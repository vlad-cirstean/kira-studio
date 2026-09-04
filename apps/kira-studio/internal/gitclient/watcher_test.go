package gitclient

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// pollInterval (500ms) makes this test slow rather than flaky on a loaded machine — it waits up
// to a generous multiple of the interval rather than asserting a tight deadline.
const watchTestTimeout = 5 * time.Second

func TestPollingWatcher_NotifiesOnChange(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "watched")
	if err := os.WriteFile(target, []byte("v1"), 0o644); err != nil {
		t.Fatalf("seed file: %v", err)
	}

	w := NewPollingWatcher()
	events, stop := w.Watch([]string{target})
	defer stop()

	// A change within the first tick must not be missed — write after a short delay so the
	// watcher's initial snapshot has definitely been taken.
	time.Sleep(50 * time.Millisecond)
	future := time.Now().Add(time.Hour)
	if err := os.Chtimes(target, future, future); err != nil {
		t.Fatalf("chtimes: %v", err)
	}

	select {
	case <-events:
	case <-time.After(watchTestTimeout):
		t.Fatal("no event received after modifying the watched file")
	}
}

func TestPollingWatcher_StopEndsTheGoroutine(t *testing.T) {
	dir := t.TempDir()
	w := NewPollingWatcher()
	_, stop := w.Watch([]string{filepath.Join(dir, "nonexistent")})
	stop()
	stop() // idempotent — a second Stop must not panic.
}

func TestPollingWatcher_MissingPathIsNotAnError(t *testing.T) {
	w := NewPollingWatcher()
	events, stop := w.Watch([]string{filepath.Join(t.TempDir(), "never-created")})
	defer stop()
	select {
	case <-events:
		t.Fatal("unexpected event for a path that never existed")
	case <-time.After(200 * time.Millisecond):
	}
}
