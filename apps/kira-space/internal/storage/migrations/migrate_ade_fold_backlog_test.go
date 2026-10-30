package migrations

import (
	"database/sql"
	"slices"
	"testing"

	_ "modernc.org/sqlite"
)

// P405: migration 0056 folds ade_backlog into Backlog-shelf tasks, keeping order and fields, and
// appends them after the existing plan rows.
func TestMigration56FoldsBacklogIntoTasks(t *testing.T) {
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
	for v := 1; v <= 55; v++ {
		apply(v)
	}
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(q, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO ade_tasks (id, kind, color, created_at) VALUES ('live', 'task', 0, 1)`)
	exec(`INSERT INTO ade_task_plan (task_id, day, position) VALUES ('live', '2026-09-24', 7)`)
	exec(`INSERT INTO ade_backlog (id, text, position, jira_key, jira_url, host_url, notes, added_at) VALUES
		('b2', 'second', 1, '', '', '', '', 20),
		('b1', 'first', 0, 'PAY-1', 'https://j/PAY-1', 'https://h/1', 'note', 10)`)

	apply(56)

	var title, jira, host, notes, status, by string
	var created int64
	if err := db.QueryRow(`SELECT title, jira_key, host_url, notes, created_at, status_id, status_by FROM ade_tasks WHERE id = 'b1'`).
		Scan(&title, &jira, &host, &notes, &created, &status, &by); err != nil {
		t.Fatal(err)
	}
	if title != "first" || jira != "PAY-1" || host != "https://h/1" || notes != "note" || created != 10 || status != "todo" || by != "auto" {
		t.Errorf("folded task = %q %q %q %q %d %q %q", title, jira, host, notes, created, status, by)
	}

	rows, err := db.Query(`SELECT task_id, day IS NULL, backlog FROM ade_task_plan ORDER BY position`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var order []string
	for rows.Next() {
		var id string
		var undated, backlog bool
		if err := rows.Scan(&id, &undated, &backlog); err != nil {
			t.Fatal(err)
		}
		if id != "live" && (!undated || !backlog) {
			t.Errorf("%s: undated %v backlog %v, want both", id, undated, backlog)
		}
		order = append(order, id)
	}
	if !slices.Equal(order, []string{"live", "b1", "b2"}) {
		t.Errorf("plan order = %v, want live b1 b2", order)
	}
	var left int
	if err := db.QueryRow(`SELECT count(*) FROM sqlite_master WHERE name = 'ade_backlog'`).Scan(&left); err != nil || left != 0 {
		t.Errorf("ade_backlog still exists: %d, %v", left, err)
	}
}
