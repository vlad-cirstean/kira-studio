package codegraph

import (
	"context"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codeparse"
)

// TestReferencesToGoUnexportedIsolatesPackages is §11 point 4: an unexported Go name shadowed in
// two unrelated packages must resolve each package's own reference to its own package's
// definition — proof the group memo (keyed per directory) never collapses two directories into
// one shared answer.
func TestReferencesToGoUnexportedIsolatesPackages(t *testing.T) {
	g, store := newTestGraph(t)
	ctx := context.Background()

	fileA := seedFile(t, store, "pkg/a/main.go", "go", nil, []codeparse.Symbol{
		sym("function", "helper", 0, 0, 20, 9, -1),
	}, nil)
	seedFile(t, store, "pkg/a/other.go", "go", nil, nil, []codeparse.Reference{
		ref("call", "helper", 0, 5, 15, 5),
	})
	seedFile(t, store, "pkg/b/main.go", "go", nil, []codeparse.Symbol{
		sym("function", "helper", 0, 0, 20, 9, -1),
	}, nil)
	seedFile(t, store, "pkg/b/other.go", "go", nil, nil, []codeparse.Reference{
		ref("call", "helper", 0, 5, 15, 5),
	})

	refs, err := g.ReferencesTo(ctx, Query{Path: fileA.Path, Byte: 10}, RefOpts{})
	if err != nil {
		t.Fatal(err)
	}
	if len(refs.Sites) != 1 || refs.Sites[0].Path != "pkg/a/other.go" {
		t.Fatalf("want only pkg/a's own reference, got %+v", refs.Sites)
	}
	if refs.Total != 1 || refs.Truncated {
		t.Fatalf("want Total=1, Truncated=false, got %+v", refs)
	}
}

// TestReferencesToRepoWideAmbiguousIsUnattributed is P69d §A.4 commit 2's own regression case: the
// attribution gate that stops ReferencesTo from crediting a reference to one definition when its
// own group resolved RepoWide with several equally-plausible candidates — before this fix, a
// RepoWide group's candidate set was used as a pure membership test, which is vacuously true for
// every definition sharing the name, so every such reference was silently attributed to whichever
// one the query happened to be.
func TestReferencesToRepoWideAmbiguousIsUnattributed(t *testing.T) {
	g, store := newTestGraph(t)
	ctx := context.Background()

	t.Run("two repo-wide candidates, no locality evidence: unattributed, not guessed", func(t *testing.T) {
		defA := seedFile(t, store, "pkg/a/def.go", "go", nil, []codeparse.Symbol{
			sym("function", "P69dWidget", 0, 0, 20, 9, -1),
		}, nil)
		seedFile(t, store, "pkg/b/def.go", "go", nil, []codeparse.Symbol{
			sym("function", "P69dWidget", 0, 0, 20, 9, -1),
		}, nil)
		// pkg/c shares neither directory with pkg/a nor pkg/b — every candidate lands tier 2
		// (RepoWide), and there are two of them, so the group carries no locality evidence at all.
		seedFile(t, store, "pkg/c/use.go", "go", nil, nil, []codeparse.Reference{
			ref("call", "P69dWidget", 0, 5, 15, 5),
		})

		refs, err := g.ReferencesTo(ctx, Query{Path: defA.Path, Byte: 10}, RefOpts{})
		if err != nil {
			t.Fatal(err)
		}
		if len(refs.Sites) != 0 || refs.Total != 0 {
			t.Fatalf("want nothing attributed, got %+v", refs.Sites)
		}
		if refs.Unattributed != 1 {
			t.Fatalf("Unattributed = %d, want 1", refs.Unattributed)
		}
	})

	t.Run("one repo-wide candidate (singleton): still attributed, recall preserved", func(t *testing.T) {
		defSolo := seedFile(t, store, "pkg/solo/def.go", "go", nil, []codeparse.Symbol{
			sym("function", "P69dSolo", 0, 0, 20, 9, -1),
		}, nil)
		// pkg/other shares no directory with pkg/solo — the one candidate still lands tier 2
		// (RepoWide), but a name with exactly one definition repository-wide is unambiguous even
		// there, so the reference must still be kept (this is what preserves recall for the
		// ordinary cross-directory case, e.g. Forget in the §A.5 table).
		refSite := seedFile(t, store, "pkg/other/use.go", "go", nil, nil, []codeparse.Reference{
			ref("call", "P69dSolo", 0, 5, 15, 5),
		})

		refs, err := g.ReferencesTo(ctx, Query{Path: defSolo.Path, Byte: 10}, RefOpts{})
		if err != nil {
			t.Fatal(err)
		}
		if len(refs.Sites) != 1 || refs.Sites[0].Path != refSite.Path {
			t.Fatalf("want the singleton repo-wide reference kept, got %+v", refs.Sites)
		}
		if refs.Total != 1 || refs.Unattributed != 0 {
			t.Fatalf("want Total=1, Unattributed=0, got %+v", refs)
		}
	})

	t.Run("NameOnly bypasses the gate entirely, even for a repo-wide-ambiguous name", func(t *testing.T) {
		defA := seedFile(t, store, "pkg/d/def.go", "go", nil, []codeparse.Symbol{
			sym("function", "P69dNameOnly", 0, 0, 20, 9, -1),
		}, nil)
		seedFile(t, store, "pkg/e/def.go", "go", nil, []codeparse.Symbol{
			sym("function", "P69dNameOnly", 0, 0, 20, 9, -1),
		}, nil)
		seedFile(t, store, "pkg/f/use.go", "go", nil, nil, []codeparse.Reference{
			ref("call", "P69dNameOnly", 0, 5, 15, 5),
		})

		refs, err := g.ReferencesTo(ctx, Query{Path: defA.Path, Byte: 10}, RefOpts{Mode: NameOnly})
		if err != nil {
			t.Fatal(err)
		}
		if len(refs.Sites) != 1 || refs.Total != 1 || refs.Unattributed != 0 {
			t.Fatalf("want NameOnly to return the reference unresolved, got %+v", refs)
		}
	})
}

// TestReferencesToReadClampsToOwnDirectory is P69b §4.2/§6.2's own regression case, in a non-Go
// language on purpose: TestReferencesToGoUnexportedIsolatesPackages only exercises the Go
// package-privacy path (§4.3), and a Go-only case can't tell resolveName's own tier<=1 clamp for
// "read" references (resolve.go) apart from that unrelated Go rule. A "read" reference to a name
// declared only in an unrelated directory must resolve to nothing; the same name declared in the
// reference's own directory must still resolve.
func TestReferencesToReadClampsToOwnDirectory(t *testing.T) {
	g, store := newTestGraph(t)
	ctx := context.Background()

	// Unrelated directory: declares p69bCount but has no reference to it — its own presence is
	// what a cross-directory "read" must NOT be allowed to resolve against.
	seedFile(t, store, "pkg/other/const.ts", "typescript", nil, []codeparse.Symbol{
		sym("constant", "p69bCount", 0, 0, 20, 6, -1),
	}, nil)

	// A "read" reference from a file with no same-directory or same-file declaration of its own —
	// only the unrelated directory above declares the name.
	fileNoDecl := seedFile(t, store, "pkg/user/use.ts", "typescript", nil, nil, []codeparse.Reference{
		ref("read", "p69bCount", 0, 10, 19, 10),
	})
	refs, err := g.ReferencesTo(ctx, Query{Path: fileNoDecl.Path, Byte: 10}, RefOpts{})
	if err != nil {
		t.Fatal(err)
	}
	if len(refs.Sites) != 0 || refs.Total != 0 {
		t.Fatalf("want no references (cross-directory read must not resolve), got %+v", refs)
	}

	// Same directory: pkg/local declares p69bLocal and also reads it — must still resolve.
	fileDecl := seedFile(t, store, "pkg/local/const.ts", "typescript", nil, []codeparse.Symbol{
		sym("constant", "p69bLocal", 0, 0, 20, 6, -1),
	}, nil)
	fileRead := seedFile(t, store, "pkg/local/use.ts", "typescript", nil, nil, []codeparse.Reference{
		ref("read", "p69bLocal", 0, 10, 19, 10),
	})
	refs, err = g.ReferencesTo(ctx, Query{Path: fileDecl.Path, Byte: 6}, RefOpts{})
	if err != nil {
		t.Fatal(err)
	}
	if len(refs.Sites) != 1 || refs.Sites[0].Path != fileRead.Path {
		t.Fatalf("want the same-directory read to resolve, got %+v", refs.Sites)
	}
	if refs.Total != 1 || refs.Truncated {
		t.Fatalf("want Total=1, Truncated=false, got %+v", refs)
	}
}
