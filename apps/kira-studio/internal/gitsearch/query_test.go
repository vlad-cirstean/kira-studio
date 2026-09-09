package gitsearch

import (
	"errors"
	"testing"
)

func TestCompile_EmptyTextMatchesNothing(t *testing.T) {
	m, err := Compile(Query{Text: ""})
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}
	got := m.MatchFields(CommitFields{Subject: "anything at all", Body: "anything"})
	if len(got) != 0 {
		t.Fatalf("MatchFields on an empty-text matcher = %v, want none", got)
	}
}

func TestCompile_LiteralMode(t *testing.T) {
	m, err := Compile(Query{Text: "widget"})
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}
	if !m.matchText("the widget cache") {
		t.Fatal("expected a literal-mode match")
	}
	// A literal-mode pattern's metacharacters must be escaped, not interpreted -- "wid.et" as a
	// literal needle must not match "widget" via a wildcard '.'.
	m2, err := Compile(Query{Text: "wid.et"})
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}
	if m2.matchText("widget") {
		t.Fatal("literal mode must escape regex metacharacters")
	}
	if !m2.matchText("wid.et") {
		t.Fatal("literal mode must still match the literal text with its literal dot")
	}
}

func TestCompile_RegexMode(t *testing.T) {
	m, err := Compile(Query{Text: "wid(get|ening)", Regex: true})
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}
	if !m.matchText("Fix the widget cache") {
		t.Fatal("expected a regex-mode alternation match")
	}
}

func TestCompile_UnsupportedPattern(t *testing.T) {
	_, err := Compile(Query{Text: "(?=x)", Regex: true})
	if !errors.Is(err, ErrUnsupportedPattern) {
		t.Fatalf("Compile error = %v, want ErrUnsupportedPattern", err)
	}
}

func TestCompile_ShaPrefix(t *testing.T) {
	m, err := Compile(Query{Text: "218224"})
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}
	if m.shaPrefix != "218224" {
		t.Fatalf("shaPrefix = %q, want %q", m.shaPrefix, "218224")
	}

	m2, err := Compile(Query{Text: "218"})
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}
	if m2.shaPrefix != "" {
		t.Fatalf("shaPrefix = %q, want empty (below MinShaPrefix)", m2.shaPrefix)
	}

	// A sha-prefix arm exists regardless of regex/literal mode -- it is tested separately in
	// compileQuery/Compile, over the raw text, not the compiled pattern.
	m3, err := Compile(Query{Text: "ABCD", Regex: true})
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}
	if m3.shaPrefix != "abcd" {
		t.Fatalf("shaPrefix = %q, want lower-cased %q", m3.shaPrefix, "abcd")
	}
}

func TestCompile_RegexCaseSensitivity(t *testing.T) {
	sensitive, err := Compile(Query{Text: "WIDGET", Regex: true, CaseSensitive: true})
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}
	if sensitive.matchText("widget") {
		t.Fatal("case-sensitive regex mode must not fold case")
	}

	insensitive, err := Compile(Query{Text: "WIDGET", Regex: true})
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}
	if !insensitive.matchText("widget") {
		t.Fatal("case-insensitive regex mode must fold case")
	}
}

func TestIsHexPrefixText(t *testing.T) {
	cases := []struct {
		text string
		want bool
	}{
		{"abcd", true},
		{"ABCD", true},
		{"abc", false},                    // below MinShaPrefix
		{"g123", false},                   // not hex
		{string(make([]byte, 41)), false}, // above maxShaPrefix (zero bytes are not hex either, but length alone should already fail)
	}
	for _, tc := range cases {
		if got := isHexPrefixText(tc.text); got != tc.want {
			t.Fatalf("isHexPrefixText(%q) = %v, want %v", tc.text, got, tc.want)
		}
	}
}
