package bridge

import (
	"net/url"
	"regexp"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ipcerr"
)

// GitHubService is P74 §3.3's one method: opening a pull request in the OS browser, never in
// place (CommitMeta.vue's own PR row used to be a bare `<a href>`, which under Wails navigates
// the app's own window to github.com — an absent external open, not a present embedded one). The
// renderer never supplies or receives a raw URL here: it names a PR by number, gitrpc's
// pr.browserUrl composes the URL server-side (gitsession.RepoEntry.PrBrowserURL), and this
// service re-validates that URL before Browser.OpenURL ever sees it — safeReleaseURL's own check
// (appupdate/checker.go), applied to the one other URL this app will ever open. Two validations,
// on both sides of the process boundary, because the boundary is the thing being defended.
type GitHubService struct {
	Browser Browser
}

// GitHubOpenPullRequestURLArgs is OpenPullRequestURL's own request.
type GitHubOpenPullRequestURLArgs struct {
	URL string `json:"url"`
}

// pullRequestPath matches /{owner}/{repo}/pull/{number} — owner/repo restricted to the characters
// GitHub itself allows in a login/repo name; anything else is refused rather than guessed at.
var pullRequestPath = regexp.MustCompile(`^/[\w.-]+/[\w.-]+/pull/[0-9]+$`)

// OpenPullRequestURL opens args.URL in the OS browser, refusing anything that is not an https
// github.com pull-request URL — BrowserManager.OpenURL (pkg/application) validates nothing at
// all, and macOS `open` will act on any scheme it recognises (appupdate/checker.go's own note).
func (s *GitHubService) OpenPullRequestURL(args GitHubOpenPullRequestURLArgs) error {
	u, err := url.Parse(args.URL)
	if err != nil || u.Scheme != "https" || u.Host != "github.com" || !pullRequestPath.MatchString(u.Path) {
		return ipcerr.BadRequest("bridge: OpenPullRequestURL: not a github.com pull request URL")
	}
	if err := s.Browser.OpenURL(args.URL); err != nil {
		return ipcerr.Internal(err.Error())
	}
	return nil
}
