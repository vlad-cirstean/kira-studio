package gitsock

import (
	"sync"
	"testing"
	"time"
)

// fakeClock is the injected clock D8's tests are built around — no time.Sleep anywhere in this
// file; every deadline is crossed by calling Advance then ExpireOverdue explicitly.
type fakeClock struct {
	mu  sync.Mutex
	now time.Time
}

func newFakeClock() *fakeClock { return &fakeClock{now: time.Unix(1_700_000_000, 0)} }

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	c.now = c.now.Add(d)
	c.mu.Unlock()
}

func TestBroker_FIFOOrder_OnlyHeadPresented(t *testing.T) {
	clock := newFakeClock()
	b := NewBroker(clock.Now)

	// G31 round-2 functional-correctness review, finding #6: Request now emits on every enqueue,
	// not only when the new request becomes the head (see that fix's own comment on Request) — a
	// second/third request queueing behind an already-presented head changes Queued and must be
	// reported too. This test's own subscriber therefore collapses CONSECUTIVE duplicate head
	// IDs before asserting order, exactly like main.go's own real subscriber does (deduping on
	// RequestID) — "only head presented" is a claim about which request is ever the ANSWERABLE
	// one at a time, not about how many snapshots fire while it stays the head.
	var mu sync.Mutex
	var presentedOrder []string
	unsub := b.Subscribe(func(snap PairingSnapshot) {
		mu.Lock()
		defer mu.Unlock()
		if snap.Pending == nil {
			return
		}
		if n := len(presentedOrder); n > 0 && presentedOrder[n-1] == snap.Pending.ClientID {
			return
		}
		presentedOrder = append(presentedOrder, snap.Pending.ClientID)
	})
	defer unsub()

	// Three requests enqueued strictly in order (each Request call returns only once resolved, so
	// they cannot race each other for enqueue order — each is started and its onEnqueued fires
	// before the next begins).
	ids := []string{"a", "b", "c"}
	results := make([]chan PairingOutcome, 0, 3)
	reqIDs := make([]string, 0, 3)
	for _, id := range ids {
		done := make(chan PairingOutcome, 1)
		enqueued := make(chan PairingRequest, 1)
		go func(id string) {
			done <- b.Request(id, "label-"+id, func(req PairingRequest) { enqueued <- req })
		}(id)
		req := <-enqueued
		reqIDs = append(reqIDs, req.RequestID)
		results = append(results, done)
	}

	snap := b.Pending()
	if snap.Pending == nil || snap.Pending.ClientID != "a" || snap.Queued != 3 {
		t.Fatalf("got %+v, want head=a queued=3", snap)
	}

	if got := b.Approve(reqIDs[0]); got != PairingActionResolved {
		t.Fatalf("approve a: got %v", got)
	}
	if out := <-results[0]; out != PairingApproved {
		t.Fatalf("a outcome: got %v", out)
	}

	snap = b.Pending()
	if snap.Pending == nil || snap.Pending.ClientID != "b" || snap.Queued != 2 {
		t.Fatalf("after resolving a: got %+v, want head=b queued=2", snap)
	}

	if got := b.Deny(reqIDs[1]); got != PairingActionResolved {
		t.Fatalf("deny b: got %v", got)
	}
	if out := <-results[1]; out != PairingDenied {
		t.Fatalf("b outcome: got %v", out)
	}

	snap = b.Pending()
	if snap.Pending == nil || snap.Pending.ClientID != "c" || snap.Queued != 1 {
		t.Fatalf("after resolving b: got %+v, want head=c queued=1", snap)
	}
	b.Approve(reqIDs[2])
	<-results[2]

	mu.Lock()
	defer mu.Unlock()
	if len(presentedOrder) != 3 || presentedOrder[0] != "a" || presentedOrder[1] != "b" || presentedOrder[2] != "c" {
		t.Fatalf("presented order: got %v, want [a b c]", presentedOrder)
	}
}

// TestBroker_QueuedCountChangeIsEmittedEvenBehindAPresentedHead is G31 round-2 functional-
// correctness review finding #6's own regression coverage: enqueueing a second/third request
// behind an already-presented head used to change Queued (SPEC §3.3's own "visible count") but
// never emit at all — Request's own `presented := len(b.queue) == 1` gate meant only the very
// first request of a queue ever triggered a snapshot. GitPairingDialog.vue's "1 of {{ queued }}
// waiting" line is fed solely by this emitter, so it stayed stuck reporting 1 no matter how many
// more requests queued up.
func TestBroker_QueuedCountChangeIsEmittedEvenBehindAPresentedHead(t *testing.T) {
	clock := newFakeClock()
	b := NewBroker(clock.Now)

	var mu sync.Mutex
	var queuedSeen []int
	unsub := b.Subscribe(func(snap PairingSnapshot) {
		mu.Lock()
		defer mu.Unlock()
		queuedSeen = append(queuedSeen, snap.Queued)
	})
	defer unsub()

	enqueuedA := make(chan PairingRequest, 1)
	go func() { b.Request("a", "a", func(req PairingRequest) { enqueuedA <- req }) }()
	<-enqueuedA // a is now the presented head — Queued: 1.

	enqueuedB := make(chan PairingRequest, 1)
	go func() { b.Request("b", "b", func(req PairingRequest) { enqueuedB <- req }) }()
	<-enqueuedB // b queues behind a, never presented — Queued must still be reported as 2.

	enqueuedC := make(chan PairingRequest, 1)
	go func() { b.Request("c", "c", func(req PairingRequest) { enqueuedC <- req }) }()
	<-enqueuedC // c queues behind a and b — Queued: 3.

	mu.Lock()
	defer mu.Unlock()
	if len(queuedSeen) != 3 || queuedSeen[0] != 1 || queuedSeen[1] != 2 || queuedSeen[2] != 3 {
		t.Fatalf("queued counts seen by the subscriber: got %v, want [1 2 3] — "+
			"an enqueue behind an already-presented head must still emit its own updated count", queuedSeen)
	}
}

func TestBroker_DeadlineMeasuredFromEnqueue_NotPresentation(t *testing.T) {
	clock := newFakeClock()
	b := NewBroker(clock.Now)

	// "b" queues behind "a" and is never presented (never the head) before it is swept — if the
	// deadline were instead measured from presentation, an un-presented "b" would have no running
	// countdown yet and this ExpireOverdue call would time out "a" only. Measured from enqueue
	// (D8), both cross their identical 120s window at the same moment regardless of queue
	// position, so both time out here.
	enqueuedA := make(chan PairingRequest, 1)
	doneA := make(chan PairingOutcome, 1)
	go func() { doneA <- b.Request("a", "a", func(req PairingRequest) { enqueuedA <- req }) }()
	<-enqueuedA

	enqueuedB := make(chan PairingRequest, 1)
	doneB := make(chan PairingOutcome, 1)
	go func() {
		doneB <- b.Request("b", "b", func(req PairingRequest) { enqueuedB <- req })
	}()
	reqB := <-enqueuedB
	if snap := b.Pending(); snap.Pending == nil || snap.Pending.ClientID != "a" || snap.Queued != 2 {
		t.Fatalf("got %+v, want head=a queued=2 (b never presented)", snap)
	}

	clock.Advance(121 * time.Second)
	b.ExpireOverdue()

	if out := recvOrTimeout(t, doneA); out != PairingTimedOut {
		t.Fatalf("a outcome: got %v, want timeout", out)
	}
	if out := recvOrTimeout(t, doneB); out != PairingTimedOut {
		t.Fatalf("b outcome: got %v, want timeout — a never-presented request must still expire on its own enqueue-based deadline", out)
	}
	if snap := b.Pending(); snap.Pending != nil || snap.Queued != 0 {
		t.Fatalf("after both expire: got %+v, want empty", snap)
	}
	if b.InCooldown(reqB.ClientID) {
		t.Fatal("timeout must not set a cooldown")
	}
}

func recvOrTimeout(t *testing.T, ch chan PairingOutcome) PairingOutcome {
	t.Helper()
	select {
	case out := <-ch:
		return out
	case <-time.After(2 * time.Second):
		t.Fatal("Request never returned")
		return 0
	}
}

func TestBroker_DenyOnly_SetsCooldown(t *testing.T) {
	clock := newFakeClock()
	b := NewBroker(clock.Now)

	enqueued := make(chan PairingRequest, 1)
	done := make(chan PairingOutcome, 1)
	go func() {
		done <- b.Request("client-1", "label", func(req PairingRequest) { enqueued <- req })
	}()
	req := <-enqueued
	b.Deny(req.RequestID)
	if out := <-done; out != PairingDenied {
		t.Fatalf("outcome: got %v", out)
	}
	if !b.InCooldown("client-1") {
		t.Fatal("deny did not set a cooldown")
	}

	// A reconnect inside the cooldown is denied immediately, without enqueueing.
	out := b.Request("client-1", "label", func(PairingRequest) {
		t.Fatal("a cooldown request must not be enqueued")
	})
	if out != PairingDenied {
		t.Fatalf("cooldown request outcome: got %v", out)
	}

	clock.Advance(61 * time.Second)
	if b.InCooldown("client-1") {
		t.Fatal("cooldown did not expire after 60s")
	}
}

func TestBroker_DoubleAnswer_ReportsAlreadyResolved(t *testing.T) {
	clock := newFakeClock()
	b := NewBroker(clock.Now)

	enqueued := make(chan PairingRequest, 1)
	done := make(chan PairingOutcome, 1)
	go func() {
		done <- b.Request("client-1", "label", func(req PairingRequest) { enqueued <- req })
	}()
	req := <-enqueued
	if got := b.Approve(req.RequestID); got != PairingActionResolved {
		t.Fatalf("first approve: got %v", got)
	}
	<-done
	if got := b.Approve(req.RequestID); got != PairingActionAlreadyResolved {
		t.Fatalf("second approve: got %v, want alreadyResolved", got)
	}
	if got := b.Deny(req.RequestID); got != PairingActionAlreadyResolved {
		t.Fatalf("deny after approve: got %v, want alreadyResolved", got)
	}
}

// TestBroker_QueueBoundedAgainstUnlimitedEnqueue is G31 round-2 architecture/security review,
// finding #10: clientID is entirely client-supplied and unauthenticated at Request time (handshake
// row 7), so nothing but maxQueueLen stops a local process from opening far more concurrent
// connections than any real user could ever triage, each blocking a goroutine on its own result
// channel for up to pairingTimeout. This proves Request denies immediately — no enqueue, no
// onEnqueued call, matching the cooldown short-circuit's own contract — once the queue is already
// at the cap, rather than growing without bound.
func TestBroker_QueueBoundedAgainstUnlimitedEnqueue(t *testing.T) {
	clock := newFakeClock()
	b := NewBroker(clock.Now)

	results := make([]chan PairingOutcome, 0, maxQueueLen)
	for i := 0; i < maxQueueLen; i++ {
		enqueued := make(chan PairingRequest, 1)
		done := make(chan PairingOutcome, 1)
		id := "client-" + string(rune('a'+i%26)) + string(rune('0'+i/26))
		go func(id string) {
			done <- b.Request(id, "label", func(req PairingRequest) { enqueued <- req })
		}(id)
		<-enqueued
		results = append(results, done)
	}
	if snap := b.Pending(); snap.Queued != maxQueueLen {
		t.Fatalf("Queued = %d, want %d (the queue must be full at the cap)", snap.Queued, maxQueueLen)
	}

	out := b.Request("one-too-many", "label", func(PairingRequest) {
		t.Fatal("a request beyond maxQueueLen must not be enqueued")
	})
	if out != PairingDenied {
		t.Fatalf("over-cap request outcome: got %v, want PairingDenied", out)
	}
	if snap := b.Pending(); snap.Queued != maxQueueLen {
		t.Fatalf("Queued after the over-cap attempt = %d, want unchanged %d", snap.Queued, maxQueueLen)
	}

	for _, done := range results {
		select {
		case <-done:
			t.Fatal("an already-queued request resolved on its own — it should still be pending")
		default:
		}
	}
}

// TestBroker_DenyPurgesEveryOtherQueuedRequestFromTheSameClient is G31 round-2 architecture/
// security review, finding #10's other half: Deny only ever resolved the ONE entry named by its
// requestID — the presented head, in practice, since that's the only request a window's dialog
// ever has a RequestID for. A clientID that opened several concurrent connections before the first
// was ever presented had its OTHER already-queued requests survive untouched, bypassing the very
// cooldown the denial just started (the cooldown only short-circuits a NEW Request() call, never
// one already queued). This proves denying one request from a client also resolves every other
// request already queued from that SAME client, as denied — while leaving an unrelated client's
// own queued request untouched.
func TestBroker_DenyPurgesEveryOtherQueuedRequestFromTheSameClient(t *testing.T) {
	clock := newFakeClock()
	b := NewBroker(clock.Now)

	enqueue := func(clientID string) (PairingRequest, chan PairingOutcome) {
		enqueued := make(chan PairingRequest, 1)
		done := make(chan PairingOutcome, 1)
		go func() {
			done <- b.Request(clientID, "label", func(req PairingRequest) { enqueued <- req })
		}()
		return <-enqueued, done
	}

	reqA1, doneA1 := enqueue("client-a") // presented head.
	_, doneA2 := enqueue("client-a")     // a second connection from the SAME client, queued behind it.
	reqB, doneB := enqueue("client-b")   // an unrelated client, queued behind both of A's.

	if snap := b.Pending(); snap.Queued != 3 {
		t.Fatalf("Queued = %d, want 3", snap.Queued)
	}

	if got := b.Deny(reqA1.RequestID); got != PairingActionResolved {
		t.Fatalf("deny reqA1: got %v", got)
	}
	if out := recvOrTimeout(t, doneA1); out != PairingDenied {
		t.Fatalf("reqA1 outcome: got %v", out)
	}
	if out := recvOrTimeout(t, doneA2); out != PairingDenied {
		t.Fatalf("reqA2 outcome: got %v, want PairingDenied — a client's OTHER queued request must be purged when the client is denied", out)
	}
	if !b.InCooldown("client-a") {
		t.Fatal("client-a must be in cooldown after its denial")
	}

	// client-b's own request must be entirely unaffected: still queued, still pending.
	select {
	case out := <-doneB:
		t.Fatalf("client-b's own request resolved (%v) — it must not be touched by client-a's denial", out)
	default:
	}
	if snap := b.Pending(); snap.Pending == nil || snap.Pending.ClientID != "client-b" || snap.Queued != 1 {
		t.Fatalf("after purging client-a: got %+v, want head=client-b queued=1", snap)
	}
	if got := b.Deny(reqB.RequestID); got != PairingActionResolved {
		t.Fatalf("deny reqB: got %v", got)
	}
	<-doneB
}

func TestBroker_UnknownRequestID_ReportsAlreadyResolved(t *testing.T) {
	b := NewBroker(newFakeClock().Now)
	if got := b.Approve("no-such-id"); got != PairingActionAlreadyResolved {
		t.Fatalf("got %v, want alreadyResolved", got)
	}
}
