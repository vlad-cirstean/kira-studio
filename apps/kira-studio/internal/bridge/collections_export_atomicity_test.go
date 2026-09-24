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

// P108 F18: os.Create(tmpPath)'s 0666-minus-umask default used to replace an existing 0600 export
// target's mode with whatever the process umask allowed, loosening it.
func TestWriteFileAtomically_PreservesExistingFileMode(t *testing.T) {
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

	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("Stat: %v", err)
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Fatalf("mode after overwrite = %o, want %o (the existing file's own mode preserved)", got, 0o600)
	}
}

// P108 F18: a fresh export (no existing target) gets a private 0600 default rather than whatever
// os.Create's 0666-minus-umask happened to leave.
func TestWriteFileAtomically_FreshFileGetsPrivateDefaultMode(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "collection.json")

	if err := writeFileAtomically(path, func(f *os.File) error {
		_, err := f.WriteString("new content")
		return err
	}); err != nil {
		t.Fatalf("writeFileAtomically: %v", err)
	}

	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("Stat: %v", err)
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Fatalf("mode for a fresh export = %o, want %o", got, 0o600)
	}
}

// P108 F18: exporting to a path that is a symlink used to replace the link itself with a regular
// file (the rename target was the link's own path); it must instead write through the link, onto
// its real target, leaving the link itself intact.
func TestWriteFileAtomically_WritesThroughASymlinkRatherThanReplacingIt(t *testing.T) {
	dir := t.TempDir()
	realPath := filepath.Join(dir, "real-collection.json")
	if err := os.WriteFile(realPath, []byte("old content"), 0o600); err != nil {
		t.Fatalf("seed real file: %v", err)
	}
	linkPath := filepath.Join(dir, "collection.json")
	if err := os.Symlink(realPath, linkPath); err != nil {
		t.Fatalf("Symlink: %v", err)
	}

	if err := writeFileAtomically(linkPath, func(f *os.File) error {
		_, err := f.WriteString("new content")
		return err
	}); err != nil {
		t.Fatalf("writeFileAtomically: %v", err)
	}

	linkInfo, err := os.Lstat(linkPath)
	if err != nil {
		t.Fatalf("Lstat(linkPath): %v", err)
	}
	if linkInfo.Mode()&os.ModeSymlink == 0 {
		t.Fatal("writeFileAtomically replaced the symlink with a regular file instead of writing through it")
	}

	got, err := os.ReadFile(realPath)
	if err != nil {
		t.Fatalf("ReadFile(realPath): %v", err)
	}
	if string(got) != "new content" {
		t.Fatalf("real target content = %q, want %q", got, "new content")
	}

	gotViaLink, err := os.ReadFile(linkPath)
	if err != nil {
		t.Fatalf("ReadFile(linkPath): %v", err)
	}
	if string(gotViaLink) != "new content" {
		t.Fatalf("content read via the symlink = %q, want %q", gotViaLink, "new content")
	}
}
