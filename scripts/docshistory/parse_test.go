package main

import (
	"bytes"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

const specV1 = `# Spec

| Phase | Deliverable | Why here |
|---|---|---|
| **P0 Foundation: tooling** | Repo setup. **Done** | first |
| **P5.5 Half step** | Between | after P5 |

Prose that mentions a decision on P5.5 outside any table.

| **P58f Cutover** | Switch over, rather than dual-run | last |
| **P52-P57 Wails migration** | Seven steps | |
| **P16 Part 2: fixes** | Misc **Superseded by P20** | |

| # | Check | Result |
|---|---|---|
| 1 | P99 checked | ok |
`

const specV13 = `| Phase | Status upstream | Lands in this chapter as |
|---|---|---|
| P0 Foundation | Done | n/a |

| # | Deliverable | Depends on | Covers upstream |
|---|---|---|---|
| **G5** | Refs and tags | G2 | P7 |
`

const specV22 = `| Phase | Title | Status |
|---|---|---|
| P210 | Embedding search \| local model | Done. Shipped in full. |
| P212 Part 1 | Mobile web | Todo |

## P210, P212 Part 1 result

Chose X instead of Y.

### Detail

kept

## P52-P57 result

range body

` + "```" + `
## P999 result
` + "```" + `

## Other prose

Closing: reverted the cache.
`

func TestTableShapes(t *testing.T) {
	p := Parse("v1", specV1, "", nil, nil)
	var ids []string
	for _, ph := range p.Phases {
		ids = append(ids, ph.ID)
	}
	want := []string{"P0", "P5.5", "P58f", "P52-P57", "P16 Part 2"}
	if !reflect.DeepEqual(ids, want) {
		t.Fatalf("ids = %v, want %v", ids, want)
	}
	if p.Phases[0].Title != "Foundation: tooling" || p.Phases[0].Status != "Done" {
		t.Errorf("P0 = %+v", p.Phases[0])
	}
	if p.Phases[4].Status != "Superseded by P20" {
		t.Errorf("status = %q", p.Phases[4].Status)
	}
	if len(p.Notes) != 1 || len(p.Phases[1].Mentions) != 1 {
		t.Errorf("notes = %v mentions = %v", p.Notes, p.Phases[1].Mentions)
	}

	q := Parse("v1.3", specV13, "", nil, nil)
	if len(q.Phases) != 1 || q.Phases[0].ID != "G5" || len(q.Phases[0].Cells) != 3 {
		t.Errorf("v1.3 phases = %+v", q.Phases)
	}
}

func TestResultSections(t *testing.T) {
	p := Parse("v2.2", specV22, "", nil, nil)
	if len(p.Phases) != 3 {
		t.Fatalf("phases = %d, want 3 (P52-P57 from its result heading)", len(p.Phases))
	}
	a, b, r := p.Phases[0], p.Phases[1], p.Phases[2]
	if a.Title != "Embedding search | local model" || a.Status != "Done." {
		t.Errorf("P210 = %+v", a)
	}
	if len(a.Results) != 1 || a.Results[0] != b.Results[0] || !strings.Contains(a.Results[0], "### Detail") {
		t.Errorf("comma heading did not file one body under both: %q / %q", a.Results, b.Results)
	}
	if r.ID != "P52-P57" || r.Title != "" || strings.Contains(r.Results[0], "other prose") {
		t.Errorf("range = %+v", r)
	}
	if !strings.Contains(r.Results[0], "## P999 result") {
		t.Errorf("fenced heading must stay in the body: %q", r.Results[0])
	}
	if len(p.Notes) != 1 || !strings.HasPrefix(p.Notes[0], "Closing:") {
		t.Errorf("notes = %v", p.Notes)
	}
}

func TestPlanResult(t *testing.T) {
	plans := map[string]string{
		"P131-part2-x.md": "# P131\n\n## Plan\n\nstuff\n\n## Result\n\nDone it.\n\n## Appendix\n\nno\n",
		"README.md":       "## Result\nignored",
	}
	p := Parse("v2.0", "| Phase | Deliverable |\n|---|---|\n| **P131 Part 2: x** | y |\n", "", nil, plans)
	if len(p.Phases) != 1 || len(p.Phases[0].Results) != 1 || p.Phases[0].Results[0] != "Done it." {
		t.Fatalf("phases = %+v", p.Phases)
	}
}

func TestBlocksIdempotent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "H.md")
	blocks := map[string]string{"v1.9": "## v1.9\nx\n", "v1": "## v1\ny\n", "v1.1": "## v1.1\nz\n"}
	if _, err := writeBlocks(path, blocks); err != nil {
		t.Fatal(err)
	}
	first, _ := os.ReadFile(path)
	got, err := readBlocks(path)
	if err != nil || !reflect.DeepEqual(got, blocks) {
		t.Fatalf("readBlocks = %v, %v", got, err)
	}
	got["v1.1"] = "## v1.1\nnew\n"
	got["v1.1"] = blocks["v1.1"]
	if _, err := writeBlocks(path, got); err != nil {
		t.Fatal(err)
	}
	second, _ := os.ReadFile(path)
	if !bytes.Equal(first, second) || bytes.Index(first, []byte("chapter v1 -->")) > bytes.Index(first, []byte("chapter v1.1 -->")) {
		t.Errorf("splice changed bytes or order:\n%s", second)
	}
}

func TestRepointText(t *testing.T) {
	commits := map[string]string{"v1": "aaaaaaaaaaaa", "v1.1": "bbbbbbbbbbbb"}
	in := "see docs/v1.1/plans/P22-slickgrid-plan.md §4.2 and docs/v1/SPEC.md:10-12, docs/v1.1/WEBVIEW-SCROLL-MEMORY.md. Glob docs/v1.1/plans/P1*.md"
	got, n, um := repointText("src/x.go", in, commits)
	want := "see docs/HISTORY.md (v1.1 P22) and docs/HISTORY.md (v1), docs/WEBVIEW-SCROLL-MEMORY.md. Glob docs/v1.1/plans/P1*.md"
	if got != want || n != 3 || len(um) != 1 {
		t.Errorf("got %q n=%d unmatched=%v", got, n, um)
	}
	got, _, _ = repointText("scripts/a.sh", "# docs/v1/plans/P1-x.md", commits)
	if got != "# git show aaaaaaaaaaaa:docs/v1/plans/P1-x.md" {
		t.Errorf("operative = %q", got)
	}
}
