package shell

import (
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/kirathecat/kira-studio/shell/internal/bridge"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// Quitter is the Go analogue of src/main/index.ts:151-163's before-quit handler. It is wired
// three ways: application.Options.ShouldQuit (which covers Cmd+Q, the Apple menu, the Dock and
// App.Quit() alike — §1.3), application.Options.OnShutdown, and the menu's own Quit item.
type Quitter struct {
	events      *bridge.Events
	beforeFlush func() // sync.OnceFunc: metrics ticker Stop (index.ts:156)
	teardown    func() // sync.OnceFunc: the ordered shutdown
	timeout     time.Duration

	app     *application.App
	started atomic.Bool
	done    atomic.Bool
	flushed chan struct{}
	ackOnce sync.Once
}

// NewQuitter takes the two teardown halves already wrapped in sync.OnceFunc by the caller, so
// main.go states the order in one place. flushTimeout is index.ts's FLUSH_TIMEOUT_MS.
func NewQuitter(events *bridge.Events, beforeFlush, teardown func(), flushTimeout time.Duration) *Quitter {
	return &Quitter{
		events:      events,
		beforeFlush: beforeFlush,
		teardown:    teardown,
		timeout:     flushTimeout,
		flushed:     make(chan struct{}),
	}
}

// Attach supplies the app once application.New has returned. ShouldQuit is passed to
// application.New as a method value before that, which is why the app cannot be a constructor
// argument.
func (q *Quitter) Attach(app *application.App) {
	q.app = app
}

// ShouldQuit is application.Options.ShouldQuit. It NEVER blocks (P56 D2): the renderer's ack is
// itself a bound call, which arrives through the main thread (application_darwin.go:431's
// processURLRequest), so a handler that waited here would deadlock the very ack it waits for and
// guarantee the timeout — losing exactly the debounced tab save the handshake exists to protect
// (src/renderer/state/tabs.ts:131-137 awaits a tabsSave round trip before acking).
func (q *Quitter) ShouldQuit() bool {
	if q.done.Load() {
		return true
	}
	if q.started.CompareAndSwap(false, true) {
		go q.flushThenQuit()
	}
	return false // NSTerminateCancel — Electron's event.preventDefault()
}

// RequestQuit is the menu Quit item's click handler. App.Quit() routes through
// applicationShouldTerminate: too, so this is the same path, not a second one.
func (q *Quitter) RequestQuit() { q.app.Quit() }

// Flushed is the renderer's ack, bound as Lifecycle.Flushed (IPC.appFlushed). Fire-and-forget and
// idempotent: a late ack after the timeout is a no-op, not a panic on a closed channel.
func (q *Quitter) Flushed() { q.ackOnce.Do(func() { close(q.flushed) }) }

// Shutdown is application.Options.OnShutdown — the path a signal or a Run() error takes, where
// ShouldQuit never fires. Both halves are sync.OnceFunc, so the ordinary path's earlier calls make
// this a no-op rather than a double teardown (P56 D3).
func (q *Quitter) Shutdown() {
	q.beforeFlush()
	q.teardown()
}

func (q *Quitter) flushThenQuit() {
	q.beforeFlush()
	q.events.Signal(bridge.ChannelFlushBeforeClose)
	select {
	case <-q.flushed:
	case <-time.After(q.timeout):
		slog.Warn("quit flush timed out", "scope", "lifecycle", "timeoutMs", q.timeout.Milliseconds())
	}
	q.teardown()
	q.done.Store(true)
	q.app.Quit() // second pass: ShouldQuit now returns true
}
