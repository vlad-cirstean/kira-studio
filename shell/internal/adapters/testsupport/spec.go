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

// chunkCellAt is CellAt's one-chunk shape, shared by the Document/KeyValue readers below — a
// page.Chunk's null-vs-empty-string distinction (P58a A4) matters here exactly as it does for a
// TabularPage's own cells, and getting it wrong in a per-package copy is the risk P58c §1.3 gap 3
// named.
func chunkCellAt(t *testing.T, chunk page.Chunk, row int) *string {
	t.Helper()
	if page.IsNull(chunk, row) {
		return nil
	}
	text := page.CellText(chunk, row)
	return &text
}

// DocIDAt reads row's pre-serialized EJSON _id text from a DocumentPage — the Go analogue of
// mongo.spec.ts's docIdAt.
func DocIDAt(t *testing.T, p page.DocumentPage, row int) *string {
	t.Helper()
	return chunkCellAt(t, p.IDs, row)
}

// DocBodyAt reads row's pre-serialized EJSON document body text from a DocumentPage — the Go
// analogue of mongo.spec.ts's docBodyAt.
func DocBodyAt(t *testing.T, p page.DocumentPage, row int) *string {
	t.Helper()
	return chunkCellAt(t, p.Bodies, row)
}

// KVPairs reads every field/value pair off a KeyValuePage into a map — the Go analogue of
// redis.spec.ts's kvPairs. A map, not a slice, because most callers (hash/set/zset reads) need to
// assert the exact *set* of pairs a page carries, order-independent — HSCAN's own round order is
// not stable across containers (§1.11/RD-1(a)), so an ordered comparison would be flaky by
// construction. A row whose value is SQL/redis NULL has no representation here (redis has no NULL
// value concept at the KeyValuePage level); every field name in a real page is expected non-null.
func KVPairs(t *testing.T, p page.KeyValuePage) map[string]string {
	t.Helper()
	out := make(map[string]string, p.RowCount)
	for row := 0; row < p.RowCount; row++ {
		field := chunkCellAt(t, p.Fields, row)
		value := chunkCellAt(t, p.Values, row)
		if field == nil {
			t.Fatalf("KVPairs: field at row %d is null, want a real field name", row)
		}
		if value == nil {
			out[*field] = ""
			continue
		}
		out[*field] = *value
	}
	return out
}

// KVValueAt reads row's value text from a KeyValuePage directly, preserving row order — for the
// ordered cases KVPairs' map would lose (a list's absolute-index fields, a stream's per-entry
// rows), where the caller needs a specific row's value rather than the whole page as a set.
func KVValueAt(t *testing.T, p page.KeyValuePage, row int) *string {
	t.Helper()
	return chunkCellAt(t, p.Values, row)
}

// Strp returns a pointer to s — every acceptance spec in this repo needs one somewhere and
// otherwise reinvents it under a different name.
func Strp(s string) *string { return &s }

// StreamKeyAt reads row's key text from a StreamPage — the Go analogue of sqs.spec.ts's own
// per-message key reads. SQS's MessageId is always present on a received message, but the reader
// stays nil-able (chunkCellAt, not a bare string) for the same reason DocIDAt does: a page.Chunk's
// null-vs-empty-string distinction is a property of the chunk format, not of any one producer's
// data, and a per-package copy that assumed "always present" would be the exact risk P58c §1.3 gap
// 3 already named once for Document/KeyValue readers.
func StreamKeyAt(t *testing.T, p page.StreamPage, row int) *string {
	t.Helper()
	return chunkCellAt(t, p.Keys, row)
}

// StreamHeadersAt reads row's pre-serialized headers cell text from a StreamPage — P58d D8's
// hand-encoded JSON, asserted as a literal string by the tests that need the exact shape.
func StreamHeadersAt(t *testing.T, p page.StreamPage, row int) *string {
	t.Helper()
	return chunkCellAt(t, p.Headers, row)
}

// StreamAttrsAt reads row's pre-serialized system-attributes cell text from a StreamPage.
func StreamAttrsAt(t *testing.T, p page.StreamPage, row int) *string {
	t.Helper()
	return chunkCellAt(t, p.Attrs, row)
}

// StreamTimestampAt reads row's ISO-8601 timestamp cell text from a StreamPage.
func StreamTimestampAt(t *testing.T, p page.StreamPage, row int) *string {
	t.Helper()
	return chunkCellAt(t, p.Timestamps, row)
}

// StreamBodyAt reads row's body cell text from a StreamPage.
func StreamBodyAt(t *testing.T, p page.StreamPage, row int) *string {
	t.Helper()
	return chunkCellAt(t, p.Bodies, row)
}
