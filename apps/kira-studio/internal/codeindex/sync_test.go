package codeindex

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
)

func requireRealGit(t *testing.T) string {
	t.Helper()
	path, err := exec.LookPath("git")
	if err != nil {
		t.Skip("no git on PATH in this environment")
	}
	return path
}

func runGit(t *testing.T, dir string, args ...string) {
	t.Helper()
	gitPath := requireRealGit(t)
	cmd := exec.Command(gitPath, args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	if err := cmd.Run(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out.String())
	}
}

func initFixtureRepo(t *testing.T) string {
	t.Helper()
	requireRealGit(t)
	dir := t.TempDir()
	runGit(t, dir, "init", "-q", "-b", "main")
	return dir
}

// newTestIndex builds an Index against a real temp repository and its own isolated codeindex.db
// (a separate t.TempDir(), never $KIRA_HOME) — the same real-git-required, real-tempdir shape
// every internal/git* suite uses.
func newTestIndex(t *testing.T, repoDir, repoID string) *Index {
	t.Helper()
	gitPath := requireRealGit(t)
	store := OpenStoreAt(t.TempDir())
	t.Cleanup(func() { _ = store.Close() })
	idx := Open(store, gitclient.NewExecRunner(), gitPath, repoID, repoDir)
	t.Cleanup(idx.Close)
	return idx
}

func writeFile(t *testing.T, dir, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", name, err)
	}
}

// TestSync_UnchangedFileDoesNoWork is §11 point 2's first rule: a file whose size and mtime both
// still match its stored row is fresh — the second Sync of an untouched repository parses nothing.
func TestSync_UnchangedFileDoesNoWork(t *testing.T) {
	dir := initFixtureRepo(t)
	writeFile(t, dir, "a.js", "function f() {}\n")
	idx := newTestIndex(t, dir, "repo-unchanged")
	ctx := context.Background()

	stats, err := idx.Sync(ctx)
	if err != nil {
		t.Fatalf("first sync: %v", err)
	}
	if stats.FilesParsed != 1 {
		t.Fatalf("first sync: FilesParsed = %d, want 1", stats.FilesParsed)
	}

	stats2, err := idx.Sync(ctx)
	if err != nil {
		t.Fatalf("second sync: %v", err)
	}
	if stats2.FilesParsed != 0 {
		t.Fatalf("second sync (nothing changed): FilesParsed = %d, want 0", stats2.FilesParsed)
	}
}

// TestSync_ChangedSizeIsReparsed covers the "changed in size only" rule.
func TestSync_ChangedSizeIsReparsed(t *testing.T) {
	dir := initFixtureRepo(t)
	writeFile(t, dir, "a.js", "function f() {}\n")
	idx := newTestIndex(t, dir, "repo-size")
	ctx := context.Background()

	if _, err := idx.Sync(ctx); err != nil {
		t.Fatalf("first sync: %v", err)
	}

	writeFile(t, dir, "a.js", "function f() { return 1; }\n") // longer: size changed.
	stats, err := idx.Sync(ctx)
	if err != nil {
		t.Fatalf("second sync: %v", err)
	}
	if stats.FilesParsed != 1 {
		t.Fatalf("FilesParsed = %d, want 1 (size changed)", stats.FilesParsed)
	}

	syms, err := idx.store.FindSymbolsByName(ctx, idx.repoID, "f")
	if err != nil {
		t.Fatalf("FindSymbolsByName: %v", err)
	}
	if len(syms) != 1 {
		t.Fatalf("expected exactly one row for f() after replace, got %d", len(syms))
	}
}

// TestSync_ContentChangedAtIdenticalSizeAndMtimeIsNotDetected is §5.3's own named, honest
// limitation: staleness compares only size_bytes and mtime_unix_ns; content_sha is computed only
// once a file is already being read for some other reason, never as a second stat-only pass. A
// content edit that preserves both size and mtime (forced here via os.Chtimes, since a real editor
// never does this) is invisible to Sync — this test pins that down as documented behavior, not an
// accidental gap discovered later.
func TestSync_ContentChangedAtIdenticalSizeAndMtimeIsNotDetected(t *testing.T) {
	dir := initFixtureRepo(t)
	writeFile(t, dir, "a.js", "function foo() {}\n")
	idx := newTestIndex(t, dir, "repo-samesize")
	ctx := context.Background()

	if _, err := idx.Sync(ctx); err != nil {
		t.Fatalf("first sync: %v", err)
	}
	info, err := os.Stat(filepath.Join(dir, "a.js"))
	if err != nil {
		t.Fatal(err)
	}
	originalMtime := info.ModTime()

	// Same byte length as the original ("foo" -> "bar", both 3 bytes) — a genuinely different
	// function name, deliberately at identical size.
	writeFile(t, dir, "a.js", "function bar() {}\n")
	if err := os.Chtimes(filepath.Join(dir, "a.js"), originalMtime, originalMtime); err != nil {
		t.Fatal(err)
	}

	stats, err := idx.Sync(ctx)
	if err != nil {
		t.Fatalf("second sync: %v", err)
	}
	if stats.FilesParsed != 0 {
		t.Fatalf("FilesParsed = %d, want 0 (size+mtime both unchanged, per §5.3)", stats.FilesParsed)
	}

	// The stored row still reflects the OLD content — foo, not bar — confirming the cache is
	// stale rather than silently correct by some other path.
	oldSyms, err := idx.store.FindSymbolsByName(ctx, idx.repoID, "foo")
	if err != nil || len(oldSyms) != 1 {
		t.Fatalf("expected the stale row for foo() to still be present: syms=%v err=%v", oldSyms, err)
	}
	newSyms, err := idx.store.FindSymbolsByName(ctx, idx.repoID, "bar")
	if err != nil || len(newSyms) != 0 {
		t.Fatalf("expected no row for bar() yet: syms=%v err=%v", newSyms, err)
	}
}

// TestSync_DeletedFileRemovesRow covers reconcile's own deletion pass (§6 step 3).
func TestSync_DeletedFileRemovesRow(t *testing.T) {
	dir := initFixtureRepo(t)
	writeFile(t, dir, "a.js", "function f() {}\n")
	idx := newTestIndex(t, dir, "repo-delete")
	ctx := context.Background()

	if _, err := idx.Sync(ctx); err != nil {
		t.Fatalf("first sync: %v", err)
	}
	if _, ok, _ := idx.store.GetFile(ctx, idx.repoID, "a.js"); !ok {
		t.Fatal("expected a.js to be indexed after first sync")
	}

	if err := os.Remove(filepath.Join(dir, "a.js")); err != nil {
		t.Fatal(err)
	}
	stats, err := idx.Sync(ctx)
	if err != nil {
		t.Fatalf("second sync: %v", err)
	}
	if stats.FilesDeleted != 1 {
		t.Fatalf("FilesDeleted = %d, want 1", stats.FilesDeleted)
	}
	if _, ok, _ := idx.store.GetFile(ctx, idx.repoID, "a.js"); ok {
		t.Fatal("expected a.js's row to be gone after deletion")
	}
}

// TestSync_RenamedFileIsDeletePlusCreate covers §5.4's own framing of a rename: "a rename or a
// deletion frees its rows in the same pass that notices it" — old path's row gone, new path's row
// present, in one Sync.
func TestSync_RenamedFileIsDeletePlusCreate(t *testing.T) {
	dir := initFixtureRepo(t)
	writeFile(t, dir, "old.js", "function f() {}\n")
	idx := newTestIndex(t, dir, "repo-rename")
	ctx := context.Background()

	if _, err := idx.Sync(ctx); err != nil {
		t.Fatalf("first sync: %v", err)
	}

	if err := os.Rename(filepath.Join(dir, "old.js"), filepath.Join(dir, "new.js")); err != nil {
		t.Fatal(err)
	}
	stats, err := idx.Sync(ctx)
	if err != nil {
		t.Fatalf("second sync: %v", err)
	}
	if stats.FilesDeleted != 1 {
		t.Fatalf("FilesDeleted = %d, want 1", stats.FilesDeleted)
	}
	if stats.FilesParsed != 1 {
		t.Fatalf("FilesParsed = %d, want 1", stats.FilesParsed)
	}
	if _, ok, _ := idx.store.GetFile(ctx, idx.repoID, "old.js"); ok {
		t.Fatal("expected old.js's row to be gone")
	}
	if _, ok, _ := idx.store.GetFile(ctx, idx.repoID, "new.js"); !ok {
		t.Fatal("expected new.js to be indexed")
	}
}

// TestSync_FingerprintMismatchTruncatesRepo is §5.3's own last rule: a stored
// meta.parser_fingerprint that disagrees with the binary's current one means the extraction
// contract changed under the stored rows, so the WHOLE repository's rows are truncated and
// rebuilt — proven here by hand-inserting a row Sync's own enumeration would never produce, then
// confirming it is gone after a Sync that starts from a deliberately wrong stored fingerprint.
func TestSync_FingerprintMismatchTruncatesRepo(t *testing.T) {
	dir := initFixtureRepo(t)
	writeFile(t, dir, "a.js", "function f() {}\n")
	idx := newTestIndex(t, dir, "repo-fingerprint")
	ctx := context.Background()

	if _, err := idx.Sync(ctx); err != nil {
		t.Fatalf("first sync: %v", err)
	}

	// A row Sync itself would never write (no such file exists) — proof of truncation, not just
	// "the real files got re-parsed on top of what was already there."
	if err := idx.store.ReplaceFile(ctx, FileWrite{
		RepoID: idx.repoID, Path: "ghost.js", Language: "javascript",
		ParseStatus: StatusOK, ParsedAt: time.Now().UnixMilli(), ContentSHA: make([]byte, 32),
	}); err != nil {
		t.Fatalf("seed ghost file: %v", err)
	}
	if err := idx.store.SetMeta(ctx, idx.repoID, parserFingerprintKey, "deliberately-wrong"); err != nil {
		t.Fatalf("seed wrong fingerprint: %v", err)
	}

	stats, err := idx.Sync(ctx)
	if err != nil {
		t.Fatalf("sync after fingerprint mismatch: %v", err)
	}
	if stats.FilesParsed != 1 {
		t.Fatalf("FilesParsed = %d, want 1 (a.js rebuilt from scratch)", stats.FilesParsed)
	}
	if _, ok, _ := idx.store.GetFile(ctx, idx.repoID, "ghost.js"); ok {
		t.Fatal("expected ghost.js's row to be gone — the fingerprint mismatch should have truncated it")
	}

	stored, had, err := idx.store.GetMeta(ctx, idx.repoID, parserFingerprintKey)
	if err != nil || !had {
		t.Fatalf("expected a stored fingerprint after sync: had=%v err=%v", had, err)
	}
	if stored == "deliberately-wrong" {
		t.Fatal("expected the stored fingerprint to be updated to the real current value")
	}
}
