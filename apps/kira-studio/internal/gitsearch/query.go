package gitsearch

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
)

// MinShaPrefix mirrors git-core's own MIN_SHA_PREFIX (search/query.ts) — git's own
// `rev-parse --disambiguate` floor (upstream probe 3): below it a hex query matches a large
// fraction of any repository and buries the real hits.
const MinShaPrefix = 4

const maxShaPrefix = 40

// Query is search.run's own SearchQueryParams, ported field for field — @kira/git-ipc's
// SearchQueryParams (contract.ts), the structural copy of git-core's SearchQuery minus `scope`.
type Query struct {
	Text          string
	CaseSensitive bool
	WholeWord     bool
	Regex         bool
}

// ErrUnsupportedPattern is Compile's answer for `regex` mode syntax RE2 cannot express at all —
// lookahead, lookbehind, or a numbered/named backreference (D4). Distinct from ErrInvalidPattern:
// the pattern IS valid JavaScript (the webview client already compiled it with `new RegExp`
// before ever sending it), just not RE2 — D6's honest `unsupportedPattern` wire member exists
// specifically so this is never confused with a pattern the client would not have sent.
var ErrUnsupportedPattern = errors.New("gitsearch: pattern uses lookahead/lookbehind/backreference syntax RE2 cannot run")

// ErrInvalidPattern is unreachable from the webview client (D7): SearchBox.vue's own compileQuery
// call already proves the pattern compiles as JS before search.run is ever sent, and translate()
// rejects everything RE2 structurally cannot express as ErrUnsupportedPattern instead. It exists
// for a raw socket client that sends a pattern neither engine can compile at all (e.g. an
// unbalanced group) — regexp.Compile's own leftover failure after a clean dialect translation.
var ErrInvalidPattern = errors.New("gitsearch: invalid pattern")

// Matcher is Compile's own result — the one thing MatchFields runs. An empty-text Query compiles
// to a matcher that matches nothing (D7): compileQuery's own "empty" branch never reaches a regex
// engine either, and building one from an empty needle would (both here and in JS) match
// everywhere rather than nowhere.
type Matcher struct {
	empty     bool
	literal   *literalMatcher
	regex     *regexp.Regexp
	shaPrefix string // "" means no sha-prefix arm; otherwise already lower-cased.
}

// Compile turns a wire SearchQueryParams into the one matcher this package runs — the mirror of
// git-core's compileQuery, the only place in the TypeScript half a pattern is interpreted.
//
//	literal mode  -> a literalMatcher (D3). Cannot fail.
//	regex mode    -> dialect.translate + regexp.Compile (D4/D5).
//	                 ErrUnsupportedPattern for lookaround/backreference/anything translate rejects.
//	                 ErrInvalidPattern for a regexp.Compile failure surviving a clean translation —
//	                 unreachable from the webview client (see that error's own doc comment).
func Compile(q Query) (*Matcher, error) {
	if q.Text == "" {
		return &Matcher{empty: true}, nil
	}

	shaPrefix := ""
	if isHexPrefixText(q.Text) {
		shaPrefix = strings.ToLower(q.Text)
	}

	if !q.Regex {
		return &Matcher{
			literal:   newLiteralMatcher(q.Text, !q.CaseSensitive, q.WholeWord),
			shaPrefix: shaPrefix,
		}, nil
	}

	translated, err := translate(q.Text)
	if err != nil {
		return nil, err
	}
	source := translated
	if q.WholeWord {
		source = wrapWholeWord(source)
	}
	if !q.CaseSensitive {
		source = "(?i)" + source
	}
	re, err := regexp.Compile(source)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidPattern, err)
	}
	return &Matcher{regex: re, shaPrefix: shaPrefix}, nil
}

// isHexPrefixText mirrors query.ts's HEX_PREFIX test (`^[0-9a-fA-F]{4,40}$`) without a regex
// engine — a plain byte scan, since this is a general sha-prefix utility, not literal-mode
// matching itself (that guarantee is literal.go's own, and is what the exit criteria's "literal
// mode runs no regexp" check greps for).
func isHexPrefixText(text string) bool {
	n := len(text)
	if n < MinShaPrefix || n > maxShaPrefix {
		return false
	}
	for i := 0; i < n; i++ {
		c := text[i]
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
			return false
		}
	}
	return true
}

// matchText is the one predicate MatchFields runs per field.
func (m *Matcher) matchText(s string) bool {
	if m.empty {
		return false
	}
	if m.literal != nil {
		return m.literal.match(s)
	}
	return m.regex.MatchString(s)
}
