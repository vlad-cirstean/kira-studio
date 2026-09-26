package bridge

import "github.com/kirathecat/kira-studio/internal/shell"

// LinkService is P79 finding 4's own generic "open this URL in the OS browser" surface —
// linkify.ts finds arbitrary URLs in a commit message body, which CommitMeta.vue used to render
// as a raw `<a href>` (a real whole-window navigation hazard under Wails, GitHubService's own doc
// comment). Unlike GitHubService.OpenPullRequestURL, this URL cannot be composed server-side: it
// *is* the untrusted content, already visible to the renderer as plain linkified text. The one
// check left to make is the shape of the URL itself — a well-formed http(s) URL, never a
// `javascript:`/`file:`/other locally-dangerous scheme — before Browser.OpenURL ever sees it.
type LinkService struct {
	Browser Browser
}

// LinkOpenExternalArgs is OpenExternal's own request.
type LinkOpenExternalArgs struct {
	URL string `json:"url"`
}

// OpenExternal opens args.URL in the OS browser, refusing anything that is not a well-formed
// http(s) URL with a non-empty host.
func (s *LinkService) OpenExternal(args LinkOpenExternalArgs) error {
	return shell.OpenExternalURL(s.Browser, args.URL)
}
