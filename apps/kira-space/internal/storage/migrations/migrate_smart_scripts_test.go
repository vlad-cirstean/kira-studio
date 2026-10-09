package migrations

import (
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

// P242 Part 2: a script saved before migration 0028 reads back as a normal script with no params.
func TestMigration28DefaultsExistingScriptsToNormal(t *testing.T) {
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
	for v := 1; v <= 27; v++ {
		apply(v)
	}
	if _, err := db.Exec(`INSERT INTO custom_scripts (id, name, command, working_dir, color, sort_order, created_at, updated_at)
		VALUES ('s1', 's1', 'true', '', 'none', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`); err != nil {
		t.Fatal(err)
	}
	apply(28)
	var kind, params, smart string
	if err := db.QueryRow(`SELECT kind, params_json, smart_json FROM custom_scripts WHERE id = 's1'`).Scan(&kind, &params, &smart); err != nil {
		t.Fatal(err)
	}
	if kind != "script" || params != "[]" || smart != "" {
		t.Errorf("got kind=%q params=%q smart=%q", kind, params, smart)
	}
	if _, err := db.Exec(`SELECT run_id, seq, stream, text FROM script_run_logs LIMIT 1`); err != nil {
		t.Errorf("script_run_logs: %v", err)
	}
}
