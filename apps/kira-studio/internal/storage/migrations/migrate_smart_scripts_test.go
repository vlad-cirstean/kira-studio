// P242 Part 2: migration 0035 adds smart scripts; a script saved before it reads back as a normal
// script with no params.
package migrations_test

import (
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/migrations"
)

func TestMigration35DefaultsExistingScriptsToNormal(t *testing.T) {
	db := openAt(t, 34)
	mustExec(t, db, `INSERT INTO custom_scripts (id, name, command, working_dir, color, sort_order, created_at, updated_at)
		VALUES ('s1', 's1', 'true', '', 'none', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`)
	steps, err := migrations.All()
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range steps {
		if m.Version == 35 {
			mustExec(t, db, m.SQL)
		}
	}
	for q, want := range map[string]string{
		`SELECT kind FROM custom_scripts WHERE id = 's1'`:        "script",
		`SELECT params_json FROM custom_scripts WHERE id = 's1'`: "[]",
		`SELECT smart_json FROM custom_scripts WHERE id = 's1'`:  "",
	} {
		if got := scalarString(t, db, q); got != want {
			t.Errorf("%s = %q, want %q", q, got, want)
		}
	}
	if n := scalarInt(t, db, `SELECT COUNT(*) FROM script_run_logs`); n != 0 {
		t.Errorf("script_run_logs holds %d rows, want an empty table", n)
	}
}
