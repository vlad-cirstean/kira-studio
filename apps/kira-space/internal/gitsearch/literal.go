package gitsearch

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

// isWordByte is JS's own \w without the `u` flag — ASCII-only ([0-9A-Za-z_]) — so a byte >= 0x80
// (any UTF-8 continuation or lead byte of a multi-byte rune) is correctly never a word byte here,
// exactly matching JS's own behaviour for a non-unicode-flag RegExp.
func isWordByte(b byte) bool {
	return b == '_' ||
		('0' <= b && b <= '9') ||
		('A' <= b && b <= 'Z') ||
		('a' <= b && b <= 'z')
}

// foldRune is ECMA-262 Canonicalize for a non-unicode-flag RegExp: uppercase the code point, and
// KEEP THE ORIGINAL when the input is non-ASCII and the uppercase result is ASCII. That last
// clause is why /k/i does not match U+212A KELVIN SIGN in JavaScript, while Go's own (?i)k does —
// unicode.SimpleFold has no such suppression, which is exactly why this is hand-written rather
// than delegated to the standard library's own case folding.
func foldRune(r rune) rune {
	if r < utf8.RuneSelf {
		if 'a' <= r && r <= 'z' {
			return r - 'a' + 'A'
		}
		return r
	}
	u := unicode.ToUpper(r)
	if u < utf8.RuneSelf {
		return r
	}
	return u
}

// boundaryOK is D3's byte-boundary post-check — (?<!\w) on the left, (?!\w) on the right. Each
// side is a property of what is OUTSIDE the occurrence (the byte immediately before start, the
// byte immediately after end, or the start/end of the string itself), never of the occurrence's
// own edge characters — which is exactly what makes "#123" whole-word-match in "fix (#123)" (the
// characters '(' before and ')' after are both non-word) even though '#' itself is not a \w
// character (upstream probe 10).
func boundaryOK(s string, start, end int) bool {
	if start > 0 && isWordByte(s[start-1]) {
		return false
	}
	if end < len(s) && isWordByte(s[end]) {
		return false
	}
	return true
}

// literalMatcher answers "does needle occur in s with acceptable word boundaries", exactly as
// JavaScript's own RegExp does for the pattern compileQuery builds in literal mode.
//
// Why no regexp here at all: in literal mode the JS pattern is escapeRegExp(text) — a fixed
// string — optionally wrapped in \b…\b or (?<!\w)…(?!\w). For a FIXED needle, "the wrapped JS
// pattern matches s" is equivalent to "SOME occurrence of needle in s has a non-word character
// (or nothing) on each side". Enumerating occurrences and post-checking their two edge bytes
// computes that directly, with no dialect to reconcile — SPEC's own "a byte-boundary post-check
// implementation in gitsearch rather than a direct pattern port" (docs/v1.3/SPEC.md:449).
type literalMatcher struct {
	// text is the raw needle, used directly for the case-sensitive path (strings.Contains/
	// strings.Index).
	text string
	// needleRunes is text's own runes, each already foldRune()-folded — populated only when fold
	// is true; the case-sensitive path never allocates or reads this.
	needleRunes []rune
	fold        bool
	wholeWord   bool
}

// newLiteralMatcher builds a literalMatcher for a non-empty needle — Compile never calls this for
// an empty query text (that short-circuits to the "empty" matcher before reaching here).
func newLiteralMatcher(text string, fold, wholeWord bool) *literalMatcher {
	m := &literalMatcher{text: text, fold: fold, wholeWord: wholeWord}
	if fold {
		runes := []rune(text)
		folded := make([]rune, len(runes))
		for i, r := range runes {
			folded[i] = foldRune(r)
		}
		m.needleRunes = folded
	}
	return m
}

// match reports whether s contains the needle with acceptable word boundaries (D3).
func (m *literalMatcher) match(s string) bool {
	if m.fold {
		return m.matchFold(s)
	}
	if !m.wholeWord {
		return strings.Contains(s, m.text)
	}
	from := 0
	for {
		i := strings.Index(s[from:], m.text)
		if i < 0 {
			return false
		}
		start := from + i
		end := start + len(m.text)
		if boundaryOK(s, start, end) {
			return true
		}
		// Advance by one byte (not len(m.text)) so overlapping occurrences are still found —
		// upstream's own JS engine finds every occurrence via .test()'s implicit re-scan, and a
		// rejected occurrence must not skip past a shorter one starting one byte later.
		from = start + 1
	}
}

// matchFold is the case-insensitive path: occurrence enumeration over folded runes, since a fold
// can change which bytes compare equal in ways a plain byte search cannot express.
func (m *literalMatcher) matchFold(s string) bool {
	from := 0
	for from < len(s) {
		start, end, ok := m.indexFoldAt(s, from)
		if !ok {
			return false
		}
		if !m.wholeWord || boundaryOK(s, start, end) {
			return true
		}
		_, size := utf8.DecodeRuneInString(s[start:])
		from = start + size
	}
	return false
}

// indexFoldAt finds the next fold-insensitive occurrence of m.needleRunes in s starting the
// search at byte offset from, returning the occurrence's own byte span.
func (m *literalMatcher) indexFoldAt(s string, from int) (start, end int, ok bool) {
	for pos := from; pos < len(s); {
		p := pos
		matched := true
		for _, nr := range m.needleRunes {
			if p >= len(s) {
				matched = false
				break
			}
			r, size := utf8.DecodeRuneInString(s[p:])
			if foldRune(r) != nr {
				matched = false
				break
			}
			p += size
		}
		if matched {
			return pos, p, true
		}
		_, size := utf8.DecodeRuneInString(s[pos:])
		pos += size
	}
	return 0, 0, false
}
