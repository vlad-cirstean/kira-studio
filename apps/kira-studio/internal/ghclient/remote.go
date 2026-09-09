package ghclient

import "strings"

// Repo is one GitHub (or GHES) repository identity — Host distinguishes github.com from a custom
// GHES hostname (D15), threaded through every `gh api --hostname` call this package makes.
type Repo struct {
	Host  string
	Owner string
	Name  string
}

// Path returns "owner/repo", the shape `gh api`'s own REST paths and D4's own calls build against.
func (r Repo) Path() string { return r.Owner + "/" + r.Name }

// trimGitSuffix strips a trailing ".git" — every documented remote form may or may not carry one.
func trimGitSuffix(s string) string {
	return strings.TrimSuffix(s, ".git")
}

// ParseRemote accepts D15's own documented forms:
//   - https://host/owner/repo(.git)
//   - http://host/owner/repo(.git)
//   - ssh://[user@]host[:port]/owner/repo(.git)
//   - git://host/owner/repo(.git)
//   - git@host:owner/repo(.git) — the scp-like short form
//
// and rejects anything else, including a URL whose path (after the host) does not resolve to
// EXACTLY two non-empty segments (owner, repo) — a nested GitLab-style "group/subgroup/repo" path,
// or a bare host with no path at all, are both rejected rather than guessed at.
func ParseRemote(url string) (Repo, bool) {
	url = strings.TrimSpace(url)
	switch {
	case strings.HasPrefix(url, "https://"):
		return parseURLForm(url[len("https://"):])
	case strings.HasPrefix(url, "http://"):
		return parseURLForm(url[len("http://"):])
	case strings.HasPrefix(url, "ssh://"):
		return parseSSHURLForm(url[len("ssh://"):])
	case strings.HasPrefix(url, "git://"):
		return parseURLForm(url[len("git://"):])
	default:
		return parseSCPForm(url)
	}
}

// parseURLForm parses "host/owner/repo(.git)" — the remainder of an https://, http:// or git://
// URL once its scheme has been stripped. A query string or fragment is dropped, not parsed — no
// documented remote form carries one, and a URL that does is safer rejected than partially parsed.
func parseURLForm(rest string) (Repo, bool) {
	rest = strings.SplitN(rest, "?", 2)[0]
	rest = strings.SplitN(rest, "#", 2)[0]
	slash := strings.IndexByte(rest, '/')
	if slash < 0 {
		return Repo{}, false
	}
	host := rest[:slash]
	if host == "" {
		return Repo{}, false
	}
	return finishParse(host, rest[slash+1:])
}

// parseSSHURLForm parses "[user@]host[:port]/owner/repo(.git)" — ssh://'s own authority component,
// which (unlike the scp-like form) uses a real "/" path separator and an optional ":port", not a
// ":" path separator.
func parseSSHURLForm(rest string) (Repo, bool) {
	rest = strings.SplitN(rest, "?", 2)[0]
	slash := strings.IndexByte(rest, '/')
	if slash < 0 {
		return Repo{}, false
	}
	authority := rest[:slash]
	if at := strings.LastIndexByte(authority, '@'); at >= 0 {
		authority = authority[at+1:]
	}
	if colon := strings.IndexByte(authority, ':'); colon >= 0 {
		authority = authority[:colon]
	}
	if authority == "" {
		return Repo{}, false
	}
	return finishParse(authority, rest[slash+1:])
}

// parseSCPForm parses "[user@]host:owner/repo(.git)" — git's own scp-like short form, the one shape
// with no "://" scheme at all.
func parseSCPForm(s string) (Repo, bool) {
	at := strings.LastIndexByte(s, '@')
	if at >= 0 {
		s = s[at+1:]
	}
	colon := strings.IndexByte(s, ':')
	if colon < 0 {
		return Repo{}, false
	}
	host := s[:colon]
	if host == "" || strings.Contains(host, "/") {
		return Repo{}, false
	}
	return finishParse(host, s[colon+1:])
}

// finishParse resolves path into exactly (owner, repo), trimming a trailing ".git" off the repo
// segment only — the segment count check is what rejects a nested "group/subgraph/repo" GitLab-style
// path and a bare host with nothing after it.
func finishParse(host, path string) (Repo, bool) {
	path = strings.Trim(path, "/")
	if path == "" {
		return Repo{}, false
	}
	segments := strings.Split(path, "/")
	if len(segments) != 2 || segments[0] == "" || segments[1] == "" {
		return Repo{}, false
	}
	owner := segments[0]
	name := trimGitSuffix(segments[1])
	if name == "" {
		return Repo{}, false
	}
	return Repo{Host: host, Owner: owner, Name: name}, true
}
