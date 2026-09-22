package shell

import (
	"fmt"
	"log/slog"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/repos"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

const boundsDebounce = 300 * time.Millisecond

// defaultWindowWidth/defaultWindowHeight/minWindowWidth/minWindowHeight/windowSizeMargin mirror
// Kira Studio's own shell/window.go constants verbatim (P100 Part 1) — same first-launch sizing
// discipline, no Kira-Space-specific reason to diverge yet.
const (
	defaultWindowWidth  = 1280
	defaultWindowHeight = 800

	minWindowWidth  = 1024
	minWindowHeight = 640

	windowSizeMargin = 40
)

// WindowDeps is Attach's dependencies, shared across every window the app opens.
type WindowDeps struct {
	Windows   *repos.WindowsRepo
	StartedAt time.Time
}

// Options builds one window's options from its own record — Kira Studio's own Options
// (shell/window.go), with Title "Kira Space" in place of "Kira Studio" and no other change.
func Options(sec SecurityOptions, w model.WindowRecord, primaryWorkArea *application.Rect) application.WebviewWindowOptions {
	width, height := DefaultBounds(primaryWorkArea)
	opts := application.WebviewWindowOptions{
		Title:            "Kira Space",
		Width:            width,
		Height:           height,
		MinWidth:         minWindowWidth,
		MinHeight:        minWindowHeight,
		BackgroundColour: application.NewRGB(24, 24, 24),
		URL:              "/?window=" + w.Key,
		Name:             w.Key,
		Permissions:      sec.Permissions,
		EnableFileDrop:   false,
		Mac: application.MacWindow{
			WebviewPreferences: sec.Webview,
			TitleBar:           application.MacTitleBarHidden,
		},
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

// DefaultBounds is Kira Studio's own DefaultBounds, unchanged.
func DefaultBounds(work *application.Rect) (width, height int) {
	if work == nil || work.Width <= 0 || work.Height <= 0 {
		return defaultWindowWidth, defaultWindowHeight
	}
	width = clampInt(min(defaultWindowWidth, work.Width-windowSizeMargin), minWindowWidth, defaultWindowWidth)
	height = clampInt(min(defaultWindowHeight, work.Height-windowSizeMargin), minWindowHeight, defaultWindowHeight)
	return width, height
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func boundsFromRect(r application.Rect) model.WindowBounds {
	return model.WindowBounds{
		X:      float64(r.X),
		Y:      float64(r.Y),
		Width:  float64(r.Width),
		Height: float64(r.Height),
	}
}

// Attach wires resize/move persistence for this one window's own `windows` row plus the
// startup-load log line — Kira Studio's own Attach, unchanged (this app's WindowsRepo has the
// same SetBounds signature).
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

const cascadeStep = 24

// CascadeFrom computes a fresh window's rectangle from an existing one — Kira Studio's own
// CascadeFrom, unchanged.
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
