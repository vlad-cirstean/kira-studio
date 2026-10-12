package migrations

import (
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

// P266: migration 0033 moves the stored ade.panelWidth settings leaf to the panel.ade.width layout
// leaf once, and deletes it from settings.
func TestMigration33MovesAdePanelWidth(t *testing.T) {
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
		t.Helper()
		for _, m := range steps {
			if m.Version == version {
				if _, err := db.Exec(m.SQL); err != nil {
					t.Fatalf("apply v%d: %v", version, err)
				}
			}
		}
	}
	for v := 1; v <= 32; v++ {
		apply(v)
	}
	exec := func(q string) {
		t.Helper()
		if _, err := db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO settings (key, value) VALUES ('ade.panelWidth', '480'), ('ade.horizonDays', '14')`)
	exec(`INSERT INTO ui_layout (key, value) VALUES ('panel.project.width', '260')`)
	apply(33)

	var width string
	if err := db.QueryRow(`SELECT value FROM ui_layout WHERE key = 'panel.ade.width'`).Scan(&width); err != nil || width != "480" {
		t.Fatalf("panel.ade.width = %q, err %v, want 480", width, err)
	}
	var left int
	if err := db.QueryRow(`SELECT count(*) FROM settings WHERE key = 'ade.panelWidth'`).Scan(&left); err != nil || left != 0 {
		t.Errorf("ade.panelWidth rows left = %d, err %v, want 0", left, err)
	}
	var other int
	if err := db.QueryRow(`SELECT count(*) FROM settings WHERE key = 'ade.horizonDays'`).Scan(&other); err != nil || other != 1 {
		t.Errorf("ade.horizonDays rows = %d, err %v, want 1", other, err)
	}
	var project string
	if err := db.QueryRow(`SELECT value FROM ui_layout WHERE key = 'panel.project.width'`).Scan(&project); err != nil || project != "260" {
		t.Errorf("panel.project.width = %q, err %v, want 260", project, err)
	}
}
