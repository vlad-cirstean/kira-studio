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

// mainWindowKey is the one window record this app manages until C2/C3 give every window its own
// minted key (D2) — kept as a named constant here rather than a bare literal so the seam is
// visible at the one call site that still hardcodes it.
const mainWindowKey = "main"

// WindowDeps is Options/Attach's dependencies.
type WindowDeps struct {
	Windows   *repos.WindowsRepo
	StartedAt time.Time
}

// Options builds the main window's options: the stored rectangle if one has ever been
// persisted, Wails' own defaults otherwise. There is no exact analogue of Electron's
// show:false/ready-to-show pattern here — WindowRuntimeReady fires only after the frontend has
// already loaded — a deliberate small divergence, not hidden (§1's window.ts read).
func Options(d WindowDeps, sec SecurityOptions, url string) application.WebviewWindowOptions {
	opts := application.WebviewWindowOptions{
		Title:            "Kira Studio",
		Width:            1280,
		Height:           800,
		MinWidth:         1024,
		MinHeight:        640,
		BackgroundColour: application.NewRGB(24, 24, 27),
		URL:              url,
		Permissions:      sec.Permissions,
		EnableFileDrop:   false,
		Mac:              application.MacWindow{WebviewPreferences: sec.Webview},
	}

	records, err := d.Windows.List()
	if err == nil {
		for _, rec := range records {
			if rec.Key != mainWindowKey || rec.Bounds == nil {
				continue
			}
			b := rec.Bounds
			opts.Width = int(b.Width)
			opts.Height = int(b.Height)
			opts.X = int(b.X)
			opts.Y = int(b.Y)
			opts.InitialPosition = application.WindowXY
			break
		}
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
// BOUNDS_DEBOUNCE_MS) and the startup log line. The returned detach unsubscribes all four
// window-event listeners and cancels any pending debounced write; call it once, from beforeFlush
// (P2 R1: main.go used to discard it, so a resize/move landing during the shutdown flush-wait —
// after beforeFlush but before teardown closes the DB — could still fire persist() against a
// LayoutRepo whose *sql.DB teardown had already closed, racing the shutdown sequence this
// listener has no other way to know is underway).
func Attach(win *application.WebviewWindow, d WindowDeps) (detach func()) {
	db := newDebouncer(boundsDebounce)

	persist := func() {
		bounds := boundsFromRect(win.Bounds())
		if err := d.Windows.SetBounds(mainWindowKey, bounds); err != nil {
			slog.Warn("persist window bounds failed", "scope", "window", "err", err)
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
