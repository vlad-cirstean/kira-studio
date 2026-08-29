package storage_test

import (
	"database/sql"
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/shell/internal/storage"
)

func TestMigrateIsIdempotent(t *testing.T) {
	t.Setenv("KIRA_HOME", t.TempDir())

	db1, err := storage.Open()
	if err != nil {
		t.Fatalf("first Open: %v", err)
	}
	var v1 int
	if err := db1.QueryRow(`SELECT version FROM schema_version`).Scan(&v1); err != nil {
		t.Fatalf("read version: %v", err)
	}
	if err := db1.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	db2, err := storage.Open()
	if err != nil {
		t.Fatalf("second Open: %v", err)
	}
	defer db2.Close() //nolint:errcheck

	var v2 int
	if err := db2.QueryRow(`SELECT version FROM schema_version`).Scan(&v2); err != nil {
		t.Fatalf("read version: %v", err)
	}
	if v1 != v2 {
		t.Errorf("schema_version changed across reopen: %d -> %d", v1, v2)
	}
}

func TestMigrateRefusesNewerSchemaVersion(t *testing.T) {
	t.Setenv("KIRA_HOME", t.TempDir())

	db, err := storage.Open()
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if _, err := db.Exec(`UPDATE schema_version SET version = 99`); err != nil {
		t.Fatalf("bump version: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	_, err = storage.Open()
	if err == nil {
		t.Fatal("Open with a newer schema_version = nil error, want an error")
	}
	if !strings.Contains(err.Error(), "newer") {
		t.Errorf("error = %q, want it to mention \"newer\"", err.Error())
	}
}

func TestMigrateCreatesExpectedSchema(t *testing.T) {
	t.Setenv("KIRA_HOME", t.TempDir())
	db, err := storage.Open()
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer db.Close() //nolint:errcheck

	wantTables := []string{
		"settings", "connections", "saved_queries", "metadata_cache", "op_log",
		"ui_layout", "tabs", "filter_history", "connection_tree_filters",
	}
	for _, table := range wantTables {
		var name string
		err := db.QueryRow(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, table).Scan(&name)
		if err != nil {
			t.Errorf("table %s: %v", table, err)
		}
	}

	// 0005_p28_tree_filters.sql drops connection_filters — must not still exist.
	var name string
	err = db.QueryRow(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'connection_filters'`).Scan(&name)
	if err != sql.ErrNoRows {
		t.Errorf("connection_filters table still exists (should be dropped by 0005), err = %v", err)
	}
}
