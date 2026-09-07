package gitsession

import (
	"sync/atomic"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
)

// TestSubscriber_BurstCoalescesFarBelowSignalCount is D14's central claim: a burst of many
// signals, delivered to a subscriber whose first delivery is held (forcing a real backlog to
// accumulate behind it), produces far fewer deliver calls than signals — the honest assertion,
// since the exact call count depends on scheduling (how many notes land before the first delivery
// is even picked up), not just on the coalescing logic itself.
func TestSubscriber_BurstCoalescesFarBelowSignalCount(t *testing.T) {
	delivered := make(chan Event, 100)
	blockFirst := make(chan struct{})
	var unblocked atomic.Bool

	s := newSubscriber("repo-1", func(ev Event) {
		if !unblocked.Load() {
			<-blockFirst // hold the first delivery until the test says go, forcing a real backlog.
		}
		delivered <- ev
	})
	defer s.close()

	const n = 200
	for i := 0; i < n; i++ {
		if i%2 == 0 {
			s.note(gitclient.SignalRefsChanged)
		} else {
			s.note(gitclient.SignalWorktreeChanged)
		}
	}

	unblocked.Store(true)
	close(blockFirst)

	var got []Event
	quiet := time.NewTimer(300 * time.Millisecond)
	defer quiet.Stop()
collect:
	for {
		select {
		case ev := <-delivered:
			got = append(got, ev)
			if !quiet.Stop() {
				<-quiet.C
			}
			quiet.Reset(300 * time.Millisecond)
		case <-quiet.C:
			break collect
		}
	}

	if len(got) == 0 {
		t.Fatal("no deliveries arrived for a burst of 200 signals")
	}
	if len(got) >= n {
		t.Fatalf("got %d deliver calls for a burst of %d signals, want far fewer (coalesced)", len(got), n)
	}
}

// TestSubscriber_SlowSubscriberDoesNotDelayAnother is the SPEC §6 sentence this design exists for:
// one subscriber stuck inside deliver must not stall a second, independent subscriber's delivery.
func TestSubscriber_SlowSubscriberDoesNotDelayAnother(t *testing.T) {
	block := make(chan struct{}) // never closed in this test: the slow subscriber stays stuck.
	slow := newSubscriber("repo-1", func(Event) { <-block })
	defer slow.close()

	fastDelivered := make(chan Event, 1)
	fast := newSubscriber("repo-1", func(ev Event) { fastDelivered <- ev })
	defer fast.close()

	slow.note(gitclient.SignalRefsChanged)
	fast.note(gitclient.SignalRefsChanged)

	select {
	case ev := <-fastDelivered:
		if ev.Kind != string(gitclient.SignalRefsChanged) {
			t.Fatalf("Kind = %q, want refsChanged", ev.Kind)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("fast subscriber's delivery never arrived — a stuck subscriber stalled another")
	}
}

func TestSubscriber_CloseStopsFurtherDelivery(t *testing.T) {
	var calls int32
	s := newSubscriber("repo-1", func(Event) { atomic.AddInt32(&calls, 1) })
	s.note(gitclient.SignalRefsChanged)
	time.Sleep(20 * time.Millisecond) // let the one delivery land.
	s.close()

	s.note(gitclient.SignalWorktreeChanged) // must not panic, and must not deliver.
	time.Sleep(20 * time.Millisecond)

	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Fatalf("deliver calls = %d, want exactly 1 (before close)", got)
	}
}
