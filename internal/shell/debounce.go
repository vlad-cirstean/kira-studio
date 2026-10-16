package shell

import (
	"sync"
	"time"
)

// debouncer coalesces bursts of trigger calls into a single fn invocation, fired d after the
// last trigger — window.go's resize/move persistence (§4.4) is its one use.
type debouncer struct {
	mu    sync.Mutex
	timer *time.Timer
	d     time.Duration
}

func newDebouncer(d time.Duration) *debouncer {
	return &debouncer{d: d}
}

// trigger (re)starts the window, replacing any pending fn with this call's.
func (b *debouncer) trigger(fn func()) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.timer != nil {
		b.timer.Stop()
	}
	b.timer = time.AfterFunc(b.d, fn)
}

// cancel stops a pending trigger without running it. Safe to call with nothing pending.
func (b *debouncer) cancel() {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.timer != nil {
		b.timer.Stop()
		b.timer = nil
	}
}
