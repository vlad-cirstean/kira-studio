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
