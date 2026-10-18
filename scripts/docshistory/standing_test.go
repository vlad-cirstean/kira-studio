package main

import (
	"strings"
	"testing"
)

func TestSplitDoc(t *testing.T) {
	long := strings.Repeat("word ", 120)
	prose := func(tag string) string { return tag + " " + long + "\n" }
	wide := strings.Repeat("cell text ", 40)
	src := "# Title\n\nintro " + long + "\n\n" +
		"## Alpha\n\n" + prose("a1") + "\n" + prose("a2") + "\n```sh\n## not a heading\n```\n\n" + prose("a3") +
		"\n| k | v |\n|---|---|\n| x | 1 |\n\n" +
		"| name | note |\n|---|---|\n| one | " + wide + " |\n| two | " + wide + " |\n\n" +
		"short tail\n\n" +
		"## Beta\n\n" + prose("b1") + "\n### Alpha\n\n" + prose("c1") +
		"\n## Kept\n\n" + prose("k1")
	segs := splitDoc("ARCHITECTURE.md", src)

	var got []string
	var raw strings.Builder
	for _, s := range segs {
		raw.WriteString(s.Raw)
		switch s.Kind {
		case segHeading:
			got = append(got, "h:"+s.Heading)
		case segVerbatim:
			got = append(got, "v:"+s.Why)
		default:
			got = append(got, "p:"+s.Slug)
		}
	}
	if raw.String() != src {
		t.Fatalf("segments do not rebuild the input")
	}
	want := []string{
		"h:Title", "v:intro",
		"h:Alpha", "p:architecture/alpha/01", "v:fence", "p:architecture/alpha/02", "v:lookup", "v:gap",
		"p:architecture/alpha/03",
		"h:Beta", "p:architecture/beta/01",
		"h:Alpha", "p:architecture/alpha-1/01",
		"h:Kept", "p:architecture/kept/01",
	}
	if strings.Join(got, " ") != strings.Join(want, " ") {
		t.Fatalf("segments\n got %v\nwant %v", got, want)
	}

	recs := map[string]Record{}
	for _, s := range segs {
		if s.Kind == segProse {
			recs[s.Slug] = Record{Slug: s.Slug, State: stateVerbatim, InputSha256: sha(s.unitText("ARCHITECTURE.md"))}
		}
	}
	out, err := renderDoc("ARCHITECTURE.md", "0123456789abcdef", segs, recs)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Replace(out, "\nDistilled in P303, one fact per line. Full earlier text: git show 0123456789ab:docs/ARCHITECTURE.md.\n", "", 1) != src {
		t.Fatalf("all-verbatim render differs from the input")
	}
	delete(recs, "architecture/beta/01")
	if _, err := renderDoc("ARCHITECTURE.md", "0123456789abcdef", segs, recs); err == nil {
		t.Fatal("render accepted a unit without a record")
	}
}

func TestKeepAndSplitCaps(t *testing.T) {
	para := strings.Repeat("x", 5000)
	src := "# T\n\n## Known open items\n\n" + para + "\n\n## Big\n\n" + para + "\n\n" + para + "\n\n" + para + "\n"
	segs := splitDoc("ARCHITECTURE.md", src)
	n := 0
	for _, s := range segs {
		if s.Kind == segProse {
			n++
			if len([]rune(s.Body)) > partMax {
				t.Fatalf("part over cap: %d", len(s.Body))
			}
			if s.Top != "Big" {
				t.Fatalf("kept section distilled: %s", s.Slug)
			}
		}
	}
	if n != 2 {
		t.Fatalf("parts = %d, want 2", n)
	}
}
