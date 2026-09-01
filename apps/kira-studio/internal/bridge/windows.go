package bridge

import (
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge/ipcerr"
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

func (s *WindowsService) Ensure(args WindowsEnsureArgs) error {
	if args.WindowKey == "" {
		return ipcerr.BadRequest("windowKey is required")
	}
	if err := s.Deps.Repos.Windows.EnsureExists(args.WindowKey); err != nil {
		return ipcerr.Internal(err.Error())
	}
	return nil
}
