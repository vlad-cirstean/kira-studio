package oplog

import (
	"log/slog"
	"sync"
	"sync/atomic"
	"time"
)

const writeQueue = 1024

// writer runs persistence jobs on one goroutine, so writes for one id keep their order. A full
// queue drops the job: persistence never blocks a git spawn.
type writer struct {
	ch       chan func()
	done     chan struct{}
	mu       sync.RWMutex
	closed   bool
	dropped  atomic.Int64
	lastWarn atomic.Int64
}

func newWriter() *writer {
	w := &writer{ch: make(chan func(), writeQueue), done: make(chan struct{})}
	go func() {
		defer close(w.done)
		for fn := range w.ch {
			fn()
		}
	}()
	return w
}

func (w *writer) submit(fn func()) bool {
	w.mu.RLock()
	defer w.mu.RUnlock()
	if w.closed {
		return false
	}
	select {
	case w.ch <- fn:
		return true
	default:
		n := w.dropped.Add(1)
		now := time.Now().UnixNano()
		if last := w.lastWarn.Load(); now-last > int64(time.Minute) && w.lastWarn.CompareAndSwap(last, now) {
			slog.Warn("oplog: write queue full, dropping", "scope", "oplog", "dropped", n)
		}
		return false
	}
}

// close stops accepting jobs and waits up to bound for the queue to drain.
func (w *writer) close(bound time.Duration) {
	w.mu.Lock()
	if !w.closed {
		w.closed = true
		close(w.ch)
	}
	w.mu.Unlock()
	select {
	case <-w.done:
	case <-time.After(bound):
	}
}
