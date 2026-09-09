package gitsearch

import "testing"

// TestLiteralMatcher_Probe10 pins upstream probe 10's own four rows (F15/D3's own worked example)
// -- the whole-word literal boundary check must agree with JS's (?<!\w)/(?!\w) wrapping exactly.
func TestLiteralMatcher_Probe10(t *testing.T) {
	cases := []struct {
		name    string
		needle  string
		haystack string
		want    bool
	}{
		{"widget in 'the widget cache' matches", "widget", "the widget cache", true},
		{"(#12 in 'fix (#123)' does not match", "(#12", "fix (#123)", false},
		{"#123 in 'fix (#123)' matches", "#123", "fix (#123)", true},
		{"v1.2 in 'tag v1.2.0 here' matches", "v1.2", "tag v1.2.0 here", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			m := newLiteralMatcher(tc.needle, false, true)
			if got := m.match(tc.haystack); got != tc.want {
				t.Fatalf("match(%q in %q) = %v, want %v", tc.needle, tc.haystack, got, tc.want)
			}
		})
	}
}

func TestLiteralMatcher_PlainSubstring(t *testing.T) {
	m := newLiteralMatcher("widget", false, false)
	if !m.match("the widget cache") {
		t.Fatal("expected a plain substring match")
	}
	if m.match("unrelated change") {
		t.Fatal("expected no match")
	}
}

func TestLiteralMatcher_CaseSensitive(t *testing.T) {
	m := newLiteralMatcher("widget", false, false)
	if m.match("WIDGET") {
		t.Fatal("case-sensitive matcher must not match a differently-cased occurrence")
	}
}

func TestLiteralMatcher_CaseInsensitive(t *testing.T) {
	m := newLiteralMatcher("widget", true, false)
	if !m.match("add WIDGETS to the list") {
		t.Fatal("case-insensitive matcher must match regardless of case")
	}
}

func TestLiteralMatcher_WholeWordRejectsPartialWordMatch(t *testing.T) {
	m := newLiteralMatcher("widget", true, true)
	if m.match("subwidgetary refactor noted") {
		t.Fatal("whole-word matcher must not match a mid-word occurrence")
	}
	if !m.match("Fix the widget cache") {
		t.Fatal("whole-word matcher must still match a real word-boundary occurrence")
	}
}

// TestLiteralMatcher_KelvinSign is F15's own worked ECMA-262 fold quirk: /k/i does not match
// U+212A KELVIN SIGN in JavaScript (foldRune keeps the original rune when a non-ASCII code
// point's uppercase form collapses to ASCII), unlike Go's own (?i)k.
func TestLiteralMatcher_KelvinSign(t *testing.T) {
	m := newLiteralMatcher("k", true, false)
	kelvin := "K" // KELVIN SIGN
	if m.match(kelvin) {
		t.Fatalf("case-insensitive 'k' must not match U+212A KELVIN SIGN, matching JS's own foldRune quirk")
	}
	if !m.match("K") {
		t.Fatal("case-insensitive 'k' must still match plain ASCII 'K'")
	}
}

func TestLiteralMatcher_OverlappingOccurrences(t *testing.T) {
	// "aaa" contains two overlapping occurrences of "aa" at byte offsets 0 and 1 -- a whole-word
	// search must consider both rather than skip past one via a len(needle)-sized stride.
	m := newLiteralMatcher("aa", false, true)
	if m.match("xaaax") {
		t.Fatal("neither occurrence of 'aa' in 'xaaax' has a non-word character on both sides")
	}
	if !m.match("aa") {
		t.Fatal("'aa' matches itself as a whole word")
	}
}

func TestBoundaryOK(t *testing.T) {
	s := "fix (#123)"
	// "#123" starts at byte 5, ends at byte 9.
	if !boundaryOK(s, 5, 9) {
		t.Fatal("expected the '(' and ')' surrounding #123 to satisfy the boundary check")
	}
	// "(#12" starts at byte 4, ends at byte 8 -- '3' at byte 8 is a word byte.
	if boundaryOK(s, 4, 8) {
		t.Fatal("expected a word byte immediately after the occurrence to fail the boundary check")
	}
	if !boundaryOK("foo", 0, 3) {
		t.Fatal("start-of-string/end-of-string must count as boundaries")
	}
}

func TestFoldRune(t *testing.T) {
	if foldRune('a') != 'A' {
		t.Fatalf("foldRune('a') = %q, want 'A'", foldRune('a'))
	}
	if foldRune('A') != 'A' {
		t.Fatalf("foldRune('A') = %q, want 'A'", foldRune('A'))
	}
	if foldRune('1') != '1' {
		t.Fatalf("foldRune('1') = %q, want '1'", foldRune('1'))
	}
	// U+212A KELVIN SIGN uppercases to itself under unicode.ToUpper (it IS already the "upper"
	// canonical form in Unicode terms), so this rune's own fold does not collapse onto ASCII 'K'
	// -- foldRune must therefore return it unchanged, never ASCII 'K'.
	if foldRune('K') == 'K' {
		t.Fatal("foldRune(U+212A) must not collapse onto ASCII 'K'")
	}
}

func TestIsWordByte(t *testing.T) {
	for _, b := range []byte("aZ_9") {
		if !isWordByte(b) {
			t.Fatalf("isWordByte(%q) = false, want true", b)
		}
	}
	for _, b := range []byte(" .#(") {
		if isWordByte(b) {
			t.Fatalf("isWordByte(%q) = true, want false", b)
		}
	}
	// A UTF-8 continuation/lead byte is never a word byte -- ASCII-only, matching JS's own \w
	// without the `u` flag.
	if isWordByte(0xC3) {
		t.Fatal("a non-ASCII byte must never be a word byte")
	}
}
