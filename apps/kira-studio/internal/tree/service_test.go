package tree_test

import (
	"context"
	"encoding/json"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/repos"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/tree"
)

// fakeStates is a Connected whose state a test sets directly, instead of driving a real connect.
type fakeStates struct {
	status map[string]string
}

func (f *fakeStates) StateOf(connectionID string) model.ConnectionState {
	return model.ConnectionState{ConnectionID: connectionID, Status: f.status[connectionID]}
}

// fakeBackend replaces the real adapterhost.Router (via a real Node engine fixture) these tests
// used before P58f Phase 4 deleted the Node sidecar — every kind has been Go-native since P58e
// M9.3, so there is no more Node-served path left to exercise here, only tree.Backend's own
// contract. Children answers one leaf node, truncated whenever the requested path's last segment
// name starts with "trunc-" — the same fixture convention these tests were written against.
type fakeBackend struct {
	childrenN      atomic.Int64
	schemaColumnsN atomic.Int64
}

func (b *fakeBackend) Children(ctx context.Context, connectionID string, path model.NodePath) (adapters.TreeChildren, error) {
	b.childrenN.Add(1)
	nodes := []model.TreeNode{{Kind: "table", Name: "x", Path: "table:x", HasChildren: false}}
	last := path.Segments[len(path.Segments)-1]
	if strings.HasPrefix(last.Name, "trunc-") {
		t := true
		return adapters.TreeChildren{Nodes: nodes, Truncated: &t}, nil
	}
	return adapters.TreeChildren{Nodes: nodes}, nil
}

func (b *fakeBackend) Describe(ctx context.Context, connectionID string, path model.NodePath, tabID *string) (model.ObjectMeta, error) {
	return model.ObjectMeta{}, nil
}

func (b *fakeBackend) Definition(ctx context.Context, connectionID string, path model.NodePath, tabID *string) (model.ObjectDefinition, error) {
	return model.ObjectDefinition{}, nil
}

func (b *fakeBackend) SchemaColumns(ctx context.Context, connectionID string, path model.NodePath) ([]model.RelationColumns, error) {
	b.schemaColumnsN.Add(1)
	return []model.RelationColumns{
		{Name: "x", Kind: "table", Columns: []model.ColumnMeta{{Name: "id", Position: 1, DataType: "integer"}}},
	}, nil
}

type harness struct {
	svc     *tree.Service
	repos   *repos.Repos
	backend *fakeBackend
	fake    *fakeStates
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	t.Setenv("KIRA_HOME", t.TempDir())
	db, err := storage.Open()
	if err != nil {
		t.Fatalf("storage.Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	r, err := repos.New(db.DB)
	if err != nil {
		t.Fatalf("repos.New: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })

	fake := &fakeStates{status: map[string]string{}}
	backend := &fakeBackend{}
	svc := tree.New(r.Connections, r.Metadata, backend, fake)
	return &harness{svc: svc, repos: r, backend: backend, fake: fake}
}

// seedConnection inserts a bare connection row so requireConnected's not-connected fallback has
// a real name to read.
func (h *harness) seedConnection(t *testing.T, id, name string) {
	t.Helper()
	now := model.NowISO()
	if _, err := h.repos.Connections.DB.Exec(
		`INSERT INTO connections (id, name, kind, color, mode, read_only, created_at, updated_at, sort_order)
		 VALUES (?, ?, ?, 'blue', 'fields', 0, ?, ?, 0)`,
		id, name, "kafka", now, now,
	); err != nil {
		t.Fatalf("seed connection: %v", err)
	}
	h.fake.status[id] = "connected"
}

func requestCount(t *testing.T, h *harness, op string) int {
	t.Helper()
	switch op {
	case "adapter:children":
		return int(h.backend.childrenN.Load())
	case "adapter:schemaColumns":
		return int(h.backend.schemaColumnsN.Load())
	default:
		t.Fatalf("requestCount: unsupported op %q", op)
		return 0
	}
}

// TestSchemaMismatchDropsRow covers the validate-before-serve half of the cache-aside path: a
// cached row that no longer parses against the current domain shape must be treated as a miss AND
// actively dropped, not merely skipped — otherwise it is re-validated and re-rejected forever.
func TestSchemaMismatchDropsRow(t *testing.T) {
	h := newHarness(t)
	h.seedConnection(t, "c1", "Conn One")
	path := model.EncodePath([]model.PathSegment{{Kind: "database", Name: "app"}})

	if err := h.repos.Metadata.Put("c1", path, "children", json.RawMessage(`[{"kind":"nonsense"}]`)); err != nil {
		t.Fatalf("seed bad row: %v", err)
	}

	result, err := h.svc.Children("c1", path, false)
	if err != nil {
		t.Fatalf("Children: %v", err)
	}
	if result.Source != "server" {
		t.Errorf("Source = %q, want server (the bad cache row must be treated as a miss)", result.Source)
	}
	if got, _, _ := h.repos.Metadata.Get("c1", path, "children"); string(got) == `[{"kind":"nonsense"}]` {
		t.Errorf("bad cache row survived: %s", got)
	}
}

// TestTruncatedRefreshDropsOlderCompleteRow covers the two truncation rules together: a truncated
// listing is never cached, and it must also DISPLACE any older complete row for the same path —
// without the drop, the next ordinary load would keep serving a stale complete listing forever.
func TestTruncatedRefreshDropsOlderCompleteRow(t *testing.T) {
	h := newHarness(t)
	h.seedConnection(t, "c1", "Conn One")
	// The fixture keys truncation off the last path segment's name, and the cache key is that
	// same encoded path string — so seeding a "complete" row under a trunc- path and then
	// refreshing it is exactly "a complete row that a later truncated answer must displace".
	path := model.EncodePath([]model.PathSegment{{Kind: "database", Name: "trunc-app"}})
	if err := h.repos.Metadata.Put("c1", path, "children",
		json.RawMessage(`[{"kind":"table","name":"x","path":"table:x","hasChildren":false}]`),
	); err != nil {
		t.Fatalf("seed complete row: %v", err)
	}

	if _, err := h.svc.Children("c1", path, true); err != nil {
		t.Fatalf("Children (truncated refresh): %v", err)
	}
	if got, _, _ := h.repos.Metadata.Get("c1", path, "children"); got != nil {
		t.Errorf("older complete row survived a truncated refresh: %s", got)
	}

	// The next ordinary (non-refresh) load must go to the server, not serve the dropped row.
	before := requestCount(t, h, "adapter:children")
	if _, err := h.svc.Children("c1", path, false); err != nil {
		t.Fatalf("Children (post-drop): %v", err)
	}
	if requestCount(t, h, "adapter:children") != before+1 {
		t.Errorf("post-drop load did not go to the server")
	}
}

// P22c §4.2: SchemaColumns gets the identical cache-aside coverage Children already has above,
// plus the two properties this design most depends on — a cache hit needs no live connection
// (F7), and it shares one metadata_cache row with "children" rather than adding a new one (F8).

func TestSchemaColumnsMissThenCacheHit(t *testing.T) {
	h := newHarness(t)
	h.seedConnection(t, "c1", "Conn One")
	path := model.EncodePath([]model.PathSegment{{Kind: "database", Name: "app"}, {Kind: "schema", Name: "s1"}})

	result, err := h.svc.SchemaColumns("c1", path, false)
	if err != nil {
		t.Fatalf("SchemaColumns: %v", err)
	}
	if result.Source != "server" || len(result.Relations) != 1 {
		t.Fatalf("first call: got %+v, want one relation from the server", result)
	}
	if got := requestCount(t, h, "adapter:schemaColumns"); got != 1 {
		t.Fatalf("backend calls after first load = %d, want 1", got)
	}

	result, err = h.svc.SchemaColumns("c1", path, false)
	if err != nil {
		t.Fatalf("SchemaColumns (cached): %v", err)
	}
	if result.Source != "cache" {
		t.Errorf("second call: Source = %q, want cache", result.Source)
	}
	if got := requestCount(t, h, "adapter:schemaColumns"); got != 1 {
		t.Errorf("backend calls after cached load = %d, want still 1 (no backend call)", got)
	}
}

func TestSchemaColumnsCacheHitNeedsNoConnection(t *testing.T) {
	h := newHarness(t)
	h.seedConnection(t, "c1", "Conn One")
	path := model.EncodePath([]model.PathSegment{{Kind: "database", Name: "app"}})

	if _, err := h.svc.SchemaColumns("c1", path, false); err != nil {
		t.Fatalf("warm the cache: %v", err)
	}

	// F7's own property: a cache hit is served before the connection is even checked.
	h.fake.status["c1"] = "disconnected"
	result, err := h.svc.SchemaColumns("c1", path, false)
	if err != nil {
		t.Fatalf("SchemaColumns while disconnected: %v", err)
	}
	if result.Source != "cache" {
		t.Errorf("Source = %q, want cache (readable with no live connection)", result.Source)
	}
}

func TestSchemaColumnsRefreshBypassesCache(t *testing.T) {
	h := newHarness(t)
	h.seedConnection(t, "c1", "Conn One")
	path := model.EncodePath([]model.PathSegment{{Kind: "database", Name: "app"}})

	if _, err := h.svc.SchemaColumns("c1", path, false); err != nil {
		t.Fatalf("warm the cache: %v", err)
	}
	result, err := h.svc.SchemaColumns("c1", path, true)
	if err != nil {
		t.Fatalf("SchemaColumns (refresh): %v", err)
	}
	if result.Source != "server" {
		t.Errorf("Source = %q, want server (refresh must bypass the cache)", result.Source)
	}
	if got := requestCount(t, h, "adapter:schemaColumns"); got != 2 {
		t.Errorf("backend calls after refresh = %d, want 2", got)
	}
}

func TestSchemaColumnsInvalidPayloadDroppedAndRefetched(t *testing.T) {
	h := newHarness(t)
	h.seedConnection(t, "c1", "Conn One")
	path := model.EncodePath([]model.PathSegment{{Kind: "database", Name: "app"}})

	if err := h.repos.Metadata.Put("c1", path, "columns", json.RawMessage(`[{"kind":"nonsense"}]`)); err != nil {
		t.Fatalf("seed bad row: %v", err)
	}

	result, err := h.svc.SchemaColumns("c1", path, false)
	if err != nil {
		t.Fatalf("SchemaColumns: %v", err)
	}
	if result.Source != "server" {
		t.Errorf("Source = %q, want server (an invalid cached payload must be treated as a miss)", result.Source)
	}
	if got, _, _ := h.repos.Metadata.Get("c1", path, "columns"); string(got) == `[{"kind":"nonsense"}]` {
		t.Errorf("bad cache row survived: %s", got)
	}
}

func TestSchemaColumnsInvalidateClears(t *testing.T) {
	h := newHarness(t)
	h.seedConnection(t, "c1", "Conn One")
	path := model.EncodePath([]model.PathSegment{{Kind: "database", Name: "app"}})

	if _, err := h.svc.SchemaColumns("c1", path, false); err != nil {
		t.Fatalf("warm the cache: %v", err)
	}
	if err := h.svc.Invalidate("c1", nil); err != nil {
		t.Fatalf("Invalidate: %v", err)
	}
	result, err := h.svc.SchemaColumns("c1", path, false)
	if err != nil {
		t.Fatalf("SchemaColumns (post-invalidate): %v", err)
	}
	if result.Source != "server" {
		t.Errorf("Source = %q, want server (Invalidate must have cleared the cache)", result.Source)
	}
}

// TestChildrenAndSchemaColumnsShareOneRow proves F8's zero-net-row property: a container's
// "children" and "columns" payloads are two kinds merged into ONE metadata_cache row (the
// (connection_id, path) unique index), not two competing rows that would otherwise pressure each
// other out of the 200-row-per-connection budget.
func TestChildrenAndSchemaColumnsShareOneRow(t *testing.T) {
	h := newHarness(t)
	h.seedConnection(t, "c1", "Conn One")
	path := model.EncodePath([]model.PathSegment{{Kind: "database", Name: "app"}})

	if _, err := h.svc.Children("c1", path, false); err != nil {
		t.Fatalf("Children: %v", err)
	}
	if _, err := h.svc.SchemaColumns("c1", path, false); err != nil {
		t.Fatalf("SchemaColumns: %v", err)
	}

	var rowCount int
	if err := h.repos.Metadata.DB.QueryRow(
		`SELECT COUNT(*) FROM metadata_cache WHERE connection_id = ? AND path = ?`, "c1", path,
	).Scan(&rowCount); err != nil {
		t.Fatalf("count rows: %v", err)
	}
	if rowCount != 1 {
		t.Fatalf("metadata_cache rows for (c1, %q) = %d, want 1 (children and columns must share one row)", path, rowCount)
	}

	// Both kinds must still read back correctly out of that one shared row.
	childrenResult, err := h.svc.Children("c1", path, false)
	if err != nil {
		t.Fatalf("Children (after sharing the row): %v", err)
	}
	if childrenResult.Source != "cache" {
		t.Errorf("Children Source = %q, want cache", childrenResult.Source)
	}
	columnsResult, err := h.svc.SchemaColumns("c1", path, false)
	if err != nil {
		t.Fatalf("SchemaColumns (after sharing the row): %v", err)
	}
	if columnsResult.Source != "cache" || len(columnsResult.Relations) != 1 {
		t.Errorf("SchemaColumns after sharing the row = %+v, want a cached single relation", columnsResult)
	}
}
