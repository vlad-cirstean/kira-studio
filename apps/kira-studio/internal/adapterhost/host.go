// Package adapterhost is the Go analogue of src/engine/{scheduler/ops.ts,control.ts,rpc.ts,data.ts}:
// Router serves every connection kind in-process against shell/internal/adapters (the adapter
// contract) — there is no more routing decision to make, since P58f deleted the Node engine child
// this package used to forward non-native kinds to.
package adapterhost

import (
	"context"
	"encoding/json"
	"fmt"
	"runtime/debug"
	"sync"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/enginecache"
	idgen "github.com/kirathecat/kira-studio/apps/kira-studio/internal/id"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/notify"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/oplog"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// OpSpec is the Go analogue of scheduler/ops.ts's runOp spec parameter. ConnectionID is nil for a
// connection-less op (adapter:test probes a throwaway adapter, never a live one). OpID empty mints
// a fresh id, matching runOp's `spec.opId ?? crypto.randomUUID()`.
type OpSpec struct {
	ConnectionID *string
	Kind         string // a model.OpKind value
	OpID         string
	TabID        *string
}

type runningOp struct {
	cancel       context.CancelFunc
	connectionID *string
}

// eventSub pairs one Subscribe()r's channel with a mutex so deliver and close can never race —
// notify.Emitter[T].Emit deliberately calls subscribers with its own lock released (to allow a
// callback to itself Subscribe/Unsubscribe/Emit without deadlocking), which means a callback can
// still be in flight after Unsubscribe returns. Closing ch from the unsubscribe func without this
// guard is a send-on-closed-channel panic waiting to happen; this mutex is the fix, kept local to
// each subscription rather than shared, so subscribers never contend with each other.
type eventSub struct {
	mu     sync.Mutex
	ch     chan oplog.Event
	closed bool
}

func (s *eventSub) deliver(e oplog.Event) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	select {
	case s.ch <- e:
	default:
		// A stalled subscriber's full buffer is skipped — dropping one event is better than
		// blocking every other subscriber.
	}
}

func (s *eventSub) close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.closed {
		s.closed = true
		close(s.ch)
	}
}

// Host is the Go analogue of scheduler/ops.ts's module-level running map plus control.ts's
// handler bodies for the five adapter:* ops (§4.8's RunOp) — the scheduler and the panic boundary,
// not the per-kind routing decision (router.go).
type Host struct {
	deps  adapters.Deps
	cache *enginecache.Cache

	events notify.Emitter[oplog.Event]

	mu      sync.Mutex
	running map[string]runningOp
}

// NewHost constructs a Host. cache is used by the native Connect/Disconnect handlers
// (disconnecting releases the connection's cached pages, §2.2 — see router.go).
func NewHost(deps adapters.Deps, cache *enginecache.Cache) *Host {
	return &Host{deps: deps, cache: cache, running: make(map[string]runningOp)}
}

type opStartPayload struct {
	OpID         string  `json:"opId"`
	ConnectionID *string `json:"connectionId"`
	TabID        *string `json:"tabId"`
	Kind         string  `json:"kind"`
	StartedAt    string  `json:"startedAt"`
}

type opEndPayload struct {
	OpID       string  `json:"opId"`
	Status     string  `json:"status"`
	DurationMs int     `json:"durationMs"`
	Rows       *int    `json:"rows"`
	Command    *string `json:"command"`
	Error      *string `json:"error"`
}

// RunOp is scheduler/ops.ts's runOp: mint or accept an op id, refuse a duplicate (a duplicate id
// would corrupt the op log's primary key and let the stop button cancel the wrong query), derive a
// cancellable context, emit op:start, run fn behind a recover() (P58 D16), emit op:end with a
// status/duration/rows/command/error decided the same way runOp decides them, and remove the op
// from the running map in a defer. ctx is the caller's own context (e.g. app shutdown); CancelOp is
// the explicit, opID-addressed cancellation path — both cancel the same derived context.
func (h *Host) RunOp(ctx context.Context, spec OpSpec, fn func(context.Context, *adapters.OpCtx) (any, error)) (string, any, error) {
	opID := spec.OpID
	if opID == "" {
		opID = idgen.New()
	}

	h.mu.Lock()
	if _, exists := h.running[opID]; exists {
		h.mu.Unlock()
		return "", nil, adapters.New(adapters.CodeQuery, "duplicate operation id: "+opID, nil)
	}
	derived, cancel := context.WithCancel(ctx)
	h.running[opID] = runningOp{cancel: cancel, connectionID: spec.ConnectionID}
	h.mu.Unlock()
	defer func() {
		h.mu.Lock()
		delete(h.running, opID)
		h.mu.Unlock()
		cancel()
	}()

	startedAt := model.NowISO()
	h.emitJSON(oplog.EventOpStart, opStartPayload{
		OpID: opID, ConnectionID: spec.ConnectionID, TabID: spec.TabID, Kind: spec.Kind, StartedAt: startedAt,
	})

	op := adapters.NewOpCtx(opID)
	start := time.Now()
	value, err := h.safeRun(derived, op, fn)
	durationMs := int(time.Since(start).Milliseconds())

	status := "ok"
	var errMsg *string
	if err != nil {
		status = "error"
		if derived.Err() == context.Canceled {
			status = "cancelled"
		}
		m := err.Error()
		errMsg = &m
	}
	var command *string
	if c := op.Command(); c != "" {
		command = &c
	}
	h.emitJSON(oplog.EventOpEnd, opEndPayload{
		OpID: opID, Status: status, DurationMs: durationMs, Rows: op.Rows(), Command: command, Error: errMsg,
	})

	return opID, value, err
}

// safeRun is P58 D16's recover() boundary: a panic inside fn becomes a failed op instead of
// crashing the app. E_INTERNAL deliberately is not one of adapters' eight closed error codes
// (OQ-1) — the renderer's classify() already handles an unrecognized code correctly, and adding it
// to the closed set would be a claim that ordinary adapter code can produce it on purpose.
func (h *Host) safeRun(ctx context.Context, op *adapters.OpCtx, fn func(context.Context, *adapters.OpCtx) (any, error)) (value any, err error) {
	defer func() {
		if r := recover(); r != nil {
			msg := fmt.Sprintf("internal error: %v", r)
			if h.deps.Log != nil {
				h.deps.Log("error", fmt.Sprintf("adapter panic: %v\n%s", r, debug.Stack()))
			}
			err = adapters.New(adapters.ErrorCode("E_INTERNAL"), msg, nil)
		}
	}()
	return fn(ctx, op)
}

func (h *Host) emitJSON(topic string, payload any) {
	body, err := json.Marshal(payload)
	if err != nil {
		return
	}
	h.events.Emit(oplog.Event{Topic: topic, Payload: body})
}

// CancelOp is scheduler/ops.ts's cancelOp, in the same order and for the same reason: the local
// abort unblocks the running RunOp call immediately; the adapter call is what actually kills the
// server-side work (§5.1: cancellation is always forwarded). Both steps are best-effort — an
// unknown op id, or an adapter that has already gone, is not an error, matching cancel()'s own
// "never throws for already finished" contract.
func (h *Host) CancelOp(ctx context.Context, opID string) (bool, error) {
	h.mu.Lock()
	op, ok := h.running[opID]
	h.mu.Unlock()
	if !ok {
		return false, nil
	}
	op.cancel()

	if op.connectionID != nil {
		if adapter, ok := adapters.GetLiveAdapter(*op.connectionID); ok {
			_, _ = adapter.Cancel(ctx, opID)
		}
	}
	return true, nil
}

// Subscribe returns this subscriber's own channel of every op:start/op:end event Host emits, and
// an unsubscribe func — the exact shape oplog.EventSource wants, since this Host is oplog's only
// producer now (P58f D9; it used to be fanned together with enginehost.Host's own events).
func (h *Host) Subscribe() (<-chan oplog.Event, func()) {
	sub := &eventSub{ch: make(chan oplog.Event, 32)}
	unsubscribe := h.events.Subscribe(sub.deliver)
	return sub.ch, func() {
		unsubscribe()
		sub.close()
	}
}
