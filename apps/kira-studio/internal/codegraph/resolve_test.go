package codegraph

import (
	"context"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codeindex"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codeparse"
)

func bareSite(file codeindex.FileRow, kind string) resolveSite {
	return resolveSite{File: file, Kind: kind, StartByte: -1, EndByte: -1, NameStartByte: -1, NameEnd: -1}
}

func TestResolverTierSelection(t *testing.T) {
	g, store := newTestGraph(t)
	ctx := context.Background()

	fileA := seedFile(t, store, "a/main.go", "go", nil, nil, nil)
	seedFile(t, store, "c/other.go", "go", nil, []codeparse.Symbol{
		sym("type", "Widget", 0, 0, 20, 5, -1),
	}, nil)

	site := bareSite(fileA, "type")

	t.Run("only a repository-wide candidate: tier 2", func(t *testing.T) {
		cands, conf, err := g.resolveName(ctx, "Widget", nil, site)
		if err != nil {
			t.Fatal(err)
		}
		if len(cands) != 1 || cands[0].tier != 2 || cands[0].rule != "repoWide" {
			t.Fatalf("want one tier-2 repoWide candidate, got %+v", cands)
		}
		if conf != RepoWide {
			t.Fatalf("want RepoWide, got %s", conf)
		}
	})

	seedFile(t, store, "a/sibling.go", "go", nil, []codeparse.Symbol{
		sym("type", "Widget", 0, 0, 20, 5, -1),
	}, nil)

	t.Run("a same-directory candidate wins over the repo-wide one: tier 1", func(t *testing.T) {
		cands, conf, err := g.resolveName(ctx, "Widget", nil, site)
		if err != nil {
			t.Fatal(err)
		}
		if len(cands) != 1 || cands[0].tier != 1 || cands[0].rule != "sameDirectory" || cands[0].file.Path != "a/sibling.go" {
			t.Fatalf("want one tier-1 sameDirectory candidate from a/sibling.go, got %+v", cands)
		}
		if conf != Exact {
			t.Fatalf("want Exact (single tier-1 candidate), got %s", conf)
		}
	})

	fileA = seedFile(t, store, "a/main.go", "go", nil, []codeparse.Symbol{
		sym("type", "Widget", 0, 0, 20, 5, -1),
	}, nil)
	site = bareSite(fileA, "type")

	t.Run("a same-file candidate wins over both: tier 0", func(t *testing.T) {
		cands, conf, err := g.resolveName(ctx, "Widget", nil, site)
		if err != nil {
			t.Fatal(err)
		}
		if len(cands) != 1 || cands[0].tier != 0 || cands[0].rule != "sameFile.other" {
			t.Fatalf("want one tier-0 sameFile.other candidate, got %+v", cands)
		}
		if conf != Exact {
			t.Fatalf("want Exact, got %s", conf)
		}
	})

	t.Run("several same-tier candidates: Scoped", func(t *testing.T) {
		// Two tier-1 (same-directory) candidates, no tier-0 one this time.
		fileB := seedFile(t, store, "b/main.go", "go", nil, nil, nil)
		seedFile(t, store, "b/one.go", "go", nil, []codeparse.Symbol{
			sym("type", "Gadget", 0, 0, 20, 5, -1),
		}, nil)
		seedFile(t, store, "b/two.go", "go", nil, []codeparse.Symbol{
			sym("type", "Gadget", 0, 0, 20, 5, -1),
		}, nil)
		cands, conf, err := g.resolveName(ctx, "Gadget", nil, bareSite(fileB, "type"))
		if err != nil {
			t.Fatal(err)
		}
		if len(cands) != 2 {
			t.Fatalf("want 2 tier-1 candidates, got %+v", cands)
		}
		if conf != Scoped {
			t.Fatalf("want Scoped, got %s", conf)
		}
	})
}

func TestResolverSameFileOrder(t *testing.T) {
	g, store := newTestGraph(t)
	ctx := context.Background()

	t.Run("enclosing: a recursive call resolves to its own containing function", func(t *testing.T) {
		symbols := []codeparse.Symbol{
			sym("function", "Recurse", 0, 0, 200, 9, -1),
		}
		refs := []codeparse.Reference{
			ref("call", "Recurse", 0, 50, 60, 50),
		}
		file := seedFile(t, store, "recurse.go", "go", nil, symbols, refs)
		fileSymbols, err := store.SymbolsInFile(ctx, file.ID)
		if err != nil {
			t.Fatal(err)
		}
		site := resolveSite{File: file, Kind: "call", StartByte: 50, EndByte: 60, NameStartByte: 50, NameEnd: 57}
		cands, _, err := g.resolveName(ctx, "Recurse", fileSymbols, site)
		if err != nil {
			t.Fatal(err)
		}
		if len(cands) != 1 || cands[0].rule != "sameFile.enclosing" {
			t.Fatalf("want sameFile.enclosing, got %+v", cands)
		}
	})

	t.Run("sibling: a call to another method of the same class ranks as a sibling", func(t *testing.T) {
		symbols := []codeparse.Symbol{
			sym("class", "Container", 0, 0, 300, 6, -1),
			sym("method", "First", 0, 20, 150, 24, 0),
			sym("method", "Second", 0, 160, 290, 166, 0),
		}
		refs := []codeparse.Reference{
			ref("call", "Second", 0, 60, 70, 60), // inside First's own span [20,150)
		}
		file := seedFile(t, store, "svc.go", "go", nil, symbols, refs)
		fileSymbols, err := store.SymbolsInFile(ctx, file.ID)
		if err != nil {
			t.Fatal(err)
		}
		site := resolveSite{File: file, Kind: "call", StartByte: 60, EndByte: 70, NameStartByte: 60, NameEnd: 66}
		cands, _, err := g.resolveName(ctx, "Second", fileSymbols, site)
		if err != nil {
			t.Fatal(err)
		}
		if len(cands) != 1 || cands[0].rule != "sameFile.sibling" {
			t.Fatalf("want sameFile.sibling, got %+v", cands)
		}
	})

	t.Run("other: an unrelated same-file candidate ranks last of the three", func(t *testing.T) {
		symbols := []codeparse.Symbol{
			sym("function", "FuncA", 0, 0, 50, 9, -1),
			sym("function", "FuncB", 0, 60, 150, 69, -1),
			sym("function", "Helper", 0, 70, 90, 77, 1), // nested inside FuncB
		}
		refs := []codeparse.Reference{
			ref("call", "Helper", 0, 10, 20, 10), // inside FuncA's own span [0,50)
		}
		file := seedFile(t, store, "mixed.go", "go", nil, symbols, refs)
		fileSymbols, err := store.SymbolsInFile(ctx, file.ID)
		if err != nil {
			t.Fatal(err)
		}
		site := resolveSite{File: file, Kind: "call", StartByte: 10, EndByte: 20, NameStartByte: 10, NameEnd: 16}
		cands, _, err := g.resolveName(ctx, "Helper", fileSymbols, site)
		if err != nil {
			t.Fatal(err)
		}
		if len(cands) != 1 || cands[0].rule != "sameFile.other" {
			t.Fatalf("want sameFile.other, got %+v", cands)
		}
	})
}

func TestResolverGoUnexportedNeverReachesTier2(t *testing.T) {
	g, store := newTestGraph(t)
	ctx := context.Background()

	fileA := seedFile(t, store, "pkg/a/main.go", "go", nil, nil, nil)
	seedFile(t, store, "pkg/c/other.go", "go", nil, []codeparse.Symbol{
		sym("function", "helper", 0, 0, 20, 5, -1),
	}, nil)

	t.Run("no same-directory candidate: no result at all, not a repo-wide guess", func(t *testing.T) {
		cands, conf, err := g.resolveName(ctx, "helper", nil, bareSite(fileA, "call"))
		if err != nil {
			t.Fatal(err)
		}
		if len(cands) != 0 || conf != "" {
			t.Fatalf("want no result, got %+v / %s", cands, conf)
		}
	})

	seedFile(t, store, "pkg/a/sibling.go", "go", nil, []codeparse.Symbol{
		sym("function", "helper", 0, 0, 20, 5, -1),
	}, nil)

	t.Run("a same-directory candidate still resolves", func(t *testing.T) {
		cands, conf, err := g.resolveName(ctx, "helper", nil, bareSite(fileA, "call"))
		if err != nil {
			t.Fatal(err)
		}
		if len(cands) != 1 || cands[0].file.Path != "pkg/a/sibling.go" {
			t.Fatalf("want pkg/a/sibling.go's helper, got %+v", cands)
		}
		if conf != Exact {
			t.Fatalf("want Exact, got %s", conf)
		}
	})

	t.Run("an exported name still reaches tier 2", func(t *testing.T) {
		fileB := seedFile(t, store, "pkg/b/main.go", "go", nil, nil, nil)
		seedFile(t, store, "pkg/z/other.go", "go", nil, []codeparse.Symbol{
			sym("function", "Helper", 0, 0, 20, 5, -1),
		}, nil)
		cands, conf, err := g.resolveName(ctx, "Helper", nil, bareSite(fileB, "call"))
		if err != nil {
			t.Fatal(err)
		}
		if len(cands) != 1 || cands[0].tier != 2 {
			t.Fatalf("want one tier-2 candidate for an exported name, got %+v", cands)
		}
		if conf != RepoWide {
			t.Fatalf("want RepoWide, got %s", conf)
		}
	})
}

func TestResolverJavaBasenameRule(t *testing.T) {
	g, store := newTestGraph(t)
	ctx := context.Background()

	fileRef := seedFile(t, store, "src/caller/Main.java", "java", nil, nil, nil)
	// "Other.java" sorts before "pkg2/Foo.java" alphabetically, so without the basename rule the
	// generic path tiebreak (rule 6) would pick Other.java first.
	seedFile(t, store, "pkg1/Other.java", "java", nil, []codeparse.Symbol{
		sym("class", "Foo", 0, 0, 20, 6, -1),
	}, nil)
	seedFile(t, store, "pkg2/Foo.java", "java", nil, []codeparse.Symbol{
		sym("class", "Foo", 0, 0, 20, 6, -1),
	}, nil)

	cands, _, err := g.resolveName(ctx, "Foo", nil, bareSite(fileRef, "type"))
	if err != nil {
		t.Fatal(err)
	}
	if len(cands) != 2 || cands[0].file.Path != "pkg2/Foo.java" {
		t.Fatalf("want Foo.java ranked first, got %+v", cands)
	}
}

func TestResolverJSBasenameRule(t *testing.T) {
	g, store := newTestGraph(t)
	ctx := context.Background()

	fileRef := seedFile(t, store, "src/caller.ts", "typescript", nil, nil, nil)
	seedFile(t, store, "src/utils/aaa.ts", "typescript", nil, []codeparse.Symbol{
		sym("function", "Button", 0, 0, 20, 9, -1),
	}, nil)
	seedFile(t, store, "src/components/Button.tsx", "tsx", nil, []codeparse.Symbol{
		sym("function", "Button", 0, 0, 20, 9, -1),
	}, nil)

	cands, _, err := g.resolveName(ctx, "Button", nil, bareSite(fileRef, "call"))
	if err != nil {
		t.Fatal(err)
	}
	if len(cands) != 2 || cands[0].file.Path != "src/components/Button.tsx" {
		t.Fatalf("want Button.tsx ranked first (default-export convention), got %+v", cands)
	}

	t.Run("index is excluded from the basename bonus", func(t *testing.T) {
		seedFile(t, store, "src/widgets/index.ts", "typescript", nil, []codeparse.Symbol{
			sym("function", "Panel", 0, 0, 20, 9, -1),
		}, nil)
		seedFile(t, store, "src/widgets/aaa-other.ts", "typescript", nil, []codeparse.Symbol{
			sym("function", "Panel", 0, 0, 20, 9, -1),
		}, nil)
		cands, _, err := g.resolveName(ctx, "Panel", nil, bareSite(fileRef, "call"))
		if err != nil {
			t.Fatal(err)
		}
		// Neither gets the basename bonus, so the generic path tiebreak (rule 6) decides —
		// "aaa-other.ts" sorts before "index.ts".
		if len(cands) != 2 || cands[0].file.Path != "src/widgets/aaa-other.ts" {
			t.Fatalf("want the path tiebreak, not index's own basename, got %+v", cands)
		}
	})
}

// TestResolverSameLanguageFamilyRule is P64 §2.4/§8.2: a TreeNode-shaped fixture — a Go struct and
// a TypeScript type alias share one name, and the Go file's own path shares a longer prefix with
// the referring TypeScript file than the TypeScript candidate's own path does. Without the
// language-family tiebreak, commonPrefixLen (rule 6) would rank the Go struct first purely on
// directory accident; the fix ranks the same-family (TypeScript) candidate first instead, while
// still returning both — a demotion, never a filter.
func TestResolverSameLanguageFamilyRule(t *testing.T) {
	g, store := newTestGraph(t)
	ctx := context.Background()

	fileRef := seedFile(t, store, "src/frontend/caller.ts", "typescript", nil, nil, nil)
	seedFile(t, store, "src/frontend/model/tree.go", "go", nil, []codeparse.Symbol{
		sym("type", "TreeNode", 0, 0, 20, 5, -1),
	}, nil)
	seedFile(t, store, "domain/tree.ts", "typescript", nil, []codeparse.Symbol{
		sym("type", "TreeNode", 0, 0, 20, 5, -1),
	}, nil)

	cands, _, err := g.resolveName(ctx, "TreeNode", nil, bareSite(fileRef, "type"))
	if err != nil {
		t.Fatal(err)
	}
	if len(cands) != 2 {
		t.Fatalf("want both candidates returned (a demotion, not a filter), got %+v", cands)
	}
	if cands[0].file.Path != "domain/tree.ts" {
		t.Fatalf("want the same-family TypeScript candidate ranked first despite the Go file's longer path prefix, got %+v", cands)
	}
	if cands[1].file.Path != "src/frontend/model/tree.go" {
		t.Fatalf("want the Go candidate still present, second, got %+v", cands)
	}
}

func TestResolverKindDemotion(t *testing.T) {
	g, store := newTestGraph(t)
	ctx := context.Background()

	fileRef := seedFile(t, store, "caller.go", "go", nil, nil, nil)
	// "aaa" sorts before "zzz" alphabetically — without kind compatibility ranking first, the
	// generic path tiebreak would put the incompatible "type" candidate ahead of the compatible
	// "function" one.
	seedFile(t, store, "aaa/thing.go", "go", nil, []codeparse.Symbol{
		sym("type", "Widget", 0, 0, 20, 5, -1),
	}, nil)
	seedFile(t, store, "zzz/thing.go", "go", nil, []codeparse.Symbol{
		sym("function", "Widget", 0, 0, 20, 9, -1),
	}, nil)

	cands, _, err := g.resolveName(ctx, "Widget", nil, bareSite(fileRef, "call"))
	if err != nil {
		t.Fatal(err)
	}
	if len(cands) != 2 || cands[0].sym.Kind != "function" {
		t.Fatalf("want the call-compatible function ranked first, got %+v", cands)
	}
}

func TestResolverTestFileTiebreak(t *testing.T) {
	g, store := newTestGraph(t)
	ctx := context.Background()

	fileRef := seedFile(t, store, "aaa/caller.go", "go", nil, nil, nil)
	seedFile(t, store, "aaa/helper_test.go", "go", nil, []codeparse.Symbol{
		sym("function", "Support", 0, 0, 20, 9, -1),
	}, nil)
	seedFile(t, store, "aaa/helper.go", "go", nil, []codeparse.Symbol{
		sym("function", "Support", 0, 0, 20, 9, -1),
	}, nil)

	cands, _, err := g.resolveName(ctx, "Support", nil, bareSite(fileRef, "call"))
	if err != nil {
		t.Fatal(err)
	}
	if len(cands) != 2 || cands[0].file.Path != "aaa/helper.go" {
		t.Fatalf("want the non-test file ranked first, got %+v", cands)
	}
}

func TestResolverHasErrorTiebreak(t *testing.T) {
	g, store := newTestGraph(t)
	ctx := context.Background()

	fileRef := seedFile(t, store, "aaa/caller.go", "go", nil, nil, nil)

	seed := func(path string, hasError bool) {
		if err := store.ReplaceFile(ctx, codeindex.FileWrite{
			RepoID: testRepo, Path: path, Language: "go",
			ParseStatus: codeindex.StatusOK, ParsedAt: time.Now().UnixMilli(),
			ContentSHA: make([]byte, 32), HasError: hasError,
			Symbols: []codeparse.Symbol{sym("function", "Broken", 0, 0, 20, 9, -1)},
		}); err != nil {
			t.Fatalf("seed %s: %v", path, err)
		}
	}
	seed("aaa/bad.go", true)
	seed("aaa/good.go", false)

	cands, _, err := g.resolveName(ctx, "Broken", nil, bareSite(fileRef, "call"))
	if err != nil {
		t.Fatal(err)
	}
	if len(cands) != 2 || cands[0].file.Path != "aaa/good.go" {
		t.Fatalf("want the error-free file ranked first, got %+v", cands)
	}
}

func TestResolverSelfReferenceDrop(t *testing.T) {
	g, store := newTestGraph(t)
	ctx := context.Background()

	// Go's own (type_identifier) @name @reference.type makes a type definition's own name also a
	// reference to itself — dropped, or `type Person struct{}` would resolve to itself.
	symbols := []codeparse.Symbol{
		sym("type", "Person", 0, 0, 20, 5, -1),
	}
	refs := []codeparse.Reference{
		ref("type", "Person", 0, 5, 11, 5), // same name span as the definition's own [5,11)
	}
	file := seedFile(t, store, "person.go", "go", nil, symbols, refs)
	fileSymbols, err := store.SymbolsInFile(ctx, file.ID)
	if err != nil {
		t.Fatal(err)
	}
	site := resolveSite{File: file, Kind: "type", StartByte: 5, EndByte: 11, NameStartByte: 5, NameEnd: 11}
	cands, conf, err := g.resolveName(ctx, "Person", fileSymbols, site)
	if err != nil {
		t.Fatal(err)
	}
	if len(cands) != 0 || conf != "" {
		t.Fatalf("want the self-reference dropped (no result), got %+v / %s", cands, conf)
	}
}

func TestResolverDeterministic(t *testing.T) {
	fileRow := codeindex.FileRow{ID: 1, Path: "x.go", Language: "go"}
	base := codeindex.SymbolRow{FileID: 1, Kind: "function", Name: "Dup"}

	a := base
	a.ID, a.StartByte, a.EndByte = 1, 10, 20
	b := base
	b.ID, b.StartByte, b.EndByte = 2, 30, 40

	forward := []candidate{{sym: a, file: fileRow}, {sym: b, file: fileRow}}
	backward := []candidate{{sym: b, file: fileRow}, {sym: a, file: fileRow}}

	sortCandidates(forward, "call", "go", "x.go")
	sortCandidates(backward, "call", "go", "x.go")

	if len(forward) != 2 || len(backward) != 2 {
		t.Fatalf("unexpected lengths: %d %d", len(forward), len(backward))
	}
	if forward[0].sym.ID != backward[0].sym.ID || forward[1].sym.ID != backward[1].sym.ID {
		t.Fatalf("sort order depends on input order: forward=%+v backward=%+v", forward, backward)
	}
	if forward[0].sym.ID != a.ID {
		t.Fatalf("want the lower start_byte first (id %d), got id %d", a.ID, forward[0].sym.ID)
	}
}
