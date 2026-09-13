// collections_export_atomicity_test.go is P21 round 3 architecture/security finding 7: Export
// used to os.Create(args.Path) directly — truncate-or-create — and stream
// postman.Write straight into it, so any failure after that point (a marshal error, a full disk,
// the process being killed mid-write) left the destination empty or half-written, with no cleanup.
// A re-export over an existing, good file is exactly the ordinary case (the save panel offers the
// existing filename), so this destroyed a good file on a failed re-export. writeFileAtomically now
// writes to a sibling temp file and renames onto the destination only once the write fully
// succeeds, mirroring internal/adapters/s3/transfer.go's downloadObject.
package bridge

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestWriteFileAtomically_FailedWriteLeavesExistingFileUntouched(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "collection.json")
	original := "{\"this is\": \"the original, good export\"}"
	if err := os.WriteFile(path, []byte(original), 0o600); err != nil {
		t.Fatalf("seed original file: %v", err)
	}

	writeErr := errors.New("boom: simulated marshal failure partway through the write")
	err := writeFileAtomically(path, func(f *os.File) error {
		// Write some real bytes first — under the old os.Create(path)-then-write approach this
		// would already have landed *in path itself*, truncating it, before the failure below.
		if _, werr := f.WriteString("partial output that must never reach the destination"); werr != nil {
			t.Fatalf("write partial output: %v", werr)
		}
		return writeErr
	})
	if err == nil {
		t.Fatal("writeFileAtomically: want an error from the failing write step")
	}

	got, readErr := os.ReadFile(path)
	if readErr != nil {
		t.Fatalf("ReadFile(path) after a failed write: %v — the original file must still exist", readErr)
	}
	if string(got) != original {
		t.Fatalf("path content after a failed write = %q, want the untouched original %q", got, original)
	}

	entries, readDirErr := os.ReadDir(dir)
	if readDirErr != nil {
		t.Fatalf("ReadDir: %v", readDirErr)
	}
	if len(entries) != 1 {
		names := make([]string, len(entries))
		for i, e := range entries {
			names[i] = e.Name()
		}
		t.Fatalf("directory has %d entries after a failed write, want 1 (no leftover .kira-partial-* temp file): %v", len(entries), names)
	}
}

func TestWriteFileAtomically_SuccessReplacesExistingFileWhole(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "collection.json")
	if err := os.WriteFile(path, []byte("old content"), 0o600); err != nil {
		t.Fatalf("seed original file: %v", err)
	}

	if err := writeFileAtomically(path, func(f *os.File) error {
		_, err := f.WriteString("new content")
		return err
	}); err != nil {
		t.Fatalf("writeFileAtomically: %v", err)
	}

	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if string(got) != "new content" {
		t.Fatalf("content = %q, want %q", got, "new content")
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("directory has %d entries after a successful write, want exactly 1 (no leftover temp file)", len(entries))
	}
}
