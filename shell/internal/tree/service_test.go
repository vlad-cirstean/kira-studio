package tree_test

import (
	"encoding/json"
	"testing"

	"github.com/kirathecat/kira-studio/shell/internal/enginehost"
	"github.com/kirathecat/kira-studio/shell/internal/enginetest"
	"github.com/kirathecat/kira-studio/shell/internal/storage"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
	"github.com/kirathecat/kira-studio/shell/internal/storage/repos"
	"github.com/kirathecat/kira-studio/shell/internal/tree"
)

// fakeStates is a Connected whose state a test sets directly, instead of driving a real connect.
type fakeStates struct {
	status map[string]string
}

func (f *fakeStates) StateOf(connectionID string) model.ConnectionState {
	return model.ConnectionState{ConnectionID: connectionID, Status: f.status[connectionID]}
}

type harness struct {
	svc   *tree.Service
	repos *repos.Repos
	host  *enginehost.Host
	fake  *fakeStates
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

	host := enginetest.Host(t)
	fake := &fakeStates{status: map[string]string{}}
	svc := tree.New(r.Connections, r.Metadata, host, fake)
	return &harness{svc: svc, repos: r, host: host, fake: fake}
}

// seedConnection inserts a bare connection row so requireConnected's not-connected fallback has
// a real name to read.
func (h *harness) seedConnection(t *testing.T, id, name string) {
	t.Helper()
	now := model.NowISO()
	if _, err := h.repos.Connections.DB.Exec(
		`INSERT INTO connections (id, name, kind, color, mode, read_only, created_at, updated_at, sort_order)
		 VALUES (?, ?, 'postgres', 'blue', 'fields', 0, ?, ?, 0)`,
		id, name, now, now,
	); err != nil {
		t.Fatalf("seed connection: %v", err)
	}
	h.fake.status[id] = "connected"
}

func requestCount(t *testing.T, h *harness, op string) int {
	t.Helper()
	payload, err := h.host.Call("fixture:request-count", map[string]any{"op": op})
	if err != nil {
		t.Fatalf("fixture:request-count: %v", err)
	}
	var got struct {
		Count int `json:"count"`
	}
	if err := json.Unmarshal(payload, &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return got.Count
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
	if got, _ := h.repos.Metadata.Get("c1", path, "children"); string(got) == `[{"kind":"nonsense"}]` {
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
	if got, _ := h.repos.Metadata.Get("c1", path, "children"); got != nil {
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
