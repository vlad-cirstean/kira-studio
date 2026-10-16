package bridge

import (
	"sync"
	"time"
)

// coalescer turns a burst of triggers into one emit per gap.
type coalescer struct {
	gap  time.Duration
	emit func()

	mu      sync.Mutex
	pending bool
}

func newCoalescer(gap time.Duration, emit func()) *coalescer {
	return &coalescer{gap: gap, emit: emit}
}

func (c *coalescer) Trigger() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.pending {
		return
	}
	c.pending = true
	time.AfterFunc(c.gap, func() {
		c.mu.Lock()
		c.pending = false
		c.mu.Unlock()
		c.emit()
	})
}
