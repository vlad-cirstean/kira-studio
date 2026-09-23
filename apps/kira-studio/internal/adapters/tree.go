package adapters

import (
	"fmt"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// This file hoists the two path-depth error shapes postgres/mysqlfamily/sqlite's own Children each
// spelled out verbatim (P107 I2-11). The depth-by-depth dispatch itself — segment-Kind checks
// interleaved with per-level listing calls — stays in each adapter: postgres acquires its
// per-database *pgx.Conn once and reuses it through both its schema and relation listing (a depth
// mysqlfamily/sqlite have no equivalent of), while sqlite wraps the whole call in runOnConn rather
// than an explicit acquire/release pair. Folding that dispatch into one shared walker would have to
// either invent a connection-acquisition step none of the three actually share, or silently add or
// drop the "acquire a connection even for a leaf path" side effect each adapter's own dispatch order
// currently gives it — a real behavioral risk for no length win, so it was declined.

// UnexpectedPathKind is Children's own "this segment's Kind doesn't match what this depth expects"
// error, byte-identical text across all three relational adapters: depth 0 (the very first segment)
// says "root path segment kind"; every deeper depth says "path segment kind at depth N".
func UnexpectedPathKind(depth int, kind string) error {
	if depth == 0 {
		return New(CodeNotFound, "unexpected root path segment kind: "+kind, nil)
	}
	return New(CodeNotFound, fmt.Sprintf("unexpected path segment kind at depth %d: %s", depth, kind), nil)
}

// LeafChildren is Children's own leaf-depth check, byte-identical across all three relational
// adapters (Rule 5, P19 D5: every relation is a leaf) — a segment whose Kind is in leafKinds
// returns no children; anything else at that depth is CodeNotFound "unexpected object kind".
func LeafChildren(kind string, leafKinds map[string]bool) (TreeChildren, error) {
	if leafKinds[kind] {
		return TreeChildren{Nodes: []model.TreeNode{}}, nil
	}
	return TreeChildren{}, New(CodeNotFound, "unexpected object kind: "+kind, nil)
}
