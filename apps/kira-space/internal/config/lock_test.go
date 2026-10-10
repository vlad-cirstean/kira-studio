package config

import (
	"path/filepath"
	"testing"
)

func TestAcquireLock(t *testing.T) {
	path := filepath.Join(t.TempDir(), "app.lock")
	first, ok, err := AcquireLock(path)
	if err != nil || !ok {
		t.Fatalf("first acquire: ok=%v err=%v", ok, err)
	}
	// A second open file description on the same path is refused even in one process.
	if _, ok, err := AcquireLock(path); err != nil || ok {
		t.Fatalf("second acquire: ok=%v err=%v, want refused", ok, err)
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}
	again, ok, err := AcquireLock(path)
	if err != nil || !ok {
		t.Fatalf("reacquire: ok=%v err=%v", ok, err)
	}
	_ = again.Close()
}
