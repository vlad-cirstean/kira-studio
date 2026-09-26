// Package windowsvc is the one Wails-bound windows surface both apps embed (P128 §2.2) — renderer-
// boot registration for the window a page is (P8 D2), plus this window's own persisted module mode.
package windowsvc

import "github.com/kirathecat/kira-studio/internal/ipcerr"

// Store is the read/write surface Service needs from an app's own *repos.WindowsRepo — each app's
// own mode vocabulary stays in its own storage/model package (P128 §2.2), Store only needs these
// three calls.
type Store interface {
	EnsureExists(key string) error
	GetMode(key string) (string, error)
	SetMode(key, mode string) error
}

// Service is the shared bound type — each app's own bridge.WindowsService is
// `struct{ *windowsvc.Service }`, so Wails' binding generator builds a call's FQN from the
// registered type's own package, promoted methods included, keeping binding names app-local while
// every method body lives here once.
type Service struct {
	Windows Store

	// OpenNewWindow is main.go's own openNewWindow closure (the ⇧⌘N menu command's action),
	// assigned after the service is constructed because that closure needs the application this
	// service is registered on. nil in a `-tags server` build, where there is no native shell to
	// open a window at all.
	OpenNewWindow func()
}

// EnsureArgs is Ensure's own wire shape.
type EnsureArgs struct {
	WindowKey string `json:"windowKey"`
}

// EnsureResult carries this window's own persisted mode back to the boot sequence that already
// calls Ensure before anything else window-scoped — the seam that hydrates each app's own
// state/mode.ts modeState.active without a second round trip.
type EnsureResult struct {
	Mode string `json:"mode"`
}

// Ensure registers this page's own windowKey with a `windows` row if it doesn't already have one —
// always a no-op on the native shell (main.go's own window-creation paths already created it before
// this page's URL ever loaded, D2), and the only thing that ever does on a `-tags server` build,
// which has no shell managing window creation at all.
func (s *Service) Ensure(args EnsureArgs) (EnsureResult, error) {
	if args.WindowKey == "" {
		return EnsureResult{}, ipcerr.BadRequest("windowKey is required")
	}
	if err := s.Windows.EnsureExists(args.WindowKey); err != nil {
		return EnsureResult{}, ipcerr.InternalErr(err)
	}
	mode, err := s.Windows.GetMode(args.WindowKey)
	if err != nil {
		return EnsureResult{}, ipcerr.InternalErr(err)
	}
	return EnsureResult{Mode: mode}, nil
}

// SetModeArgs is SetMode's own wire shape.
type SetModeArgs struct {
	WindowKey string `json:"windowKey"`
	Mode      string `json:"mode"`
}

// SetMode persists this window's own mode — called from a debounced writer (state/mode.ts), never
// synchronously from a mode-tab click (Studio's own F20 invariant, carried into both apps: a mode
// switch itself schedules no write).
func (s *Service) SetMode(args SetModeArgs) error {
	if args.WindowKey == "" {
		return ipcerr.BadRequest("windowKey is required")
	}
	return ipcerr.InternalErr(s.Windows.SetMode(args.WindowKey, args.Mode))
}

// OpenNew is the title bar's "New window" button — the same action as the ⇧⌘N menu command, reached
// from the renderer for the first time.
func (s *Service) OpenNew() error {
	if s.OpenNewWindow == nil {
		return ipcerr.BadRequest("windows: this build cannot open a window")
	}
	s.OpenNewWindow()
	return nil
}
