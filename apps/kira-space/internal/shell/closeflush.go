package shell

import (
	"sync"
	"sync/atomic"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/wailsapp/wails/v3/pkg/application"
	wailsevents "github.com/wailsapp/wails/v3/pkg/events"
)

// closeFlushTimeout mirrors the quit handshake's own cap — one window's close-flush wait, not
// open-ended. Kira Studio's own closeflush.go, unchanged.
const closeFlushTimeout = 2 * time.Second

// CloseFlushCoordinator routes one window's "flush before close" ack (LifecycleService.
// WindowFlushed) back to whichever WindowClosing hook is waiting for it — Kira Studio's own
// CloseFlushCoordinator (internal/shell/closeflush.go), unchanged: at most one waiter exists per
// key at a time.
type CloseFlushCoordinator struct {
	mu      sync.Mutex
	waiting map[string]chan struct{}
}

func NewCloseFlushCoordinator() *CloseFlushCoordinator {
	return &CloseFlushCoordinator{waiting: map[string]chan struct{}{}}
}

func (c *CloseFlushCoordinator) wait(key string) (ack <-chan struct{}, done func()) {
	ch := make(chan struct{})
	c.mu.Lock()
	c.waiting[key] = ch
	c.mu.Unlock()
	return ch, func() {
		c.mu.Lock()
		defer c.mu.Unlock()
		if c.waiting[key] == ch {
			delete(c.waiting, key)
		}
	}
}

// Ack fires the currently registered waiter for key, if any — a late or duplicate call is a
// silent no-op.
func (c *CloseFlushCoordinator) Ack(key string) {
	c.mu.Lock()
	ch, ok := c.waiting[key]
	if ok {
		delete(c.waiting, key)
	}
	c.mu.Unlock()
	if ok {
		close(ch)
	}
}

// AttachCloseFlush registers the WindowClosing hook that holds one window's close, asks it (only)
// to flush its pending tab-state save, and lets it actually close once that ack arrives or
// closeFlushTimeout elapses — whichever first. Kira Studio's own AttachCloseFlush
// (internal/shell/closeflush.go), unchanged: same one-shot `flushing` guard against
// (*WebviewWindow).Close() re-emitting WindowClosing, same last-window Hide()-not-Close() leak
// mitigation, same about:blank navigate-away before a real Close().
func AttachCloseFlush(
	win *application.WebviewWindow,
	key string,
	emit *bridge.Events,
	coordinator *CloseFlushCoordinator,
	isLastWindow func() bool,
) {
	var flushing atomic.Bool
	win.RegisterHook(wailsevents.Common.WindowClosing, func(event *application.WindowEvent) {
		if !flushing.CompareAndSwap(false, true) {
			return
		}
		event.Cancel()
		last := isLastWindow()
		ack, done := coordinator.wait(key)
		emit.SignalTo(key, bridge.ChannelWindowFlushBeforeClose)
		go func() {
			select {
			case <-ack:
			case <-time.After(closeFlushTimeout):
			}
			done()
			if last {
				win.Hide()
				return
			}
			win.SetURL("about:blank")
			win.Close()
		}()
	})
}
