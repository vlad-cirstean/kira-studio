package connections

import (
	"net/url"
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
//
// A libpq-style `password` query parameter (pgx honours it) is removed the same way and wins only
// when the userinfo carries no password.
func stripURIPassword(uri string) (stripped string, password *string) {
	stripped, password = stripUserinfoPassword(uri)
	stripped, queryPassword := stripQueryPassword(stripped)
	if password == nil {
		password = queryPassword
	}
	return stripped, password
}

func stripUserinfoPassword(uri string) (stripped string, password *string) {
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

// queryRange returns the bounds of uri's query string (after the "?", before any "#"); ok is
// false when there is none.
func queryRange(uri string) (start, end int, ok bool) {
	_, authorityEnd, found := findAuthority(uri)
	if !found {
		return 0, 0, false
	}
	q := strings.IndexByte(uri[authorityEnd:], '?')
	if q < 0 {
		return 0, 0, false
	}
	start = authorityEnd + q + 1
	end = len(uri)
	if h := strings.IndexByte(uri[start:], '#'); h >= 0 {
		end = start + h
	}
	return start, end, true
}

// queryKey returns pair's key, decoded.
func queryKey(pair string) string {
	key, _, _ := strings.Cut(pair, "=")
	decoded, err := url.QueryUnescape(key)
	if err != nil {
		return key
	}
	return decoded
}

// stripQueryPassword removes every `password` query pair from uri and returns the first one's
// value decoded as the driver would (url.QueryUnescape). Other pairs keep their exact spelling.
func stripQueryPassword(uri string) (stripped string, password *string) {
	start, end, ok := queryRange(uri)
	if !ok {
		return uri, nil
	}
	var kept []string
	for _, pair := range strings.Split(uri[start:end], "&") {
		if !strings.EqualFold(queryKey(pair), "password") {
			kept = append(kept, pair)
			continue
		}
		if password == nil {
			_, raw, _ := strings.Cut(pair, "=")
			value, err := url.QueryUnescape(raw)
			if err != nil {
				value = raw
			}
			password = &value
		}
	}
	if password == nil {
		return uri, nil
	}
	rest := strings.Join(kept, "&")
	if rest == "" {
		return uri[:start-1] + uri[end:], password
	}
	return uri[:start] + rest + uri[end:], password
}

// credentialQueryKeys are query parameters, other than `password`, that carry a secret a driver
// honours: pgx's key passphrase, Mongo's key-file passphrase and proxy password. They have no slot
// in the encrypted secret store, so a URI carrying one is refused rather than stored in plaintext.
var credentialQueryKeys = []string{"sslpassword", "tlscertificatekeyfilepassword", "proxypassword"}

// uriHasCredentialQuery reports whether uri's query carries a non-empty credentialQueryKeys pair.
func uriHasCredentialQuery(uri string) (key string, found bool) {
	start, end, ok := queryRange(uri)
	if !ok {
		return "", false
	}
	for _, pair := range strings.Split(uri[start:end], "&") {
		name := queryKey(pair)
		if _, value, hasValue := strings.Cut(pair, "="); !hasValue || value == "" {
			continue
		}
		for _, k := range credentialQueryKeys {
			if strings.EqualFold(name, k) {
				return name, true
			}
		}
	}
	return "", false
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
// that delimiter (what findAuthority mistook for the whole authority) has no '@' of its own (one
// there means findAuthority already saw the real userinfo, and the later '@' belongs to the path or
// query), AND it contains a ':' outside a bracketed IPv6 host, AND the text after that ':' is not
// an all-digit port — exactly the shape a genuine "host:port" (with no
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
	if strings.Contains(before, "@") {
		return false
	}
	offset := 0
	if strings.HasPrefix(before, "[") {
		if end := strings.IndexByte(before, ']'); end >= 0 {
			offset = end + 1
		}
	}
	colon := strings.IndexByte(before[offset:], ':')
	if colon < 0 {
		return false
	}
	return !isAllDigits(before[offset+colon+1:])
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
