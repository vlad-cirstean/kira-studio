// P242 Part 3: migration 0036 lets a script run in a task's worktree; a script saved before it reads
// back with the option on, and a run before it has no task.
package migrations_test

import (
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/migrations"
)

func TestMigration36DefaultsExistingScriptsToAdeDir(t *testing.T) {
	db := openAt(t, 35)
	mustExec(t, db, `INSERT INTO custom_scripts (id, name, command, working_dir, color, sort_order, created_at, updated_at)
		VALUES ('s1', 's1', 'true', '', 'none', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`)
	mustExec(t, db, `INSERT INTO script_runs (id, script_id, script_name, kind, trigger_kind, state, created_at)
		VALUES ('r1', 's1', 's1', 'script', 'manual', 'done', 1)`)
	steps, err := migrations.All()
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range steps {
		if m.Version == 36 {
			mustExec(t, db, m.SQL)
		}
	}
	if n := scalarInt(t, db, `SELECT use_ade_dir FROM custom_scripts WHERE id = 's1'`); n != 1 {
		t.Errorf("use_ade_dir = %d, want 1", n)
	}
	if got := scalarString(t, db, `SELECT task_id || branch_label FROM script_runs WHERE id = 'r1'`); got != "" {
		t.Errorf("task fields = %q, want empty", got)
	}
}
