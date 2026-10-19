package migrations

import (
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

// P312: migration 0039 seeds every module's project panel width from the old shared leaf and drops it.
func TestMigration39SeedsPerModePanelWidth(t *testing.T) {
	db, err := sql.Open("sqlite", "file:"+t.TempDir()+"/kira.sqlite?_foreign_keys=1")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	steps, err := All()
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range steps {
		if m.Version >= 39 {
			continue
		}
		if _, err := db.Exec(m.SQL); err != nil {
			t.Fatalf("apply v%d: %v", m.Version, err)
		}
	}
	if _, err := db.Exec(`INSERT INTO ui_layout (key, value) VALUES ('panel.project.width', '333'), ('panel.ade.width', '480')`); err != nil {
		t.Fatal(err)
	}
	for _, m := range steps {
		if m.Version == 39 {
			if _, err := db.Exec(m.SQL); err != nil {
				t.Fatalf("apply v39: %v", err)
			}
		}
	}

	for _, mode := range []string{"git", "automations", "ade", "memory"} {
		var got string
		if err := db.QueryRow(`SELECT value FROM ui_layout WHERE key = ?`, "modes."+mode+".project.width").Scan(&got); err != nil || got != "333" {
			t.Errorf("%s width = %q, err %v, want 333", mode, got, err)
		}
	}
	var legacy int
	if err := db.QueryRow(`SELECT count(*) FROM ui_layout WHERE key = 'panel.project.width'`).Scan(&legacy); err != nil || legacy != 0 {
		t.Errorf("legacy leaf rows = %d, err %v, want 0", legacy, err)
	}
	var ade string
	if err := db.QueryRow(`SELECT value FROM ui_layout WHERE key = 'panel.ade.width'`).Scan(&ade); err != nil || ade != "480" {
		t.Errorf("panel.ade.width = %q, err %v, want it untouched", ade, err)
	}
}
