package shell

import (
	"net/url"

	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

// Browser is the OS-browser seam OpenExternalURL needs — each app's own bridge.Browser interface
// (declared where consumed, P79 finding 4's own precedent) has the identical single method, so it
// satisfies this directly with no adapter.
type Browser interface {
	OpenURL(url string) error
}

// OpenExternalURL opens raw in the OS browser, refusing anything that is not a well-formed
// http(s) URL with a non-empty host — both apps' own bridge.LinkService.OpenExternal (P107 I2-6).
// The check is the shape of the URL alone: raw is already untrusted, renderer-visible content
// (a linkified commit message, P79 finding 4), never composed server-side.
func OpenExternalURL(browser Browser, raw string) error {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
		return ipcerr.BadRequest("bridge: LinkService.OpenExternal: not a well-formed http(s) URL")
	}
	if err := browser.OpenURL(raw); err != nil {
		return ipcerr.Internal(err.Error())
	}
	return nil
}
