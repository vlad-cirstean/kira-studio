package repomap

import (
	"context"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codegraph"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codeindex"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codeparse"
)

const testRepoID = "test-repo"
const testRoot = "/repo"

func newTestGraph(t *testing.T) (*codegraph.Graph, *codeindex.Store) {
	t.Helper()
	store := codeindex.OpenStoreAt(t.TempDir())
	t.Cleanup(func() { _ = store.Close() })
	return codegraph.New(store, testRepoID), store
}

func seed(t *testing.T, store *codeindex.Store, path string, syms []codeparse.Symbol) {
	t.Helper()
	if err := store.ReplaceFile(context.Background(), codeindex.FileWrite{
		RepoID: testRepoID, Path: path, Language: "go",
		ParseStatus: codeindex.StatusOK, ParsedAt: time.Now().UnixMilli(),
		ContentSHA: make([]byte, 32), Symbols: syms,
	}); err != nil {
		t.Fatalf("seed %s: %v", path, err)
	}
}

func mkSym(kind, name string, row, startCol, endCol, nameCol int) codeparse.Symbol {
	return codeparse.Symbol{
		Kind: kind, Name: name,
		StartByte: startCol, EndByte: endCol,
		StartPoint:    codeparse.Point{Row: row, Column: startCol},
		EndPoint:      codeparse.Point{Row: row, Column: endCol},
		NameStartByte: nameCol, NameEndByte: nameCol + len(name),
		NameStart:   codeparse.Point{Row: row, Column: nameCol},
		ParentIndex: -1,
		BlockIndex:  -1,
	}
}

func TestLocateFileAbsoluteMadeRelative(t *testing.T) {
	g, store := newTestGraph(t)
	seed(t, store, "pkg/file.go", []codeparse.Symbol{mkSym("function", "Foo", 4, 0, 20, 5)})

	res, err := locate(context.Background(), g, testRoot, locateArgs{File: testRoot + "/pkg/file.go", Line: 5})
	if err != nil {
		t.Fatalf("locate: %v", err)
	}
	if res.msg != "" {
		t.Fatalf("unexpected error: %s", res.msg)
	}
	if res.query.Path != "pkg/file.go" {
		t.Fatalf("Path = %q, want pkg/file.go", res.query.Path)
	}
}

func TestLocateFileOutsideRepoErrors(t *testing.T) {
	g, _ := newTestGraph(t)
	res, err := locate(context.Background(), g, testRoot, locateArgs{File: "/elsewhere/file.go", Line: 1})
	if err != nil {
		t.Fatalf("locate: %v", err)
	}
	if res.msg == "" {
		t.Fatal("expected an error message for a file outside the repository")
	}
}

func TestLocateFileLineColumnConversion(t *testing.T) {
	g, _ := newTestGraph(t)
	res, err := locate(context.Background(), g, testRoot, locateArgs{File: "pkg/file.go", Line: 5, Column: 3})
	if err != nil {
		t.Fatalf("locate: %v", err)
	}
	if res.query.Point == nil {
		t.Fatal("expected a Point")
	}
	if res.query.Point.Row != 4 || res.query.Point.Column != 2 {
		t.Fatalf("Point = %+v, want Row=4 Column=2 (1-based -> 0-based)", res.query.Point)
	}
}

func TestLocateFileLineNoColumnDefaultsToOne(t *testing.T) {
	g, _ := newTestGraph(t)
	res, err := locate(context.Background(), g, testRoot, locateArgs{File: "pkg/file.go", Line: 5})
	if err != nil {
		t.Fatalf("locate: %v", err)
	}
	if res.query.Point.Column != 0 {
		t.Fatalf("Column = %d, want 0 (column defaults to 1, 1-based -> 0)", res.query.Point.Column)
	}
}

func TestLocateFileWithSymbolHint(t *testing.T) {
	g, _ := newTestGraph(t)
	res, err := locate(context.Background(), g, testRoot, locateArgs{File: "pkg/file.go", Symbol: "Foo"})
	if err != nil {
		t.Fatalf("locate: %v", err)
	}
	if res.query.Name != "Foo" || res.query.Point != nil {
		t.Fatalf("query = %+v, want Name=Foo with no Point", res.query)
	}
}

func TestLocateFileWithNeitherLineNorSymbol(t *testing.T) {
	g, _ := newTestGraph(t)
	res, err := locate(context.Background(), g, testRoot, locateArgs{File: "pkg/file.go"})
	if err != nil {
		t.Fatalf("locate: %v", err)
	}
	if res.msg == "" {
		t.Fatal("expected an error for file given with neither line nor symbol")
	}
}

func TestLocateSymbolAloneExactlyOneHit(t *testing.T) {
	g, store := newTestGraph(t)
	seed(t, store, "pkg/file.go", []codeparse.Symbol{mkSym("function", "UniqueName", 9, 0, 30, 9)})

	res, err := locate(context.Background(), g, testRoot, locateArgs{Symbol: "UniqueName"})
	if err != nil {
		t.Fatalf("locate: %v", err)
	}
	if res.msg != "" || res.ambiguous != nil || res.empty {
		t.Fatalf("unexpected result: %+v", res)
	}
	if res.query.Path != "pkg/file.go" {
		t.Fatalf("Path = %q, want pkg/file.go", res.query.Path)
	}
	if res.query.Point == nil || res.query.Point.Row != 9 {
		t.Fatalf("Point = %+v, want Row=9", res.query.Point)
	}
}

func TestLocateSymbolAloneSeveralHitsReturnsAmbiguous(t *testing.T) {
	g, store := newTestGraph(t)
	seed(t, store, "a.go", []codeparse.Symbol{mkSym("function", "Dup", 1, 0, 10, 9)})
	seed(t, store, "b.go", []codeparse.Symbol{mkSym("function", "Dup", 2, 0, 10, 9)})

	res, err := locate(context.Background(), g, testRoot, locateArgs{Symbol: "Dup"})
	if err != nil {
		t.Fatalf("locate: %v", err)
	}
	if len(res.ambiguous) != 2 {
		t.Fatalf("ambiguous = %d candidates, want 2", len(res.ambiguous))
	}
}

func TestLocateSymbolAloneNoHitsIsEmpty(t *testing.T) {
	g, _ := newTestGraph(t)
	res, err := locate(context.Background(), g, testRoot, locateArgs{Symbol: "NoSuchSymbol"})
	if err != nil {
		t.Fatalf("locate: %v", err)
	}
	if !res.empty {
		t.Fatalf("expected empty result, got %+v", res)
	}
}

func TestLocateNeitherFileNorSymbolErrors(t *testing.T) {
	g, _ := newTestGraph(t)
	res, err := locate(context.Background(), g, testRoot, locateArgs{})
	if err != nil {
		t.Fatalf("locate: %v", err)
	}
	if res.msg == "" {
		t.Fatal("expected an error naming both file and symbol as missing")
	}
}
