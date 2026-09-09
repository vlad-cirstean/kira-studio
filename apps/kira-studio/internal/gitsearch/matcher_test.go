package gitsearch

import (
	"reflect"
	"testing"
)

func mustCompile(t *testing.T, q Query) *Matcher {
	t.Helper()
	m, err := Compile(q)
	if err != nil {
		t.Fatalf("Compile(%+v): %v", q, err)
	}
	return m
}

func fieldStrings(fields []Field) []string {
	out := make([]string, len(fields))
	for i, f := range fields {
		out[i] = string(f)
	}
	return out
}

// TestMatchFields_FieldOrder pins D8's own contract: the returned slice's order is subject, body,
// authorName, authorEmail, committerName, committerEmail, sha -- exactly matcher.ts's own order.
func TestMatchFields_FieldOrder(t *testing.T) {
	m := mustCompile(t, Query{Text: "x"})
	f := CommitFields{
		SHA: "x0000000000000000000000000000000000000",
		Subject: "x", Body: "x",
		AuthorName: "x", AuthorEmail: "x",
		CommitterName: "x", CommitterEmail: "x",
	}
	got := fieldStrings(m.MatchFields(f))
	want := []string{"subject", "body", "authorName", "authorEmail", "committerName", "committerEmail"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("MatchFields order = %v, want %v", got, want)
	}
}

func TestMatchFields_EmptyBodyGuard(t *testing.T) {
	m := mustCompile(t, Query{Text: ""})
	// An empty query text compiles to a matcher that matches nothing -- but the guard under test
	// here is about a PATTERN that matches the empty string (a regex like "x*"), not an empty
	// query, so exercise that instead.
	re := mustCompile(t, Query{Text: "x*", Regex: true})
	hits := re.MatchFields(CommitFields{Subject: "no x here", Body: ""})
	for _, f := range hits {
		if f == FieldBody {
			t.Fatal("a pattern matching the empty string must not report 'body' on a body-less commit")
		}
	}
	_ = m
}

func TestMatchFields_BodyOnlyHit(t *testing.T) {
	m := mustCompile(t, Query{Text: "Zebra"})
	f := CommitFields{Subject: "routine maintenance", Body: "Renames the internal Zebra module."}
	got := fieldStrings(m.MatchFields(f))
	if !reflect.DeepEqual(got, []string{"body"}) {
		t.Fatalf("MatchFields = %v, want exactly [body]", got)
	}
}

func TestMatchFields_ShaPrefix(t *testing.T) {
	m := mustCompile(t, Query{Text: "218224"})
	f := CommitFields{SHA: "218224" + "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", Subject: "sha prefix commit"}
	got := fieldStrings(m.MatchFields(f))
	if !reflect.DeepEqual(got, []string{"sha"}) {
		t.Fatalf("MatchFields = %v, want exactly [sha]", got)
	}
}

func TestMatchFields_BelowMinShaPrefixMatchesNothing(t *testing.T) {
	m := mustCompile(t, Query{Text: "218"})
	f := CommitFields{SHA: "218224" + "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", Subject: "sha prefix commit"}
	if got := m.MatchFields(f); len(got) != 0 {
		t.Fatalf("MatchFields = %v, want none (below MinShaPrefix)", fieldStrings(got))
	}
}

func TestMatchFields_NoMatchReturnsEmpty(t *testing.T) {
	m := mustCompile(t, Query{Text: "widget"})
	got := m.MatchFields(CommitFields{Subject: "unrelated change to build config"})
	if len(got) != 0 {
		t.Fatalf("MatchFields = %v, want none", fieldStrings(got))
	}
}
