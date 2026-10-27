package migrations

import (
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

// P379: migration 0051 backfills status_id and status_step per task, first matching rule wins.
func TestMigration51BackfillsTaskStatuses(t *testing.T) {
	db, err := sql.Open("sqlite", "file:"+t.TempDir()+"/kira.sqlite")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	steps, err := All()
	if err != nil {
		t.Fatal(err)
	}
	apply := func(version int) {
		t.Helper()
		for _, m := range steps {
			if m.Version == version {
				if _, err := db.Exec(m.SQL); err != nil {
					t.Fatalf("apply v%d: %v", version, err)
				}
			}
		}
	}
	for v := 1; v <= 50; v++ {
		apply(v)
	}
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(q, args...); err != nil {
			t.Fatal(err)
		}
	}
	const wf = `{"id":"w","name":"W","steps":[{"id":"a","status":"In progress"},{"id":"b","status":"In review"},{"id":"c","status":"Weird"},{"id":"d","status":"Done"}]}`
	task := func(id, kind, workflowID, entry string, workflowJSON any) {
		exec(`INSERT INTO ade_tasks (id, kind, color, created_at, workflow_id, entry_step_id, workflow_json) VALUES (?, ?, 0, 1, ?, ?, ?)`,
			id, kind, workflowID, entry, workflowJSON)
	}
	run := func(taskID, purpose string) {
		exec(`INSERT INTO ade_runs (id, task_id, step_id, attempt, state, purpose) VALUES (?, ?, 'a', 1, 'done', ?)`, taskID+"-r", taskID, purpose)
	}
	task("review", "review", "", "", nil)
	task("finished", "task", "w", "done", wf)
	task("parked", "parked", "w", "a", wf)
	task("noflow", "task", "", "", nil)
	task("untouched", "task", "w", "a", wf)
	// A rebase run is not workflow progress: the rule keys on purpose = ''.
	task("rebase-only", "task", "w", "a", wf)
	run("rebase-only", "rebase")
	task("at-b", "task", "w", "b", wf)
	run("at-b", "")
	task("at-c", "task", "w", "c", wf)
	run("at-c", "")
	task("missing-step", "task", "w", "zz", wf)
	run("missing-step", "")
	task("session-only", "task", "w", "d", wf)
	exec(`INSERT INTO ade_sessions (id, task_id, agent_session_id, cwd, state, started_at, last_active_at) VALUES ('s', 'session-only', 'c', '/', 'running', 1, 1)`)

	apply(51)

	want := map[string][2]string{
		"review":       {"in-review", ""},
		"finished":     {"done", "done"},
		"parked":       {"todo", ""},
		"noflow":       {"todo", ""},
		"untouched":    {"todo", ""},
		"rebase-only":  {"todo", ""},
		"at-b":         {"in-review", "b"},
		"at-c":         {"in-progress", "c"},
		"missing-step": {"in-progress", "zz"},
		"session-only": {"done", "d"},
	}
	for id, w := range want {
		var status, step, by string
		if err := db.QueryRow(`SELECT status_id, status_step, status_by FROM ade_tasks WHERE id = ?`, id).Scan(&status, &step, &by); err != nil {
			t.Fatal(err)
		}
		if status != w[0] || step != w[1] || by != "auto" {
			t.Errorf("%s: status %q step %q by %q, want %q %q auto", id, status, step, by, w[0], w[1])
		}
	}
	var n int
	if err := db.QueryRow(`SELECT count(*) FROM ade_task_statuses`).Scan(&n); err != nil || n != 4 {
		t.Errorf("seeded statuses = %d, err %v, want 4", n, err)
	}
}
