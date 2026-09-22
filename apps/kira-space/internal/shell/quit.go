package shell

import (
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Quitter runs teardown exactly once, on whichever of ShouldQuit/Shutdown Wails calls first, then
// lets the second (or a repeated) call through immediately.
//
// Kira Studio's own Quitter (shell/quit.go) additionally waits out a per-window flush handshake —
// every open window acks a ChannelFlushBeforeClose broadcast (its own tabsSave round trip)
// before teardown runs, capped by a timeout. Kira Space has nothing to flush yet (P100 Part 1: no
// tabs, no layout — model.WindowRecord's own doc comment), so this copy skips the handshake
// entirely rather than porting a wait for an ack no renderer code will ever send; Part 2 is where
// this app gains its own quit-time save if it turns out to need one.
type Quitter struct {
	teardown func()
	app      *application.App
	once     sync.Once
}

// NewQuitter takes teardown already wrapped in sync.OnceFunc by the caller (matching Kira
// Studio's own convention), so main.go states the shutdown order in one place.
func NewQuitter(teardown func()) *Quitter {
	return &Quitter{teardown: teardown}
}

// Attach supplies the app once application.New has returned.
func (q *Quitter) Attach(app *application.App) {
	q.app = app
}

// ShouldQuit is application.Options.ShouldQuit — runs teardown synchronously (nothing here blocks
// on a renderer round trip, unlike Kira Studio's own flush handshake) and lets Wails proceed.
func (q *Quitter) ShouldQuit() bool {
	q.once.Do(q.teardown)
	return true
}

// RequestQuit is the menu Quit item's click handler.
func (q *Quitter) RequestQuit() { q.app.Quit() }

// Shutdown is application.Options.OnShutdown — the path a signal or a Run() error takes, where
// ShouldQuit never fires.
func (q *Quitter) Shutdown() {
	q.once.Do(q.teardown)
}
