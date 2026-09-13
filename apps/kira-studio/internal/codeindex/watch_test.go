package codeindex

import (
	"sync"
	"testing"
	"time"
)

// fakeBackend is an in-package backend implementation for driving Watcher's own logic (the
// debounce and the Rescan rule) with no filesystem — the same role gitclient/watcher_test.go's own
// fakeBackend plays for its watcher.
type fakeBackend struct {
	events chan rawEvent
}

func (b *fakeBackend) Events() <-chan rawEvent { return b.events }
func (b *fakeBackend) Close() error            { return nil }

// firingSpy records every call the debounce loop makes to onFire, safe for concurrent
// reads/writes since the loop and the test goroutine touch it from different goroutines.
type firingSpy struct {
	mu    sync.Mutex
	calls []firingCall
}

type firingCall struct {
	at     time.Time
	paths  map[string]bool
	rescan bool
}

func (s *firingSpy) record(paths map[string]bool, rescan bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls = append(s.calls, firingCall{at: time.Now(), paths: paths, rescan: rescan})
}

func (s *firingSpy) snapshot() []firingCall {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]firingCall, len(s.calls))
	copy(out, s.calls)
	return out
}

func awaitCalls(t *testing.T, spy *firingSpy, n int) []firingCall {
	t.Helper()
	deadline := time.After(2 * time.Second)
	for {
		if calls := spy.snapshot(); len(calls) >= n {
			return calls
		}
		select {
		case <-time.After(5 * time.Millisecond):
		case <-deadline:
			t.Fatalf("timed out waiting for %d firing(s), got %d", n, len(spy.snapshot()))
		}
	}
}

// TestWatcher_CoalescesWithinOneWindow is §11 point 5: several events for different paths inside
// one debounce window produce exactly one firing carrying every path, not one firing per event.
func TestWatcher_CoalescesWithinOneWindow(t *testing.T) {
	fake := &fakeBackend{events: make(chan rawEvent, 4)}
	spy := &firingSpy{}
	w := newWatcherWith(nil, fake, spy.record)
	t.Cleanup(func() { _ = w.Close() })

	fake.events <- rawEvent{Path: "/repo/a.js"}
	fake.events <- rawEvent{Path: "/repo/b.js"}
	fake.events <- rawEvent{Path: "/repo/a.js"} // same path twice: still one entry in the set.

	calls := awaitCalls(t, spy, 1)
	if len(calls[0].paths) != 2 {
		t.Fatalf("expected one firing with 2 distinct paths, got %v", calls[0].paths)
	}
	if calls[0].rescan {
		t.Fatal("expected rescan=false")
	}

	// No second firing arrives later for the same burst.
	time.Sleep(300 * time.Millisecond)
	if got := len(spy.snapshot()); got != 1 {
		t.Fatalf("expected exactly 1 firing for the burst, got %d", got)
	}
}

// TestWatcher_LeadingWindowFiring proves the debounce is measured from the FIRST event of a burst,
// not the last: a steady trickle of events, each well inside the window, must not push the firing
// out indefinitely.
func TestWatcher_LeadingWindowFiring(t *testing.T) {
	fake := &fakeBackend{events: make(chan rawEvent, 16)}
	spy := &firingSpy{}
	w := newWatcherWith(nil, fake, spy.record)
	t.Cleanup(func() { _ = w.Close() })

	start := time.Now()
	fake.events <- rawEvent{Path: "/repo/a.js"}
	// Keep sending well inside the 200ms window — a trailing-edge debounce would never fire
	// while events keep arriving; a leading-edge one fires ~200ms after `start` regardless.
	for i := 0; i < 15; i++ {
		time.Sleep(20 * time.Millisecond)
		fake.events <- rawEvent{Path: "/repo/b.js"}
	}

	calls := awaitCalls(t, spy, 1)
	elapsed := calls[0].at.Sub(start)
	if elapsed > 500*time.Millisecond {
		t.Fatalf("firing took %v after the first event — the debounce is not leading-edge", elapsed)
	}
}

// TestWatcher_RescanSupersedesPathSet is §11 point 5's Rescan rule: a Rescan arriving mid-window
// drops whatever paths had already accumulated, firing with rescan=true and no paths.
func TestWatcher_RescanSupersedesPathSet(t *testing.T) {
	fake := &fakeBackend{events: make(chan rawEvent, 4)}
	spy := &firingSpy{}
	w := newWatcherWith(nil, fake, spy.record)
	t.Cleanup(func() { _ = w.Close() })

	fake.events <- rawEvent{Path: "/repo/a.js"}
	fake.events <- rawEvent{Rescan: true}

	calls := awaitCalls(t, spy, 1)
	if !calls[0].rescan {
		t.Fatal("expected rescan=true")
	}
	if len(calls[0].paths) != 0 {
		t.Fatalf("expected the Rescan to drop the accumulated path set, got %v", calls[0].paths)
	}
}

// TestWatcher_CloseDuringPendingTimer proves Close doesn't hang or panic while a debounce timer
// is armed and pending — the timer must be stopped, not left to fire into a closed watcher.
func TestWatcher_CloseDuringPendingTimer(t *testing.T) {
	fake := &fakeBackend{events: make(chan rawEvent, 1)}
	spy := &firingSpy{}
	w := newWatcherWith(nil, fake, spy.record)

	fake.events <- rawEvent{Path: "/repo/a.js"} // arms the timer; window has not elapsed yet.

	done := make(chan struct{})
	go func() {
		_ = w.Close()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Close did not return promptly with a pending debounce timer")
	}

	// No firing should have happened — Close won the race with the timer.
	if got := len(spy.snapshot()); got != 0 {
		t.Fatalf("expected no firing once closed before the window elapsed, got %d", got)
	}
}
