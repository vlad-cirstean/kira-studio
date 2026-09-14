package codegraph

import (
	"context"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codeindex"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codeparse"
)

// row builds a ReferenceRow directly (bypassing codeparse.Reference/the store round trip) for the
// pure resolveHit boundary tests below — fast, exhaustive, no I/O. position_test.go's own
// TestLocateThroughStore below covers the same resolveHit path end to end through a real Store,
// including a block-scoped symbol and the template name-hint fallback.
func refRow(name string, startByte, endByte, nameStartByte, nameEndByte int) codeindex.ReferenceRow {
	return codeindex.ReferenceRow{
		Kind: "call", Name: name,
		StartByte: startByte, EndByte: endByte, StartRow: 0, StartColumn: startByte,
		NameStartByte: nameStartByte, NameEndByte: nameEndByte,
		NameStartRow: 0, NameStartColumn: nameStartByte,
	}
}

func TestResolveHitReferences(t *testing.T) {
	t.Run("name span preferred over an unrelated wider node span", func(t *testing.T) {
		outer := refRow("outer", 0, 20, 0, 5)    // node [0,20), name [0,5)
		inner := refRow("target", 6, 19, 12, 18) // node [6,19), name [12,18)
		hit := resolveHit(Query{Byte: 13}, nil, []codeindex.ReferenceRow{outer, inner})
		if !hit.Ok || hit.Ref == nil || hit.Ref.Name != "target" {
			t.Fatalf("want target (name-span hit), got %+v", hit)
		}
	})

	t.Run("node span containment when the byte falls before the name (Java/JS member call)", func(t *testing.T) {
		call := refRow("parse", 0, 15, 4, 9) // "obj.parse(x)": node [0,15), name [4,9)
		hit := resolveHit(Query{Byte: 1}, nil, []codeindex.ReferenceRow{call})
		if !hit.Ok || hit.Ref == nil || hit.Ref.Name != "parse" {
			t.Fatalf("want parse (node-span fallback), got %+v", hit)
		}
	})

	t.Run("innermost of two nesting node spans wins", func(t *testing.T) {
		outer := refRow("wrapper", 0, 30, 25, 29)
		inner := refRow("inner", 5, 20, 15, 19)
		hit := resolveHit(Query{Byte: 10}, nil, []codeindex.ReferenceRow{outer, inner})
		if !hit.Ok || hit.Ref == nil || hit.Ref.Name != "inner" {
			t.Fatalf("want inner (innermost node span), got %+v", hit)
		}
	})

	t.Run("boundaries: start_byte included, end_byte excluded", func(t *testing.T) {
		first := refRow("first", 10, 20, 10, 15)
		second := refRow("second", 20, 30, 20, 25)
		refs := []codeindex.ReferenceRow{first, second}

		if hit := resolveHit(Query{Byte: 10}, nil, refs); !hit.Ok || hit.Ref.Name != "first" {
			t.Fatalf("byte==start_byte: want first, got %+v", hit)
		}
		if hit := resolveHit(Query{Byte: 19}, nil, refs); !hit.Ok || hit.Ref.Name != "first" {
			t.Fatalf("byte==end_byte-1: want first, got %+v", hit)
		}
		if hit := resolveHit(Query{Byte: 20}, nil, refs); !hit.Ok || hit.Ref.Name != "second" {
			t.Fatalf("byte==end_byte of first (excluded), start_byte of second (included): want second, got %+v", hit)
		}
	})

	t.Run("no match and no Name falls through to nothing", func(t *testing.T) {
		refs := []codeindex.ReferenceRow{refRow("first", 10, 20, 10, 15)}
		if hit := resolveHit(Query{Byte: 999}, nil, refs); hit.Ok {
			t.Fatalf("want no hit, got %+v", hit)
		}
	})

	t.Run("no match falls through to the Query.Name hint", func(t *testing.T) {
		refs := []codeindex.ReferenceRow{refRow("first", 10, 20, 10, 15)}
		hit := resolveHit(Query{Byte: 999, Name: "count"}, nil, refs)
		if !hit.Ok || hit.Name != "count" || hit.Ref != nil || hit.Sym != nil {
			t.Fatalf("want a bare name hint, got %+v", hit)
		}
	})
}

// TestResolveHitSymbolWinsOverColocatedReference guards the dogfooding-log bug (C7): Go's tags.scm
// double-captures a type declaration's own name node — `type_spec name: (type_identifier)
// @definition.type` alongside the blanket `(type_identifier) @name @reference.type` — so a real
// symbol row and a spurious self-referencing reference row end up at the identical name span (see
// isSelfSite's own doc comment in references.go, which names this exact quirk). A Point or Byte
// landing on that shared span must resolve to the symbol, not the reference: a symbol row only
// ever exists at a genuine declaration site, so it's always the more specific hit.
func TestResolveHitSymbolWinsOverColocatedReference(t *testing.T) {
	// "type grpcCoalescer struct{...}": the type's own name spans bytes [5,18) on row 0 — both a
	// definition.type symbol row and a spurious reference.type reference row.
	symRow := codeindex.SymbolRow{
		Kind: "type", Name: "grpcCoalescer",
		StartByte: 0, EndByte: 30, StartRow: 0, StartColumn: 0, EndRow: 0, EndColumn: 30,
		NameStartByte: 5, NameEndByte: 18, NameStartRow: 0, NameStartColumn: 5,
	}
	selfRef := codeindex.ReferenceRow{
		Kind: "type", Name: "grpcCoalescer",
		StartByte: 5, EndByte: 18, StartRow: 0, StartColumn: 5,
		NameStartByte: 5, NameEndByte: 18, NameStartRow: 0, NameStartColumn: 5,
	}
	symbols := []codeindex.SymbolRow{symRow}
	references := []codeindex.ReferenceRow{selfRef}

	t.Run("Point query on the shared name span", func(t *testing.T) {
		hit := resolveHit(Query{Point: &Point{Row: 0, Column: 8}}, symbols, references)
		if !hit.Ok || hit.Sym == nil || hit.Ref != nil {
			t.Fatalf("want a symbol hit (not a reference hit), got %+v", hit)
		}
		if hit.Sym.Name != "grpcCoalescer" {
			t.Fatalf("Sym.Name = %q, want grpcCoalescer", hit.Sym.Name)
		}
	})

	t.Run("Byte query on the shared name span", func(t *testing.T) {
		hit := resolveHit(Query{Byte: 8}, symbols, references)
		if !hit.Ok || hit.Sym == nil || hit.Ref != nil {
			t.Fatalf("want a symbol hit (not a reference hit), got %+v", hit)
		}
		if hit.Sym.Name != "grpcCoalescer" {
			t.Fatalf("Sym.Name = %q, want grpcCoalescer", hit.Sym.Name)
		}
	})
}

// TestDefinitionOfGoTypeSelfCapture is the same bug one layer up: DefinitionOf on a Point sitting
// exactly on a Go type's own declaration name must resolve to that type itself (rule "self"), not
// zero targets — the shape find_definition hits when called with only {"symbol": "<a Go type>"}
// (repomap's locate() builds exactly such a Point from search_symbols' own NameSpan).
func TestDefinitionOfGoTypeSelfCapture(t *testing.T) {
	g, store := newTestGraph(t)
	ctx := context.Background()

	// "type grpcCoalescer struct{...}" at row 0: symbol name spans bytes [5,18); tags.scm's own
	// blanket @reference.type capture also emits a reference row at the identical span.
	symbols := []codeparse.Symbol{
		sym("type", "grpcCoalescer", 0, 0, 30, 5, -1),
	}
	references := []codeparse.Reference{
		ref("type", "grpcCoalescer", 0, 5, 18, 5),
	}
	file := seedFile(t, store, "grpc.go", "go", nil, symbols, references)

	q := Query{Path: file.Path, Byte: -1, Point: &Point{Row: 0, Column: 8}}
	targets, err := g.DefinitionOf(ctx, q)
	if err != nil {
		t.Fatalf("DefinitionOf: %v", err)
	}
	if len(targets) != 1 {
		t.Fatalf("want exactly one target, got %d: %+v", len(targets), targets)
	}
	if targets[0].Name != "grpcCoalescer" || targets[0].Rule != "self" {
		t.Fatalf("want self-rule hit on grpcCoalescer, got %+v", targets[0])
	}
}

// TestLocateThroughStore exercises the same resolveHit path end to end through a real
// codeindex.Store (§11's own seeding convention): one file carrying a script-setup block's own
// symbol (Point lookup into a block-scoped definition) and a template region with no rows at all
// (falling through to the name hint, §7).
func TestLocateThroughStore(t *testing.T) {
	g, store := newTestGraph(t)
	ctx := context.Background()

	blocks := []codeparse.Block{
		{Kind: codeparse.BlockScriptSetup, Language: codeparse.TypeScript, StartByte: 0, EndByte: 40,
			StartPoint: codeparse.Point{Row: 0, Column: 0}},
	}
	// A script-setup `const count = ref(0)` — its own name "count" at row 0, columns 6-11.
	counter := codeparse.Symbol{
		Kind: "constant", Name: "count",
		StartByte: 0, EndByte: 20, StartPoint: codeparse.Point{Row: 0, Column: 0}, EndPoint: codeparse.Point{Row: 0, Column: 20},
		NameStartByte: 6, NameEndByte: 11, NameStart: codeparse.Point{Row: 0, Column: 6},
		ParentIndex: -1, BlockIndex: 0,
	}
	seedFile(t, store, "Counter.vue", "vue", blocks, []codeparse.Symbol{counter}, nil)

	file, symbols, references, err := g.loadFile(ctx, "Counter.vue")
	if err != nil {
		t.Fatalf("loadFile: %v", err)
	}
	if len(symbols) != 1 || symbols[0].BlockID == nil {
		t.Fatalf("want one block-scoped symbol, got %+v", symbols)
	}

	// Point lookup into the block-scoped symbol's own name span.
	hit := resolveHit(Query{Point: &Point{Row: 0, Column: 8}}, symbols, references)
	if !hit.Ok || hit.Sym == nil || hit.Sym.Name != "count" {
		t.Fatalf("want count (block-scoped symbol), got %+v", hit)
	}

	// A template-region position: no symbol/reference row exists for `{{ count }}` at all (§7 — no
	// vendored HTML/Vue query emits one), so resolution falls through to the caller's own
	// word-under-cursor Name.
	templateHit := resolveHit(Query{Point: &Point{Row: 5, Column: 3}, Name: "count"}, symbols, references)
	if !templateHit.Ok || templateHit.Name != "count" || templateHit.Ref != nil || templateHit.Sym != nil {
		t.Fatalf("want a bare name-hint fallback, got %+v", templateHit)
	}

	_ = file
}
