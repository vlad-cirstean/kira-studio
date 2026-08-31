package adapterhost

import (
	"context"
	"encoding/json"

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

// AttachStream makes conn the current renderer connection: a Session (A18's single writer) that
// also becomes the engine child's Sink, so both producers share one queue and one conn.Send
// caller. detach supersedes this session — call it when the renderer's side closes.
func (r *Router) AttachStream(conn StreamSession) (session *Session, detach func()) {
	session = newSession(r, conn)
	var detachChild func()
	if r.child != nil {
		detachChild = r.child.AttachStream(session)
	}
	return session, func() {
		if detachChild != nil {
			detachChild()
		}
		session.Close()
	}
}

// HandleDataFrame is rpc.ts's dispatch, reimagined as a router: ping always forwards to the child
// (A17); cache:stats/cache:clear are not connection-scoped (A16); every other op reads its
// payload's connectionId and routes on that connection's kind (A12/D4).
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
		r.forwardToChild(frame)
		return
	case "cache:stats":
		r.respondCacheStats(session, probe.ID)
		return
	case "cache:clear":
		r.cache.Clear()
		r.forwardToChild(frame) // the child's own {} response flows back via the normal pass-through
		return
	}

	var connProbe struct {
		ConnectionID string `json:"connectionId"`
	}
	_ = json.Unmarshal(probe.Payload, &connProbe)

	kind, known := r.conns.KindOf(connProbe.ConnectionID)
	if !known || !r.isNative(kind) {
		r.noteChildRoute(probe.Op, kind)
		r.forwardToChild(frame)
		return
	}
	r.handleNativeDataOp(session, probe.Op, probe.ID, probe.Payload)
}

func (r *Router) forwardToChild(frame []byte) {
	if r.child == nil {
		return
	}
	if err := r.child.SendData(frame); err != nil {
		// The engine is gone. The session stays open: enginehost has already failed every
		// pending control-plane call with E_ENGINE_DOWN, and the renderer's own pending map is
		// what surfaces that for a data-plane request too — closing the stream here would
		// additionally reject frames the renderer has not sent yet, which is not today's
		// behaviour (bridge/stream.go's own prior comment, carried forward).
		r.deps.Log("warn", "engine stream send failed: "+err.Error())
	}
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

// observeChildEvent is A16's live half: the engine pushes a cache:stats event unsolicited whenever
// its own stats change (cache/index.ts's 1 Hz throttle), and this is the router's one chance to
// see it — every child data frame passes through Session.Send before being relayed to the
// renderer. The frame is still relayed unchanged after this; the renderer's own explicit
// cache:stats request (rare — nothing in the renderer actually issues one today) is what gets the
// merged, not-summed-twice answer built from this snapshot (respondCacheStats).
func (r *Router) observeChildEvent(frame []byte) {
	var probe struct {
		Kind    string          `json:"kind"`
		Topic   string          `json:"topic"`
		Payload json.RawMessage `json:"payload"`
	}
	if err := json.Unmarshal(frame, &probe); err != nil || probe.Kind != "evt" || probe.Topic != "cache:stats" {
		return
	}
	var stats enginecache.CacheStats
	if err := json.Unmarshal(probe.Payload, &stats); err != nil {
		return
	}
	r.statsMu.Lock()
	r.lastChildStats, r.haveChildStats = stats, true
	r.statsMu.Unlock()
}

func (r *Router) respondCacheStats(session *Session, id int) {
	body, err := json.Marshal(wireResponse{Kind: "res", ID: id, OK: true, Payload: r.mergedCacheStats()})
	if err != nil {
		return
	}
	session.enqueueLocal(body)
}

// mergedCacheStats is A16: the two caches' counters sum; the configured budget (not a counter)
// reports once, since both caches are configured with the same settings.cache.l2BudgetMb and
// summing it would report double the number the user actually set.
func (r *Router) mergedCacheStats() enginecache.CacheStats {
	goStats := r.cache.Stats()

	r.statsMu.Lock()
	child, haveChild := r.lastChildStats, r.haveChildStats
	r.statsMu.Unlock()
	if !haveChild {
		return goStats
	}

	return enginecache.CacheStats{
		L2Bytes:       goStats.L2Bytes + child.L2Bytes,
		L2BudgetBytes: goStats.L2BudgetBytes,
		L2Entries:     goStats.L2Entries + child.L2Entries,
		L2Hits:        goStats.L2Hits + child.L2Hits,
		L2Misses:      goStats.L2Misses + child.L2Misses,
		L3Entries:     goStats.L3Entries + child.L3Entries,
	}
}
