package codegraph

import (
	"context"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codeparse"
)

// TestGoMethodSetStructSatisfiesInterface covers §4.1's direct-method path (a "receiver" reference
// recovered by containment) and §4.2's ⊇ test on the straightforward case: every wanted method
// present, nothing embedded.
func TestGoMethodSetStructSatisfiesInterface(t *testing.T) {
	g, store := newTestGraph(t)
	ctx := context.Background()

	seedFile(t, store, "iface.go", "go", nil, []codeparse.Symbol{
		sym("type", "Reader", 0, 0, 100, 5, -1),
		sym("method", "Read", 0, 10, 30, 10, 0),
		sym("method", "Close", 0, 30, 50, 30, 0),
	}, nil)
	seedFile(t, store, "foo.go", "go", nil, []codeparse.Symbol{
		sym("type", "Foo", 0, 0, 10, 5, -1),
		sym("method", "Read", 0, 20, 40, 20, -1),
		sym("method", "Close", 0, 40, 60, 40, -1),
	}, []codeparse.Reference{
		ref("receiver", "Foo", 0, 20, 40, 20),
		ref("receiver", "Foo", 0, 40, 60, 40),
	})

	targets, err := g.goImplementationsOf(ctx, "Reader")
	if err != nil {
		t.Fatal(err)
	}
	if len(targets) != 1 || targets[0].Name != "Foo" || targets[0].Path != "foo.go" {
		t.Fatalf("want Foo recovered by method set, got %+v", targets)
	}
	if targets[0].Rule != "implementationsOf.goMethodSet" {
		t.Fatalf("want the unpromoted rule string, got %q", targets[0].Rule)
	}
	if targets[0].Confidence != Scoped {
		t.Fatalf("want Scoped confidence, got %q", targets[0].Confidence)
	}
}

// TestGoMethodSetMissingMethodExcluded covers §4.2's own point: the comparison is containment
// (⊇), not intersection — a type with only one of the two wanted methods is never returned.
func TestGoMethodSetMissingMethodExcluded(t *testing.T) {
	g, store := newTestGraph(t)
	ctx := context.Background()

	seedFile(t, store, "iface.go", "go", nil, []codeparse.Symbol{
		sym("type", "Reader", 0, 0, 100, 5, -1),
		sym("method", "Read", 0, 10, 30, 10, 0),
		sym("method", "Close", 0, 30, 50, 30, 0),
	}, nil)
	seedFile(t, store, "bar.go", "go", nil, []codeparse.Symbol{
		sym("type", "Bar", 0, 0, 10, 5, -1),
		sym("method", "Read", 0, 20, 40, 20, -1),
	}, []codeparse.Reference{
		ref("receiver", "Bar", 0, 20, 40, 20),
	})

	targets, err := g.goImplementationsOf(ctx, "Reader")
	if err != nil {
		t.Fatal(err)
	}
	if len(targets) != 0 {
		t.Fatalf("want Bar excluded (missing Close), got %+v", targets)
	}
}

// TestGoMethodSetPromotionThroughEmbeddedStruct covers §4.1 source 3 (promotion) and §4.3's
// ".promoted" rule suffix: Wrapper only declares Close itself, but embeds Base, which supplies
// Read.
//
// Wrapper's own method is named "Close" (not "Read") deliberately: Close and Read each have two
// symbol rows (one on the interface, one on the type that truly owns it), a tie rarestGoMethodName
// breaks alphabetically — "Close" first. Seeding must land on a name Wrapper declares directly,
// since seeding finds a candidate by its own literal method rows, never by a promoted one.
func TestGoMethodSetPromotionThroughEmbeddedStruct(t *testing.T) {
	g, store := newTestGraph(t)
	ctx := context.Background()

	seedFile(t, store, "iface.go", "go", nil, []codeparse.Symbol{
		sym("type", "Reader", 0, 0, 100, 5, -1),
		sym("method", "Close", 0, 10, 30, 10, 0),
		sym("method", "Read", 0, 30, 50, 30, 0),
	}, nil)
	seedFile(t, store, "base.go", "go", nil, []codeparse.Symbol{
		sym("type", "Base", 0, 0, 10, 5, -1),
		sym("method", "Read", 0, 20, 40, 20, -1),
	}, []codeparse.Reference{
		ref("receiver", "Base", 0, 20, 40, 20),
	})
	seedFile(t, store, "wrapper.go", "go", nil, []codeparse.Symbol{
		sym("type", "Wrapper", 0, 0, 100, 5, -1), // wide enough to contain the embed field below
		sym("method", "Close", 0, 200, 220, 200, -1),
	}, []codeparse.Reference{
		ref("embed", "Base", 0, 10, 30, 10), // within Wrapper's own span
		ref("receiver", "Wrapper", 0, 200, 220, 200),
	})

	targets, err := g.goImplementationsOf(ctx, "Reader")
	if err != nil {
		t.Fatal(err)
	}
	if len(targets) != 1 || targets[0].Name != "Wrapper" {
		t.Fatalf("want Wrapper recovered via embedding, got %+v", targets)
	}
	if targets[0].Rule != "implementationsOf.goMethodSet.promoted" {
		t.Fatalf("want the promoted rule string, got %q", targets[0].Rule)
	}
}

// TestGoMethodSetInterfaceEmbeddingPromotesWantSide covers §3.1's type_elem capture: B's own
// wanted set is assembled from its own method (Y) plus A's, promoted through the embed. The rule
// string's own ".promoted" suffix reports the *returned candidate's* own embedding use (§4.3),
// not the interface side's, so Concrete — which declares X and Y directly — still gets the plain
// rule; what this proves is that B's want set correctly includes X at all.

func TestGoMethodSetInterfaceEmbeddingPromotesWantSide(t *testing.T) {
	g, store := newTestGraph(t)
	ctx := context.Background()

	seedFile(t, store, "a.go", "go", nil, []codeparse.Symbol{
		sym("type", "A", 0, 0, 50, 5, -1),
		sym("method", "X", 0, 10, 30, 10, 0),
	}, nil)
	seedFile(t, store, "b.go", "go", nil, []codeparse.Symbol{
		sym("type", "B", 0, 0, 100, 5, -1),
		sym("method", "Y", 0, 10, 30, 10, 0),
	}, []codeparse.Reference{
		ref("embed", "A", 0, 40, 60, 40), // within B's own span
	})
	seedFile(t, store, "concrete.go", "go", nil, []codeparse.Symbol{
		sym("type", "Concrete", 0, 0, 10, 5, -1),
		sym("method", "X", 0, 20, 40, 20, -1),
		sym("method", "Y", 0, 40, 60, 40, -1),
	}, []codeparse.Reference{
		ref("receiver", "Concrete", 0, 20, 40, 20),
		ref("receiver", "Concrete", 0, 40, 60, 40),
	})

	targets, err := g.goImplementationsOf(ctx, "B")
	if err != nil {
		t.Fatal(err)
	}
	if len(targets) != 1 || targets[0].Name != "Concrete" {
		t.Fatalf("want Concrete satisfying B's promoted method set, got %+v", targets)
	}
	if targets[0].Rule != "implementationsOf.goMethodSet" {
		t.Fatalf("want the plain rule string (Concrete itself declares X and Y directly), got %q", targets[0].Rule)
	}
}

// TestGoMethodSetMutualEmbeddingTerminates covers §4.1's cycle guard: X embeds Y, Y embeds X.
// Neither declares a method of its own, so the only assertion that matters is that this returns
// at all (no infinite recursion) with whatever is reachable — here, nothing.
func TestGoMethodSetMutualEmbeddingTerminates(t *testing.T) {
	g, store := newTestGraph(t)
	ctx := context.Background()

	seedFile(t, store, "x.go", "go", nil, []codeparse.Symbol{
		sym("type", "X", 0, 0, 100, 5, -1),
	}, []codeparse.Reference{
		ref("embed", "Y", 0, 10, 30, 10),
	})
	seedFile(t, store, "y.go", "go", nil, []codeparse.Symbol{
		sym("type", "Y", 0, 0, 100, 5, -1),
	}, []codeparse.Reference{
		ref("embed", "X", 0, 10, 30, 10),
	})

	ix := newGoTypes(g)
	methods, _, _, err := ix.methodSet(ctx, "X", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(methods) != 0 {
		t.Fatalf("want no methods reachable from a mutually-embedding pair, got %+v", methods)
	}
}

// TestGoMethodSetCycleDoesNotPoisonMemo covers the memo-poisoning fix (P79 review): A embeds B, B
// embeds A — a legal Go embedding cycle at the type-graph level. Walking from A recurses into B,
// which needs A again; the cycle guard refuses that and B's own computation completes with a
// truncated view of itself. That truncated result must not be cached: a later, unrelated top-level
// methodSet("B", 0) call on the same ix must still see B's full method set ({M, N}, reached fresh
// through its own embed of A), not a poisoned {M} left behind by A's own walk.
func TestGoMethodSetCycleDoesNotPoisonMemo(t *testing.T) {
	g, store := newTestGraph(t)
	ctx := context.Background()

	seedFile(t, store, "a.go", "go", nil, []codeparse.Symbol{
		sym("type", "A", 0, 0, 100, 5, -1),
		sym("method", "N", 0, 200, 220, 200, -1),
	}, []codeparse.Reference{
		ref("embed", "B", 0, 10, 30, 10), // within A's own span
		ref("receiver", "A", 0, 200, 220, 200),
	})
	seedFile(t, store, "b.go", "go", nil, []codeparse.Symbol{
		sym("type", "B", 0, 0, 100, 5, -1),
		sym("method", "M", 0, 200, 220, 200, -1),
	}, []codeparse.Reference{
		ref("embed", "A", 0, 10, 30, 10), // within B's own span
		ref("receiver", "B", 0, 200, 220, 200),
	})

	ix := newGoTypes(g)
	if _, _, _, err := ix.methodSet(ctx, "A", 0); err != nil {
		t.Fatal(err)
	}

	methods, _, _, err := ix.methodSet(ctx, "B", 0)
	if err != nil {
		t.Fatal(err)
	}
	if !methods["M"] || !methods["N"] {
		t.Fatalf("want B's full method set {M, N} via embedding A, got %+v (memo poisoned by A's own truncated walk)", methods)
	}
}

// TestGoMethodSetEmbeddingCapsAtDepth covers §4.1's depth cap: a straight chain nine levels deep,
// with the only method at the bottom. maxEmbedDepth (8) stops promotion before it's ever reached.
func TestGoMethodSetEmbeddingCapsAtDepth(t *testing.T) {
	g, store := newTestGraph(t)
	ctx := context.Background()

	const depth = 9
	for i := 0; i < depth; i++ {
		name := chainTypeName(i)
		next := chainTypeName(i + 1)
		seedFile(t, store, name+".go", "go", nil, []codeparse.Symbol{
			sym("type", name, 0, 0, 100, 5, -1),
		}, []codeparse.Reference{
			ref("embed", next, 0, 10, 30, 10),
		})
	}
	last := chainTypeName(depth)
	seedFile(t, store, last+".go", "go", nil, []codeparse.Symbol{
		sym("type", last, 0, 0, 10, 5, -1),
		sym("method", "M", 0, 20, 40, 20, -1),
	}, []codeparse.Reference{
		ref("receiver", last, 0, 20, 40, 20),
	})

	ix := newGoTypes(g)
	methods, _, _, err := ix.methodSet(ctx, chainTypeName(0), 0)
	if err != nil {
		t.Fatal(err)
	}
	if methods["M"] {
		t.Fatalf("want M dropped past the depth cap, got %+v", methods)
	}
}

func chainTypeName(i int) string {
	return "Chain" + string(rune('A'+i))
}

// TestGoMethodSetEmptyInterfaceReturnsNothing covers §4.2's own len(want)==0 case: an empty
// interface is satisfied by every type, so answering "every type" is noise, not an answer.
func TestGoMethodSetEmptyInterfaceReturnsNothing(t *testing.T) {
	g, store := newTestGraph(t)
	ctx := context.Background()

	seedFile(t, store, "iface.go", "go", nil, []codeparse.Symbol{
		sym("type", "Empty", 0, 0, 10, 5, -1),
	}, nil)
	seedFile(t, store, "foo.go", "go", nil, []codeparse.Symbol{
		sym("type", "Foo", 0, 0, 10, 5, -1),
		sym("method", "Anything", 0, 20, 40, 20, -1),
	}, []codeparse.Reference{
		ref("receiver", "Foo", 0, 20, 40, 20),
	})

	targets, err := g.goImplementationsOf(ctx, "Empty")
	if err != nil {
		t.Fatal(err)
	}
	if len(targets) != 0 {
		t.Fatalf("want nothing for an empty interface, got %+v", targets)
	}
}

// TestGoMethodSetReverseFromConcreteType covers §4.2's reverse direction: the cursor resolved to
// the concrete type itself (directGoMethods(name) non-empty), and the interface it satisfies comes
// back.
func TestGoMethodSetReverseFromConcreteType(t *testing.T) {
	g, store := newTestGraph(t)
	ctx := context.Background()

	seedFile(t, store, "iface.go", "go", nil, []codeparse.Symbol{
		sym("type", "Reader", 0, 0, 100, 5, -1),
		sym("method", "Read", 0, 10, 30, 10, 0),
		sym("method", "Close", 0, 30, 50, 30, 0),
	}, nil)
	seedFile(t, store, "foo.go", "go", nil, []codeparse.Symbol{
		sym("type", "Foo", 0, 0, 10, 5, -1),
		sym("method", "Read", 0, 20, 40, 20, -1),
		sym("method", "Close", 0, 40, 60, 40, -1),
	}, []codeparse.Reference{
		ref("receiver", "Foo", 0, 20, 40, 20),
		ref("receiver", "Foo", 0, 40, 60, 40),
	})

	targets, err := g.goImplementationsOf(ctx, "Foo")
	if err != nil {
		t.Fatal(err)
	}
	if len(targets) != 1 || targets[0].Name != "Reader" || targets[0].Path != "iface.go" {
		t.Fatalf("want Reader recovered in reverse, got %+v", targets)
	}
	if targets[0].Confidence != Scoped {
		t.Fatalf("want Scoped confidence, got %q", targets[0].Confidence)
	}
}

// TestGoMethodSetSameNameDifferentReceiverOnlyMatchingIncluded covers §4.2's seeding: the rarest
// wanted method name can have several symbol rows, one per receiver type using that name, and only
// the receiver whose own full method set is a superset of want becomes a candidate.
//
// Qux/Quux exist only to outnumber Read's own occurrences, so Read (shared by Foo and Bar) —
// rather than Close — is the name rarestGoMethodName actually seeds from; without them Close
// alone would be rarest and Bar's Read row would never be visited at all.
func TestGoMethodSetSameNameDifferentReceiverOnlyMatchingIncluded(t *testing.T) {
	g, store := newTestGraph(t)
	ctx := context.Background()

	seedFile(t, store, "iface.go", "go", nil, []codeparse.Symbol{
		sym("type", "Reader", 0, 0, 100, 5, -1),
		sym("method", "Read", 0, 10, 30, 10, 0),
		sym("method", "Close", 0, 30, 50, 30, 0),
	}, nil)
	seedFile(t, store, "foo.go", "go", nil, []codeparse.Symbol{
		sym("type", "Foo", 0, 0, 10, 5, -1),
		sym("method", "Read", 0, 20, 40, 20, -1),
		sym("method", "Close", 0, 40, 60, 40, -1),
	}, []codeparse.Reference{
		ref("receiver", "Foo", 0, 20, 40, 20),
		ref("receiver", "Foo", 0, 40, 60, 40),
	})
	seedFile(t, store, "bar.go", "go", nil, []codeparse.Symbol{
		sym("method", "Read", 0, 20, 40, 20, -1), // shares the name "Read" with Foo's own method
	}, []codeparse.Reference{
		ref("receiver", "Bar", 0, 20, 40, 20),
	})
	seedFile(t, store, "qux.go", "go", nil, []codeparse.Symbol{
		sym("method", "Close", 0, 20, 40, 20, -1),
	}, []codeparse.Reference{
		ref("receiver", "Qux", 0, 20, 40, 20),
	})
	seedFile(t, store, "quux.go", "go", nil, []codeparse.Symbol{
		sym("method", "Close", 0, 20, 40, 20, -1),
	}, []codeparse.Reference{
		ref("receiver", "Quux", 0, 20, 40, 20),
	})

	targets, err := g.goImplementationsOf(ctx, "Reader")
	if err != nil {
		t.Fatal(err)
	}
	if len(targets) != 1 || targets[0].Name != "Foo" {
		t.Fatalf("want only Foo (Bar shares the seed name but lacks Close), got %+v", targets)
	}
}

// TestGoMethodSetReverseSeedsFromEveryMethodName covers the reverse-seeding fix (P79 review): an
// interface only needs a SUBSET of a concrete type's methods, so candidate discovery must union
// over every name in have, not just the rarest. Foo declares Read, Close and Shutdown; Reader wants
// only Read. Close and Shutdown are each rarer than Read (Read has a second row: Reader's own
// method_elem), so the old single-rarest-name seed picks Close or Shutdown — whose only row is
// Foo's own concrete method (ParentID nil, never an interface candidate) — and wrongly returns
// nothing.
func TestGoMethodSetReverseSeedsFromEveryMethodName(t *testing.T) {
	g, store := newTestGraph(t)
	ctx := context.Background()

	seedFile(t, store, "iface.go", "go", nil, []codeparse.Symbol{
		sym("type", "Reader", 0, 0, 100, 5, -1),
		sym("method", "Read", 0, 10, 30, 10, 0),
	}, nil)
	seedFile(t, store, "foo.go", "go", nil, []codeparse.Symbol{
		sym("type", "Foo", 0, 0, 10, 5, -1),
		sym("method", "Read", 0, 20, 40, 20, -1),
		sym("method", "Close", 0, 40, 60, 40, -1),
		sym("method", "Shutdown", 0, 60, 80, 60, -1),
	}, []codeparse.Reference{
		ref("receiver", "Foo", 0, 20, 40, 20),
		ref("receiver", "Foo", 0, 40, 60, 40),
		ref("receiver", "Foo", 0, 60, 80, 60),
	})

	targets, err := g.goImplementationsOf(ctx, "Foo")
	if err != nil {
		t.Fatal(err)
	}
	if len(targets) != 1 || targets[0].Name != "Reader" {
		t.Fatalf("want Reader recovered via union seeding even though Close/Shutdown are rarer, got %+v", targets)
	}
}
