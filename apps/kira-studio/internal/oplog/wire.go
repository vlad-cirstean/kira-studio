// Package oplog is the Go analogue of src/main/oplog.ts: pure orchestration over
// internal/storage/repos.OpsRepo's Append/Finish/Prune — subscribing to op:start/op:end events,
// forwarding an update for the renderer's op-log panel, and reconciling whatever was still running
// when the event source's channel closes (app shutdown, P58f D9).
package oplog

import (
	"encoding/json"
	"log/slog"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/notify"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/repos"
)

// Event is the op-log's own event shape. EventSource is a consumer-declared interface (A11's
// discipline), so its payload type belongs with the consumer, here, rather than with whichever
// producer happens to publish it first (P58f D9) — enginehost.Event was that producer's own type,
// borrowed only because oplog was its sole consumer.
type Event struct {
	Topic   string
	Payload json.RawMessage
}

// Event topics this package's consume loop switches on, mirroring ENGINE_EVENT.opStart/opEnd
// (src/shared/protocol/engine-ops.ts:21-25). There is no EventEngineDown any more (P58f D9):
// adapterhost.Host, the only producer left, never published one — that was enginehost.Host's own
// synthetic topic for a Node child exiting — and reconciliation now runs whenever the event
// channel closes for any reason, orderly shutdown included, rather than waiting for a topic that
// nothing sends.
const (
	EventOpStart = "op:start"
	EventOpEnd   = "op:end"
)

// EventSource is the slice of a producer oplog consumes — adapterhost.Host in production, a fake
// channel in a test. A one-method interface lets the reconciliation logic — this package's actual
// subject — be driven by synthetic events deterministically.
type EventSource interface {
	Subscribe() (<-chan Event, func())
}

// pruneEveryOps mirrors oplog.ts's PRUNE_EVERY_OPS (D11: bounds the table at HARD_CAP_ROWS +
// PRUNE_EVERY_OPS instead of only at the next launch).
const pruneEveryOps = 500

// opEndStatuses is opEndEventSchema's status enum — narrower than model.ValidOpStatus (which
// also accepts "running", a status op:end itself is never sent with).
var opEndStatuses = map[string]bool{"ok": true, "error": true, "cancelled": true}

var appExitedError = "app exited"

// inFlightOp is oplog.ts's InFlightOp.
type inFlightOp struct {
	connectionID *string
	tabID        *string
	kind         string
	startedAt    string
}

// Wiring is the Go analogue of oplog.ts's wireOplog, split into New/Start/Stop (P54 D14): New
// does no I/O and subscribes nothing, so every test can attach OnUpdate before the first event.
type Wiring struct {
	src           EventSource
	ops           *repos.OpsRepo
	retentionDays int

	updates     notify.Emitter[model.OpRecord]
	unsubscribe func()
}

func New(src EventSource, ops *repos.OpsRepo, retentionDays int) *Wiring {
	return &Wiring{src: src, ops: ops, retentionDays: retentionDays}
}

// OnUpdate registers fn for every op-log row lifecycle event (running, then its terminal state).
func (w *Wiring) OnUpdate(fn func(model.OpRecord)) (unsubscribe func()) {
	return w.updates.Subscribe(fn)
}

// Start prunes once (oplog.ts:28) and then consumes events on one goroutine until Stop is called
// or the event source's channel closes on its own (adapterhost.Host's, once app teardown
// unsubscribes every subscriber — P54 §4.2, P58f D9).
func (w *Wiring) Start() {
	w.prune()
	events, unsubscribe := w.src.Subscribe()
	w.unsubscribe = unsubscribe
	go w.consume(events)
}

// Stop ends the consumer goroutine early (main's before-quit; a test's own cleanup). Idempotent
// only in the sense that the event source's own unsubscribe already tolerates a second call —
// Wiring itself is only ever Stopped once in practice.
func (w *Wiring) Stop() {
	if w.unsubscribe != nil {
		w.unsubscribe()
	}
}

func (w *Wiring) prune() {
	if err := w.ops.Prune(w.retentionDays); err != nil {
		slog.Warn("prune failed", "scope", "oplog", "err", err)
	}
}

// consume is the only reader and writer of inFlight, so that map needs no mutex — nobody should
// add one. The `for evt := range events` loop ends when the event source's channel closes — Stop's
// unsubscribe (main's before-quit) causes that in production — at which point finishInFlight
// reconciles whatever never reached a terminal state (P58f D9).
func (w *Wiring) consume(events <-chan Event) {
	inFlight := map[string]inFlightOp{}
	completedSincePrune := 0

	for evt := range events {
		switch evt.Topic {
		case EventOpStart:
			w.handleOpStart(evt.Payload, inFlight)
		case EventOpEnd:
			completedSincePrune = w.handleOpEnd(evt.Payload, inFlight, completedSincePrune)
		}
	}
	w.finishInFlight(inFlight, appExitedError)
}

func (w *Wiring) handleOpStart(payload json.RawMessage, inFlight map[string]inFlightOp) {
	var evt struct {
		OpID         string  `json:"opId"`
		ConnectionID *string `json:"connectionId"`
		TabID        *string `json:"tabId"`
		Kind         string  `json:"kind"`
		StartedAt    string  `json:"startedAt"`
	}
	if err := json.Unmarshal(payload, &evt); err != nil || !model.ValidOpKind(evt.Kind) {
		return
	}

	rec := inFlightOp{connectionID: evt.ConnectionID, tabID: evt.TabID, kind: evt.Kind, startedAt: evt.StartedAt}
	inFlight[evt.OpID] = rec

	if err := w.ops.Append(model.OpAppend{
		ID: evt.OpID, ConnectionID: rec.connectionID, TabID: rec.tabID, Kind: rec.kind, StartedAt: rec.startedAt,
	}); err != nil {
		slog.Warn("append failed", "scope", "oplog", "opId", evt.OpID, "err", err)
		return
	}

	w.updates.Emit(model.OpRecord{
		ID: evt.OpID, ConnectionID: rec.connectionID, TabID: rec.tabID, StartedAt: rec.startedAt,
		DurationMs: nil, Kind: rec.kind, Status: "running", Rows: nil, Command: nil, Error: nil,
	})
}

func (w *Wiring) handleOpEnd(payload json.RawMessage, inFlight map[string]inFlightOp, completedSincePrune int) int {
	var evt struct {
		OpID       string  `json:"opId"`
		Status     string  `json:"status"`
		DurationMs int     `json:"durationMs"`
		Rows       *int    `json:"rows"`
		Command    *string `json:"command"`
		Error      *string `json:"error"`
	}
	if err := json.Unmarshal(payload, &evt); err != nil || !opEndStatuses[evt.Status] {
		return completedSincePrune
	}

	if err := w.ops.Finish(evt.OpID, model.OpFinish{
		Status: evt.Status, DurationMs: evt.DurationMs, Rows: evt.Rows, Command: evt.Command, Error: evt.Error,
	}); err != nil {
		slog.Warn("finish failed", "scope", "oplog", "opId", evt.OpID, "err", err)
		return completedSincePrune
	}

	// oplog.ts:80-84's exact fallbacks for an op:end with no matching op:start.
	started, ok := inFlight[evt.OpID]
	delete(inFlight, evt.OpID)
	record := model.OpRecord{
		ID: evt.OpID, DurationMs: &evt.DurationMs, Status: evt.Status, Rows: evt.Rows,
		Command: evt.Command, Error: evt.Error,
	}
	if ok {
		record.ConnectionID, record.TabID, record.StartedAt, record.Kind = started.connectionID, started.tabID, started.startedAt, started.kind
	} else {
		record.StartedAt, record.Kind = model.NowISO(), "test"
	}
	w.updates.Emit(record)

	completedSincePrune++
	if completedSincePrune >= pruneEveryOps {
		completedSincePrune = 0
		w.prune()
	}
	return completedSincePrune
}

// finishInFlight mirrors oplog.ts's engine:down handler, generalised from "the engine child died"
// to "the event source is done" (P58f D9): whatever op-log rows were still 'running' when consume's
// range loop ended is finished with message, and dropped from inFlight so a crash mid-session
// cannot grow the map without bound. A hard kill (SIGKILL, OOM, a panic outside Host.safeRun) still
// leaves 'running' rows — this only runs on an orderly channel close, same as it only ran on an
// orderly child exit before P58f.
func (w *Wiring) finishInFlight(inFlight map[string]inFlightOp, message string) {
	now := time.Now()
	for opID, rec := range inFlight {
		delete(inFlight, opID)

		durationMs := 0 // a startedAt that will not parse yields 0 — JS gives NaN there, which
		// is not a number SQLite should store, and 0 is the honest value for "we cannot tell".
		if started, err := model.ParseISO(rec.startedAt); err == nil {
			if d := int(now.Sub(started).Milliseconds()); d > 0 {
				durationMs = d
			}
		}

		if err := w.ops.Finish(opID, model.OpFinish{
			Status: "error", DurationMs: durationMs, Rows: nil, Command: nil, Error: &message,
		}); err != nil {
			slog.Warn("shutdown finish failed", "scope", "oplog", "opId", opID, "err", err)
		}
	}
}
