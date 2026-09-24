package gitsock

import (
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/kirathecat/kira-studio/internal/notify"
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
// ExpireOverdue reaps them. Beyond this cap, Request aborts immediately rather than enqueueing —
// the same short-circuit shape the cooldown check just above already uses (F11: aborted, not
// denied — capacity is not a decision about this particular client).
const maxQueueLen = 200

// PairingOutcome is Broker.Request's own vocabulary — never a Go error (F7's precedent: a pairing
// decision is a value, not a failure).
type PairingOutcome int

const (
	PairingApproved PairingOutcome = iota
	PairingDenied
	PairingTimedOut
	// PairingAborted is F11's outcome for a request resolved by something that is not a user
	// decision — the server shutting down, the queue already at its cap, or Request being called
	// after Shutdown — as distinct from PairingDenied, which is always a real user Deny (and its
	// cooldown). runHandshake answers it with the row-1 posture (close, no frame) rather than a
	// "denied" frame, so the client's ordinary backoff-reconnect path runs instead of its terminal,
	// manual-retry-only denied state.
	PairingAborted
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

// approvedToken is the single token an approval decision mints (F6) — shared verbatim by the
// presented head and every sibling request already queued from the same clientID, so every window
// of one VS Code install receives and stores the identical token instead of each one racing its
// own independently-minted token against the same trust-store row. Read via TakeApprovedToken,
// keyed by RequestID so each connection's own runHandshake fetches only its own copy.
type approvedToken struct {
	plain string
	hash  []byte
	salt  []byte
}

// Broker implements D8's queue/cooldown/injected-clock state machine — a FIFO of pending requests
// (at most one "presented", always the head), a per-clientID cooldown map, and a
// notify.OrderedEmitter[PairingSnapshot] fanning out every change (P107 T2-8: the queue and the
// ordered-emit guard both now come from internal/notify, shared with dbmcp.ApprovalBroker). It
// knows nothing about whether any Kira Space window is open (F9) — "held with no window open yet"
// (SPEC §3.3) falls out for free: the request simply sits at the head, presented, until a window
// later calls Pending() and renders it, or its deadline expires.
type Broker struct {
	now func() time.Time

	mu       sync.Mutex
	queue    *notify.PendingQueue[*pendingEntry]
	cooldown map[string]time.Time
	// closed is F4(b)'s own guard: once Shutdown has run, expireLoop has already exited (its
	// closeCh is closed) so nothing will ever resolve a freshly enqueued entry's result channel,
	// and closing the underlying net.Conn does nothing to unblock a channel receive either —
	// Request must refuse outright rather than enqueue once this is set.
	closed bool
	// tokens holds each still-unclaimed approvedToken, keyed by the RequestID it was minted for
	// (F6) — populated by answer() at the moment of Approve, drained by TakeApprovedToken.
	tokens map[string]approvedToken

	emitter notify.OrderedEmitter[PairingSnapshot]
}

func NewBroker(now func() time.Time) *Broker {
	return &Broker{
		now: now, queue: notify.NewPendingQueue[*pendingEntry](),
		cooldown: map[string]time.Time{}, tokens: map[string]approvedToken{},
	}
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
	items := b.queue.Snapshot()
	if len(items) == 0 {
		return PairingSnapshot{}
	}
	head := items[0].req
	return PairingSnapshot{Pending: &head, Queued: len(items)}
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
	// F4(b)/F11: a handshake that already read hello but reaches Request only after Shutdown has
	// already cleared the queue must not enqueue a fresh entry nobody will ever resolve. Aborted,
	// not Denied — the server going away is not a user decision about this client.
	if b.closed {
		b.mu.Unlock()
		return PairingAborted
	}
	// A real Deny's own cooldown: this IS a user decision (D8), so it stays Denied.
	if until, ok := b.cooldown[clientID]; ok && b.now().Before(until) {
		b.mu.Unlock()
		return PairingDenied
	}
	// F11: the queue being full is capacity, not a user decision about this client — Aborted.
	if b.queue.Len() >= maxQueueLen {
		b.mu.Unlock()
		return PairingAborted
	}
	now := b.now()
	entry := &pendingEntry{
		req: PairingRequest{
			RequestID: uuid.NewString(), ClientID: clientID, Label: label,
			EnqueuedAt: now, ExpiresAt: now.Add(pairingTimeout),
		},
		result: make(chan PairingOutcome, 1),
	}
	b.queue.Add(entry.req.RequestID, entry)
	snap := b.snapshotLocked()
	seq := b.emitter.NextSeq()
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
	b.emitter.Emit(seq, snap)
	return <-entry.result
}

// Approve resolves requestID as approved, and — F6 — every OTHER request already queued from the
// SAME clientID too, sharing one freshly minted token across all of them (TakeApprovedToken).
// Deny resolves requestID as denied and starts its client's 60s cooldown (D8), also purging every
// sibling request from the same clientID as denied under that same cooldown. Either way, a
// deadline that had already passed by the time the decision arrived is reported Expired instead,
// exactly like a timeout, and neither a cooldown nor a token is set (the decision arrived too
// late to be one).
func (b *Broker) Approve(requestID string) PairingActionResult {
	return b.answer(requestID, PairingApproved, false)
}

func (b *Broker) Deny(requestID string) PairingActionResult {
	return b.answer(requestID, PairingDenied, true)
}

func (b *Broker) answer(requestID string, outcome PairingOutcome, isDeny bool) PairingActionResult {
	b.mu.Lock()
	entry, ok := b.queue.Remove(requestID)
	if !ok {
		b.mu.Unlock()
		return PairingActionAlreadyResolved
	}
	expired := !b.now().Before(entry.req.ExpiresAt)
	var others []*pendingEntry
	var mintFailed bool
	if !expired {
		// G31 round-2 architecture/security review, finding #10 (Deny's own half) / F6 (Approve's):
		// a decision on requestID only ever resolved that ONE entry — in practice always the
		// presented head, since that is the only request a window's dialog ever has a RequestID
		// for. Nothing stops the SAME clientID from having other requests already queued behind it
		// (opened from several concurrent connections — one VS Code install's several windows —
		// before the first was ever presented), and those survived untouched: for Deny, bypassing
		// the cooldown this denial just started; for Approve, each sibling window's own
		// finishPairing call would separately mint and store ITS OWN token, racing the others
		// against the same trust-store row (G12 D4's "one row covers every window" design intent
		// violated). Both decisions now also resolve every other request already queued from the
		// same clientID, under the same outcome.
		others = b.removeAllForClientLocked(entry.req.ClientID)
		if isDeny {
			b.cooldown[entry.req.ClientID] = b.now().Add(pairingCooldown)
		} else {
			// F6: mint exactly once for this whole approval decision, and stash it for the head
			// and every sibling alike — TakeApprovedToken hands each connection's own runHandshake
			// its copy once that connection's own outcome resolves.
			plain, hash, salt, err := mintToken()
			if err != nil {
				mintFailed = true
			} else {
				tok := approvedToken{plain: plain, hash: hash, salt: salt}
				b.tokens[entry.req.RequestID] = tok
				for _, other := range others {
					b.tokens[other.req.RequestID] = tok
				}
			}
		}
	}
	snap := b.snapshotLocked()
	seq := b.emitter.NextSeq()
	b.mu.Unlock()

	if mintFailed {
		slog.Warn("gitsock: mint token for pairing approval", "scope", "gitsock", "client", entry.req.ClientID)
	}

	// A mint failure degrades the whole decision to denied (fail-closed, D6's own posture) rather
	// than approving without a token to hand any window — every sibling shares this fate exactly
	// like it would have shared a successfully minted token.
	headOutcome, siblingOutcome := outcome, PairingDenied
	if !isDeny {
		if mintFailed {
			headOutcome = PairingDenied
		} else {
			siblingOutcome = PairingApproved
		}
	}

	if expired {
		entry.result <- PairingTimedOut
	} else {
		entry.result <- headOutcome
	}
	for _, other := range others {
		other.result <- siblingOutcome
	}
	b.emitter.Emit(seq, snap)
	if expired {
		return PairingActionExpired
	}
	return PairingActionResolved
}

// Cancel removes requestID from the queue, if it is still there, and resolves it PairingAborted
// (F12) — the requester itself disconnected while its decision was still pending (window closed,
// extension reload). Without this, the entry stays queued and presentable until its own
// pairingTimeout deadline, and an Approve landing in that window mints a trusted git_clients row
// for a connection nobody holds any more. A no-op — no send, no emit — if requestID was already
// resolved (approved/denied/expired) by the time this runs: queue.Remove reports that with ok
// false, exactly like answer's and ExpireOverdue's own already-resolved guards.
func (b *Broker) Cancel(requestID string) {
	b.mu.Lock()
	entry, ok := b.queue.Remove(requestID)
	if !ok {
		b.mu.Unlock()
		return
	}
	snap := b.snapshotLocked()
	seq := b.emitter.NextSeq()
	b.mu.Unlock()

	entry.result <- PairingAborted
	b.emitter.Emit(seq, snap)
}

// TakeApprovedToken returns (and forgets) the token Approve minted for requestID — the single
// token shared by the whole approval decision (F6: the presented head and every sibling request
// from the same clientID). ok is false when nothing was ever stored for this id: a Denied or
// TimedOut outcome, or an Approved outcome that lost the race against a token-mint failure
// (degraded to Denied — see answer's own comment).
func (b *Broker) TakeApprovedToken(requestID string) (approvedToken, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	tok, ok := b.tokens[requestID]
	if ok {
		delete(b.tokens, requestID)
	}
	return tok, ok
}

// ExpireOverdue resolves every queued request whose deadline has passed, as PairingTimedOut — no
// cooldown, since a timeout expresses no opinion (D8). Production wiring (Server.expireLoop) calls
// this on a real 1s ticker; tests call it directly after advancing an injected clock, no sleep
// required.
func (b *Broker) ExpireOverdue() {
	b.mu.Lock()
	now := b.now()
	var overdue []*pendingEntry
	for _, entry := range b.queue.Snapshot() {
		if !now.Before(entry.req.ExpiresAt) {
			overdue = append(overdue, entry)
		}
	}
	for _, entry := range overdue {
		b.queue.Remove(entry.req.RequestID)
	}
	snap := b.snapshotLocked()
	seq := b.emitter.NextSeq()
	b.mu.Unlock()

	for _, entry := range overdue {
		entry.result <- PairingTimedOut
	}
	if len(overdue) > 0 {
		b.emitter.Emit(seq, snap)
	}
}

// Shutdown resolves every currently queued pairing request as aborted (F11), unblocking any
// Request() call still waiting on one. Server.Close calls this before its own wg.Wait() (G32
// round-3 architecture/security review, finding #1): a queued request's Request() call blocks on
// entry.result, a plain Go channel receive with no other case — unlike a connection blocked on an
// actual network read, closing its net.Conn does nothing to unblock it, so a pairing prompt still
// sitting unanswered when the app quits would otherwise hang that connection's handleConn
// goroutine, and so Close's own wg.Wait(), forever. No cooldown is started, and the outcome is
// Aborted, not Denied (F11): this is the server going away, not a decision about the client — the
// client's terminal, manual-retry-only "denied" state would otherwise leave it disconnected until
// the user finds and presses retry.
func (b *Broker) Shutdown() {
	b.mu.Lock()
	b.closed = true
	all := b.queue.Clear()
	snap := b.snapshotLocked()
	seq := b.emitter.NextSeq()
	b.mu.Unlock()

	for _, entry := range all {
		entry.result <- PairingAborted
	}
	if len(all) > 0 {
		b.emitter.Emit(seq, snap)
	}
}

// removeAllForClientLocked drops every remaining queued entry belonging to clientID and returns
// them so the caller can resolve their result channels outside the lock. Caller holds b.mu.
func (b *Broker) removeAllForClientLocked(clientID string) []*pendingEntry {
	var removed []*pendingEntry
	for _, e := range b.queue.Snapshot() {
		if e.req.ClientID == clientID {
			b.queue.Remove(e.req.RequestID)
			removed = append(removed, e)
		}
	}
	return removed
}
