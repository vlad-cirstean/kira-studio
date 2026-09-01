package shell_test

import (
	"bytes"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/shell"
)

// quitEmitter records every Emit call — quit_test.go only cares about
// bridge.ChannelFlushBeforeClose, but recording everything makes a wrong-channel bug visible too.
type quitEmitter struct {
	mu     sync.Mutex
	events []string
}

func (e *quitEmitter) Emit(name string, _ any) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.events = append(e.events, name)
}

// EmitTo satisfies appcore.Emitter's second method (P8 C6/D6) — no quit_test.go case drives it
// directly, so it just records like Emit does, keeping the package compiling with one double.
func (e *quitEmitter) EmitTo(_ string, name string, _ any) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.events = append(e.events, name)
}

func (e *quitEmitter) names() []string {
	e.mu.Lock()
	defer e.mu.Unlock()
	out := make([]string, len(e.events))
	copy(out, e.events)
	return out
}

// order records the sequence beforeFlush/teardown actually ran in, from whichever goroutine
// called them — quit.go's two halves are the only writers.
type order struct {
	mu  sync.Mutex
	seq []string
}

func (o *order) record(name string) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.seq = append(o.seq, name)
}

func (o *order) snapshot() []string {
	o.mu.Lock()
	defer o.mu.Unlock()
	out := make([]string, len(o.seq))
	copy(out, o.seq)
	return out
}

// newTestQuitter wires a Quitter against the shared testApp (main_test.go) with counting,
// OnceFunc-wrapped teardown halves — exactly the shape main.go is required to pass in — plus a
// channel closed when teardown has run. keys is the live window set flushThenQuit seeds its
// pending ack set from (P8 C8) — most tests here only ever had one window, so newTestQuitter1
// below covers that shape without every existing call site having to spell out `[]string{"main"}`.
func newTestQuitter(timeout time.Duration, keys []string) (q *shell.Quitter, emitter *quitEmitter, ord *order, teardownDone chan struct{}) {
	emitter = &quitEmitter{}
	events := bridge.NewEvents(emitter)
	ord = &order{}
	done := make(chan struct{})

	beforeFlush := sync.OnceFunc(func() { ord.record("beforeFlush") })
	teardown := sync.OnceFunc(func() {
		ord.record("teardown")
		close(done)
	})

	q = shell.NewQuitter(events, beforeFlush, teardown, timeout, func() []string { return keys })
	q.Attach(testApp)
	return q, emitter, ord, done
}

// newTestQuitter1 is newTestQuitter with the single-window shape most of this file's existing
// cases predate P8 and still only need.
func newTestQuitter1(timeout time.Duration) (q *shell.Quitter, emitter *quitEmitter, ord *order, teardownDone chan struct{}) {
	return newTestQuitter(timeout, []string{"main"})
}

func waitFor(t *testing.T, ch <-chan struct{}, within time.Duration, what string) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(within):
		t.Fatalf("%s did not happen within %s", what, within)
	}
}

// TestFlushAckCompletesTeardown covers the winning arm of flushThenQuit's ack-vs-timeout select:
// the renderer's ack must short-circuit the timeout, and the two teardown halves must still run
// in order.
func TestFlushAckCompletesTeardown(t *testing.T) {
	q, emitter, ord, done := newTestQuitter1(200 * time.Millisecond)

	start := time.Now()
	q.ShouldQuit()

	// Give the flush goroutine a moment to run beforeFlush and emit the signal, before acking.
	deadline := time.Now().Add(time.Second)
	for len(emitter.names()) == 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if got := ord.snapshot(); len(got) != 1 || got[0] != "beforeFlush" {
		t.Fatalf("order before the ack = %v, want [beforeFlush]", got)
	}

	q.Flushed("main")
	waitFor(t, done, time.Second, "teardown")
	elapsed := time.Since(start)

	if elapsed >= 200*time.Millisecond {
		t.Errorf("elapsed %s, want well under the 200ms timeout — the ack must short-circuit it", elapsed)
	}
	if got := ord.snapshot(); len(got) != 2 || got[0] != "beforeFlush" || got[1] != "teardown" {
		t.Errorf("order = %v, want [beforeFlush teardown]", got)
	}
}

// TestFlushTimeoutStillTearsDown covers the other arm: a renderer that never acks must not be
// able to keep the app alive — the timeout fires and teardown runs anyway.
func TestFlushTimeoutStillTearsDown(t *testing.T) {
	var logs bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })

	q, _, ord, done := newTestQuitter1(30 * time.Millisecond)

	start := time.Now()
	q.ShouldQuit()
	waitFor(t, done, time.Second, "teardown")
	elapsed := time.Since(start)

	if elapsed < 30*time.Millisecond {
		t.Errorf("teardown ran after %s, want at least the 30ms timeout", elapsed)
	}
	if got := ord.snapshot(); len(got) != 2 || got[0] != "beforeFlush" || got[1] != "teardown" {
		t.Errorf("order = %v, want [beforeFlush teardown]", got)
	}
	if !strings.Contains(logs.String(), "quit flush timed out") {
		t.Errorf("log output = %q, want it to contain \"quit flush timed out\"", logs.String())
	}
}

// TestSecondShouldQuitReturnsTrue covers the started/done CAS handshake: concurrent ShouldQuit
// calls must all decline and start exactly one flush, and only the post-teardown pass may return
// true. None of them may block — ShouldQuit runs on the same thread the ack arrives on (D2).
func TestSecondShouldQuitReturnsTrue(t *testing.T) {
	q, _, _, done := newTestQuitter1(time.Second)

	// A burst of concurrent calls while the flush is in flight must all return false and start
	// exactly one flush.
	var wg sync.WaitGroup
	results := make([]bool, 10)
	for i := range results {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			results[i] = q.ShouldQuit()
		}(i)
	}
	wg.Wait()
	for i, got := range results {
		if got {
			t.Errorf("concurrent ShouldQuit()[%d] = true, want false (flush not yet complete)", i)
		}
	}

	q.Flushed("main")
	waitFor(t, done, time.Second, "teardown")

	if !q.ShouldQuit() {
		t.Error("ShouldQuit() after teardown = false, want true")
	}
}

// TestQuitWaitsForEveryWindowAck is P8 D13.2's rule, restoring the pre-Go-port behaviour
// (18fe7bb^:src/main/index.ts:47-60's Promise.all over every window): the handshake must not
// release until every live window has acked, or the timeout fires regardless. This is exactly
// the shape F3 named as a regression — with two windows, the old single sync.Once-closed channel
// let the first window's ack release teardown while the second's own tabsSave was still in
// flight, racing db.Close() against it.
func TestQuitWaitsForEveryWindowAck(t *testing.T) {
	t.Run("one ack does not release; both do", func(t *testing.T) {
		q, emitter, _, done := newTestQuitter(time.Second, []string{"win-a", "win-b"})

		q.ShouldQuit()

		// flushThenQuit seeds the pending set before it emits the flush signal — wait for the
		// signal (as TestFlushAckCompletesTeardown does) so an ack below can't race a nil/not-yet-
		// populated pending set and get silently swallowed as "unknown key" before it was ever
		// given the chance to be a known one.
		deadline := time.Now().Add(time.Second)
		for len(emitter.names()) == 0 && time.Now().Before(deadline) {
			time.Sleep(time.Millisecond)
		}

		q.Flushed("win-a")
		select {
		case <-done:
			t.Fatal("teardown ran after only one of two windows acked")
		case <-time.After(50 * time.Millisecond):
			// correctly still waiting
		}

		// An unknown key (never live, or already removed) must stay a no-op — not release the
		// wait and not panic.
		q.Flushed("not-a-real-window")
		select {
		case <-done:
			t.Fatal("teardown ran after an ack for an unregistered window key")
		case <-time.After(50 * time.Millisecond):
		}

		q.Flushed("win-b")
		waitFor(t, done, time.Second, "teardown")
	})

	t.Run("timeout releases with one window still outstanding", func(t *testing.T) {
		var logs bytes.Buffer
		prev := slog.Default()
		slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
		t.Cleanup(func() { slog.SetDefault(prev) })

		q, emitter, _, done := newTestQuitter(30*time.Millisecond, []string{"win-a", "win-b"})

		q.ShouldQuit()
		deadline := time.Now().Add(time.Second)
		for len(emitter.names()) == 0 && time.Now().Before(deadline) {
			time.Sleep(time.Millisecond)
		}
		q.Flushed("win-a") // only one of two — the other must not block teardown forever
		waitFor(t, done, time.Second, "teardown")

		if !strings.Contains(logs.String(), "quit flush timed out") {
			t.Errorf("log output = %q, want it to contain \"quit flush timed out\"", logs.String())
		}
	})
}
