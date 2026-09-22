package shell

import (
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// Quitter is Kira Studio's own Quitter (internal/shell/quit.go), unchanged: it waits for every
// live window's flush ack before teardown runs, so a debounced tabsSave() in flight is never
// dropped mid-quit. P100 Part 1's own copy of this file skipped the handshake entirely (this app
// had no tabs/layout to flush yet, that file's own doc comment); Part 2 is what gives it a real
// consumer, so this replaces that file wholesale rather than growing it in place.
type Quitter struct {
	events         *bridge.Events
	beforeFlush    func() // sync.OnceFunc
	teardown       func() // sync.OnceFunc
	timeout        time.Duration
	liveWindowKeys func() []string // seeds the pending set at the moment quitting starts

	app     *application.App
	started atomic.Bool
	done    atomic.Bool

	mu        sync.Mutex
	pending   map[string]struct{}
	flushed   chan struct{}
	closeOnce sync.Once
}

// NewQuitter takes the two teardown halves already wrapped in sync.OnceFunc by the caller, so
// main.go states the order in one place — Kira Studio's own NewQuitter, unchanged signature.
func NewQuitter(events *bridge.Events, beforeFlush, teardown func(), flushTimeout time.Duration, liveWindowKeys func() []string) *Quitter {
	return &Quitter{
		events:         events,
		beforeFlush:    beforeFlush,
		teardown:       teardown,
		timeout:        flushTimeout,
		liveWindowKeys: liveWindowKeys,
		flushed:        make(chan struct{}),
	}
}

// Attach supplies the app once application.New has returned.
func (q *Quitter) Attach(app *application.App) {
	q.app = app
}

// ShouldQuit is application.Options.ShouldQuit. It NEVER blocks — the renderer's ack is itself a
// bound call arriving through the main thread, so a handler that waited here would deadlock the
// very ack it waits for.
func (q *Quitter) ShouldQuit() bool {
	if q.done.Load() {
		return true
	}
	if q.started.CompareAndSwap(false, true) {
		go q.flushThenQuit()
	}
	return false // NSTerminateCancel
}

// RequestQuit is the menu Quit item's click handler.
func (q *Quitter) RequestQuit() { q.app.Quit() }

// Flushed is one window's ack, bound as Lifecycle.Flushed (IPC.appFlushed) — fire-and-forget and
// idempotent: an unknown key is a no-op, not a panic. Also the release valve for a window that
// closes mid-handshake without ever acking.
func (q *Quitter) Flushed(windowKey string) {
	q.mu.Lock()
	if _, owing := q.pending[windowKey]; !owing {
		q.mu.Unlock()
		return
	}
	delete(q.pending, windowKey)
	empty := len(q.pending) == 0
	q.mu.Unlock()
	if empty {
		q.release()
	}
}

func (q *Quitter) release() { q.closeOnce.Do(func() { close(q.flushed) }) }

// Shutdown is application.Options.OnShutdown — the path a signal or a Run() error takes, where
// ShouldQuit never fires.
func (q *Quitter) Shutdown() {
	q.beforeFlush()
	q.teardown()
}

func (q *Quitter) flushThenQuit() {
	q.beforeFlush()

	q.mu.Lock()
	q.pending = make(map[string]struct{})
	for _, key := range q.liveWindowKeys() {
		q.pending[key] = struct{}{}
	}
	noWindows := len(q.pending) == 0
	q.mu.Unlock()
	if noWindows {
		q.release()
	}

	// Broadcast (not Signal): every window must flush before quitting, not only the focused one.
	q.events.Broadcast(bridge.ChannelFlushBeforeClose)
	select {
	case <-q.flushed:
	case <-time.After(q.timeout):
		slog.Warn("quit flush timed out", "scope", "lifecycle", "timeoutMs", q.timeout.Milliseconds())
	}
	q.teardown()
	q.done.Store(true)
	q.app.Quit() // second pass: ShouldQuit now returns true
}
