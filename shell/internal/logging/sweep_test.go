package logging

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestSweepDeletesOldLogsKeepsRecentAndIgnoresOthers(t *testing.T) {
	t.Setenv("KIRA_HOME", t.TempDir())
	dir := filepath.Join(os.Getenv("KIRA_HOME"), "logs")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatalf("mkdir: %v", err)
	}

	old := filepath.Join(dir, "kira-2020-01-01.log")
	recent := filepath.Join(dir, "kira-2020-02-01.log")
	other := filepath.Join(dir, "notes.txt")
	oldTxt := filepath.Join(dir, "kira-old.txt")
	for _, p := range []string{old, recent, other, oldTxt} {
		if err := os.WriteFile(p, []byte("x"), 0o600); err != nil {
			t.Fatalf("write %s: %v", p, err)
		}
	}

	oldTime := time.Now().Add(-31 * 24 * time.Hour)
	recentTime := time.Now().Add(-29 * 24 * time.Hour)
	if err := os.Chtimes(old, oldTime, oldTime); err != nil {
		t.Fatalf("chtimes old: %v", err)
	}
	if err := os.Chtimes(recent, recentTime, recentTime); err != nil {
		t.Fatalf("chtimes recent: %v", err)
	}
	if err := os.Chtimes(other, oldTime, oldTime); err != nil {
		t.Fatalf("chtimes other: %v", err)
	}
	if err := os.Chtimes(oldTxt, oldTime, oldTime); err != nil {
		t.Fatalf("chtimes oldTxt: %v", err)
	}

	Sweep()

	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Errorf("kira-2020-01-01.log still exists, want deleted")
	}
	if _, err := os.Stat(recent); err != nil {
		t.Errorf("kira-2020-02-01.log missing, want kept: %v", err)
	}
	if _, err := os.Stat(other); err != nil {
		t.Errorf("notes.txt missing, want ignored/kept: %v", err)
	}
	if _, err := os.Stat(oldTxt); err != nil {
		t.Errorf("kira-old.txt missing, want ignored/kept (wrong extension): %v", err)
	}
}

func TestSweepOnMissingDirectoryIsANoOp(t *testing.T) {
	t.Setenv("KIRA_HOME", t.TempDir())
	Sweep() // logs/ was never created; must not panic or error out loud
}
