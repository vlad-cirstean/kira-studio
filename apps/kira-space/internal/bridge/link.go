package bridge

import "github.com/kirathecat/kira-studio/internal/shell"

// LinkService is Kira Studio's own LinkService (P79 finding 4), ported unchanged: linkify.ts
// finds arbitrary URLs in a commit message body, which git-ui's host contract's own
// `link.openExternal` handler (repo/git/hostHandlers.ts) opens through this — the URL is
// untrusted renderer-visible content already, so this validates only its shape (a well-formed
// http(s) URL, never a `javascript:`/`file:`/other locally-dangerous scheme) before Browser.
// OpenURL ever sees it. Discovered missing during P100 Part 2's frontend port: the plan's own
// §5.2 table ported repo/git/hostHandlers.ts wholesale without naming this dependency — this file
// closes that gap rather than leaving link.openExternal silently broken in this app.
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
