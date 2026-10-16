package importer

import (
	"path/filepath"
	"testing"

	"github.com/kirathecat/kira-studio/internal/memory/migrations"
	"github.com/kirathecat/kira-studio/internal/sqlitex"
)

// TestMigration5KeepsImports rebuilds the import tables on a v4 store holding a job, two files, chunks
// and an import event: every row survives, provenance is backfilled, nothing dangles, and the new
// kinds and state are accepted.
func TestMigration5KeepsImports(t *testing.T) {
	db, err := sqlitex.OpenImmediate(filepath.Join(t.TempDir(), "memory.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	steps, err := migrations.All()
	if err != nil || len(steps) < 5 {
		t.Fatalf("migrations = %d, %v", len(steps), err)
	}
	if err := sqlitex.Migrate(db, steps[:4]); err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`INSERT INTO import_jobs (id, roots, base, state, created_at) VALUES ('j1', '["/d"]', '/d', 'done', '2026-01-01T00:00:00Z')`,
		`INSERT INTO import_files (id, job_id, path, rel_path, kind, size, content_hash, state, chunk_count, added, updated_at)
			VALUES ('f1', 'j1', '/d/a.md', 'a.md', 'markdown', 10, 'h1', 'extracting', 2, 1, '2026-01-01T00:00:00Z'),
			       ('f2', 'j1', '/d/b.txt', 'b.txt', 'text', 20, 'h2', 'done', 0, 3, '2026-01-01T00:00:00Z')`,
		`INSERT INTO import_chunks (file_id, idx, heading_path, text, tokens, state, facts)
			VALUES ('f1', 0, 'A', 'alpha', 3, 'done', '[{"fact":"x"}]'), ('f1', 1, 'B', 'beta', 3, 'pending', '[]')`,
		`INSERT INTO memories (id, lineage_id, version, fact, reason, origin, source_tag, scope, status, fact_hash, created_at)
			VALUES ('km_aaaaaaaaaaaa.1', 'km_aaaaaaaaaaaa', 1, 'Alpha holds.', 'Said in a.md.', 'external', 'doc', 'personal', 'current', 'fh', '2026-01-01T00:00:00Z')`,
		`INSERT INTO memory_events (request_id, source, source_ref, action, lineage_id, memory_id, origin, source_tag, rationale, created_at)
			VALUES ('r1', 'import', 'f2', 'add', 'km_aaaaaaaaaaaa', 'km_aaaaaaaaaaaa.1', 'external', 'doc', 'new', '2026-01-01T00:00:00Z')`,
	} {
		if _, err := db.Exec(q); err != nil {
			t.Fatalf("seed: %v\n%s", err, q)
		}
	}
	if err := sqlitex.Migrate(db, steps); err != nil {
		t.Fatal(err)
	}

	count := func(q string) int {
		t.Helper()
		var n int
		if err := db.QueryRow(q).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	if n := count(`SELECT count(*) FROM import_files`); n != 2 {
		t.Errorf("files = %d", n)
	}
	if n := count(`SELECT count(*) FROM import_chunks WHERE file_id = 'f1' AND facts LIKE '%"x"%'`); n != 1 {
		t.Errorf("chunk facts lost")
	}
	if n := count(`SELECT count(*) FROM import_chunks`); n != 2 {
		t.Errorf("chunks = %d", n)
	}
	if n := count(`SELECT count(*) FROM import_jobs WHERE channel = 'ui' AND origin = 'external' AND source_tag = 'doc'
		AND scope = 'personal' AND project IS NULL AND auto_start = 0 AND write_doc = 0 AND groups_json = '[]'`); n != 1 {
		t.Errorf("job not backfilled")
	}
	if n := count(`SELECT count(*) FROM memory_events WHERE source_ref = 'f2'`); n != 1 {
		t.Errorf("import event lost")
	}
	if n := count(`SELECT count(*) FROM pragma_foreign_key_check`); n != 0 {
		t.Errorf("foreign_key_check reports %d rows", n)
	}
	for _, q := range []string{
		`INSERT INTO import_files (id, job_id, path, rel_path, kind, size, state, updated_at)
			VALUES ('f3', 'j1', '/d/c.json', 'c.json', 'json', 1, 'verifying', 'x'),
			       ('f4', 'j1', '/d/d.jsonl', 'd.jsonl', 'jsonl', 1, 'pending', 'x'),
			       ('f5', 'j1', '/d/e.md', 'e.md', 'memdoc', 1, 'pending', 'x')`,
	} {
		if _, err := db.Exec(q); err != nil {
			t.Errorf("new kind or state rejected: %v", err)
		}
	}
}
