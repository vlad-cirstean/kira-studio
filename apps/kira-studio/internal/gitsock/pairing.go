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
	presented := len(b.queue) == 1
	snap := b.snapshotLocked()
	b.mu.Unlock()

	if onEnqueued != nil {
		onEnqueued(entry.req)
	}
	if presented {
		b.emitter.Emit(snap)
	}
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
	if cooldownOnDeny && !expired {
		b.cooldown[entry.req.ClientID] = b.now().Add(pairingCooldown)
	}
	snap := b.snapshotLocked()
	b.mu.Unlock()

	if expired {
		entry.result <- PairingTimedOut
	} else {
		entry.result <- outcome
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
