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
// goroutine's own win.Close()/win.Hide() call once the wait ends — sees flushing already true,
// does not cancel again, and (for Close) lets Wails' own internal listener finally destroy the
// window.
//
// Real-interaction fix (item 8 — a webview process outlives its window, and duplicates on
// reopen): root-caused against the actual Wails v3 beta.16 source (vendored at
// $GOPATH/pkg/mod/github.com/wailsapp/wails/v3@v3.0.0-beta.16), not guessed —
//   - webview_window.go's own default WindowClosing *listener* (registered once, in NewWindow,
//     for every window) is the entire native teardown: markAsDestroyed, impl.close,
//     Window.Remove. On macOS, impl.close is exactly `[NSWindow close]`
//     (webview_window_darwin.go's macosWebviewWindow.close) — nothing more.
//     macosWebviewWindow.destroy() exists but is called from nowhere in the library, and its C
//     body is byte-identical to close()'s; there is no exported Destroy on *WebviewWindow* at
//     all. So closing a window never guarantees its WKWebView's own WebContent/GPU/Networking
//     XPC helper processes (docs/v1.1/WEBVIEW-SCROLL-MEMORY.md §2.2 names all three) actually exit —
//     confirmed as a known, unfixable-from-Go limitation of this exact Wails version, not
//     something this app's own code was doing wrong. This is the "does not actually terminate"
//     half of the report, and it stays true for a genuine Close() below (a real limitation, not
//     band-aided over) — what this fix changes is *how often Close() has to happen at all*.
//   - The "duplicates on reopen" half **was** this app's own bug, and is fully fixable: closing
//     the *last* window always called Close() (real destroy, permanently orphaning that
//     process), which empties app.Window.GetAll() — so the next Dock-click/menu reopen
//     (main.go's reopenWindow, gated on GetAll()==0) minted a **second**, brand-new window and
//     webview from scratch. Every close/reopen cycle on a single-window app (the common case)
//     therefore orphaned one more WebContent process forever, an unbounded leak.
//   - Fix: closing the last window now calls Hide() instead of Close(). Hide() never emits
//     WindowClosing at all (isDestroyed()/impl.close() are never reached), so the native window
//     and its webview process stay alive — but Wails' *own* default reopen handler
//     (events_common_darwin.go's setupCommonEvents, registered automatically for every app, not
//     something this app has to duplicate) already does exactly the right thing for a hidden
//     window on the next Dock-click: "for _, window := range app.Window.GetAll() { if
//     !window.IsVisible() { window.Show() } }" — the same window, the same webview, the same
//     process, reused. main.go's own AttachReopen only ever needs to mint a genuinely new window
//     when GetAll() is truly empty (first launch, or after a real Cmd+Q quit-then-relaunch), which
//     this change does not touch. A window that is not the last one still calls Close() exactly as
//     before — D5's "delete this window's own row unless it's the one keeping the app alive"
//     bookkeeping (main.go's WindowClosing listener) is unaffected, and closing one of several
//     windows is a deliberate "I'm done with this workbench" action, not backgrounding the app,
//     so reusing it later is not the right behaviour there.
//
// Known limitation, not resolved here: if the whole app is quitting at the same moment (Quitter's
// own broadcast flush, C8) and quitting closes windows individually as part of macOS termination,
// this hook would hold each of them for up to closeFlushTimeout waiting on an ack the renderer
// may already be past sending — bounded by the timeout, so a worst-case added delay, not a hang,
// but the actual interaction is AppKit termination sequencing this sandbox cannot observe
// (**[needs a Mac]**, P8 §6.3). Quitting always calls Close() on every window regardless of count
// (quitter.RequestQuit/App.cleanup, not this hook's own hide/close choice) — Hide is only ever
// reached from a plain window-close, never from quitting the whole app.
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
		// Decided now, before the flush wait — RemoveAndCount only runs once this hook lets a
		// real Close() through (main.go's own WindowClosing listener, the second pass below), so
		// this window is still counted here regardless of which way the decision goes.
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
				// Real-interaction fix: reused, not destroyed — see this function's own doc
				// comment. Deliberately does NOT navigate to about:blank first (unlike the Close
				// path below): the whole point of keeping this window alive is instant resume —
				// every open tab, the query text mid-edit, scroll position — on the next
				// Dock-click, which a page unload would throw away for no benefit (nothing here
				// is actually being reclaimed; the process stays up either way).
				win.Hide()
				return
			}
			// P28 D20: drop this window's page before the native close — this app's own
			// mitigation for the leak described above, on the one path (not the last window)
			// where the process really is being permanently orphaned and there is nothing
			// stronger available. By here the flush ack has arrived or timed out, so nothing in
			// the page still has work to do; navigating away tears down the Vue tree, every
			// SlickGrid and CodeMirror instance, the data-plane stream reader and every timer, so
			// the process is left holding an empty document rather than the whole app heap. Safe
			// on every platform and on every path into a close, including the quit handshake.
			// **[needs a Mac]** whether macOS then reaps the process itself, and how quickly —
			// that is observable only in Activity Monitor against a packaged build.
			win.SetURL("about:blank")
			win.Close()
		}()
	})
}
