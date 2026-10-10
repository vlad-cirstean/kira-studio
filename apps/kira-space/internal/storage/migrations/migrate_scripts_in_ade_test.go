package migrations

import (
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

// P242 Part 3: a script saved before migration 0029 reads back with the worktree option on, and a
// run before it has no task.
func TestMigration29DefaultsExistingScriptsToAdeDir(t *testing.T) {
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
	for v := 1; v <= 28; v++ {
		apply(v)
	}
	for _, q := range []string{
		`INSERT INTO custom_scripts (id, name, command, working_dir, color, sort_order, created_at, updated_at)
			VALUES ('s1', 's1', 'true', '', 'none', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
		`INSERT INTO script_runs (id, script_id, script_name, kind, trigger_kind, state, created_at)
			VALUES ('r1', 's1', 's1', 'script', 'manual', 'done', 1)`,
	} {
		if _, err := db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	apply(29)
	var ade int
	var task string
	if err := db.QueryRow(`SELECT use_ade_dir FROM custom_scripts WHERE id = 's1'`).Scan(&ade); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT task_id || branch_label FROM script_runs WHERE id = 'r1'`).Scan(&task); err != nil {
		t.Fatal(err)
	}
	if ade != 1 || task != "" {
		t.Errorf("got use_ade_dir=%d task fields=%q", ade, task)
	}
}
