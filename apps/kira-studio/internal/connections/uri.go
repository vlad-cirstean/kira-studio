package connections

import (
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// stripURIPassword removes the userinfo password from uri and returns it decoded. A string with
// no "://" (or no userinfo, or no password in the userinfo) is returned unchanged with a nil
// password — deliberate string surgery on the userinfo segment only, not a round trip through
// WHATWG URL (P55 §2 D10: net/url's own serialisation does not match it byte for byte).
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
// empty password is a no-op (the identity), and a uri with no "://" is left unchanged.
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

// uriHasAmbiguousPassword detects a URI-mode password containing a raw (unencoded) /, ? or # —
// F3, P108 Part 3. findAuthority ends the authority at the first such character after "://", so
// e.g. "postgres://u:pa/ss@h/db" detects an authority of "u:pa" (no '@' in it, so
// stripURIPassword returns a nil password) while the URI's real '@' sits past that point — the
// full URI, raw password included, then gets stored as-is in connections.uri and returned by
// List, breaking the no-password-in-List guarantee.
//
// Heuristic: an '@' exists after the first /, ? or # following "://", AND the segment before
// that delimiter (what findAuthority mistook for the whole authority) contains ':', AND the text
// after that ':' is not an all-digit port — exactly the shape a genuine "host:port" (with no
// userinfo, and so no password, at all) never has. A password properly percent-encoded (the fix
// validateMode's own error message asks for) contains no raw delimiter and is never flagged.
func uriHasAmbiguousPassword(uri string) bool {
	idx := strings.Index(uri, "://")
	if idx < 0 {
		return false
	}
	rest := uri[idx+3:]
	delim := strings.IndexAny(rest, "/?#")
	if delim < 0 {
		return false
	}
	before, after := rest[:delim], rest[delim:]
	if !strings.Contains(after, "@") {
		return false
	}
	colon := strings.IndexByte(before, ':')
	if colon < 0 {
		return false
	}
	return !isAllDigits(before[colon+1:])
}

// isAllDigits reports whether s is non-empty and every byte is an ASCII digit — a real port
// number, never a password fragment (which would need a decimal point, letter or symbol to be a
// realistic credential and still pass this check only by coincidence — an all-numeric password is
// the one case this heuristic cannot distinguish from a port, and is left as a rare false
// negative rather than rejecting every all-digit password outright).
func isAllDigits(s string) bool {
	if s == "" {
		return false
	}
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

// encodeURIComponent/decodeURIComponent live in internal/storage/model (model/uriescape.go),
// shared with internal/tree's DecodePath — see that file's doc comment for why.
