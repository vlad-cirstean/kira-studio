package storage_test

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/kirathecat/kira-studio/shell/internal/storage"
)

func TestOpenCreatesTightPermissions(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX permission bits don't apply on windows")
	}
	home := t.TempDir()
	t.Setenv("KIRA_HOME", home)

	db, err := storage.Open()
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	for _, dir := range []string{home, filepath.Join(home, "logs")} {
		info, err := os.Stat(dir)
		if err != nil {
			t.Fatalf("stat %s: %v", dir, err)
		}
		if got := info.Mode().Perm(); got != 0o700 {
			t.Errorf("mode of %s = %o, want 0700", dir, got)
		}
	}

	dbPath := filepath.Join(home, "kira.db")
	info, err := os.Stat(dbPath)
	if err != nil {
		t.Fatalf("stat %s: %v", dbPath, err)
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Errorf("mode of %s = %o, want 0600", dbPath, got)
	}
}

func TestOpenAppliesPragmas(t *testing.T) {
	t.Setenv("KIRA_HOME", t.TempDir())
	db, err := storage.Open()
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	tests := []struct {
		pragma string
		want   string
	}{
		{"journal_mode", "wal"},
		{"synchronous", "1"},
		{"foreign_keys", "1"},
		{"busy_timeout", "5000"},
	}
	for _, tt := range tests {
		t.Run(tt.pragma, func(t *testing.T) {
			var got string
			if err := db.QueryRow("PRAGMA " + tt.pragma).Scan(&got); err != nil {
				t.Fatalf("PRAGMA %s: %v", tt.pragma, err)
			}
			if got != tt.want {
				t.Errorf("PRAGMA %s = %q, want %q", tt.pragma, got, tt.want)
			}
		})
	}
}
