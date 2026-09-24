package codeworkspace

import (
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

// P108 Part 20 F12: os.Stat never blocks regardless of what the path names, but os.Open does —
// opening a FIFO for reading blocks until some other process opens its write end. A FIFO reached
// through a symlink git tracked (never an escape: pathsafe.ValidateRelPath's requireUnder already
// rejects anything outside root) passed the old code's stat (size 0, not a dir) straight into a
// blocking os.ReadFile, pinning the bound call forever. This proves the actual fix — checking
// Mode().IsRegular() on the stat, before Open is ever attempted — rather than merely asserting it
// against a mock: a real mkfifo with no writer is the one thing that reproduces the hang the old
// code was vulnerable to, and nothing here waits for or provides a writer.
func TestReadFile_FIFO_ReturnsMissingWithoutHanging(t *testing.T) {
	dir := t.TempDir()
	fifoPath := filepath.Join(dir, "pipe")
	if err := syscall.Mkfifo(fifoPath, 0o600); err != nil {
		t.Fatalf("Mkfifo: %v", err)
	}

	done := make(chan FileContent, 1)
	errCh := make(chan error, 1)
	go func() {
		content, err := ReadFile(fifoPath, "pipe")
		if err != nil {
			errCh <- err
			return
		}
		done <- content
	}()

	select {
	case content := <-done:
		if content.Kind != "missing" {
			t.Fatalf("ReadFile(FIFO).Kind = %q, want %q", content.Kind, "missing")
		}
	case err := <-errCh:
		t.Fatalf("ReadFile(FIFO) returned an error: %v", err)
	case <-time.After(2 * time.Second):
		// A leaked goroutine blocked in os.Open on the FIFO outlives this test (nothing can
		// un-hang it without a writer) -- acceptable for a test proving the bug is gone, since it
		// only ever fires if that regression actually reappears.
		t.Fatal("ReadFile(FIFO) did not return within 2s — it hung opening the FIFO")
	}
}
