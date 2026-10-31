package migrations

import (
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

// P411: migration 0059 keeps tones as colours and seeds each default slot with the lowest-position
// status of the matching category, id breaking a position tie.
func TestMigration59SeedsStatusDefaults(t *testing.T) {
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
	for v := 1; v <= 51; v++ {
		apply(v)
	}
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(q, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`DELETE FROM ade_task_statuses`)
	exec(`INSERT INTO ade_task_statuses (id, name, tone, category, position) VALUES
		('later', 'Later', 'purple', 'active', 5),
		('z-doing', 'Doing', 'amber', 'active', 2),
		('a-doing', 'Also doing', 'red', 'active', 2),
		('queued', 'Queued', 'grey', 'todo', 1),
		('shipped', 'Shipped', 'green', 'done', 9)`)
	exec(`INSERT INTO ade_tasks (id, kind, color, created_at, status_id) VALUES ('t', 'task', 0, 1, 'later')`)
	for v := 52; v <= 59; v++ {
		apply(v)
	}

	colors := map[string]string{"later": "purple", "z-doing": "amber", "a-doing": "red", "queued": "grey", "shipped": "green"}
	for id, want := range colors {
		var got string
		if err := db.QueryRow(`SELECT color FROM ade_task_statuses WHERE id = ?`, id).Scan(&got); err != nil || got != want {
			t.Errorf("%s: color %q err %v, want %q", id, got, err, want)
		}
	}
	slots := map[string]string{}
	rows, err := db.Query(`SELECT slot, status_id FROM ade_task_status_defaults`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var slot, id string
		if err := rows.Scan(&slot, &id); err != nil {
			t.Fatal(err)
		}
		slots[slot] = id
	}
	// No review status exists, so the review slot stays absent (keep current).
	want := map[string]string{"new": "queued", "step": "a-doing", "finished": "shipped"}
	if len(slots) != len(want) {
		t.Errorf("slots = %v, want %v", slots, want)
	}
	for slot, id := range want {
		if slots[slot] != id {
			t.Errorf("slot %s = %q, want %q", slot, slots[slot], id)
		}
	}
	var statusID string
	if err := db.QueryRow(`SELECT status_id FROM ade_tasks WHERE id = 't'`).Scan(&statusID); err != nil || statusID != "later" {
		t.Errorf("task status = %q err %v, want unchanged later", statusID, err)
	}
}
