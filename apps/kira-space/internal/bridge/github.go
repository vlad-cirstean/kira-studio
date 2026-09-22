package bridge

import (
	"context"
	"net/url"
	"regexp"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsession"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

// GitHubService is P74 §3.3's one method: opening a pull request in the OS browser, never in
// place (CommitMeta.vue's own PR row used to be a bare `<a href>`, which under Wails navigates
// the app's own window to github.com — an absent external open, not a present embedded one). The
// renderer never supplies or receives a raw URL here: it names a PR by number, gitrpc's
// pr.browserUrl composes the URL server-side (gitsession.RepoEntry.PrBrowserURL), and this
// service re-validates that URL before Browser.OpenURL ever sees it — safeReleaseURL's own check
// (appupdate/checker.go), applied to the one other URL this app will ever open. Two validations,
// on both sides of the process boundary, because the boundary is the thing being defended.
//
// P79 finding 2: the host half of that re-validation used to be a literal "github.com" compare,
// which rejected every correctly-composed GHES URL right after PrBrowserURL was fixed to compose
// one. Deps.GitRegistry.Gh.Hosts (the same Discovery cache gitsession.IsGitHubHost already
// trusts) is the one place this process tracks "a GitHub host the user has actually authenticated
// against", so the validator below reuses it instead of hand-rolling a second host allowlist.
type GitHubService struct {
	Deps    appcore.Deps
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
// pull-request URL on a known GitHub host — BrowserManager.OpenURL (pkg/application) validates
// nothing at all, and macOS `open` will act on any scheme it recognises (appupdate/checker.go's
// own note).
func (s *GitHubService) OpenPullRequestURL(args GitHubOpenPullRequestURLArgs) error {
	u, err := url.Parse(args.URL)
	if err != nil || u.Scheme != "https" || !gitsession.IsGitHubHost(u.Host, s.knownGhHosts()) ||
		!pullRequestPath.MatchString(u.Path) {
		return ipcerr.BadRequest("bridge: OpenPullRequestURL: not a GitHub pull request URL")
	}
	if err := s.Browser.OpenURL(args.URL); err != nil {
		return ipcerr.Internal(err.Error())
	}
	return nil
}

// knownGhHosts is the GHES-aware half of the host check above: every host s.Deps.GitRegistry's
// shared *ghclient.Client has ever probed successfully, or nil when no registry is wired (a
// fixture that never sets one up) — IsGitHubHost still accepts the literal "github.com" either
// way, so that fallback matches this method's pre-P79-finding-2 behavior exactly.
func (s *GitHubService) knownGhHosts() []string {
	if s.Deps.GitRegistry == nil || s.Deps.GitRegistry.Gh == nil {
		return nil
	}
	return s.Deps.GitRegistry.Gh.Hosts(context.Background())
}
