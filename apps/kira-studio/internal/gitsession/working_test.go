package gitsession

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
)

func byPath(changes []porcelain.FileChange) map[string]porcelain.FileChange {
	m := make(map[string]porcelain.FileChange, len(changes))
	for _, c := range changes {
		m[c.Path] = c
	}
	return m
}

// TestWorkingDetail_StagedUnstagedAndUntracked proves the three-way composition: a staged add, an
// unstaged modify (both from one `git diff HEAD` spawn) and an untracked file (from status.Entries,
// which a plain `git diff` never reports at all).
func TestWorkingDetail_StagedUnstagedAndUntracked(t *testing.T) {
	t.Parallel()
	skipWithoutGitQueries(t)
	dir := t.TempDir()
	runGitQ(t, dir, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("a\n"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	runGitQ(t, dir, "add", "a.txt")
	runGitQ(t, dir, "commit", "-q", "-m", "initial")

	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("a\nmodified\n"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "staged.txt"), []byte("new\n"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	runGitQ(t, dir, "add", "staged.txt")
	if err := os.WriteFile(filepath.Join(dir, "untracked.txt"), []byte("x\n"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	e := newQueriesTestEntry(t, dir)
	changes, err := e.WorkingDetail(context.Background())
	if err != nil {
		t.Fatalf("WorkingDetail: %v", err)
	}
	if len(changes) != 3 {
		t.Fatalf("got %d changes, want 3: %+v", len(changes), changes)
	}
	m := byPath(changes)
	if c, ok := m["a.txt"]; !ok || c.Kind != porcelain.FileModified {
		t.Fatalf("a.txt = %+v, ok=%v, want modified", c, ok)
	}
	if c, ok := m["staged.txt"]; !ok || c.Kind != porcelain.FileAdded {
		t.Fatalf("staged.txt = %+v, ok=%v, want added", c, ok)
	}
	untracked, ok := m["untracked.txt"]
	if !ok || untracked.Kind != porcelain.FileAdded {
		t.Fatalf("untracked.txt = %+v, ok=%v, want added", untracked, ok)
	}
	if untracked.Additions != nil || untracked.Deletions != nil {
		t.Fatalf("untracked.txt = %+v, want nil additions/deletions (stash.go's own precedent)", untracked)
	}
}

// TestWorkingDetail_CleanTree proves a clean checkout returns an empty, non-nil-shaped result —
// never an error.
func TestWorkingDetail_CleanTree(t *testing.T) {
	t.Parallel()
	skipWithoutGitQueries(t)
	dir := t.TempDir()
	runGitQ(t, dir, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("a\n"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	runGitQ(t, dir, "add", "a.txt")
	runGitQ(t, dir, "commit", "-q", "-m", "initial")

	e := newQueriesTestEntry(t, dir)
	changes, err := e.WorkingDetail(context.Background())
	if err != nil {
		t.Fatalf("WorkingDetail: %v", err)
	}
	if len(changes) != 0 {
		t.Fatalf("got %d changes on a clean tree, want 0: %+v", len(changes), changes)
	}
}

// TestWorkingDetail_UnbornHead proves the EmptyTreeSHA base works end to end against a fresh,
// zero-commit repo — the one case statusAndInProgress's own Branch.Unborn exists to signal.
func TestWorkingDetail_UnbornHead(t *testing.T) {
	t.Parallel()
	skipWithoutGitQueries(t)
	dir := t.TempDir()
	runGitQ(t, dir, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "staged.txt"), []byte("new\n"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	runGitQ(t, dir, "add", "staged.txt")

	e := newQueriesTestEntry(t, dir)
	changes, err := e.WorkingDetail(context.Background())
	if err != nil {
		t.Fatalf("WorkingDetail: %v", err)
	}
	if len(changes) != 1 || changes[0].Kind != porcelain.FileAdded || changes[0].Path != "staged.txt" {
		t.Fatalf("changes = %+v, want one added staged.txt", changes)
	}
}

// TestWorkingDetail_UnstagedRename proves an unstaged (on-disk-only) rename is detected — the shape
// commit.detail's own diff-tree path never sees, since a rename there is always already staged.
func TestWorkingDetail_UnstagedRename(t *testing.T) {
	t.Parallel()
	skipWithoutGitQueries(t)
	dir := t.TempDir()
	runGitQ(t, dir, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "old.txt"), []byte("line one\nline two\nline three\n"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	runGitQ(t, dir, "add", "old.txt")
	runGitQ(t, dir, "commit", "-q", "-m", "initial")
	runGitQ(t, dir, "mv", "old.txt", "renamed.txt")

	e := newQueriesTestEntry(t, dir)
	changes, err := e.WorkingDetail(context.Background())
	if err != nil {
		t.Fatalf("WorkingDetail: %v", err)
	}
	if len(changes) != 1 {
		t.Fatalf("got %d changes, want 1: %+v", len(changes), changes)
	}
	c := changes[0]
	if c.Kind != porcelain.FileRenamed || c.Path != "renamed.txt" || c.OriginalPath == nil || *c.OriginalPath != "old.txt" {
		t.Fatalf("changes[0] = %+v, want renamed old.txt -> renamed.txt", c)
	}
}
