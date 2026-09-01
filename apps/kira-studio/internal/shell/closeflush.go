package shell

import (
	"sync"
	"sync/atomic"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge"
	"github.com/wailsapp/wails/v3/pkg/application"
	wailsevents "github.com/wailsapp/wails/v3/pkg/events"
)

// closeFlushTimeout mirrors the quit handshake's own cap (main.go's 2*time.Second) — one
// window's close-flush wait, not open-ended.
const closeFlushTimeout = 2 * time.Second

// CloseFlushCoordinator routes one window's "flush before close" ack
// (LifecycleService.WindowFlushed) back to whichever WindowClosing hook is waiting for it (C6).
// Unlike the quit handshake (C8's Quitter, which waits for every window at once), at most one
// waiter exists per key at a time — a window can only be in the middle of closing once, since
// AttachCloseFlush's own `flushing` guard makes the hook one-shot per window.
type CloseFlushCoordinator struct {
	mu      sync.Mutex
	waiting map[string]chan struct{}
}

func NewCloseFlushCoordinator() *CloseFlushCoordinator {
	return &CloseFlushCoordinator{waiting: map[string]chan struct{}{}}
}

// wait registers key as awaiting an ack and returns the channel that closes when one arrives.
// done must be called exactly once, whether the wait ended in an ack or a timeout, so a late or
// duplicate Ack(key) call after that point is a no-op rather than a close on a channel nothing
// still owns.
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

// Ack fires the currently registered waiter for key, if any. A key with no registered waiter —
// already timed out, or an ack that never had a matching wait — is a silent no-op, the same "a
// late ack is not a panic" property Quitter's own Flushed has (quit.go:67-69).
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

// AttachCloseFlush registers the WindowClosing hook that fixes F8: closing a window used to flush
// nothing, dropping whatever saveDebounced() had pending. This holds the close, asks this one
// window (only) to flush its pending tab-state save, and lets it actually close once that ack
// arrives or closeFlushTimeout elapses — whichever first.
//
// The trap this works around: (*WebviewWindow).Close() is itself w.emit(events.Common.WindowClosing)
// (webview_window.go:1248-1255), so a hook that unconditionally cancels and then calls Close()
// loops forever. `flushing` makes the hook one-shot: the first pass (the user's own close, or the
// Dock/menu Close Window action) cancels and starts the flush wait; the second pass — this
// goroutine's own win.Close() call once the wait ends — sees flushing already true, does not
// cancel again, and lets Wails' own internal listener finally destroy the window.
//
// Known limitation, not resolved here: if the whole app is quitting at the same moment (Quitter's
// own broadcast flush, C8) and quitting closes windows individually as part of macOS termination,
// this hook would hold each of them for up to closeFlushTimeout waiting on an ack the renderer
// may already be past sending — bounded by the timeout, so a worst-case added delay, not a hang,
// but the actual interaction is AppKit termination sequencing this sandbox cannot observe
// (**[needs a Mac]**, P8 §6.3).
func AttachCloseFlush(win *application.WebviewWindow, key string, emit *bridge.Events, coordinator *CloseFlushCoordinator) {
	var flushing atomic.Bool
	win.RegisterHook(wailsevents.Common.WindowClosing, func(event *application.WindowEvent) {
		if !flushing.CompareAndSwap(false, true) {
			return
		}
		event.Cancel()
		ack, done := coordinator.wait(key)
		emit.SignalTo(key, bridge.ChannelWindowFlushBeforeClose)
		go func() {
			select {
			case <-ack:
			case <-time.After(closeFlushTimeout):
			}
			done()
			win.Close()
		}()
	})
}
