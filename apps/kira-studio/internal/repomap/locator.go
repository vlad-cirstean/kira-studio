package repomap

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codegraph"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/pathsafe"
)

// locateArgs is every navigation tool's own shared input (§6.1) — file/line/column/symbol, plus
// this Server's own repository root for the absolute-to-relative conversion.
type locateArgs struct {
	File      string
	Line      int
	Column    int
	Symbol    string
	Languages []string
}

// locateResult is locate's own outcome: exactly one of query (proceed), ambiguous (rule 4's
// several-exact-hits case — render as a list, tell the caller to re-call with file), or empty
// (rule 4's no-hits case, or nothing at all resolvable) is meaningful; msg carries the
// caller-correctable IsError text for a genuine input problem (rule 5, or file-without-line-or-
// symbol).
type locateResult struct {
	query     codegraph.Query
	ambiguous []codegraph.Target
	empty     bool
	msg       string
}

// relFile implements §6.1 rule 1: an absolute file is made repository-relative against root; a
// relative one is trusted as already repository-relative (an agent that already has a file listing
// from outline_file/search_files passes it straight back through). Never NFC-normalized —
// `internal/gitpath`'s tier 2 rule: the stored path is git's own bytes.
func relFile(root, file string) (string, error) {
	if !filepath.IsAbs(file) {
		return file, nil
	}
	rel, err := filepath.Rel(root, file)
	if err != nil {
		return "", fmt.Errorf("%s is not inside this repository (%s)", file, root)
	}
	if strings.HasPrefix(rel, "..") {
		return "", fmt.Errorf("%s is not inside this repository (%s)", file, root)
	}
	return rel, nil
}

// absentFileReason explains why outline_file found no index row for rel — rel has already passed
// relFile, so this is the P68b distinction: a real "no such file" (typo, unindexed language,
// directory, out-of-repo escape) versus a real, indexed file that genuinely has zero definitions
// (renderOutline's own "has no indexed definitions", which this function never renders). Stats
// through pathsafe.ValidateRelPath — the same containment check sourceForOneFile uses — rather than
// os.Stat directly, so a relative ".." escape that relFile alone passes through is still caught
// here as "not inside this repository", not misreported as a stat error.
func absentFileReason(root, rel string) string {
	abs, err := pathsafe.ValidateRelPath(root, rel)
	if err != nil {
		return fmt.Sprintf("%s is not inside this repository (%s)", rel, root)
	}
	info, err := os.Stat(abs)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Sprintf("no indexed file at %s, and no such file on disk — call search_files to find the right path", rel)
		}
		return fmt.Sprintf("no indexed file at %s (%s is unreadable)", rel, rel)
	}
	if info.IsDir() {
		return fmt.Sprintf("%s is a directory, not a file — call search_files with it as pathPrefix to list indexed files under it", rel)
	}
	if !info.Mode().IsRegular() {
		return fmt.Sprintf("%s is not a regular file", rel)
	}
	return fmt.Sprintf("%s exists but is not indexed — its language is not one this index covers, or it is excluded — call search_files to see what is indexed", rel)
}

// exactSymbolMatches narrows hits (a prefix search's own results, §4.3 in C2) down to the ones
// whose Name is exactly name — rule 4's own "exactly one hit whose name matches exactly."
func exactSymbolMatches(hits []codegraph.Target, name string) []codegraph.Target {
	var out []codegraph.Target
	for _, h := range hits {
		if h.Name == name {
			out = append(out, h)
		}
	}
	return out
}

// locate resolves args into a codegraph.Query per §6.1's five rules. A returned error is a genuine
// internal fault (a database error from the rule-4 symbol search); everything caller-correctable is
// carried in locateResult.msg/ambiguous/empty instead.
func locate(ctx context.Context, graph *codegraph.Graph, root string, args locateArgs) (locateResult, error) {
	switch {
	case args.File != "":
		rel, err := relFile(root, args.File)
		if err != nil {
			return locateResult{msg: err.Error()}, nil
		}
		q := codegraph.Query{Path: rel, Byte: -1}
		switch {
		case args.Line > 0:
			column := args.Column
			if column <= 0 {
				column = 1
			}
			q.Point = &codegraph.Point{Row: args.Line - 1, Column: column - 1}
		case args.Symbol != "":
			q.Name = args.Symbol
		default:
			return locateResult{msg: "file given with neither line nor symbol — pass line (and optional column), or symbol, alongside file"}, nil
		}
		return locateResult{query: q}, nil

	case args.Symbol != "":
		hits, err := graph.SearchSymbols(ctx, codegraph.SymbolSearch{Text: args.Symbol, Languages: args.Languages, Limit: defaultSymbolLocateLimit})
		if err != nil {
			return locateResult{}, err
		}
		exact := exactSymbolMatches(hits, args.Symbol)
		switch len(exact) {
		case 0:
			return locateResult{empty: true}, nil
		case 1:
			t := exact[0]
			return locateResult{query: codegraph.Query{
				Path: t.Path, Byte: -1,
				Point: &codegraph.Point{Row: t.NameSpan.Start.Row, Column: t.NameSpan.Start.Column},
			}}, nil
		default:
			return locateResult{ambiguous: exact}, nil
		}

	default:
		return locateResult{msg: "one of file or symbol is required (file with line or symbol; or symbol alone)"}, nil
	}
}

// defaultSymbolLocateLimit bounds rule 4's own disambiguation search — enough to show a caller
// every real candidate in practice without an unbounded scan; codegraph's own SearchSymbols clamps
// again regardless (§6.2).
const defaultSymbolLocateLimit = 50
