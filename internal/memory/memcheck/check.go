// Package memcheck is the `memory-check` subcommand: a validator for kira-memory comments and doc
// files, usable as a git pre-commit hook in any repository.
package memcheck

import (
	"fmt"
	"sort"

	"github.com/kirathecat/kira-studio/internal/memory/memfmt"
)

// Source is one file to check.
type Source struct {
	Path string
	Data []byte
}

// Problem is one violation in a file.
type Problem struct {
	Path string
	Line int
	Msg  string
}

func (p Problem) String() string { return fmt.Sprintf("%s:%d: %s", p.Path, p.Line, p.Msg) }

type seenFact struct {
	fact, reason string
	at           string
}

// Check validates every file and the facts across them: one id must carry the same fact text
// everywhere, and the same reason wherever two files both state one. Problems come sorted; facts counts the valid facts read.
func Check(files []Source) (problems []Problem, facts int) {
	sorted := append([]Source(nil), files...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Path < sorted[j].Path })
	seen := map[string]seenFact{}
	for _, f := range sorted {
		var (
			ps []memfmt.Problem
			fs []memfmt.Fact
		)
		if memfmt.IsDocPath(f.Path) {
			var d memfmt.Doc
			d, _, ps = memfmt.ParseDoc(f.Data)
			fs = d.Facts
		} else {
			var blocks []memfmt.Block
			blocks, ps = memfmt.ParseComments(f.Path, f.Data)
			for _, b := range blocks {
				fs = append(fs, b.Facts...)
			}
		}
		for _, p := range ps {
			problems = append(problems, Problem{f.Path, p.Line, p.Msg})
		}
		for _, x := range fs {
			facts++
			at := fmt.Sprintf("%s:%d", f.Path, x.Line)
			prev, ok := seen[x.ID]
			switch {
			case !ok:
				seen[x.ID] = seenFact{x.Fact, x.Reason, at}
			case prev.fact != x.Fact || (prev.reason != "" && x.Reason != "" && prev.reason != x.Reason):
				problems = append(problems, Problem{f.Path, x.Line, fmt.Sprintf("%s differs from %s", x.ID, prev.at)})
			case prev.reason == "" && x.Reason != "":
				prev.reason = x.Reason
				seen[x.ID] = prev
			}
		}
	}
	sort.SliceStable(problems, func(i, j int) bool {
		a, b := problems[i], problems[j]
		if a.Path != b.Path {
			return a.Path < b.Path
		}
		return a.Line < b.Line
	})
	return problems, facts
}
