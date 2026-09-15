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
