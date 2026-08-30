package shell_test

import (
	"bytes"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/shell/internal/bridge"
	"github.com/kirathecat/kira-studio/shell/internal/shell"
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
// channel closed when teardown has run.
func newTestQuitter(timeout time.Duration) (q *shell.Quitter, emitter *quitEmitter, ord *order, teardownDone chan struct{}) {
	emitter = &quitEmitter{}
	events := bridge.NewEvents(emitter)
	ord = &order{}
	done := make(chan struct{})

	beforeFlush := sync.OnceFunc(func() { ord.record("beforeFlush") })
	teardown := sync.OnceFunc(func() {
		ord.record("teardown")
		close(done)
	})

	q = shell.NewQuitter(events, beforeFlush, teardown, timeout)
	q.Attach(testApp)
	return q, emitter, ord, done
}

func waitFor(t *testing.T, ch <-chan struct{}, within time.Duration, what string) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(within):
		t.Fatalf("%s did not happen within %s", what, within)
	}
}

func TestShouldQuitReturnsFalseImmediately(t *testing.T) {
	q, _, _, _ := newTestQuitter(time.Second)

	start := time.Now()
	got := q.ShouldQuit()
	elapsed := time.Since(start)

	if got {
		t.Error("ShouldQuit() = true on the first call, want false")
	}
	if elapsed > time.Millisecond {
		t.Errorf("ShouldQuit() took %s, want well under 1ms — it must never block (D2)", elapsed)
	}
}

func TestFlushAckCompletesTeardown(t *testing.T) {
	q, emitter, ord, done := newTestQuitter(200 * time.Millisecond)

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

	q.Flushed()
	waitFor(t, done, time.Second, "teardown")
	elapsed := time.Since(start)

	if elapsed >= 200*time.Millisecond {
		t.Errorf("elapsed %s, want well under the 200ms timeout — the ack must short-circuit it", elapsed)
	}
	if got := ord.snapshot(); len(got) != 2 || got[0] != "beforeFlush" || got[1] != "teardown" {
		t.Errorf("order = %v, want [beforeFlush teardown]", got)
	}
}

func TestFlushTimeoutStillTearsDown(t *testing.T) {
	var logs bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })

	q, _, ord, done := newTestQuitter(30 * time.Millisecond)

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

func TestLateAckIsHarmless(t *testing.T) {
	q, _, ord, done := newTestQuitter(20 * time.Millisecond)

	q.ShouldQuit()
	waitFor(t, done, time.Second, "teardown")
	before := ord.snapshot()

	q.Flushed() // after the timeout already tore down — must not panic or re-run anything

	after := ord.snapshot()
	if len(after) != len(before) {
		t.Errorf("order changed after a late ack: before=%v after=%v", before, after)
	}
}

func TestSecondShouldQuitReturnsTrue(t *testing.T) {
	q, _, _, done := newTestQuitter(time.Second)

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

	q.Flushed()
	waitFor(t, done, time.Second, "teardown")

	if !q.ShouldQuit() {
		t.Error("ShouldQuit() after teardown = false, want true")
	}
}

func TestShutdownWithoutShouldQuit(t *testing.T) {
	q, _, ord, done := newTestQuitter(time.Second)

	q.Shutdown()
	waitFor(t, done, time.Second, "teardown")

	if got := ord.snapshot(); len(got) != 2 || got[0] != "beforeFlush" || got[1] != "teardown" {
		t.Errorf("order = %v, want [beforeFlush teardown]", got)
	}
}

func TestTeardownRunsOnceAcrossBothPaths(t *testing.T) {
	q, _, ord, done := newTestQuitter(time.Second)

	q.ShouldQuit()
	deadline := time.Now().Add(time.Second)
	for len(ord.snapshot()) == 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}

	q.Flushed()
	waitFor(t, done, time.Second, "teardown")

	// The signal path's own call, arriving after ShouldQuit's ack-driven teardown already ran —
	// both OnceFuncs must make this a no-op (D3).
	q.Shutdown()

	got := ord.snapshot()
	if len(got) != 2 || got[0] != "beforeFlush" || got[1] != "teardown" {
		t.Errorf("order = %v, want exactly [beforeFlush teardown] — each half must run once across both paths", got)
	}
}

func TestFlushBeforeCloseIsEmitted(t *testing.T) {
	q, emitter, _, done := newTestQuitter(time.Second)

	q.ShouldQuit()
	deadline := time.Now().Add(time.Second)
	for len(emitter.names()) == 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}

	names := emitter.names()
	if len(names) != 1 || names[0] != bridge.ChannelFlushBeforeClose {
		t.Fatalf("emitted channels = %v, want exactly [%s], and before the ack was even possible",
			names, bridge.ChannelFlushBeforeClose)
	}

	q.Flushed()
	waitFor(t, done, time.Second, "teardown")
}
