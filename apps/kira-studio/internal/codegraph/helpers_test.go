package codegraph

import (
	"context"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codeindex"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codeparse"
)

// testRepo is every test's own repo_id — one Store per test (t.TempDir()), so it never needs to
// vary.
const testRepo = "test-repo"

// newTestGraph opens a fresh codeindex.Store under t.TempDir() and returns a Graph over it,
// scoped to testRepo — every test in this package seeds through ReplaceFile, never through git or
// a real parse (§11's own stated shape).
func newTestGraph(t *testing.T) (*Graph, *codeindex.Store) {
	t.Helper()
	store := codeindex.OpenStoreAt(t.TempDir())
	t.Cleanup(func() { _ = store.Close() })
	return New(store, testRepo), store
}

// seedFile writes one file's worth of symbols/references/blocks under path/lang, returning its
// codeindex.FileRow.
func seedFile(t *testing.T, store *codeindex.Store, path, lang string, blocks []codeparse.Block, syms []codeparse.Symbol, refs []codeparse.Reference) codeindex.FileRow {
	t.Helper()
	ctx := context.Background()
	if err := store.ReplaceFile(ctx, codeindex.FileWrite{
		RepoID: testRepo, Path: path, Language: lang,
		ParseStatus: codeindex.StatusOK, ParsedAt: time.Now().UnixMilli(),
		ContentSHA: make([]byte, 32),
		Blocks:     blocks, Symbols: syms, References: refs,
	}); err != nil {
		t.Fatalf("seed file %s: %v", path, err)
	}
	file, ok, err := store.GetFile(ctx, testRepo, path)
	if err != nil || !ok {
		t.Fatalf("get seeded file %s: ok=%v err=%v", path, ok, err)
	}
	return file
}

// sym is a small constructor for a single-line codeparse.Symbol: name occupies
// [nameCol, nameCol+len(name)) on row, the whole definition spans [startCol, endCol) on the same
// row. Every fixture in this package is single-line by construction — multi-line containment
// (parent linking) is exercised through ParentIndex directly, not through real row/column nesting.
func sym(kind, name string, row, startCol, endCol, nameCol int, parent int) codeparse.Symbol {
	nameEnd := nameCol + len(name)
	return codeparse.Symbol{
		Kind: kind, Name: name,
		StartByte: startCol, EndByte: endCol,
		StartPoint:    codeparse.Point{Row: row, Column: startCol},
		EndPoint:      codeparse.Point{Row: row, Column: endCol},
		NameStartByte: nameCol, NameEndByte: nameEnd,
		NameStart:   codeparse.Point{Row: row, Column: nameCol},
		ParentIndex: parent,
		BlockIndex:  -1,
	}
}

// ref is sym's own counterpart for a codeparse.Reference: the reference node spans
// [startCol, endCol) on row, its own name spans [nameCol, nameCol+len(name)).
func ref(kind, name string, row, startCol, endCol, nameCol int) codeparse.Reference {
	nameEnd := nameCol + len(name)
	return codeparse.Reference{
		Kind: kind, Name: name,
		StartByte: startCol, EndByte: endCol,
		StartPoint:    codeparse.Point{Row: row, Column: startCol},
		NameStartByte: nameCol, NameEndByte: nameEnd,
		NameStart:  codeparse.Point{Row: row, Column: nameCol},
		BlockIndex: -1,
	}
}
