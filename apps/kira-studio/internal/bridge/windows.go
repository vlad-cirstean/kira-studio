package bridge

import (
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ipcerr"
)

// WindowsService is renderer-boot registration for the window this page is (P8 D2). On the
// native shell every window's `windows` row already exists by the time the renderer that would
// call this loads at all — main.go's own window-creation paths always Create the row before
// building the window's URL — so Ensure is always a no-op there. A `-tags server` build has no
// native shell managing window creation, so a browser tab's own `?window=<key>` is the only thing
// that ever tells the backend that key exists; the renderer calls Ensure once at boot, before it
// asks for anything window-scoped (state/tabs.ts's hydrateTabs, in particular), which is what
// makes tests/e2e-real/multiwindow-real.spec.ts's own two-browser-page shape work at all.
type WindowsService struct {
	Deps appcore.Deps
}

type WindowsEnsureArgs struct {
	WindowKey string `json:"windowKey"`
}

// WindowsEnsureResult carries this window's own persisted mode (P22 D12) back to the boot
// sequence that already calls Ensure before anything else window-scoped — the seam that hydrates
// state/mode.ts's modeState.active without a second round trip.
type WindowsEnsureResult struct {
	Mode string `json:"mode"`
}

func (s *WindowsService) Ensure(args WindowsEnsureArgs) (WindowsEnsureResult, error) {
	if args.WindowKey == "" {
		return WindowsEnsureResult{}, ipcerr.BadRequest("windowKey is required")
	}
	if err := s.Deps.Repos.Windows.EnsureExists(args.WindowKey); err != nil {
		return WindowsEnsureResult{}, ipcerr.Internal(err.Error())
	}
	mode, err := s.Deps.Repos.Windows.GetMode(args.WindowKey)
	if err != nil {
		return WindowsEnsureResult{}, ipcerr.Internal(err.Error())
	}
	return WindowsEnsureResult{Mode: mode}, nil
}

type WindowsSetModeArgs struct {
	WindowKey string `json:"windowKey"`
	Mode      string `json:"mode"`
}

// SetMode persists this window's own mode (P22 D12) — called from a debounced writer
// (state/mode.ts), never synchronously from a mode-tab click (F20's own invariant).
func (s *WindowsService) SetMode(args WindowsSetModeArgs) error {
	if args.WindowKey == "" {
		return ipcerr.BadRequest("windowKey is required")
	}
	if err := s.Deps.Repos.Windows.SetMode(args.WindowKey, args.Mode); err != nil {
		return ipcerr.Internal(err.Error())
	}
	return nil
}
