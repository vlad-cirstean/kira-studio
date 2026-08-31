package testsupport

import (
	"testing"

	"github.com/kirathecat/kira-studio/shell/internal/adapters"
	"github.com/kirathecat/kira-studio/shell/internal/page"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

// Seg builds one model.PathSegment — postgres_test.go's own seg(), generalised so mysqlfamily's,
// sqlite's and clickhouse's own acceptance specs do not each write it again.
func Seg(kind, name string) model.PathSegment { return model.PathSegment{Kind: kind, Name: name} }

// NodePath builds a model.NodePath for connectionID.
func NodePath(connectionID string, segments ...model.PathSegment) model.NodePath {
	return model.NodePath{ConnectionID: connectionID, Segments: segments}
}

// ChildNames extracts every node's Name from a Children() result, in order.
func ChildNames(t *testing.T, children adapters.TreeChildren) []string {
	t.Helper()
	names := make([]string, len(children.Nodes))
	for i, n := range children.Nodes {
		names[i] = n.Name
	}
	return names
}

// ContainsName reports whether want is present in names.
func ContainsName(names []string, want string) bool {
	for _, n := range names {
		if n == want {
			return true
		}
	}
	return false
}

// CellAt reads one cell of a TabularPage as *string (nil for SQL NULL) — the Go analogue of
// tests/db/support/page.ts's cellAt/isNull pair.
func CellAt(t *testing.T, p page.TabularPage, col, row int) *string {
	t.Helper()
	chunk := p.Chunks[col]
	if page.IsNull(chunk, row) {
		return nil
	}
	text := page.CellText(chunk, row)
	return &text
}

// Strp returns a pointer to s — every acceptance spec in this repo needs one somewhere and
// otherwise reinvents it under a different name.
func Strp(s string) *string { return &s }
