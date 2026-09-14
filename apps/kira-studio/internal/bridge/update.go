package bridge

import (
	"context"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appupdate"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ipcerr"
)

// Browser is the OS-browser seam, declared where it is consumed — the same precedent Dialogs
// (files.go:52) and RepoMapInstaller (repomap.go:19) already set.
type Browser interface {
	OpenURL(url string) error
}

// UpdateStatus is the whole wire shape. It deliberately carries no URL and no error string: the
// renderer never supplies or receives a URL (main.go's own security note), and a failed check is
// silence, not a surface.
type UpdateStatus struct {
	UpdateAvailable bool   `json:"updateAvailable"`
	CurrentVersion  string `json:"currentVersion"`
	LatestVersion   string `json:"latestVersion"`
}

// UpdateService is P66's whole surface: Status (polled by the renderer) and OpenReleasePage
// (the banner's click handler).
type UpdateService struct {
	Checker *appupdate.Checker
	Browser Browser
}

func toWireUpdateStatus(r appupdate.Result) UpdateStatus {
	return UpdateStatus{
		UpdateAvailable: r.UpdateAvailable,
		CurrentVersion:  r.CurrentVersion,
		LatestVersion:   r.LatestVersion,
	}
}

// Status blocks on the network only when a check is actually due (appupdate's own cache interval)
// — never on the boot critical path, since the renderer calls this only after the app has mounted.
func (s *UpdateService) Status(ctx context.Context) (UpdateStatus, error) {
	return toWireUpdateStatus(s.Checker.Status(ctx)), nil
}

// OpenReleasePage opens the last-checked release's own page, or the repository's /releases page
// when none has ever validated — never a renderer-supplied URL (appupdate.Checker.ReleaseURL is
// nullary; the renderer never sends or receives a URL at all).
func (s *UpdateService) OpenReleasePage() error {
	if err := s.Browser.OpenURL(s.Checker.ReleaseURL()); err != nil {
		return ipcerr.Internal(err.Error())
	}
	return nil
}
