package gitsock

import (
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/notify"
)

// D8's fixed windows: 120s from enqueue (not from being presented), 60s cooldown on an explicit
// deny only.
const (
	pairingTimeout  = 120 * time.Second
	pairingCooldown = 60 * time.Second
)

// maxQueueLen bounds Broker.queue. G31 round-2 architecture/security review, finding #10:
// clientID is entirely client-supplied (handshake.go's own hello.Client.ID, unauthenticated until
// a pairing decision grants it a token), and Request never limited how many requests could be
// queued at once — nothing stops a local process from opening many concurrent connections and
// enqueueing a pairing request on each one, growing the queue (and the goroutines blocked waiting
// on each entry's own result channel) without bound for up to pairingTimeout before
// ExpireOverdue reaps them. Beyond this cap, Request denies immediately rather than enqueueing —
// the same short-circuit shape the cooldown check just above already uses.
const maxQueueLen = 200

// PairingOutcome is Broker.Request's own vocabulary — never a Go error (F7's precedent: a pairing
// decision is a value, not a failure).
type PairingOutcome int

const (
	PairingApproved PairingOutcome = iota
	PairingDenied
	PairingTimedOut
)

// PairingActionResult is what Approve/Deny report — also never an error (D19).
type PairingActionResult int

const (
	PairingActionResolved PairingActionResult = iota
	PairingActionAlreadyResolved
	PairingActionExpired
)

// PairingRequest is one queued request — what a window's prompt renders.
type PairingRequest struct {
	RequestID  string
	ClientID   string
	Label      string
	EnqueuedAt time.Time
	ExpiresAt  time.Time
}

// PairingSnapshot is emitted on every queue change: the head request (nil when empty) plus how
// many are waiting behind it (SPEC §3.3's "visible count").
type PairingSnapshot struct {
	Pending *PairingRequest
	Queued  int
}

type pendingEntry struct {
	req    PairingRequest
	result chan PairingOutcome // buffered 1; exactly one send over the entry's lifetime.
}

// Broker implements D8's queue/cooldown/injected-clock state machine — a FIFO of pending requests
// (at most one "presented", always the head), a per-clientID cooldown map, and a
// notify.Emitter[PairingSnapshot] fanning out every change. It knows nothing about whether any
// Kira Studio window is open (F9) — "held with no window open yet" (SPEC §3.3) falls out for free:
// the request simply sits at the head, presented, until a window later calls Pending() and renders
// it, or its deadline expires.
type Broker struct {
	now func() time.Time

	mu       sync.Mutex
	queue    []*pendingEntry
	byID     map[string]*pendingEntry
	cooldown map[string]time.Time

	emitter notify.Emitter[PairingSnapshot]
}

func NewBroker(now func() time.Time) *Broker {
	return &Broker{now: now, byID: map[string]*pendingEntry{}, cooldown: map[string]time.Time{}}
}

func (b *Broker) Subscribe(fn func(PairingSnapshot)) (unsubscribe func()) {
	return b.emitter.Subscribe(fn)
}

// Pending is the snapshot a newly opened window fetches on mount.
func (b *Broker) Pending() PairingSnapshot {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.snapshotLocked()
}

func (b *Broker) snapshotLocked() PairingSnapshot {
	if len(b.queue) == 0 {
		return PairingSnapshot{}
	}
	head := b.queue[0].req
	return PairingSnapshot{Pending: &head, Queued: len(b.queue)}
}

// InCooldown reports whether clientID is inside its 60s post-denial window (handshake row 6).
func (b *Broker) InCooldown(clientID string) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	until, ok := b.cooldown[clientID]
	return ok && b.now().Before(until)
}

// Request enqueues (clientID, label) and blocks the calling goroutine until it is approved,
// denied, or its deadline elapses. onEnqueued is called synchronously, before Request blocks, with
// the request as minted (its RequestID and deadline) — the handshake uses it to send
// "pairingRequired" with real values before waiting on the outcome.
//
// A cooldown check happens first and short-circuits with neither enqueueing nor emitting (D8): a
// client mid-cooldown gets an immediate, silent "denied".
func (b *Broker) Request(clientID, label string, onEnqueued func(PairingRequest)) PairingOutcome {
	b.mu.Lock()
	if until, ok := b.cooldown[clientID]; ok && b.now().Before(until) {
		b.mu.Unlock()
		return PairingDenied
	}
	if len(b.queue) >= maxQueueLen {
		b.mu.Unlock()
		return PairingDenied
	}
	now := b.now()
	entry := &pendingEntry{
		req: PairingRequest{
			RequestID: uuid.NewString(), ClientID: clientID, Label: label,
			EnqueuedAt: now, ExpiresAt: now.Add(pairingTimeout),
		},
		result: make(chan PairingOutcome, 1),
	}
	b.queue = append(b.queue, entry)
	b.byID[entry.req.RequestID] = entry
	snap := b.snapshotLocked()
	b.mu.Unlock()

	if onEnqueued != nil {
		onEnqueued(entry.req)
	}
	// G31 round-2 functional-correctness review, finding #6: this used to emit only when the new
	// request became the presented head (`presented := len(b.queue) == 1` at append time) — so
	// enqueueing a second or third request behind an already-presented head changed
	// snapshotLocked's own Queued count (SPEC §3.3's "concurrent requests queue with a visible
	// count") but never told any subscriber. GitPairingDialog.vue's own "1 of {{ queued }}
	// waiting" line, fed solely by this emitter (bridge/events.go, state/gitClients.ts), stayed
	// stuck at 1 until the head was approved/denied/expired, no matter how many more requests
	// queued up behind it. Every enqueue changes Queued by construction (the append above always
	// succeeds), so every enqueue is worth emitting — main.go's own subscriber already dedupes on
	// RequestID for exactly this case ("a snapshot emitted because the count behind it changed
	// re-presents the same RequestID and is not [worth re-presenting]"), so this was already the
	// assumed contract on the consuming side.
	b.emitter.Emit(snap)
	return <-entry.result
}

// Approve resolves requestID as approved. Deny resolves it as denied and starts its client's 60s
// cooldown (D8) — unless the deadline had already passed, in which case it is reported Expired,
// exactly like a timeout, and no cooldown is set (the user's decision arrived too late to be one).
func (b *Broker) Approve(requestID string) PairingActionResult {
	return b.answer(requestID, PairingApproved, false)
}

func (b *Broker) Deny(requestID string) PairingActionResult {
	return b.answer(requestID, PairingDenied, true)
}

func (b *Broker) answer(requestID string, outcome PairingOutcome, cooldownOnDeny bool) PairingActionResult {
	b.mu.Lock()
	entry, ok := b.byID[requestID]
	if !ok {
		b.mu.Unlock()
		return PairingActionAlreadyResolved
	}
	expired := !b.now().Before(entry.req.ExpiresAt)
	b.removeLocked(entry)
	var others []*pendingEntry
	if cooldownOnDeny && !expired {
		b.cooldown[entry.req.ClientID] = b.now().Add(pairingCooldown)
		// G31 round-2 architecture/security review, finding #10: an explicit Deny only ever
		// resolved the ONE entry named by requestID — in practice always the presented head,
		// since that is the only request a window's dialog ever has a RequestID for. Nothing
		// stops the SAME clientID from having other requests already queued behind it (opened
		// from several concurrent connections before the first was ever presented), and those
		// survived untouched — bypassing the cooldown this denial just started, since the
		// cooldown only short-circuits a NEW Request() call above, never one already queued.
		// Denying a client now also resolves every other request already queued from it, as
		// denied, under the same cooldown just started.
		others = b.removeAllForClientLocked(entry.req.ClientID)
	}
	snap := b.snapshotLocked()
	b.mu.Unlock()

	if expired {
		entry.result <- PairingTimedOut
	} else {
		entry.result <- outcome
	}
	for _, other := range others {
		other.result <- PairingDenied
	}
	b.emitter.Emit(snap)
	if expired {
		return PairingActionExpired
	}
	return PairingActionResolved
}

// ExpireOverdue resolves every queued request whose deadline has passed, as PairingTimedOut — no
// cooldown, since a timeout expresses no opinion (D8). Production wiring (Server.expireLoop) calls
// this on a real 1s ticker; tests call it directly after advancing an injected clock, no sleep
// required.
func (b *Broker) ExpireOverdue() {
	b.mu.Lock()
	now := b.now()
	var overdue []*pendingEntry
	for _, entry := range b.queue {
		if !now.Before(entry.req.ExpiresAt) {
			overdue = append(overdue, entry)
		}
	}
	for _, entry := range overdue {
		b.removeLocked(entry)
	}
	snap := b.snapshotLocked()
	b.mu.Unlock()

	for _, entry := range overdue {
		entry.result <- PairingTimedOut
	}
	if len(overdue) > 0 {
		b.emitter.Emit(snap)
	}
}

// removeLocked drops entry from both byID and the queue slice. Caller holds b.mu.
func (b *Broker) removeLocked(entry *pendingEntry) {
	delete(b.byID, entry.req.RequestID)
	for i, e := range b.queue {
		if e == entry {
			b.queue = append(b.queue[:i], b.queue[i+1:]...)
			break
		}
	}
}

// removeAllForClientLocked drops every remaining queued entry belonging to clientID from both
// byID and the queue slice, and returns them so the caller can resolve their result channels
// outside the lock. Caller holds b.mu.
func (b *Broker) removeAllForClientLocked(clientID string) []*pendingEntry {
	var removed []*pendingEntry
	kept := b.queue[:0]
	for _, e := range b.queue {
		if e.req.ClientID == clientID {
			delete(b.byID, e.req.RequestID)
			removed = append(removed, e)
		} else {
			kept = append(kept, e)
		}
	}
	b.queue = kept
	return removed
}
