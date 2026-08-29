package tree_test

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/kirathecat/kira-studio/shell/internal/bridge/ipcerr"
	"github.com/kirathecat/kira-studio/shell/internal/connections"
	"github.com/kirathecat/kira-studio/shell/internal/enginehost"
	"github.com/kirathecat/kira-studio/shell/internal/enginetest"
	"github.com/kirathecat/kira-studio/shell/internal/preconnect"
	"github.com/kirathecat/kira-studio/shell/internal/secrets"
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

func TestChildrenCacheMissThenHit(t *testing.T) {
	h := newHarness(t)
	h.seedConnection(t, "c1", "Conn One")
	path := model.EncodePath([]model.PathSegment{{Kind: "database", Name: "app"}})

	first, err := h.svc.Children("c1", path, false)
	if err != nil {
		t.Fatalf("Children (miss): %v", err)
	}
	if first.Source != "server" {
		t.Fatalf("Source = %q, want server", first.Source)
	}
	before := requestCount(t, h, "adapter:children")

	second, err := h.svc.Children("c1", path, false)
	if err != nil {
		t.Fatalf("Children (hit): %v", err)
	}
	if second.Source != "cache" {
		t.Fatalf("Source = %q, want cache", second.Source)
	}
	if requestCount(t, h, "adapter:children") != before {
		t.Errorf("adapter:children was called again on a cache hit")
	}
	if diff := cmp.Diff(first.Nodes, second.Nodes); diff != "" {
		t.Errorf("cached nodes mismatch vs server nodes (-server +cache):\n%s", diff)
	}
}

func TestRefreshBypassesCache(t *testing.T) {
	h := newHarness(t)
	h.seedConnection(t, "c1", "Conn One")
	path := model.EncodePath([]model.PathSegment{{Kind: "database", Name: "app"}})

	if _, err := h.svc.Children("c1", path, false); err != nil {
		t.Fatalf("Children (warm): %v", err)
	}
	before := requestCount(t, h, "adapter:children")
	if _, err := h.svc.Children("c1", path, true); err != nil {
		t.Fatalf("Children (refresh): %v", err)
	}
	if requestCount(t, h, "adapter:children") != before+1 {
		t.Errorf("refresh=true did not call the engine even with a warm cache row")
	}
}

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

func TestTruncatedListingNotCached(t *testing.T) {
	h := newHarness(t)
	h.seedConnection(t, "c1", "Conn One")
	path := model.EncodePath([]model.PathSegment{{Kind: "database", Name: "trunc-app"}})

	result, err := h.svc.Children("c1", path, false)
	if err != nil {
		t.Fatalf("Children: %v", err)
	}
	if !result.Truncated {
		t.Fatalf("Truncated = false, want true")
	}
	if got, _ := h.repos.Metadata.Get("c1", path, "children"); got != nil {
		t.Errorf("truncated listing was cached: %s", got)
	}
}

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

func TestDescribeAndDefinitionCacheAside(t *testing.T) {
	h := newHarness(t)
	h.seedConnection(t, "c1", "Conn One")

	describePath := model.EncodePath([]model.PathSegment{{Kind: "table", Name: "orders"}})
	d1, err := h.svc.Describe("c1", describePath, false, nil)
	if err != nil {
		t.Fatalf("Describe (miss): %v", err)
	}
	if d1.Source != "server" {
		t.Fatalf("Source = %q, want server", d1.Source)
	}
	d2, err := h.svc.Describe("c1", describePath, false, nil)
	if err != nil {
		t.Fatalf("Describe (hit): %v", err)
	}
	if d2.Source != "cache" {
		t.Fatalf("Source = %q, want cache", d2.Source)
	}

	defPath := model.EncodePath([]model.PathSegment{{Kind: "table", Name: "orders"}})
	f1, err := h.svc.Definition("c1", defPath, false, nil)
	if err != nil {
		t.Fatalf("Definition (miss): %v", err)
	}
	if f1.Source != "server" {
		t.Fatalf("Source = %q, want server", f1.Source)
	}
	f2, err := h.svc.Definition("c1", defPath, false, nil)
	if err != nil {
		t.Fatalf("Definition (hit): %v", err)
	}
	if f2.Source != "cache" {
		t.Fatalf("Source = %q, want cache", f2.Source)
	}

	// badkind- makes the engine's own describe() answer invalid; the write is unvalidated (it
	// mirrors tree-service.ts's own unconditional putCached), so the *next* read is what proves
	// the drop: it must go back to the server rather than serving the invalid row.
	badPath := model.EncodePath([]model.PathSegment{{Kind: "table", Name: "badkind-orders"}})
	if _, err := h.svc.Describe("c1", badPath, false, nil); err != nil {
		t.Fatalf("Describe (badkind, first): %v", err)
	}
	beforeDescribe := requestCount(t, h, "adapter:describe")
	if again, err := h.svc.Describe("c1", badPath, false, nil); err != nil || again.Source != "server" {
		t.Fatalf("Describe (badkind, second) = %+v, %v; want source=server", again, err)
	}
	if requestCount(t, h, "adapter:describe") != beforeDescribe+1 {
		t.Errorf("invalid cached meta was served instead of being dropped")
	}

	nostmtPath := model.EncodePath([]model.PathSegment{{Kind: "table", Name: "nostmt-orders"}})
	if _, err := h.svc.Definition("c1", nostmtPath, false, nil); err != nil {
		t.Fatalf("Definition (nostmt, first): %v", err)
	}
	beforeDefinition := requestCount(t, h, "adapter:definition")
	if again, err := h.svc.Definition("c1", nostmtPath, false, nil); err != nil || again.Source != "server" {
		t.Fatalf("Definition (nostmt, second) = %+v, %v; want source=server", again, err)
	}
	if requestCount(t, h, "adapter:definition") != beforeDefinition+1 {
		t.Errorf("invalid cached definition was served instead of being dropped")
	}
}

func TestDisconnectedError(t *testing.T) {
	h := newHarness(t)
	now := model.NowISO()
	if _, err := h.repos.Connections.DB.Exec(
		`INSERT INTO connections (id, name, kind, color, mode, read_only, created_at, updated_at, sort_order)
		 VALUES ('c1', 'My Conn', 'postgres', 'blue', 'fields', 0, ?, ?, 0)`,
		now, now,
	); err != nil {
		t.Fatalf("seed connection: %v", err)
	}
	// Deliberately not marking c1 connected in h.fake.

	before := requestCount(t, h, "adapter:children")
	_, err := h.svc.Children("c1", "", false)
	if err == nil {
		t.Fatalf("Children on a disconnected connection: want an error")
	}
	var ie *ipcerr.Error
	if !errors.As(err, &ie) {
		t.Fatalf("error %v (%T) is not an *ipcerr.Error", err, err)
	}
	if ie.Code != "E_DISCONNECTED" || ie.Message != "My Conn is not connected" {
		t.Errorf("error = %+v, want E_DISCONNECTED \"My Conn is not connected\"", ie)
	}
	if requestCount(t, h, "adapter:children") != before {
		t.Errorf("adapter:children was called despite the connection being disconnected")
	}
}

func TestInvalidate(t *testing.T) {
	h := newHarness(t)
	h.seedConnection(t, "c1", "Conn One")
	pathA := model.EncodePath([]model.PathSegment{{Kind: "database", Name: "a"}})
	pathB := model.EncodePath([]model.PathSegment{{Kind: "database", Name: "b"}})

	if _, err := h.svc.Children("c1", pathA, false); err != nil {
		t.Fatalf("Children(a): %v", err)
	}
	if _, err := h.svc.Children("c1", pathB, false); err != nil {
		t.Fatalf("Children(b): %v", err)
	}

	if err := h.svc.Invalidate("c1", &pathA); err != nil {
		t.Fatalf("Invalidate(path): %v", err)
	}
	if got, _ := h.repos.Metadata.Get("c1", pathA, "children"); got != nil {
		t.Errorf("path-scoped invalidate left pathA cached: %s", got)
	}
	if got, _ := h.repos.Metadata.Get("c1", pathB, "children"); got == nil {
		t.Errorf("path-scoped invalidate dropped pathB too")
	}

	if err := h.svc.Invalidate("c1", nil); err != nil {
		t.Fatalf("Invalidate(nil): %v", err)
	}
	if got, _ := h.repos.Metadata.Get("c1", pathB, "children"); got != nil {
		t.Errorf("connection-wide invalidate left pathB cached: %s", got)
	}
}

func TestRealConnectionsServiceSatisfiesConnected(t *testing.T) {
	var _ tree.Connected = (*connections.Service)(nil)

	t.Setenv("KIRA_HOME", t.TempDir())
	t.Setenv("KIRA_INSECURE_SECRETS", "1")
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

	cipher := secrets.New()
	secretsRepo := repos.NewSecrets(db.DB, cipher)
	host := enginetest.Host(t)
	pre := preconnect.New()
	connSvc := connections.New(connections.Deps{
		Conns: r.Connections, Secrets: secretsRepo, Metadata: r.Metadata,
		Cipher: cipher, Host: host, Preconnect: pre,
	})
	connSvc.Start()
	t.Cleanup(connSvc.Shutdown)

	treeSvc := tree.New(r.Connections, r.Metadata, host, connSvc)

	created, err := connSvc.Create(connections.Input{
		ConnectionFields: model.ConnectionFields{
			Name: "e2e", Kind: "postgres", Color: "blue", Mode: "fields",
			Host: strPtrE2E("localhost"), Port: intPtrE2E(5432), Options: map[string]any{},
		},
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if _, err := connSvc.Connect(created.ID); err != nil {
		t.Fatalf("Connect: %v", err)
	}

	path := model.EncodePath([]model.PathSegment{{Kind: "database", Name: "app"}})
	result, err := treeSvc.Children(created.ID, path, false)
	if err != nil {
		t.Fatalf("Children: %v", err)
	}
	if result.Source != "server" || len(result.Nodes) == 0 {
		t.Errorf("Children() = %+v, want a non-empty server result", result)
	}
}

func strPtrE2E(s string) *string { return &s }
func intPtrE2E(i int) *int       { return &i }
