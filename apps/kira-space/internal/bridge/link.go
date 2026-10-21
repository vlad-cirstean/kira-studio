package bridge

import "github.com/kirathecat/kira-studio/internal/shell"

// LinkService is this app's own generic "open this URL in the OS browser" surface for the git-ui
// host: linkify.ts finds arbitrary URLs in a commit message body, which git-ui's host contract's
// own `link.openExternal` handler (repo/git/hostHandlers.ts) opens through this — the URL is
// untrusted renderer-visible content already, so this validates only its shape (a well-formed
// http(s) URL, never a `javascript:`/`file:`/other locally-dangerous scheme) before Browser.
// OpenURL ever sees it. Kira Studio's own byte-identical copy is gone — it had no real caller.
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
