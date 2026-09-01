package adapterhost

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"runtime/debug"
	"strconv"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/enginecache"
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

	// P2 R2: host.go's safeRun (P58 D16) only wraps a call already routed through Host.RunOp — but
	// Dispatcher.Preview deliberately never goes through RunOp (it must not appear in the op log,
	// data.go's own doc comment on Preview), and several other paths here (Invalidate, the cache
	// fast paths around Read/Count, every RunOp result's own `any` type assertion) never do either.
	// Each of those runs on this frame's own goroutine (HandleDataFrameAsync), so an unrecovered
	// panic here previously took the whole process down instead of failing just this one request.
	// This mirrors safeRun's own contract (recover, log, answer with E_INTERNAL) at the one point
	// that actually covers every op dispatched from a frame, known-request-id included.
	defer func() {
		if rec := recover(); rec != nil {
			if r.deps.Log != nil {
				r.deps.Log("error", fmt.Sprintf("data frame panic: %v\n%s", rec, debug.Stack()))
			}
			r.respondError(session, probe.ID, adapters.New(adapters.ErrorCode("E_INTERNAL"), fmt.Sprintf("internal error: %v", rec), nil))
		}
	}()

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

	r.handleDataOp(session, probe.Op, probe.ID, probe.Payload)
}

// HandleDataFrameAsync is ServeEngineStream's own per-frame dispatch: HandleDataFrame runs on its
// own goroutine so a slow op never serialises behind it, but bounded (P2 R1) — it blocks until a
// concurrency slot is free (or the session closes) before spawning, so a burst of frames can't grow
// goroutines/driver work without bound. Returns immediately (without spawning) once the session has
// closed, matching every other session-scoped operation's own no-op-after-close contract.
func (r *Router) HandleDataFrameAsync(session *Session, frame []byte) {
	if !session.acquireSlot() {
		return
	}
	go func() {
		defer session.releaseSlot()
		r.HandleDataFrame(session, frame)
	}()
}

// pingPayload is port.ts's PingPayload (packages/shared/protocol/port.ts:18-22), byte-compatible with
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

func (r *Router) handleDataOp(session *Session, op string, id int, payload json.RawMessage) {
	// P2 R1: session.ctx, not context.Background() — an op derived from Background() has no way
	// to be bounded by anything but an explicit ops:cancel RPC, so it outlives its own session
	// (and the now-gone renderer request that started it) indefinitely once the session closes.
	ctx := session.ctx
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

// maxResponsePayloadBytes leaves generous room for wireResponse's own envelope (kind/id/ok) below
// session.go's hard maxDataFrameBytes cap — resp is checked against this before ever reaching the
// queue, so a payload that would be silently unrepresentable there is turned into an error response
// instead of a frame that can never be delivered (P2 R1: a dropped response has no other way to
// ever settle its pending request, per enqueueResponse's own doc comment).
const maxResponsePayloadBytes = maxDataFrameBytes - 4096

func (r *Router) respond(session *Session, id int, payload any, err error) {
	if err != nil {
		r.respondError(session, id, err)
		return
	}
	body, encErr := json.Marshal(wireResponse{Kind: "res", ID: id, OK: true, Payload: payload})
	if encErr != nil {
		r.deps.Log("error", "failed to encode a response frame: "+encErr.Error())
		r.respondError(session, id, adapters.New(adapters.CodeQuery, "failed to encode the response", nil))
		return
	}
	if len(body) > maxResponsePayloadBytes {
		r.deps.Log("error", "response frame exceeds the size limit, substituting an error response")
		r.respondError(session, id, adapters.New(adapters.CodeQuery, "the response was too large to return", nil))
		return
	}
	session.enqueueResponse(body)
}

func (r *Router) respondError(session *Session, id int, err error) {
	code := ""
	var ae *adapters.Error
	if errors.As(err, &ae) {
		code = string(ae.Code)
	}
	body, encErr := json.Marshal(wireResponse{Kind: "res", ID: id, OK: false, Error: &wireError{Message: err.Error(), Code: code}})
	if encErr != nil {
		// Vanishingly unlikely (every field here is a plain string/int) but still must not leave
		// id's pending request unanswered forever — a hardcoded literal needs no encoder at all.
		body = []byte(`{"kind":"res","id":` + strconv.Itoa(id) + `,"ok":false,"error":{"message":"internal error"}}`)
	}
	session.enqueueResponse(body)
}

func (r *Router) respondCacheStats(session *Session, id int) {
	body, err := json.Marshal(wireResponse{Kind: "res", ID: id, OK: true, Payload: r.cache.Stats()})
	if err != nil {
		r.respondError(session, id, adapters.New(adapters.CodeQuery, "failed to encode the response", nil))
		return
	}
	session.enqueueResponse(body)
}
