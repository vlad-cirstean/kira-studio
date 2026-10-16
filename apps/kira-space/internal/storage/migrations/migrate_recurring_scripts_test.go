package migrations

import (
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

// P242 Part 4: migration 0030 rebuilds script_runs; rows and indexes survive and the new states insert.
func TestMigration30RebuildsScriptRuns(t *testing.T) {
	db, err := sql.Open("sqlite", "file:"+t.TempDir()+"/kira.sqlite?_foreign_keys=1")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	steps, err := All()
	if err != nil {
		t.Fatal(err)
	}
	apply := func(version int) {
		for _, m := range steps {
			if m.Version == version {
				if _, err := db.Exec(m.SQL); err != nil {
					t.Fatalf("apply v%d: %v", version, err)
				}
			}
		}
	}
	for v := 1; v <= 29; v++ {
		apply(v)
	}
	exec := func(q string) {
		t.Helper()
		if _, err := db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO script_runs (id, script_id, script_name, kind, trigger_kind, state, created_at, task_id)
		VALUES ('r1', 's1', 's1', 'script', 'manual', 'done', 1, 't1')`)
	apply(30)
	var task string
	if err := db.QueryRow(`SELECT task_id FROM script_runs WHERE id = 'r1'`).Scan(&task); err != nil || task != "t1" {
		t.Fatalf("task_id = %q, err %v", task, err)
	}
	exec(`INSERT INTO script_runs (id, script_id, script_name, trigger_kind, state, created_at) VALUES ('r2', 's1', 's1', 'scheduled', 'waiting', 2)`)
	exec(`INSERT INTO script_runs (id, script_id, script_name, trigger_kind, state, created_at) VALUES ('r3', 's1', 's1', 'scheduled', 'skipped', 3)`)
	var n int
	if err := db.QueryRow(`SELECT count(*) FROM sqlite_master WHERE type = 'index' AND name IN ('script_runs_created', 'script_runs_terminal', 'script_runs_task', 'script_runs_active')`).Scan(&n); err != nil || n != 4 {
		t.Errorf("indexes = %d, err %v, want 4", n, err)
	}
}
