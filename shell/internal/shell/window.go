package shell

import (
	"fmt"
	"log/slog"
	"time"

	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
	"github.com/kirathecat/kira-studio/shell/internal/storage/repos"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

const boundsDebounce = 300 * time.Millisecond

// WindowDeps is Options/Attach's dependencies.
type WindowDeps struct {
	Layout    *repos.LayoutRepo
	StartedAt time.Time
}

// Options builds the main window's options: the stored rectangle if window.ts ever persisted
// one, Wails' own defaults otherwise. There is no exact analogue of Electron's
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
		EnableFileDrop:   true,
		Mac:              application.MacWindow{WebviewPreferences: sec.Webview},
	}

	layout, err := d.Layout.GetAll()
	if err == nil && layout.Window.Bounds != nil {
		b := layout.Window.Bounds
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
// BOUNDS_DEBOUNCE_MS) and the startup log line. The returned detach unsubscribes all four
// window-event listeners and cancels any pending debounced write; call it once, from
// beforeFlush.
func Attach(win *application.WebviewWindow, d WindowDeps) (detach func()) {
	db := newDebouncer(boundsDebounce)

	persist := func() {
		bounds := boundsFromRect(win.Bounds())
		if _, err := d.Layout.Set(model.LayoutPatch{Window: &model.WindowPatch{Bounds: &bounds}}); err != nil {
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
