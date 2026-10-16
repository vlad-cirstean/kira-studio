package memfmt

import (
	"regexp"
	"strings"
	"unicode"
)

const (
	notWord = `[^A-Za-z0-9_]`
)

var markupPatterns = []struct {
	name string
	re   *regexp.Regexp
}{
	{"bold **", regexp.MustCompile(`\*\*[^*\s](?:[^*]*[^*\s])?\*\*`)},
	{"emphasis __", regexp.MustCompile(`(?:^|` + notWord + `)__[^_\s](?:[^_]*[^_\s])?__(?:` + notWord + `|$)`)},
	{"emphasis *", regexp.MustCompile(`(?:^|[^A-Za-z0-9_*])\*[^*\s](?:[^*]*[^*\s])?\*(?:[^A-Za-z0-9_*]|$)`)},
	{"emphasis _", regexp.MustCompile(`(?:^|` + notWord + `)_[^_\s](?:[^_]*[^_\s])?_(?:` + notWord + `|$)`)},
	{"code backticks", regexp.MustCompile("`[^`]+`")},
	{"strikethrough ~~", regexp.MustCompile(`~~[^~]+~~`)},
	{"link [x](y)", regexp.MustCompile(`\[[^\]]*\]\([^)]*\)`)},
	{"tag <x>", regexp.MustCompile(`<[A-Za-z/!][^>]*>`)},
}

var (
	idToken  = regexp.MustCompile(`(?:^|[^A-Za-z0-9_])(k[mg]_[A-Za-z0-9_]*)`)
	exactID  = regexp.MustCompile(`^(` + FactID + `|` + GroupID + `)$`)
	factOnly = regexp.MustCompile(`^` + FactID + `$`)
	groupID  = regexp.MustCompile(`^` + GroupID + `$`)
)

// IsFactID and IsGroupID report whether s is exactly one id.
func IsFactID(s string) bool  { return factOnly.MatchString(s) }
func IsGroupID(s string) bool { return groupID.MatchString(s) }

// CheckText returns "" or why s breaks the shared text rules: one non-empty line, no inline
// Markdown pairs, every km_ or kg_ token a full id. Lone * and _ inside words stay legal.
func CheckText(s string) string {
	if s == "" {
		return "text is empty"
	}
	if strings.TrimSpace(s) != s {
		return "text has leading or trailing space"
	}
	for _, r := range s {
		if unicode.IsControl(r) {
			return "text has a line break or control character"
		}
	}
	for _, p := range markupPatterns {
		if p.re.MatchString(s) {
			return "text has Markdown markup (" + p.name + ")"
		}
	}
	for _, m := range idToken.FindAllStringSubmatch(s, -1) {
		if !exactID.MatchString(m[1]) {
			return "malformed id " + m[1]
		}
	}
	return ""
}

// StripMarkup removes inline Markdown pairs from s, keeping their content, and collapses
// whitespace runs. It returns s unchanged when it has no markup.
func StripMarkup(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	for i := 0; i < 4; i++ {
		before := s
		s = strings.NewReplacer("**", "", "~~", "", "`", "").Replace(s)
		s = stripEdge(s, markupPatterns[1].re, "__")
		s = stripEdge(s, markupPatterns[2].re, "*")
		s = stripEdge(s, markupPatterns[3].re, "_")
		s = linkRe.ReplaceAllString(s, "$1")
		s = tagRe.ReplaceAllString(s, "")
		if s == before {
			break
		}
	}
	return strings.Join(strings.Fields(s), " ")
}

var (
	linkRe = regexp.MustCompile(`\[([^\]]*)\]\([^)]*\)`)
	tagRe  = markupPatterns[7].re
)

// stripEdge drops the delimiter d from the first and last position of each match of re.
func stripEdge(s string, re *regexp.Regexp, d string) string {
	return re.ReplaceAllStringFunc(s, func(m string) string {
		i := strings.Index(m, d)
		j := strings.LastIndex(m, d)
		if i < 0 || j <= i {
			return m
		}
		return m[:i] + m[i+len(d):j] + m[j+len(d):]
	})
}
