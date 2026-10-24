package openedfiles

import (
	"sync"
	"time"
)

// Stop cancels a scheduled call.
type Stop func()

// After schedules f once after d. time.AfterFunc in production, a manual clock in tests.
type After func(d time.Duration, f func()) Stop

// RealAfter is the production After.
func RealAfter(d time.Duration, f func()) Stop {
	t := time.AfterFunc(d, f)
	return func() { t.Stop() }
}

// Coalescer batches paths: AppKit delivers a multi-file open as back-to-back openFile: calls, and
// one Finder action must become one window. A batch flushes delay after the last Add.
type Coalescer struct {
	delay time.Duration
	after After
	flush func(paths []string)

	mu     sync.Mutex
	buf    []string
	stop   Stop
	gen    int
	closed bool
}

// NewCoalescer builds a Coalescer; flush runs on the timer's goroutine.
func NewCoalescer(delay time.Duration, after After, flush func(paths []string)) *Coalescer {
	return &Coalescer{delay: delay, after: after, flush: flush}
}

// Add buffers path and restarts the flush timer. A no-op after Close.
func (c *Coalescer) Add(path string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return
	}
	c.buf = append(c.buf, path)
	if c.stop != nil {
		c.stop()
	}
	c.gen++
	gen := c.gen
	c.stop = c.after(c.delay, func() { c.fire(gen) })
}

// fire flushes the buffer unless a later Add or Close superseded this timer.
func (c *Coalescer) fire(gen int) {
	c.mu.Lock()
	if c.closed || gen != c.gen {
		c.mu.Unlock()
		return
	}
	batch := c.buf
	c.buf, c.stop = nil, nil
	c.mu.Unlock()
	c.flush(batch)
}

// Close stops the timer and drops the buffer.
func (c *Coalescer) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.closed = true
	c.buf = nil
	if c.stop != nil {
		c.stop()
		c.stop = nil
	}
}
