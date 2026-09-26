package bridge

import "github.com/kirathecat/kira-studio/internal/ipcerr"

// WindowsService is the title bar's "New window" button — Kira Studio's own WindowsService
// (internal/bridge/windows.go), trimmed: no Ensure/SetMode, since this app has no AppMode of its
// own to persist.
type WindowsService struct {
	// OpenNewWindow is main.go's own openNew closure (the same action Shift+Cmd+N ties to) —
	// assigned after the service is constructed, since that closure needs the application this
	// service is registered on.
	OpenNewWindow func()
}

// OpenNew is the title bar's "New window" button — Kira Studio's own WindowsService.OpenNew,
// unchanged.
func (s *WindowsService) OpenNew() error {
	if s.OpenNewWindow == nil {
		return ipcerr.BadRequest("windows: this build cannot open a window")
	}
	s.OpenNewWindow()
	return nil
}
