package notify

import (
	"sync"
	"sync/atomic"
)

// OrderedEmitter wraps Emitter[T] with the emitSeq/lastEmitted "never publish a stale snapshot"
// guard dbmcp.ApprovalBroker and gitsock.Broker each hand-rolled identically (P107 T2-8): every
// state change that produces a value to emit takes NextSeq (typically while still holding
// whatever lock protects that state), builds its snapshot, releases the lock, then calls Emit(seq,
// v) — a call whose seq is not strictly greater than the highest already emitted is dropped, so
// two callers racing to Emit after releasing their lock in the opposite order from the
// mutex-protected changes that produced their snapshots can never let a stale one win. The zero
// value is ready to use.
type OrderedEmitter[T any] struct {
	emitter     Emitter[T]
	seq         atomic.Uint64
	lastEmitted atomic.Uint64
	// emitMu serializes Emit's whole check-and-deliver sequence (F8/P108 Part 2 — reported as F7
	// against dbmcp.ApprovalBroker/gitsock.Broker, the two callers): the original CAS-then-deliver
	// had a gap between winning the CAS and calling e.emitter.Emit(v) where a second, actually
	// newer Emit call could win its own CAS and deliver first, so the first call's now-stale value
	// still went out last. Holding one lock across both steps (separate from whatever lock each
	// caller already holds across its own NextSeq/build-snapshot/Emit sequence — this one is
	// private to the emitter, not shared with the caller) closes that gap: "publish" and "record
	// the high-water mark" happen as one atomic step. Safe against every real subscriber today —
	// none calls back into Emit synchronously from within its own callback (confirmed by reading
	// the one production subscriber, bridge/events.go's Attach, which only forwards to Wails'
	// EventsEmit) — so this cannot self-deadlock; a future subscriber that did call back in would
	// need the mailbox-plus-delivery-goroutine shape instead, not this lock.
	emitMu sync.Mutex
}

// Subscribe registers fn — Emitter.Subscribe's own contract.
func (e *OrderedEmitter[T]) Subscribe(fn func(T)) (unsubscribe func()) {
	return e.emitter.Subscribe(fn)
}

// NextSeq assigns and returns the next emit sequence number. Call it once per state change (an
// atomic increment, so — unlike the two hand-rolled originals — it needs no lock of its own even
// when called outside whatever lock protects the state it is sequencing), then Emit after
// releasing that lock.
func (e *OrderedEmitter[T]) NextSeq() uint64 {
	return e.seq.Add(1)
}

// Emit publishes v under seq (from NextSeq), unless a later-sequenced value already went out.
// emitMu holds the check and the delivery together (see its own doc comment) so two calls can
// never interleave into "the stale one delivers last".
func (e *OrderedEmitter[T]) Emit(seq uint64, v T) {
	e.emitMu.Lock()
	defer e.emitMu.Unlock()
	if seq <= e.lastEmitted.Load() {
		return // superseded — a value reflecting this state and more already went out
	}
	e.lastEmitted.Store(seq)
	e.emitter.Emit(v)
}

// PendingQueue is a FIFO of pending, id-keyed entries — dbmcp.ApprovalBroker's queue/byID pair and
// gitsock.Broker's own, restated once (P107 T2-8). R is whatever entry type the caller stores;
// both existing callers store a pointer to their own request-plus-result-channel struct, keyed by
// a RequestID they mint themselves before calling Add. Not safe for concurrent use on its own —
// both callers already hold their own mutex across every call, the same as the queue/byID fields
// this replaces.
type PendingQueue[R any] struct {
	order []string
	byID  map[string]R
}

// NewPendingQueue constructs an empty PendingQueue.
func NewPendingQueue[R any]() *PendingQueue[R] {
	return &PendingQueue[R]{byID: map[string]R{}}
}

// Len reports how many entries are queued — dbmcp's maxPendingApprovals/gitsock's maxQueueLen own
// cap check.
func (q *PendingQueue[R]) Len() int { return len(q.order) }

// Add appends id/entry to the back of the queue.
func (q *PendingQueue[R]) Add(id string, entry R) {
	q.byID[id] = entry
	q.order = append(q.order, id)
}

// Remove drops id and returns its entry, reporting whether it was present — a combined
// get-and-delete, since neither existing caller ever needs to peek an entry without also removing
// it.
func (q *PendingQueue[R]) Remove(id string) (R, bool) {
	entry, ok := q.byID[id]
	if !ok {
		return entry, false
	}
	delete(q.byID, id)
	for i, oid := range q.order {
		if oid == id {
			q.order = append(q.order[:i], q.order[i+1:]...)
			break
		}
	}
	return entry, true
}

// Snapshot returns every entry in FIFO order — a fresh copy, safe for the caller to range over
// (and to call Remove from mid-iteration) without aliasing this queue's own internal slice.
func (q *PendingQueue[R]) Snapshot() []R {
	out := make([]R, 0, len(q.order))
	for _, id := range q.order {
		out = append(out, q.byID[id])
	}
	return out
}

// Clear empties the queue and returns every entry that was in it, in FIFO order — AbandonAll's and
// Shutdown's own "resolve everything still queued" step.
func (q *PendingQueue[R]) Clear() []R {
	out := q.Snapshot()
	q.order = nil
	q.byID = map[string]R{}
	return out
}
