package connections

import (
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// stripURIPassword removes the userinfo password from uri and returns it decoded. A string with
// no "://" (or no userinfo, or no password in the userinfo) is returned unchanged with a nil
// password — the same total behaviour domain/uri.ts's stripUriPassword's try/catch gives, without
// actually needing WHATWG URL (P55 §2 D10: net/url's serialisation does not match it byte for
// byte, so this is deliberate string surgery on the userinfo segment only).
//
// Algorithm: locate "://"; the authority runs to the first /, ? or # after it; if it contains @,
// split at the last @ (a password can itself contain an encoded @); the userinfo's password is
// everything after its first : (a username can itself contain an encoded :). Stripping rebuilds
// the authority as user@host when the username is non-empty and as host when it is not (WHATWG
// drops the @ when both halves are empty). Nothing else in the string is touched.
func stripURIPassword(uri string) (stripped string, password *string) {
	authorityStart, end, ok := findAuthority(uri)
	if !ok {
		return uri, nil
	}
	authority := uri[authorityStart:end]
	at := strings.LastIndex(authority, "@")
	if at < 0 {
		return uri, nil
	}
	userinfo, host := authority[:at], authority[at+1:]
	colon := strings.IndexByte(userinfo, ':')
	if colon < 0 {
		return uri, nil
	}
	user := userinfo[:colon]
	plain := model.DecodeURIComponent(userinfo[colon+1:])

	newAuthority := host
	if user != "" {
		newAuthority = user + "@" + host
	}
	return uri[:authorityStart] + newAuthority + uri[end:], &plain
}

// injectURIPassword puts password back into uri's userinfo, encodeURIComponent-encoded. A nil or
// empty password is a no-op (the identity), and a uri with no "://" is left unchanged — the same
// total behaviour domain/uri.ts's injectUriPassword gives.
func injectURIPassword(uri string, password *string) string {
	if password == nil || *password == "" {
		return uri
	}
	authorityStart, end, ok := findAuthority(uri)
	if !ok {
		return uri
	}
	authority := uri[authorityStart:end]

	var user, host string
	if at := strings.LastIndex(authority, "@"); at >= 0 {
		userinfo := authority[:at]
		host = authority[at+1:]
		if colon := strings.IndexByte(userinfo, ':'); colon >= 0 {
			user = userinfo[:colon]
		} else {
			user = userinfo
		}
	} else {
		host = authority
	}

	newAuthority := user + ":" + model.EncodeURIComponent(*password) + "@" + host
	return uri[:authorityStart] + newAuthority + uri[end:]
}

// findAuthority locates the authority segment (the part between "://" and the first /, ? or #
// after it, or the end of the string). ok is false when uri has no "://" at all.
func findAuthority(uri string) (start, end int, ok bool) {
	idx := strings.Index(uri, "://")
	if idx < 0 {
		return 0, 0, false
	}
	start = idx + 3
	end = len(uri)
	if i := strings.IndexAny(uri[start:], "/?#"); i >= 0 {
		end = start + i
	}
	return start, end, true
}

// encodeURIComponent/decodeURIComponent live in internal/storage/model (model/uriescape.go),
// shared with internal/tree's DecodePath — see that file's doc comment for why.
