package main

import (
	"os"
	"strings"
	"testing"
)

func unitAt(src, text string, id string) Unit {
	i := strings.Index(src, text)
	return Unit{ID: id, Start: i, End: i + len(text), Text: text, InputKey: id}
}

func TestSpliceMultiUnitAndOverlap(t *testing.T) {
	src := "// one\nx := 1\n// two\ny := 2\n"
	a, b := unitAt(src, "// one", "a"), unitAt(src, "// two", "b")
	got, err := splice([]byte(src), []Unit{b, a}, func(u Unit) string { return map[string]string{"a": "// 1", "b": "// second"}[u.ID] })
	if err != nil || string(got) != "// 1\nx := 1\n// second\ny := 2\n" {
		t.Fatalf("splice: %q %v", got, err)
	}
	over := Unit{ID: "c", Start: a.Start, End: b.End, Text: src[a.Start:b.End]}
	if _, err := splice([]byte(src), []Unit{a, over}, func(Unit) string { return "" }); err == nil {
		t.Fatal("overlap must be an error")
	}
	stale := a
	stale.Text = "// uno"
	if _, err := splice([]byte(src), []Unit{stale}, func(Unit) string { return "" }); err == nil {
		t.Fatal("changed file text must be an error")
	}
}

func TestGoDiff(t *testing.T) {
	before := "package p\n\n// old words\nvar a = 1\n"
	if r := goDiff("x.go", []byte(before), []byte("package p\n\n// new words\nvar a = 1\n")); r != "" {
		t.Fatalf("comment-only change must pass: %s", r)
	}
	if r := goDiff("x.go", []byte(before), []byte("package p\n\n// old words\nvar b = 1\n")); r == "" {
		t.Fatal("changed identifier must fail")
	}
	if r := goDiff("x.go", []byte("package p\n\n/* old */\nvar a = 1\n"), []byte("package p\n\n/* new */ var c = 3 /* x */\nvar a = 1\n")); r == "" {
		t.Fatal("a comment ended early must fail")
	}
	if r := goDiff("x.go", []byte(before), []byte("package p\n\n// old words \nvar a = 1\n")); r == "" {
		t.Fatal("trailing space must fail the gofmt check")
	}
}

func TestApplyRefusesStaleFile(t *testing.T) {
	t.Chdir(t.TempDir())
	src := "package p\n\n// old\nvar a = 1\n"
	if err := os.WriteFile("x.go", []byte("package p\n\n// changed since scan\nvar a = 1\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	u := unitAt(src, "// old", "a")
	u.File, u.Lang, u.FileSha = "x.go", "go", sha([]byte(src))
	if err := writeAll("units.jsonl", []Unit{u}); err != nil {
		t.Fatal(err)
	}
	if err := writeAll("results.jsonl", []Result{{ID: "a", InputKey: "a", Outcome: outRewritten, Text: "// new"}}); err != nil {
		t.Fatal(err)
	}
	if err := runApply(applyOpts{lang: "go"}); err == nil || !strings.Contains(err.Error(), "stale") {
		t.Fatalf("stale file must be refused: %v", err)
	}
	if got, _ := os.ReadFile("x.go"); !strings.Contains(string(got), "changed since scan") {
		t.Fatal("stale file must stay untouched")
	}
}
