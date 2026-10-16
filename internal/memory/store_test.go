package memory

import (
	"context"
	"database/sql"
	"encoding/hex"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/kirathecat/kira-studio/internal/memory/migrations"
	"github.com/kirathecat/kira-studio/internal/sqlitex"
	"github.com/kirathecat/kira-studio/internal/testx"
)

func TestMain(m *testing.M) { os.Exit(testx.RunWithTempHomes(m)) }

func newStore(t *testing.T) *Store {
	t.Helper()
	s := NewStore(filepath.Join(t.TempDir(), "memory.db"))
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func add(t *testing.T, s *Store, fact, reason string, kw ...string) commitResult {
	t.Helper()
	rev, err := s.Revision(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	r, err := s.commitFact(context.Background(), commitInput{Revision: rev, Action: ActionAdd, Fact: fact,
		Reason: reason, Keywords: kw, Origin: OriginUser, Scope: ScopePersonal, Source: SourceUI, RequestID: "r"})
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func facts(ms []Memory) []string {
	out := []string{}
	for _, m := range ms {
		out = append(out, m.Fact)
	}
	return out
}

func TestTriggersProtectHistory(t *testing.T) {
	s := newStore(t)
	r := add(t, s, "uses postgres", "ops decision")
	db, _ := s.conn()
	for name, q := range map[string]string{
		"immutable fact": `UPDATE memories SET fact = 'x' WHERE id = '` + r.ID + `'`,
		"delete":         `DELETE FROM memories WHERE id = '` + r.ID + `'`,
	} {
		if _, err := db.Exec(q); err == nil {
			t.Errorf("%s: expected abort", name)
		}
	}
	rev, _ := s.Revision(context.Background())
	if _, err := s.commitFact(context.Background(), commitInput{Revision: rev, Action: ActionUpdate, TargetID: r.ID,
		Fact: "uses postgres 16", Reason: "upgrade", Origin: OriginAgent, Scope: ScopePersonal, Source: SourceMCP, RequestID: "r2"}); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE memories SET status = 'current' WHERE id = ?`, r.ID); err == nil {
		t.Error("a superseded memory must stay superseded")
	}
	var current int
	_ = db.QueryRow(`SELECT count(*) FROM memories WHERE lineage_id = ? AND status = 'current'`, r.LineageID).Scan(&current)
	if current != 1 {
		t.Errorf("current rows in lineage = %d, want 1", current)
	}
}

func TestStaleRevisionRejected(t *testing.T) {
	s := newStore(t)
	rev, _ := s.Revision(context.Background())
	add(t, s, "first fact", "why")
	_, err := s.commitFact(context.Background(), commitInput{Revision: rev, Action: ActionAdd, Fact: "second",
		Reason: "why", Origin: OriginUser, Scope: ScopePersonal, Source: SourceUI, RequestID: "r"})
	if err != errStale {
		t.Fatalf("err = %v, want errStale", err)
	}
}

func TestSearchRecall(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	add(t, s, "The deployment pipeline was deployed to staging", "release process")
	add(t, s, "Cluster runs on Kubernetes", "infra", "k8s", "kubernetes")
	add(t, s, "Prefers tabs over spaces", "style guide")
	old := add(t, s, "API port is 8080", "initial setup")
	rev, _ := s.Revision(ctx)
	if _, err := s.commitFact(ctx, commitInput{Revision: rev, Action: ActionUpdate, TargetID: old.ID, Fact: "API port is 9090",
		Reason: "moved", Origin: OriginUser, Scope: ScopePersonal, Source: SourceUI, RequestID: "r"}); err != nil {
		t.Fatal(err)
	}

	cases := []struct{ name, q, want string }{
		{"prefix", "deplo", "The deployment pipeline was deployed to staging"},
		{"stem", "deploying", "The deployment pipeline was deployed to staging"},
		{"one of three terms", "tabs unrelated nonsense", "Prefers tabs over spaces"},
		{"keyword column", "k8s", "Cluster runs on Kubernetes"},
		{"stopword only", "the of and", ""},
	}
	for _, c := range cases {
		got, err := s.searchFTS(ctx, SearchArgs{Query: c.q})
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if c.want != "" && !slices.Contains(facts(got), c.want) {
			t.Errorf("%s: %v missing %q", c.name, facts(got), c.want)
		}
	}

	cur, _ := s.searchFTS(ctx, SearchArgs{Query: "port"})
	if !slices.Equal(facts(cur), []string{"API port is 9090"}) {
		t.Errorf("current-only = %v", facts(cur))
	}
	all, _ := s.searchFTS(ctx, SearchArgs{Query: "port", IncludeHistory: true})
	if len(all) != 2 {
		t.Fatalf("with history = %v", facts(all))
	}
	for _, m := range all {
		if m.Historical != (m.Fact == "API port is 8080") {
			t.Errorf("historical flag wrong on %q", m.Fact)
		}
	}
}

func TestSearchNeverFailsOnFTSSyntax(t *testing.T) {
	s := newStore(t)
	add(t, s, "plain fact here", "reason")
	for _, q := range []string{`"`, `NEAR(a b)`, `a AND -b`, `col:x`, `*`, `fact"" OR "`, `^fact`, `(fact`} {
		if _, err := s.searchFTS(context.Background(), SearchArgs{Query: q}); err != nil {
			t.Errorf("query %q: %v", q, err)
		}
	}
}

// migrateTo opens a fresh memory.db and applies the first n migration steps.
func migrateTo(t *testing.T, n int) (string, *sql.DB) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "memory.db")
	db, err := sqlitex.OpenImmediate(path)
	if err != nil {
		t.Fatal(err)
	}
	steps, err := migrations.All()
	if err != nil {
		t.Fatal(err)
	}
	if err := sqlitex.Migrate(db, steps[:n]); err != nil {
		t.Fatal(err)
	}
	return path, db
}

func execAll(t *testing.T, db *sql.DB, qs ...string) {
	t.Helper()
	for _, q := range qs {
		if _, err := db.Exec(q); err != nil {
			t.Fatalf("%v\n%s", err, q)
		}
	}
}

func TestMigration3KeepsEvents(t *testing.T) {
	path, db := migrateTo(t, 2)
	execAll(t, db,
		`INSERT INTO memories (id, lineage_id, version, fact, reason, author, status, fact_hash, created_at)
			VALUES ('m1', 'm1', 1, 'old fact', 'why', 'user', 'current', 'h', 't')`,
		`INSERT INTO memory_events (request_id, source, action, lineage_id, memory_id, author, created_at)
			VALUES ('r', 'ui', 'add', 'm1', 'm1', 'user', 't')`)
	_ = db.Close()

	s := NewStore(path)
	t.Cleanup(func() { _ = s.Close() })
	h, err := s.Lineage(context.Background(), "m1")
	if err != nil {
		t.Fatal(err)
	}
	if len(h.Events) != 1 || h.Events[0].Source != SourceUI || h.Events[0].SourceRef != nil {
		t.Fatalf("event not preserved: %+v", h.Events)
	}
	conn, _ := s.conn()
	id := h.Memories[0].ID
	if _, err := conn.Exec(`INSERT INTO memory_events (request_id, source, source_ref, action, lineage_id, memory_id, origin, source_tag, created_at)
		VALUES ('r2', 'import', 'f1', 'noop', ?, ?, 'external', 'doc', 't')`, h.Memories[0].LineageID, id); err != nil {
		t.Fatalf("import event: %v", err)
	}
	if _, err := conn.Exec(`INSERT INTO memory_events (request_id, source, action, lineage_id, memory_id, origin, source_tag, created_at)
		VALUES ('r3', 'import', 'noop', ?, ?, 'external', 'doc', 't')`, h.Memories[0].LineageID, id); err == nil {
		t.Fatal("import event without source_ref accepted")
	}
}

func TestMigration4Provenance(t *testing.T) {
	path, db := migrateTo(t, 3)
	vec := make([]byte, 12)
	execAll(t, db,
		`INSERT INTO memories (seq, id, lineage_id, version, fact, reason, author, status, supersedes_id, superseded_by_id, fact_hash, created_at, superseded_at)
			VALUES (1, 'a1', 'a1', 1, 'billing runs on postgres', 'ops', 'user', 'superseded', NULL, NULL, 'h1', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z')`,
		`INSERT INTO memories (seq, id, lineage_id, version, fact, reason, author, status, supersedes_id, fact_hash, created_at)
			VALUES (2, 'a2', 'a1', 2, 'billing runs on postgres 16', 'upgrade', 'user', 'current', 'a1', 'h2', '2026-01-02T00:00:00Z')`,
		`UPDATE memories SET superseded_by_id = 'a2' WHERE id = 'a1'`,
		`INSERT INTO memories (seq, id, lineage_id, version, fact, reason, author, status, fact_hash, created_at)
			VALUES (3, 'b1', 'b1', 1, 'the gateway retries twice', 'doc', 'agent', 'current', 'h3', '2026-01-03T00:00:00Z')`,
		`INSERT INTO memory_embeddings (seq, model, vec, created_at) VALUES (3, 'm', x'`+hex.EncodeToString(vec)+`', 't')`,
		`INSERT INTO import_jobs (id, roots, base, state, created_at) VALUES ('j1', '[]', '/docs', 'done', 't')`,
		`INSERT INTO import_files (id, job_id, path, rel_path, kind, size, state, updated_at)
			VALUES ('f1', 'j1', '/docs/gateway.md', 'gateway.md', 'markdown', 1, 'done', 't')`,
		`INSERT INTO memory_events (request_id, source, action, lineage_id, memory_id, author, created_at) VALUES ('r1', 'ui', 'add', 'a1', 'a1', 'user', '2026-01-01T00:00:00Z')`,
		`INSERT INTO memory_events (request_id, source, action, lineage_id, memory_id, previous_id, author, created_at) VALUES ('r2', 'ui', 'update', 'a1', 'a2', 'a1', 'user', '2026-01-02T00:00:00Z')`,
		`INSERT INTO memory_events (request_id, source, source_ref, action, lineage_id, memory_id, author, created_at) VALUES ('r3', 'import', 'f1', 'add', 'b1', 'b1', 'agent', '2026-01-03T00:00:00Z')`)
	_ = db.Close()

	s := NewStore(path)
	t.Cleanup(func() { _ = s.Close() })
	ctx := context.Background()
	conn, err := s.conn()
	if err != nil {
		t.Fatal(err)
	}

	rows, err := conn.Query(`PRAGMA foreign_key_check`)
	if err != nil {
		t.Fatal(err)
	}
	if rows.Next() {
		t.Error("foreign_key_check reports violations")
	}
	_ = rows.Close()

	h, err := s.Lineage(ctx, "a1") // legacy uuid
	if err != nil || len(h.Memories) != 2 {
		t.Fatalf("legacy lookup: %+v, %v", h, err)
	}
	v1, v2 := h.Memories[0], h.Memories[1]
	if !factIDExact.MatchString(v1.LineageID) || v2.LineageID != v1.LineageID {
		t.Fatalf("fact ids = %q, %q", v1.LineageID, v2.LineageID)
	}
	if v1.ID != v1.LineageID+".1" || v2.ID != v1.LineageID+".2" {
		t.Errorf("version ids = %q, %q", v1.ID, v2.ID)
	}
	if v1.SupersededBy == nil || *v1.SupersededBy != v2.ID || v2.SupersedesID == nil || *v2.SupersedesID != v1.ID {
		t.Errorf("supersede links = %v, %v", v1.SupersededBy, v2.SupersedesID)
	}
	if v2.Origin != OriginUser || v2.SourceTag != nil || v2.Scope != ScopePersonal || v2.Project != nil || v2.SessionID != nil {
		t.Errorf("v2 provenance = %+v", v2)
	}
	if len(h.Events) != 2 || h.Events[1].MemoryID != v2.ID || h.Events[1].PreviousID == nil || *h.Events[1].PreviousID != v1.ID {
		t.Errorf("events = %+v", h.Events)
	}
	for _, id := range []string{v1.LineageID, v2.ID} {
		if got, err := s.Lineage(ctx, id); err != nil || len(got.Memories) != 2 {
			t.Errorf("lookup %q: %v", id, err)
		}
	}

	found, err := s.searchFTS(ctx, SearchArgs{Query: "gateway retries"})
	if err != nil || len(found) != 1 {
		t.Fatalf("fts: %v, %v", facts(found), err)
	}
	b := found[0]
	if b.Origin != OriginExternal || b.SourceTag == nil || *b.SourceTag != "doc" || b.Scope != ScopePersonal {
		t.Errorf("imported provenance = %+v", b)
	}
	var joined int
	if err := conn.QueryRow(`SELECT count(*) FROM memory_embeddings e JOIN memories m ON m.seq = e.seq WHERE m.id = ?`, b.ID).Scan(&joined); err != nil || joined != 1 {
		t.Errorf("embedding join = %d, %v", joined, err)
	}

	ctxA, err := s.Context(ctx, v1.LineageID, 10)
	if err != nil || len(ctxA.Groups) != 2 {
		t.Fatalf("context of a: %+v, %v", ctxA, err)
	}
	for _, g := range ctxA.Groups {
		if g.Kind != GroupRequest || g.Total != 0 {
			t.Errorf("group %+v", g)
		}
	}
	ctxB, err := s.Context(ctx, b.LineageID, 10)
	if err != nil || len(ctxB.Groups) != 2 {
		t.Fatalf("context of b: %+v, %v", ctxB, err)
	}
	kinds := map[string]GroupContext{}
	for _, g := range ctxB.Groups {
		kinds[g.Kind] = g
	}
	if d := kinds[GroupDocument]; d.Key != "/docs/gateway.md" || d.Title != "gateway.md" || kinds[GroupRequest].Key != "r3" {
		t.Errorf("groups of b = %+v", ctxB.Groups)
	}
	var bad int
	_ = conn.QueryRow(`SELECT count(*) FROM memories WHERE lineage_id NOT GLOB 'km_*'`).Scan(&bad)
	if bad != 0 {
		t.Errorf("%d lineages kept an old id", bad)
	}

	for name, q := range map[string]string{
		"origin":        `UPDATE memories SET origin = 'agent' WHERE id = '` + v2.ID + `'`,
		"scope":         `UPDATE memories SET scope = 'company' WHERE id = '` + v2.ID + `'`,
		"session":       `UPDATE memories SET session_id = 'x' WHERE id = '` + v2.ID + `'`,
		"group delete":  `DELETE FROM memory_groups`,
		"member delete": `DELETE FROM memory_group_members`,
		"group update":  `UPDATE memory_groups SET title = 'x'`,
	} {
		if _, err := conn.Exec(q); err == nil {
			t.Errorf("%s: expected abort", name)
		}
	}
}
