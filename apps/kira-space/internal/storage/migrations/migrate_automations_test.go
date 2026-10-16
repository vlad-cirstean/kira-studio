package migrations

import (
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

// P242: migration 0026 renames the 'terminal' mode and tab workspace to 'automations', classifies
// each script's folder, and adds the run store and the ADE outcome column.
func TestMigration26RenamesTerminalModeAndClassifiesScriptFolders(t *testing.T) {
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
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(q, args...); err != nil {
			t.Fatalf("exec %q: %v", q, err)
		}
	}
	one := func(q string, args ...any) string {
		t.Helper()
		var v string
		if err := db.QueryRow(q, args...).Scan(&v); err != nil {
			t.Fatalf("query %q: %v", q, err)
		}
		return v
	}

	for v := 1; v <= 25; v++ {
		apply(v)
	}
	exec(`INSERT INTO windows (key, "order", bounds_json, mode) VALUES ('w2', 1, NULL, 'terminal')`)
	exec(`INSERT INTO tabs (id, path, kind, state_json, "order", active, window_key, workspace_id)
		VALUES ('t1', '', 'terminal', '{}', 0, 1, 'w2', 'terminal')`)
	for _, row := range [][2]string{{"home", ""}, {"fixed", "/srv/build"}} {
		exec(`INSERT INTO custom_scripts (id, name, command, working_dir, color, sort_order, created_at, updated_at)
			VALUES (?, ?, 'true', ?, 'none', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`, row[0], row[0], row[1])
	}
	apply(26)

	if got := one(`SELECT mode FROM windows WHERE key = 'w2'`); got != "automations" {
		t.Errorf("window mode = %q, want automations", got)
	}
	if got := one(`SELECT workspace_id FROM tabs WHERE id = 't1'`); got != "automations" {
		t.Errorf("tab workspace = %q, want automations", got)
	}
	for _, id := range []string{"home", "fixed"} {
		if got := one(`SELECT dir_mode FROM custom_scripts WHERE id = ?`, id); got != id {
			t.Errorf("dir_mode(%s) = %q, want %q", id, got, id)
		}
	}
	if _, err := db.Exec(`SELECT outcome_json FROM ade_runs LIMIT 1`); err != nil {
		t.Errorf("ade_runs.outcome_json: %v", err)
	}
	if _, err := db.Exec(`SELECT id FROM script_runs LIMIT 1`); err != nil {
		t.Errorf("script_runs: %v", err)
	}
}
