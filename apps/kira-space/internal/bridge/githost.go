package bridge

import (
	"context"
	"net/url"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/githost"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

// GitHostService opens a change request in the OS browser, never in place: a bare `<a href>` under
// Wails would navigate the app's own window away. The renderer never supplies or receives a raw
// URL here: it names a change request by number, gitrpc's changeRequest URL call composes the URL
// server-side (gitsession.RepoEntry.ChangeRequestURL), and this service re-validates that URL
// before Browser.OpenURL ever sees it — scheme, host and path all checked again, server-side trust
// notwithstanding. Two validations, on both sides of the process boundary, because the boundary is
// the thing being defended. The host check is each registered provider's own (githost.URLs), so a
// self-hosted instance the user authenticated against is accepted, and nothing else is.
type GitHostService struct {
	Deps    appcore.Deps
	Browser Browser
}

// OpenChangeRequestURLArgs is OpenChangeRequestURL's own request.
type OpenChangeRequestURLArgs struct {
	URL string `json:"url"`
}

// OpenChangeRequestURL opens args.URL in the OS browser, refusing anything that no registered
// provider accepts as a change-request URL — BrowserManager.OpenURL (pkg/application) validates
// nothing at all, and macOS `open` will act on any scheme it recognises.
func (s *GitHostService) OpenChangeRequestURL(args OpenChangeRequestURLArgs) error {
	var hosts *githost.Registry
	if s.Deps.GitRegistry != nil {
		hosts = s.Deps.GitRegistry.Hosts.Registry
	}
	u, err := url.Parse(args.URL)
	if err != nil || !hosts.IsChangeRequestURL(context.Background(), u) {
		return ipcerr.T(ipcerr.CodeBadRequest, "backend.space.gitHost.notChangeRequestUrl.body",
			map[string]string{"changeRequests": hosts.ChangeRequestLabels()})
	}
	return ipcerr.InternalErr(s.Browser.OpenURL(args.URL))
}

// Providers lists every registered code host provider, for naming it in the UI.
func (s *GitHostService) Providers() githost.Providers {
	var hosts *githost.Registry
	if s.Deps.GitRegistry != nil {
		hosts = s.Deps.GitRegistry.Hosts.Registry
	}
	return githost.Providers{Providers: hosts.Infos()}
}
