package gitsearch

import (
	"errors"
	"regexp"
	"testing"
)

func TestTranslate_DotExcludesJSFourNotJustLF(t *testing.T) {
	got, err := translate(".")
	if err != nil {
		t.Fatalf("translate: %v", err)
	}
	re := regexp.MustCompile(got)
	for _, excluded := range []string{"\n", "\r", " ", " "} {
		if re.MatchString(excluded) {
			t.Fatalf("translated '.' matched %q, want excluded (JS's own four)", excluded)
		}
	}
	if !re.MatchString("x") {
		t.Fatal("translated '.' must still match an ordinary character")
	}
}

func TestTranslate_WhitespaceClassIsWiderThanRE2Native(t *testing.T) {
	source, err := translate(`\s`)
	if err != nil {
		t.Fatalf("translate: %v", err)
	}
	re := regexp.MustCompile(source)
	// NBSP (U+00A0) is JS \s but NOT RE2's native \s.
	if !re.MatchString(" ") {
		t.Fatal("translated \\s must match NBSP, matching JS's own wider whitespace class")
	}
	if !re.MatchString(" ") || !re.MatchString("\t") || !re.MatchString("\n") {
		t.Fatal("translated \\s must still match ordinary ASCII whitespace")
	}

	negSource, err := translate(`\S`)
	if err != nil {
		t.Fatalf("translate: %v", err)
	}
	negRe := regexp.MustCompile(negSource)
	if negRe.MatchString(" ") {
		t.Fatal("translated \\S must not match NBSP")
	}
	if !negRe.MatchString("x") {
		t.Fatal("translated \\S must still match an ordinary non-whitespace character")
	}
}

func TestTranslate_UnicodePropertyEscapeIsIdentityNotClass(t *testing.T) {
	// Without the `u` flag, JS's \p is just an identity escape for the literal letter 'p' -- NOT
	// a Unicode property class (which RE2 would otherwise happily interpret \p{L} as).
	source, err := translate(`\p{L}`)
	if err != nil {
		t.Fatalf("translate: %v", err)
	}
	re := regexp.MustCompile(source)
	if !re.MatchString("p{L}") {
		t.Fatalf("translated %q = %q, want to match the literal text \"p{L}\"", `\p{L}`, source)
	}
	if re.MatchString("x") {
		t.Fatal("translated \\p{L} must not behave as a Unicode letter class")
	}
}

func TestTranslate_UnicodeEscapes(t *testing.T) {
	cases := []struct {
		pattern string
		want    rune
	}{
		{`A`, 'A'},
		{`\u{41}`, 'A'},
		{`\u{1F600}`, '\U0001F600'},
	}
	for _, tc := range cases {
		source, err := translate(tc.pattern)
		if err != nil {
			t.Fatalf("translate(%q): %v", tc.pattern, err)
		}
		re := regexp.MustCompile(source)
		if !re.MatchString(string(tc.want)) {
			t.Fatalf("translate(%q) = %q, want a pattern matching %q", tc.pattern, source, string(tc.want))
		}
	}
}

func TestTranslate_MalformedUnicodeEscapeIsIdentityEscape(t *testing.T) {
	source, err := translate(`\u`)
	if err != nil {
		t.Fatalf("translate: %v", err)
	}
	re := regexp.MustCompile(source)
	if !re.MatchString("u") {
		t.Fatalf("translate(%q) = %q, want a pattern matching literal 'u'", `\u`, source)
	}
}

func TestTranslate_ControlEscapes(t *testing.T) {
	source, err := translate(`\cA`)
	if err != nil {
		t.Fatalf("translate: %v", err)
	}
	re := regexp.MustCompile(source)
	if !re.MatchString("\x01") {
		t.Fatal("translate(\\cA) must match 0x01")
	}

	lower, err := translate(`\cz`)
	if err != nil {
		t.Fatalf("translate: %v", err)
	}
	reLower := regexp.MustCompile(lower)
	if !reLower.MatchString("\x1a") {
		t.Fatal("translate(\\cz) must match 0x1a")
	}
}

func TestTranslate_BareNulEscape(t *testing.T) {
	source, err := translate(`\0`)
	if err != nil {
		t.Fatalf("translate: %v", err)
	}
	re := regexp.MustCompile(source)
	if !re.MatchString("\x00") {
		t.Fatal("translate(\\0) must match NUL")
	}
}

func TestTranslate_UnknownIdentityEscapeBecomesLiteral(t *testing.T) {
	source, err := translate(`\q`)
	if err != nil {
		t.Fatalf("translate: %v", err)
	}
	re := regexp.MustCompile(source)
	if !re.MatchString("q") {
		t.Fatalf("translate(\\q) = %q, want a pattern matching literal 'q'", source)
	}
}

func TestTranslate_KnownPassthroughEscapesAreUnchanged(t *testing.T) {
	for _, esc := range []string{`\d`, `\D`, `\w`, `\W`, `\b`, `\B`, `\n`, `\t`} {
		if _, err := translate(esc); err != nil {
			t.Fatalf("translate(%q): unexpected error %v", esc, err)
		}
	}
}

func TestTranslate_RejectsLookaroundAndBackreferences(t *testing.T) {
	for _, pattern := range []string{"(?=x)", "(?!x)", "(?<=x)", "(?<!x)", `(a)\1`, `(?<name>a)\k<name>`} {
		_, err := translate(pattern)
		if !errors.Is(err, ErrUnsupportedPattern) {
			t.Fatalf("translate(%q) error = %v, want ErrUnsupportedPattern", pattern, err)
		}
	}
}

func TestTranslate_NamedCaptureGroupIsNotLookbehind(t *testing.T) {
	source, err := translate(`(?<name>foo)`)
	if err != nil {
		t.Fatalf("translate(%q): unexpected error %v", `(?<name>foo)`, err)
	}
	if _, err := regexp.Compile(source); err != nil {
		t.Fatalf("regexp.Compile(%q): %v", source, err)
	}
}

func TestTranslate_LookaroundInsideClassIsLiteral(t *testing.T) {
	// Inside a character class, '(' '?' '=' are all ordinary literal members -- not lookaround.
	source, err := translate(`[(?=]`)
	if err != nil {
		t.Fatalf("translate(%q): unexpected error %v", `[(?=]`, err)
	}
	re := regexp.MustCompile(source)
	if !re.MatchString("=") {
		t.Fatalf("translate(%q) = %q, want a class matching '='", `[(?=]`, source)
	}
}

func TestWrapWholeWord_Probe10OverRegexMode(t *testing.T) {
	// Row 7/matcher.test.ts's own regex+wholeWord case: "widget" as a regex, matched against
	// "Fix the widget cache" (match) and "subwidgetary refactor noted" (no match).
	source, err := translate("widget")
	if err != nil {
		t.Fatalf("translate: %v", err)
	}
	wrapped := wrapWholeWord(source)
	re := regexp.MustCompile(wrapped)
	if !re.MatchString("Fix the widget cache") {
		t.Fatal("expected a whole-word match in 'Fix the widget cache'")
	}
	if re.MatchString("subwidgetary refactor noted") {
		t.Fatal("expected no whole-word match in 'subwidgetary refactor noted'")
	}
}

// TestWrapWholeWord_AlternationBacktrackCase is D5's own named hazard: a naive post-check on
// FindStringIndex disagrees with JS here, because JS backtracks into the SECOND alternative when
// the first's boundary fails. The consuming rewrite must not have that bug.
func TestWrapWholeWord_AlternationBacktrackCase(t *testing.T) {
	source, err := translate("foo|foobar")
	if err != nil {
		t.Fatalf("translate: %v", err)
	}
	wrapped := wrapWholeWord(source)
	re := regexp.MustCompile(wrapped)
	if !re.MatchString("foobar") {
		t.Fatal("expected 'foo|foobar' whole-word-wrapped to match 'foobar' via the second alternative")
	}
}

func TestWrapWholeWord_AnchoredStart(t *testing.T) {
	source, err := translate("^foo")
	if err != nil {
		t.Fatalf("translate: %v", err)
	}
	wrapped := wrapWholeWord(source)
	re := regexp.MustCompile(wrapped)
	if !re.MatchString("foo bar") {
		t.Fatal("expected '^foo' whole-word-wrapped to match text starting with 'foo'")
	}
	if re.MatchString("xfoo bar") {
		t.Fatal("expected '^foo' whole-word-wrapped to require the true start of the text")
	}
}

func TestWrapWholeWord_AnchoredEnd(t *testing.T) {
	source, err := translate("bar$")
	if err != nil {
		t.Fatalf("translate: %v", err)
	}
	wrapped := wrapWholeWord(source)
	re := regexp.MustCompile(wrapped)
	if !re.MatchString("foo bar") {
		t.Fatal("expected 'bar$' whole-word-wrapped to match text ending with 'bar'")
	}
	if re.MatchString("foo barn") {
		t.Fatal("expected 'bar$' whole-word-wrapped to require the true end of the text")
	}
}

func TestWrapWholeWord_AnchoredAlternationDoesNotOverAnchor(t *testing.T) {
	// "^foo|bar" must still let "bar" match anywhere, whole-word -- the anchor optimisation must
	// not fire when only ONE branch of a top-level alternation is anchored.
	source, err := translate("^foo|bar")
	if err != nil {
		t.Fatalf("translate: %v", err)
	}
	wrapped := wrapWholeWord(source)
	re := regexp.MustCompile(wrapped)
	if !re.MatchString("xxx bar xxx") {
		t.Fatal("expected the unanchored 'bar' branch to still match anywhere in the text")
	}
}

func TestHasTopLevelAlternation(t *testing.T) {
	cases := []struct {
		source string
		want   bool
	}{
		{"foo", false},
		{"foo|bar", true},
		{"(foo|bar)", false},
		{`foo\|bar`, false},
		{"[a|b]", false},
	}
	for _, tc := range cases {
		if got := hasTopLevelAlternation(tc.source); got != tc.want {
			t.Fatalf("hasTopLevelAlternation(%q) = %v, want %v", tc.source, got, tc.want)
		}
	}
}
