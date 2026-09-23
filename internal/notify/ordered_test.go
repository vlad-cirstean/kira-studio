package notify_test

import (
	"testing"

	"github.com/kirathecat/kira-studio/internal/notify"
)

// TestOrderedEmitter_DropsStaleEmit is dbmcp.ApprovalBroker's and gitsock.Broker's own former
// TestApprovalBroker_EmitOrdered_DropsStaleSnapshot / TestBroker_EmitOrdered_DropsStaleSnapshot
// (M7 finding #10 / #23), hoisted here as OrderedEmitter's one authoritative test (P107 T2-8): a
// caller takes NextSeq under its own lock, builds a snapshot, releases the lock, then Emits — so
// two callers can Emit in the opposite order from the state changes that produced their snapshots.
// A later (higher-sequence) Emit reaching the emitter first must make an earlier-sequenced Emit
// that lands after it a no-op, or a subscriber ends up holding a stale value even though a newer,
// correct one already went out.
func TestOrderedEmitter_DropsStaleEmit(t *testing.T) {
	t.Parallel()
	var e notify.OrderedEmitter[string]

	events := make(chan string, 4)
	unsub := e.Subscribe(func(v string) { events <- v })
	defer unsub()

	seqOlder := e.NextSeq()
	seqNewer := e.NextSeq()

	// The later (higher-sequence) value reaches the emitter first — the exact interleaving the
	// finding describes.
	e.Emit(seqNewer, "newer")
	e.Emit(seqOlder, "stale")

	select {
	case got := <-events:
		if got != "newer" {
			t.Fatalf("first (only) event = %q, want %q", got, "newer")
		}
	default:
		t.Fatal("newer value was never emitted")
	}

	select {
	case got := <-events:
		t.Fatalf("a second, stale event was emitted: %q — the older value must be dropped, not published after a newer one", got)
	default:
		// correct: the stale Emit call above must be a no-op.
	}
}

// TestOrderedEmitter_ConcurrentNextSeqNeverRepeats guards NextSeq's own atomic-increment shape
// (P107 T2-8's deviation from the two originals' mutex-guarded emitSeq field): concurrent callers
// must never observe the same sequence number twice, the one property Emit's stale-drop guard
// depends on.
func TestOrderedEmitter_ConcurrentNextSeqNeverRepeats(t *testing.T) {
	t.Parallel()
	var e notify.OrderedEmitter[int]

	const n = 100
	seqs := make(chan uint64, n)
	done := make(chan struct{})
	for i := 0; i < n; i++ {
		go func() { seqs <- e.NextSeq() }()
	}
	go func() {
		seen := map[uint64]bool{}
		for i := 0; i < n; i++ {
			seq := <-seqs
			if seen[seq] {
				t.Errorf("NextSeq returned %d twice", seq)
			}
			seen[seq] = true
		}
		close(done)
	}()
	<-done
}
