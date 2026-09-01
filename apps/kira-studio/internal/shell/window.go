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

// cascadeStep is the classic one-title-bar-step offset a freshly opened window gets from the
// window it cascades from (D10) — large enough that the new window is unmistakably a second
// window, not a resize glitch on the first.
const cascadeStep = 24

// CascadeFrom computes a fresh window's rectangle from an existing one (D10: a new workbench
// with no stored rectangle of its own inherits the focused window's size, offset by one
// title-bar step, wrapped back to the screen's work-area origin rather than left to drift off
// it). Returns nil when there is no window to cascade from (the very first window, or a Linux
// build where Current() never resolves one — Options' own defaults take over in that case).
func CascadeFrom(from application.Window) *model.WindowBounds {
	if from == nil {
		return nil
	}
	b := from.Bounds()
	var work *application.Rect
	if screen, err := from.GetScreen(); err == nil && screen != nil {
		work = &screen.WorkArea
	}
	return cascadeRect(b, work)
}

// cascadeRect is CascadeFrom's pure arithmetic, split out so the offset/wrap rule doesn't need a
// live *application.WebviewWindow to reason about.
func cascadeRect(from application.Rect, work *application.Rect) *model.WindowBounds {
	x, y := from.X+cascadeStep, from.Y+cascadeStep
	if work != nil {
		if x+from.Width > work.X+work.Width || y+from.Height > work.Y+work.Height {
			x, y = work.X, work.Y
		}
		if x < work.X {
			x = work.X
		}
		if y < work.Y {
			y = work.Y
		}
	}
	return &model.WindowBounds{X: float64(x), Y: float64(y), Width: float64(from.Width), Height: float64(from.Height)}
}
