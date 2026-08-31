package adapterhost

import (
	"context"
	"encoding/json"
	"os"
	"time"

	"github.com/kirathecat/kira-studio/shell/internal/adapters"
	"github.com/kirathecat/kira-studio/shell/internal/enginecache"
)

// This file is bridge/stream.go's real subject after M4 (§4.10): the data plane stops being a
// byte forwarder and becomes a server. A frame from the renderer is parsed just enough to decide
// routing (op, and for a connection-scoped op, its connectionId) — never fully, and never at all
// for a frame the router only relays.

type wireError struct {
	Message string `json:"message"`
	Code    string `json:"code,omitempty"`
}

type wireResponse struct {
	Kind    string     `json:"kind"`
	ID      int        `json:"id"`
	OK      bool       `json:"ok"`
	Payload any        `json:"payload,omitempty"`
	Error   *wireError `json:"error,omitempty"`
}

type wireEvent struct {
	Kind    string `json:"kind"`
	Topic   string `json:"topic"`
	Payload any    `json:"payload"`
}

// AttachStream makes conn the current renderer connection: a Session (A18's single writer)
// subscribed to the Go cache's own stats-changed notifications (D12), which is what feeds the
// status bar's cache readout. detach supersedes this session — call it when the renderer's side
// closes.
func (r *Router) AttachStream(conn StreamSession) (session *Session, detach func()) {
	session = newSession(conn)
	unsubscribeStats := r.cache.OnStatsChanged(func(stats enginecache.CacheStats) {
		r.pushCacheStats(session, stats)
	})
	return session, func() {
		unsubscribeStats()
		session.Close()
	}
}

// pushCacheStats emits an unsolicited cache:stats event frame — the exact shape port.ts's
// handleMessage dispatches on and data.onCacheStats consumes.
func (r *Router) pushCacheStats(session *Session, stats enginecache.CacheStats) {
	body, err := json.Marshal(wireEvent{Kind: "evt", Topic: "cache:stats", Payload: stats})
	if err != nil {
		return
	}
	session.enqueueLocal(body)
}

// HandleDataFrame is rpc.ts's dispatch, reimagined as a router: ping is answered in-process — the
// engine is this process now (P58f D11); cache:stats/cache:clear are not connection-scoped (A16);
// every other op is served in-process too, since every kind has been native since P58e M9.3
// (P58f Phase 4 deleted the Node child this used to forward a non-native kind's op to).
func (r *Router) HandleDataFrame(session *Session, frame []byte) {
	var probe struct {
		Kind    string          `json:"kind"`
		ID      int             `json:"id"`
		Op      string          `json:"op"`
		Payload json.RawMessage `json:"payload"`
	}
	if err := json.Unmarshal(frame, &probe); err != nil || probe.Kind != "req" {
		// Matches stdio-main.ts's own "dropped an unparseable frame" / kind-check no-op.
		return
	}

	switch probe.Op {
	case "ping":
		r.respondPing(session, probe.ID)
		return
	case "cache:stats":
		r.respondCacheStats(session, probe.ID)
		return
	case "cache:clear":
		r.cache.Clear()
		r.respond(session, probe.ID, struct{}{}, nil)
		return
	}

	r.handleNativeDataOp(session, probe.Op, probe.ID, probe.Payload)
}

// pingPayload is port.ts's PingPayload (src/shared/protocol/port.ts:18-22), byte-compatible with
// what rpc.ts's own ping handler used to return — state/engine.ts and StatusBar.vue read it
// unchanged (P58f D11).
type pingPayload struct {
	Pong      bool  `json:"pong"`
	EnginePid int   `json:"enginePid"`
	At        int64 `json:"at"`
}

// respondPing answers the data plane's own health probe locally.
func (r *Router) respondPing(session *Session, id int) {
	r.respond(session, id, pingPayload{Pong: true, EnginePid: os.Getpid(), At: time.Now().UnixMilli()}, nil)
}

func decodeAndValidate[T interface{ Validate() error }](payload json.RawMessage, out *T) error {
	if err := json.Unmarshal(payload, out); err != nil {
		return err
	}
	return (*out).Validate()
}

func (r *Router) handleNativeDataOp(session *Session, op string, id int, payload json.RawMessage) {
	ctx := context.Background()
	switch op {
	case "data:read":
		var req ReadRequestWire
		if err := decodeAndValidate(payload, &req); err != nil {
			r.respondError(session, id, err)
			return
		}
		resp, err := r.dispatcher.Read(ctx, req)
		r.respond(session, id, resp, err)
	case "data:count":
		var req CountRequestWire
		if err := decodeAndValidate(payload, &req); err != nil {
			r.respondError(session, id, err)
			return
		}
		resp, err := r.dispatcher.Count(ctx, req)
		r.respond(session, id, resp, err)
	case "data:invalidate":
		var req InvalidateRequestWire
		if err := decodeAndValidate(payload, &req); err != nil {
			r.respondError(session, id, err)
			return
		}
		r.dispatcher.Invalidate(req)
		r.respond(session, id, struct{}{}, nil)
	case "data:preview":
		var req PreviewRequestWire
		if err := decodeAndValidate(payload, &req); err != nil {
			r.respondError(session, id, err)
			return
		}
		resp, err := r.dispatcher.Preview(req)
		r.respond(session, id, resp, err)
	case "data:mutate":
		var req MutateRequestWire
		if err := decodeAndValidate(payload, &req); err != nil {
			r.respondError(session, id, err)
			return
		}
		resp, err := r.dispatcher.Mutate(ctx, req)
		r.respond(session, id, resp, err)
	case "data:execute":
		var req ExecuteRequestWire
		if err := decodeAndValidate(payload, &req); err != nil {
			r.respondError(session, id, err)
			return
		}
		resp, err := r.dispatcher.Execute(ctx, req)
		r.respond(session, id, resp, err)
	case "data:objectDownload":
		var req ObjectDownloadRequestWire
		if err := decodeAndValidate(payload, &req); err != nil {
			r.respondError(session, id, err)
			return
		}
		resp, err := r.dispatcher.ObjectDownload(ctx, req)
		r.respond(session, id, resp, err)
	default:
		r.respondError(session, id, adapters.New(adapters.CodeUnsupported, "unknown op: "+op, nil))
	}
}

func (r *Router) respond(session *Session, id int, payload any, err error) {
	if err != nil {
		r.respondError(session, id, err)
		return
	}
	body, encErr := json.Marshal(wireResponse{Kind: "res", ID: id, OK: true, Payload: payload})
	if encErr != nil {
		r.deps.Log("error", "failed to encode a response frame: "+encErr.Error())
		return
	}
	session.enqueueLocal(body)
}

func (r *Router) respondError(session *Session, id int, err error) {
	code := ""
	if ae, ok := err.(*adapters.Error); ok {
		code = string(ae.Code)
	}
	body, encErr := json.Marshal(wireResponse{Kind: "res", ID: id, OK: false, Error: &wireError{Message: err.Error(), Code: code}})
	if encErr != nil {
		return
	}
	session.enqueueLocal(body)
}

func (r *Router) respondCacheStats(session *Session, id int) {
	body, err := json.Marshal(wireResponse{Kind: "res", ID: id, OK: true, Payload: r.cache.Stats()})
	if err != nil {
		return
	}
	session.enqueueLocal(body)
}
