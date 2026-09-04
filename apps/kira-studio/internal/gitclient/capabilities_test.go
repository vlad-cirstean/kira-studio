package gitclient

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestProbeCapabilities_OrdinaryRepo(t *testing.T) {
	dir := initFixtureRepo(t)
	gitPath := requireRealGit(t)
	summary, err := identify(context.Background(), NewExecRunner(), gitPath, dir)
	if err != nil {
		t.Fatalf("identify: %v", err)
	}

	caps, err := ProbeCapabilities(context.Background(), NewExecRunner(), gitPath, summary)
	if err != nil {
		t.Fatalf("ProbeCapabilities: %v", err)
	}
	if caps.CommitGraph {
		t.Error("CommitGraph = true, want false for a fresh repo with none written")
	}
	if caps.SparseWorktree {
		t.Error("SparseWorktree = true, want false by default")
	}
	if caps.LinkedWorktree {
		t.Error("LinkedWorktree = true, want false for the main worktree")
	}
}

func TestProbeCapabilities_CommitGraphPresent(t *testing.T) {
	dir := initFixtureRepo(t)
	gitPath := requireRealGit(t)
	runGit(t, dir, "commit-graph", "write", "--reachable")

	summary, err := identify(context.Background(), NewExecRunner(), gitPath, dir)
	if err != nil {
		t.Fatalf("identify: %v", err)
	}
	caps, err := ProbeCapabilities(context.Background(), NewExecRunner(), gitPath, summary)
	if err != nil {
		t.Fatalf("ProbeCapabilities: %v", err)
	}
	if !caps.CommitGraph {
		t.Error("CommitGraph = false, want true after `git commit-graph write`")
	}
}

func TestProbeCapabilities_SparseCheckoutEnabled(t *testing.T) {
	dir := initFixtureRepo(t)
	gitPath := requireRealGit(t)
	runGit(t, dir, "config", "core.sparseCheckout", "true")

	summary, err := identify(context.Background(), NewExecRunner(), gitPath, dir)
	if err != nil {
		t.Fatalf("identify: %v", err)
	}
	caps, err := ProbeCapabilities(context.Background(), NewExecRunner(), gitPath, summary)
	if err != nil {
		t.Fatalf("ProbeCapabilities: %v", err)
	}
	if !caps.SparseWorktree {
		t.Error("SparseWorktree = false, want true after core.sparseCheckout=true")
	}
}

func TestCommitGraphExists_ChunkedLayout(t *testing.T) {
	dir := t.TempDir()
	chunkedDir := filepath.Join(dir, "objects", "info", "commit-graphs")
	if err := os.MkdirAll(chunkedDir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(filepath.Join(chunkedDir, "commit-graph-chain"), []byte("x"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	if !commitGraphExists(dir) {
		t.Fatal("commitGraphExists = false, want true for a populated chunked layout")
	}
}

func TestCommitGraphExists_Absent(t *testing.T) {
	if commitGraphExists(t.TempDir()) {
		t.Fatal("commitGraphExists = true, want false for an empty directory")
	}
}
