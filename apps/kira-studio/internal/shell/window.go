package shell

import (
	"fmt"
	"log/slog"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/repos"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

const boundsDebounce = 300 * time.Millisecond

// WindowDeps is Attach's dependencies, shared across every window the app opens — only the key
// passed to Attach varies per window (P8 C2).
type WindowDeps struct {
	Windows   *repos.WindowsRepo
	StartedAt time.Time
}

// Options builds one window's options from its own record (D11): the stored rectangle if it has
// one, Wails' own size defaults otherwise, always at its own `/?window=<key>` URL and `Name`
// (D2 — the shell mints the key and hands it to the renderer this way, since it must be readable
// synchronously at boot, before hydrateTabs() runs). There is no exact analogue of Electron's
// show:false/ready-to-show pattern here — WindowRuntimeReady fires only after the frontend has
// already loaded — a deliberate small divergence, not hidden (§1's window.ts read).
func Options(sec SecurityOptions, w model.WindowRecord) application.WebviewWindowOptions {
	opts := application.WebviewWindowOptions{
		Title:            "Kira Studio",
		Width:            1280,
		Height:           800,
		MinWidth:         1024,
		MinHeight:        640,
		BackgroundColour: application.NewRGB(24, 24, 27),
		URL:              "/?window=" + w.Key,
		Name:             w.Key,
		Permissions:      sec.Permissions,
		EnableFileDrop:   false,
		Mac:              application.MacWindow{WebviewPreferences: sec.Webview},
	}

	if w.Bounds != nil {
		b := w.Bounds
		opts.Width = int(b.Width)
		opts.Height = int(b.Height)
		opts.X = int(b.X)
		opts.Y = int(b.Y)
		opts.InitialPosition = application.WindowXY
	}
	return opts
}

// boundsFromRect converts Wails' int-fielded Rect (webview_window.go's Bounds()) to the
// float64-fielded model.WindowBounds that LayoutRepo stores — split out so the conversion is
// testable without a live *application.WebviewWindow.
func boundsFromRect(r application.Rect) model.WindowBounds {
	return model.WindowBounds{
		X:      float64(r.X),
		Y:      float64(r.Y),
		Width:  float64(r.Width),
		Height: float64(r.Height),
	}
}

// Attach wires resize/move persistence (debounced 300ms, matching window.ts's
// BOUNDS_DEBOUNCE_MS) for this one window's own `windows` row and the startup log line. The
// returned detach unsubscribes all four window-event listeners and cancels any pending debounced
// write; call it once per window, from beforeFlush (P2 R1: main.go used to discard it, so a
// resize/move landing during the shutdown flush-wait — after beforeFlush but before teardown
// closes the DB — could still fire persist() against a WindowsRepo whose *sql.DB teardown had
// already closed, racing the shutdown sequence this listener has no other way to know is
// underway) — and, per window, when that window closes (C3's WindowClosing listener).
func Attach(win *application.WebviewWindow, d WindowDeps, key string) (detach func()) {
	db := newDebouncer(boundsDebounce)

	persist := func() {
		bounds := boundsFromRect(win.Bounds())
		if err := d.Windows.SetBounds(key, bounds); err != nil {
			slog.Warn("persist window bounds failed", "scope", "window", "key", key, "err", err)
		}
	}

	offResize := win.OnWindowEvent(events.Common.WindowDidResize, func(*application.WindowEvent) {
		db.trigger(persist)
	})
	offMove := win.OnWindowEvent(events.Common.WindowDidMove, func(*application.WindowEvent) {
		db.trigger(persist)
	})
	// window.ts's closed handler only clears its pending timeout, never flushes — parity keeps
	// that here too (D8): a bounds write in flight when the window closes is simply dropped.
	offClosing := win.OnWindowEvent(events.Common.WindowClosing, func(*application.WindowEvent) {
		db.cancel()
	})
	offReady := win.OnWindowEvent(events.Common.WindowRuntimeReady, func(*application.WindowEvent) {
		ms := time.Since(d.StartedAt).Milliseconds()
		slog.Info(fmt.Sprintf("did-finish-load at uptime %dms", ms), "scope", "startup")
	})

	return func() {
		offResize()
		offMove()
		offClosing()
		offReady()
		db.cancel()
	}
}
