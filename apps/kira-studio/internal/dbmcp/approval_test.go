package dbmcp

import (
	"context"
	"testing"
	"time"
)

func recvApprovalOrTimeout(t *testing.T, ch chan ApprovalOutcome) ApprovalOutcome {
	t.Helper()
	select {
	case out := <-ch:
		return out
	case <-time.After(2 * time.Second):
		t.Fatal("Request never returned")
		return 0
	}
}

func TestApprovalBroker_FIFOOrder_OnlyHeadPresented(t *testing.T) {
	t.Parallel()
	b := NewApprovalBroker(time.Now)

	events := make(chan ApprovalSnapshot, 16)
	unsub := b.OnApprovalChange(func(snap ApprovalSnapshot) { events <- snap })
	defer unsub()

	ids := []string{"a", "b", "c"}
	results := make([]chan ApprovalOutcome, 0, 3)
	for _, id := range ids {
		done := make(chan ApprovalOutcome, 1)
		go func(id string) {
			done <- b.Request(context.Background(), ApprovalRequest{ConnectionID: id})
		}(id)
		snap := <-events
		if snap.Pending == nil {
			t.Fatalf("enqueue %s: snapshot has no pending head", id)
		}
		results = append(results, done)
	}

	snap := b.Pending()
	if snap.Pending == nil || snap.Pending.ConnectionID != "a" || snap.Queued != 3 {
		t.Fatalf("got %+v, want head=a queued=3", snap)
	}

	if got := b.Approve(snap.Pending.RequestID); got != ApprovalActionResolved {
		t.Fatalf("approve a: got %v", got)
	}
	if out := <-results[0]; out != ApprovalApproved {
		t.Fatalf("a outcome: got %v", out)
	}
	<-events // resolution snapshot

	snap = b.Pending()
	if snap.Pending == nil || snap.Pending.ConnectionID != "b" || snap.Queued != 2 {
		t.Fatalf("after resolving a: got %+v, want head=b queued=2", snap)
	}
	if got := b.Deny(snap.Pending.RequestID); got != ApprovalActionResolved {
		t.Fatalf("deny b: got %v", got)
	}
	if out := <-results[1]; out != ApprovalDenied {
		t.Fatalf("b outcome: got %v", out)
	}
	<-events

	snap = b.Pending()
	if snap.Pending == nil || snap.Pending.ConnectionID != "c" || snap.Queued != 1 {
		t.Fatalf("after resolving b: got %+v, want head=c queued=1", snap)
	}
	b.Approve(snap.Pending.RequestID)
	if out := <-results[2]; out != ApprovalApproved {
		t.Fatalf("c outcome: got %v", out)
	}
}

// TestApprovalBroker_EmitsOnEveryEnqueueAndResolution pins the same contract G31 round-2 finding
// #6 established for gitsock's own pairing broker: an enqueue behind an already-presented head, or
// a resolution of either entry, must always emit a fresh snapshot with the right Queued — never
// only on a head change.
func TestApprovalBroker_EmitsOnEveryEnqueueAndResolution(t *testing.T) {
	t.Parallel()
	b := NewApprovalBroker(time.Now)

	events := make(chan ApprovalSnapshot, 16)
	unsub := b.OnApprovalChange(func(snap ApprovalSnapshot) { events <- snap })
	defer unsub()

	doneA := make(chan ApprovalOutcome, 1)
	go func() { doneA <- b.Request(context.Background(), ApprovalRequest{ConnectionID: "a"}) }()
	snapA := <-events
	if snapA.Queued != 1 {
		t.Fatalf("after enqueueing a: Queued = %d, want 1", snapA.Queued)
	}

	doneB := make(chan ApprovalOutcome, 1)
	go func() { doneB <- b.Request(context.Background(), ApprovalRequest{ConnectionID: "b"}) }()
	snapB := <-events
	if snapB.Queued != 2 {
		t.Fatalf("after enqueueing b behind a: Queued = %d, want 2 — a queued-behind-head enqueue must still emit", snapB.Queued)
	}

	b.Approve(snapA.Pending.RequestID)
	<-doneA
	snapAfterApprove := <-events
	if snapAfterApprove.Queued != 1 || snapAfterApprove.Pending == nil || snapAfterApprove.Pending.ConnectionID != "b" {
		t.Fatalf("after resolving a: got %+v, want head=b queued=1", snapAfterApprove)
	}

	b.Deny(snapAfterApprove.Pending.RequestID)
	<-doneB
	snapAfterDeny := <-events
	if snapAfterDeny.Queued != 0 || snapAfterDeny.Pending != nil {
		t.Fatalf("after resolving b: got %+v, want empty", snapAfterDeny)
	}
}

// TestApprovalBroker_EmitOrdered_DropsStaleSnapshot is the M7 finding: resolve/Request/AbandonAll
// each snapshot state under b.mu, then unlock, then Emit — notify.Emitter's own "never hold your
// own mutex across Emit" rule — so two of them can call Emit in the opposite order from the
// mu-protected changes that produced their snapshots. A subscriber then ends up holding an older
// snapshot (naming a request that is already resolved and gone) even though a newer, correct one
// was computed. emitOrdered's sequence-number guard must drop a stale Emit outright rather than
// let it land after a newer one already went out — exercised directly and deterministically here,
// since winning that goroutine-scheduling race is not reliable to force from outside.
func TestApprovalBroker_EmitOrdered_DropsStaleSnapshot(t *testing.T) {
	t.Parallel()
	b := NewApprovalBroker(time.Now)

	events := make(chan ApprovalSnapshot, 4)
	unsub := b.OnApprovalChange(func(snap ApprovalSnapshot) { events <- snap })
	defer unsub()

	older := "older-request-id"
	staleSnap := ApprovalSnapshot{Pending: &ApprovalRequest{RequestID: older}, Queued: 1}
	newerSnap := ApprovalSnapshot{} // e.g. the same request resolved and the queue now empty

	b.mu.Lock()
	seqOlder := b.nextSeqLocked()
	seqNewer := b.nextSeqLocked()
	b.mu.Unlock()

	// The later (higher-sequence) resolution's Emit reaches the emitter first — the exact
	// interleaving the finding describes.
	b.emitOrdered(seqNewer, newerSnap)
	b.emitOrdered(seqOlder, staleSnap)

	select {
	case got := <-events:
		if got.Pending != nil || got.Queued != 0 {
			t.Fatalf("first (only) event = %+v, want the newer empty snapshot", got)
		}
	default:
		t.Fatal("newer snapshot was never emitted")
	}

	select {
	case got := <-events:
		t.Fatalf("a second, stale event was emitted: %+v — the older snapshot must be dropped, not published after a newer one", got)
	default:
		// correct: the stale emitOrdered call above must be a no-op.
	}
}

func TestApprovalBroker_DoubleApprove_ReportsAlreadyResolved(t *testing.T) {
	t.Parallel()
	b := NewApprovalBroker(time.Now)

	events := make(chan ApprovalSnapshot, 4)
	unsub := b.OnApprovalChange(func(snap ApprovalSnapshot) { events <- snap })
	defer unsub()

	done := make(chan ApprovalOutcome, 1)
	go func() { done <- b.Request(context.Background(), ApprovalRequest{ConnectionID: "a"}) }()
	snap := <-events
	id := snap.Pending.RequestID

	if got := b.Approve(id); got != ApprovalActionResolved {
		t.Fatalf("first approve: got %v", got)
	}
	if out := <-done; out != ApprovalApproved {
		t.Fatalf("outcome: got %v", out)
	}
	<-events // resolution snapshot

	if got := b.Approve(id); got != ApprovalActionAlreadyResolved {
		t.Fatalf("second approve: got %v, want AlreadyResolved", got)
	}
	if got := b.Deny(id); got != ApprovalActionAlreadyResolved {
		t.Fatalf("deny after approve: got %v, want AlreadyResolved", got)
	}

	// Neither the second Approve nor the Deny must have emitted again, or double-pumped the queue.
	select {
	case snap := <-events:
		t.Fatalf("an already-resolved id must not re-emit, got %+v", snap)
	default:
	}
	if snap := b.Pending(); snap.Pending != nil || snap.Queued != 0 {
		t.Fatalf("queue must stay empty, got %+v", snap)
	}
}

// TestApprovalBroker_CtxCancel_NonHeadEntry_LeavesHeadPresented proves the deliberate difference
// from gitsock.Broker (§5.1): Request selects on the caller's own ctx, so a disconnected MCP
// client's queued-but-not-yet-presented request resolves as abandoned without disturbing the head.
func TestApprovalBroker_CtxCancel_NonHeadEntry_LeavesHeadPresented(t *testing.T) {
	t.Parallel()
	b := NewApprovalBroker(time.Now)

	events := make(chan ApprovalSnapshot, 16)
	unsub := b.OnApprovalChange(func(snap ApprovalSnapshot) { events <- snap })
	defer unsub()

	doneA := make(chan ApprovalOutcome, 1)
	go func() { doneA <- b.Request(context.Background(), ApprovalRequest{ConnectionID: "a"}) }()
	snapA := <-events
	headID := snapA.Pending.RequestID

	ctxB, cancelB := context.WithCancel(context.Background())
	doneB := make(chan ApprovalOutcome, 1)
	go func() { doneB <- b.Request(ctxB, ApprovalRequest{ConnectionID: "b"}) }()
	<-events // b enqueued, still behind a

	cancelB()
	if out := recvApprovalOrTimeout(t, doneB); out != ApprovalAbandoned {
		t.Fatalf("b outcome: got %v, want ApprovalAbandoned", out)
	}
	snapAfterCancel := <-events
	if snapAfterCancel.Pending == nil || snapAfterCancel.Pending.RequestID != headID || snapAfterCancel.Queued != 1 {
		t.Fatalf("after cancelling b: got %+v, want head still a (id %s) queued=1", snapAfterCancel, headID)
	}

	// a is unaffected by b's cancellation and still resolvable.
	b.Approve(headID)
	if out := recvApprovalOrTimeout(t, doneA); out != ApprovalApproved {
		t.Fatalf("a outcome: got %v", out)
	}
}

// TestApprovalBroker_DeadlineExpiresWithInjectedClock uses a "now" frozen far in the past so the
// minted ExpiresAt is already elapsed by real wall-clock time — the select's timer branch fires
// immediately, exercising the 120s deadline with no real sleep.
func TestApprovalBroker_DeadlineExpiresWithInjectedClock(t *testing.T) {
	t.Parallel()
	longAgo := time.Unix(0, 0)
	b := NewApprovalBroker(func() time.Time { return longAgo })

	done := make(chan ApprovalOutcome, 1)
	go func() { done <- b.Request(context.Background(), ApprovalRequest{ConnectionID: "a"}) }()

	if out := recvApprovalOrTimeout(t, done); out != ApprovalTimedOut {
		t.Fatalf("got %v, want ApprovalTimedOut", out)
	}
	if snap := b.Pending(); snap.Pending != nil || snap.Queued != 0 {
		t.Fatalf("after timeout: got %+v, want empty", snap)
	}
}

// TestApprovalBroker_QueueBoundedAgainstUnlimitedEnqueue mirrors gitsock's own maxQueueLen
// coverage: an MCP client is a program and can call run_query in a loop, so the broker must deny
// immediately past its cap rather than grow without bound.
func TestApprovalBroker_QueueBoundedAgainstUnlimitedEnqueue(t *testing.T) {
	t.Parallel()
	b := NewApprovalBroker(time.Now)

	events := make(chan ApprovalSnapshot, maxPendingApprovals+4)
	unsub := b.OnApprovalChange(func(snap ApprovalSnapshot) { events <- snap })
	defer unsub()

	results := make([]chan ApprovalOutcome, 0, maxPendingApprovals)
	for i := 0; i < maxPendingApprovals; i++ {
		done := make(chan ApprovalOutcome, 1)
		go func() {
			done <- b.Request(context.Background(), ApprovalRequest{ConnectionID: "c"})
		}()
		<-events
		results = append(results, done)
	}
	if snap := b.Pending(); snap.Queued != maxPendingApprovals {
		t.Fatalf("Queued = %d, want %d", snap.Queued, maxPendingApprovals)
	}

	out := b.Request(context.Background(), ApprovalRequest{ConnectionID: "over-cap"})
	if out != ApprovalDenied {
		t.Fatalf("over-cap outcome: got %v, want ApprovalDenied", out)
	}
	if snap := b.Pending(); snap.Queued != maxPendingApprovals {
		t.Fatalf("Queued after the over-cap attempt = %d, want unchanged %d", snap.Queued, maxPendingApprovals)
	}
	select {
	case snap := <-events:
		t.Fatalf("an over-cap Request must not enqueue or emit, got %+v", snap)
	default:
	}

	for _, done := range results {
		select {
		case <-done:
			t.Fatal("an already-queued request resolved on its own — it should still be pending")
		default:
		}
	}
}

// TestApprovalBroker_AbandonAll_ReleasesAndStaysUsable is the M2 §5.3 contract: the app quitting
// or the server toggling off must not leave any run_query call blocked forever, and the broker
// must still work if the server is toggled back on within the same app run.
func TestApprovalBroker_AbandonAll_ReleasesAndStaysUsable(t *testing.T) {
	t.Parallel()
	b := NewApprovalBroker(time.Now)

	events := make(chan ApprovalSnapshot, 16)
	unsub := b.OnApprovalChange(func(snap ApprovalSnapshot) { events <- snap })
	defer unsub()

	doneA := make(chan ApprovalOutcome, 1)
	go func() { doneA <- b.Request(context.Background(), ApprovalRequest{ConnectionID: "a"}) }()
	<-events
	doneB := make(chan ApprovalOutcome, 1)
	go func() { doneB <- b.Request(context.Background(), ApprovalRequest{ConnectionID: "b"}) }()
	<-events

	b.AbandonAll()
	if out := recvApprovalOrTimeout(t, doneA); out != ApprovalAbandoned {
		t.Fatalf("a outcome: got %v, want ApprovalAbandoned", out)
	}
	if out := recvApprovalOrTimeout(t, doneB); out != ApprovalAbandoned {
		t.Fatalf("b outcome: got %v, want ApprovalAbandoned", out)
	}
	<-events // AbandonAll's own (empty) snapshot
	if snap := b.Pending(); snap.Pending != nil || snap.Queued != 0 {
		t.Fatalf("after AbandonAll: got %+v, want empty", snap)
	}

	// The broker stays usable: a fresh Request enqueues and resolves normally.
	doneC := make(chan ApprovalOutcome, 1)
	go func() { doneC <- b.Request(context.Background(), ApprovalRequest{ConnectionID: "c"}) }()
	snapC := <-events
	if snapC.Pending == nil || snapC.Pending.ConnectionID != "c" {
		t.Fatalf("after AbandonAll, a new request did not enqueue: got %+v", snapC)
	}
	b.Approve(snapC.Pending.RequestID)
	if out := recvApprovalOrTimeout(t, doneC); out != ApprovalApproved {
		t.Fatalf("c outcome: got %v", out)
	}
}
