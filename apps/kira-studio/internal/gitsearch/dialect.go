package gitsearch

import (
	"strconv"
	"strings"
	"unicode/utf8"
)

// jsWhitespaceClassMembers is ECMA-262's own \s, restated as RE2 character-class members (D4's
// "explicit JS class"): WhiteSpace (Tab, VT, FF, SP, NBSP, ZWNBSP and the Unicode "space
// separator" category's own code points) plus LineTerminator (LF, CR, LS, PS) — strictly wider
// than RE2's native \s ([\t\n\f\r ]).
const jsWhitespaceClassMembers = `\t\n\v\f\r \x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}`

// passthroughEscapeChars are backslash+X pairs that mean the same thing in a non-`u`-flag JS
// RegExp and in RE2, so translate copies them through unchanged rather than rewriting them.
const passthroughEscapeChars = `dDwWbBnrtfv\.*+?()[]{}|^$/-`

// translate is D4's single left-to-right JS -> RE2 source rewrite. It rejects (ErrUnsupported
// Pattern) the two constructs RE2 cannot express at all — lookaround and a backreference — before
// ever handing anything to regexp.Compile; every other JS construct in compileQuery's own surface
// (no `u`, `m`, `g`, or `y` flag: F15's own derived inventory) is either identical in both
// dialects already or rewritten here into an RE2-equivalent form.
func translate(pattern string) (string, error) {
	var out strings.Builder
	inClass := false
	i := 0
	n := len(pattern)
	for i < n {
		c := pattern[i]
		switch {
		case c == '\\':
			if i+1 >= n {
				// A trailing lone backslash is not valid regex syntax in either dialect — pass it
				// through and let regexp.Compile reject it as ErrInvalidPattern.
				out.WriteByte(c)
				i++
				continue
			}
			next := pattern[i+1]
			switch {
			case !inClass && next >= '1' && next <= '9':
				return "", ErrUnsupportedPattern // \1-\9: a numbered backreference.
			case !inClass && next == 'k' && i+2 < n && pattern[i+2] == '<':
				return "", ErrUnsupportedPattern // \k<name>: a named backreference.
			case next == 's':
				if inClass {
					out.WriteString(jsWhitespaceClassMembers)
				} else {
					out.WriteString("[" + jsWhitespaceClassMembers + "]")
				}
				i += 2
			case next == 'S':
				if inClass {
					// Documented gap (§10.3/doc.go): negating a sub-portion of an already-open
					// class is not expressible by insertion the way \s's own member list is, so
					// this falls back to RE2's native (ASCII-only) \S rather than a true negation
					// of jsWhitespaceClassMembers. `[\S]` in a user's own pattern is rare; the
					// out-of-class form immediately below stays exact.
					out.WriteString(`\S`)
				} else {
					out.WriteString("[^" + jsWhitespaceClassMembers + "]")
				}
				i += 2
			case next == 'p':
				out.WriteByte('p') // identity escape without the `u` flag (D4 table), not a class.
				i += 2
			case next == 'P':
				out.WriteByte('P')
				i += 2
			case next == 'u':
				if seq, consumed, ok := translateUnicodeEscape(pattern[i:]); ok {
					out.WriteString(seq)
					i += consumed
				} else {
					out.WriteByte('u') // malformed \u -> identity escape, JS's own Annex B rule.
					i += 2
				}
			case next == 'c':
				if seq, consumed, ok := translateControlEscape(pattern[i:]); ok {
					out.WriteString(seq)
					i += consumed
				} else {
					out.WriteByte('c')
					i += 2
				}
			case next == '0':
				// \0 not followed by a digit -> \x{00} (D4 table). A \0 that IS followed by a
				// digit is JS's own legacy octal-escape corner (Annex B, essentially never typed
				// into a search box) — folded into the same NUL rewrite here, documented as a
				// deliberate simplification rather than a full octal-escape port.
				out.WriteString(`\x{00}`)
				i += 2
			case strings.IndexByte(passthroughEscapeChars, next) >= 0:
				out.WriteByte('\\')
				out.WriteByte(next)
				i += 2
			default:
				// Unknown identity escape -> literal (D4 table's last row) — also the fallback
				// for a bare \k not followed by '<', which is just the letter k after all.
				r, size := utf8.DecodeRuneInString(pattern[i+1:])
				out.WriteRune(r)
				i += 1 + size
			}
		case !inClass && c == '.':
			out.WriteString(`[^\n\r\x{2028}\x{2029}]`)
			i++
		case !inClass && c == '(':
			if isLookaroundAt(pattern, i) {
				return "", ErrUnsupportedPattern
			}
			out.WriteByte(c)
			i++
		case c == '[':
			out.WriteByte(c)
			i++
			if !inClass {
				inClass = true
				// A leading '^' (negation) and/or an immediately-following ']' are both literal-
				// position conventions every regex dialect shares — copy them through without
				// re-triggering class-entry logic.
				if i < n && pattern[i] == '^' {
					out.WriteByte('^')
					i++
				}
				if i < n && pattern[i] == ']' {
					out.WriteByte(']')
					i++
				}
			}
		case c == ']':
			inClass = false
			out.WriteByte(c)
			i++
		default:
			r, size := utf8.DecodeRuneInString(pattern[i:])
			out.WriteRune(r)
			i += size
		}
	}
	return out.String(), nil
}

// isLookaroundAt reports whether pattern[i:] begins one of the four lookaround forms — checked
// only at an unescaped, out-of-class '(' (pattern[i] == '('). A named capture group, `(?<name>`,
// is NOT a match here: its next character after '<' is a name character, never '=' or '!'.
func isLookaroundAt(pattern string, i int) bool {
	rest := pattern[i:]
	if strings.HasPrefix(rest, "(?=") || strings.HasPrefix(rest, "(?!") {
		return true
	}
	return strings.HasPrefix(rest, "(?<=") || strings.HasPrefix(rest, "(?<!")
}

// translateUnicodeEscape handles \uXXXX (exactly four hex digits) and \u{H+} (one or more),
// rewriting either into RE2's own \x{...} hex-escape spelling — the same braced form, so only the
// letter (and, for the fixed-width case, the braces) actually change. ok is false for a malformed
// \u, which the caller identity-escapes to a literal 'u' instead (JS's own Annex B behaviour).
func translateUnicodeEscape(s string) (string, int, bool) {
	// s[0] == '\\', s[1] == 'u'.
	if len(s) >= 3 && s[2] == '{' {
		close := strings.IndexByte(s[3:], '}')
		if close < 0 {
			return "", 0, false
		}
		hex := s[3 : 3+close]
		if hex == "" || !isHexDigits(hex) {
			return "", 0, false
		}
		return `\x{` + hex + `}`, 3 + close + 1, true
	}
	if len(s) >= 6 && isHexDigits(s[2:6]) {
		return `\x{` + s[2:6] + `}`, 6, true
	}
	return "", 0, false
}

// translateControlEscape handles \cA-\cZ / \ca-\cz, rewriting to RE2's \x{01}-\x{1a}. ok is false
// when the character after \c is not a letter, in which case the caller identity-escapes \c to a
// literal 'c' (Annex B).
func translateControlEscape(s string) (string, int, bool) {
	// s[0] == '\\', s[1] == 'c'.
	if len(s) < 3 {
		return "", 0, false
	}
	c := s[2]
	var code byte
	switch {
	case c >= 'A' && c <= 'Z':
		code = c - 'A' + 1
	case c >= 'a' && c <= 'z':
		code = c - 'a' + 1
	default:
		return "", 0, false
	}
	return `\x{` + hexTwoDigits(code) + `}`, 3, true
}

func hexTwoDigits(b byte) string {
	s := strconv.FormatInt(int64(b), 16)
	if len(s) < 2 {
		s = "0" + s
	}
	return s
}

func isHexDigits(s string) bool {
	if s == "" {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
			return false
		}
	}
	return true
}

// hasTopLevelAlternation reports whether source contains a `|` outside every group and character
// class — wrapWholeWord's own guard against wrongly anchoring a multi-branch alternation where
// only one branch happens to start with `^` (or end with `$`).
func hasTopLevelAlternation(source string) bool {
	depth := 0
	inClass := false
	for i := 0; i < len(source); i++ {
		switch c := source[i]; {
		case c == '\\':
			i++ // skip the escaped character; safe even at the very last byte (i++ overshoots the
			// loop's own bound, which the for-loop's condition catches on the next iteration).
		case !inClass && c == '[':
			inClass = true
		case inClass && c == ']':
			inClass = false
		case !inClass && c == '(':
			depth++
		case !inClass && c == ')':
			depth--
		case !inClass && c == '|' && depth == 0:
			return true
		}
	}
	return false
}

// wrapWholeWord is D5's consuming, anchor-aware whole-word rewrite. Existence-equivalent to
// (?<!\w)(?:P)(?!\w), expressed in RE2 as a form that CONSUMES its boundary delimiters rather than
// merely asserting them (RE2 has no lookaround at all) — safe here because MatchFields only ever
// asks a boolean "does this field match" question, never needs the exact matched span.
//
// A naive post-check on FindStringIndex would be wrong: JS backtracks into a different
// ALTERNATIVE when a boundary fails (`foo|foobar` against "foobar" matches via the second
// branch), and Go's leftmost-first search returns only the first candidate — so the boundary must
// be part of the pattern itself, not checked after the fact.
func wrapWholeWord(source string) string {
	hasAlternation := hasTopLevelAlternation(source)

	lead := `(?:\A|[^0-9A-Za-z_])`
	if !hasAlternation && strings.HasPrefix(source, "^") {
		// P can only ever match starting at the true beginning of the text — the consuming
		// left-alternative would make that anchor unsatisfiable (it must consume one character
		// before `^`, which then can never be position zero), so it is dropped in favour of \A.
		lead = `\A`
	}
	trail := `(?:[^0-9A-Za-z_]|\z)`
	if !hasAlternation && strings.HasSuffix(source, "$") && !strings.HasSuffix(source, `\$`) {
		trail = `\z`
	}
	return lead + `(?:` + source + `)` + trail
}
