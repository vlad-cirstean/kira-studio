package logging

import (
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/shell/internal/config"
)

func TestInitCreatesTodaysLogFileAtTightPermissions(t *testing.T) {
	t.Setenv("KIRA_HOME", t.TempDir())
	prev := slog.Default()
	t.Cleanup(func() { slog.SetDefault(prev) })

	if err := Init(); err != nil {
		t.Fatalf("Init: %v", err)
	}
	slog.Default().Info("hello", "scope", "test")

	today := time.Now().Format("2006-01-02")
	path := filepath.Join(config.LogsDir(), "kira-"+today+".log")
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat %s: %v", path, err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Errorf("mode = %o, want 0600", info.Mode().Perm())
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if !strings.Contains(string(data), "hello") || !strings.Contains(string(data), "scope=test") {
		t.Errorf("log file content = %q, want it to contain the record", data)
	}
}

func TestDailyWriterRollsOverAtMidnight(t *testing.T) {
	dir := t.TempDir()
	day1 := time.Date(2026, 1, 1, 23, 59, 0, 0, time.UTC)
	day2 := time.Date(2026, 1, 2, 0, 1, 0, 0, time.UTC)
	cur := day1
	w := newDailyWriter(dir, func() time.Time { return cur })

	if _, err := w.Write([]byte("first\n")); err != nil {
		t.Fatalf("write day1: %v", err)
	}
	cur = day2
	if _, err := w.Write([]byte("second\n")); err != nil {
		t.Fatalf("write day2: %v", err)
	}

	f1, err := os.ReadFile(filepath.Join(dir, "kira-2026-01-01.log"))
	if err != nil {
		t.Fatalf("read day1 file: %v", err)
	}
	if string(f1) != "first\n" {
		t.Errorf("day1 file = %q, want %q (untouched by the roll)", f1, "first\n")
	}
	f2, err := os.ReadFile(filepath.Join(dir, "kira-2026-01-02.log"))
	if err != nil {
		t.Fatalf("read day2 file: %v", err)
	}
	if string(f2) != "second\n" {
		t.Errorf("day2 file = %q, want %q", f2, "second\n")
	}
}
