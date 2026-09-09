package gitrpc

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
)

// G30 round-1 architecture/security review, finding #2: `file.goToTarget`'s `rev` reached
// `git diff <rev> -- <path>` (WorktreeDiffArgs) as a bare argv token in an option-consuming
// position, unguarded beyond non-empty — a rev of "--output=<path>" makes `git diff` write
// (truncate/overwrite) an arbitrary file rather than erroring. `file.read`'s `rev` has the same
// shape one layer down (`git show <rev>:<path>`), and `commit.detail`/`commit.fileDiff`'s `sha`
// reaches `diff-tree`'s own revision position the same way. This proves all four are now rejected
// at the RPC boundary, and that goToTarget's write no longer happens.

func detailSecurityConn(t *testing.T, dir string) (Handlers, string) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	runner := gitclient.NewExecRunner()
	registry := gitsession.NewRegistry(runner)
	t.Cleanup(registry.Close)
	router := New(Deps{Runner: runner, Registry: registry, ServerVersion: "test"})
	conn := gitsession.NewConn(gitsession.ConnID("detail-rpc-test-conn"), "test-client", "test-label", nil)
	t.Cleanup(conn.Close)
	handlers := router.ForConn(conn)

	summary, err := conn.Open(context.Background(), registry, "git", dir)
	if err != nil {
		t.Fatalf("conn.Open: %v", err)
	}
	return handlers, summary.RepoID
}

func TestFileGoToTarget_RejectsOptionInjectingRev(t *testing.T) {
	dir := t.TempDir()
	resetSmokeGit(t, dir, "init", "-q", "-b", "main")
	targetPath := filepath.Join(dir, "target.txt")
	if err := os.WriteFile(targetPath, []byte("has real content\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	resetSmokeGit(t, dir, "add", "target.txt")
	resetSmokeGit(t, dir, "commit", "-q", "-m", "base")

	handlers, repoID := detailSecurityConn(t, dir)

	canary := filepath.Join(t.TempDir(), "diff-output")
	params, _ := json.Marshal(FileGoToTargetParams{
		RepoID: repoID,
		Rev:    "--output=" + canary,
		Path:   "target.txt",
	})

	_, err := handlers.Request(context.Background(), "file.goToTarget", params)
	if err == nil {
		t.Fatal("file.goToTarget: expected an error for an option-injecting rev, got nil")
	}
	if !strings.Contains(err.Error(), "must not begin with '-'") {
		t.Fatalf("file.goToTarget: expected a validRefArg rejection, got: %v", err)
	}
	if _, statErr := os.Stat(canary); statErr == nil {
		t.Fatalf("file.goToTarget: %s was created — the injected --output= option ran", canary)
	}
	// The real target file must be untouched too — the review's own repro truncated it to 0 bytes.
	content, err := os.ReadFile(targetPath)
	if err != nil {
		t.Fatalf("read target.txt: %v", err)
	}
	if string(content) != "has real content\n" {
		t.Fatalf("target.txt was modified: %q", content)
	}
}

func TestFileRead_RejectsOptionInjectingRev(t *testing.T) {
	dir := t.TempDir()
	resetSmokeGit(t, dir, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("one\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	resetSmokeGit(t, dir, "add", "f.txt")
	resetSmokeGit(t, dir, "commit", "-q", "-m", "base")

	handlers, repoID := detailSecurityConn(t, dir)

	params, _ := json.Marshal(FileReadParams{RepoID: repoID, Rev: "--batch", Path: "f.txt"})
	if _, err := handlers.Request(context.Background(), "file.read", params); err == nil {
		t.Fatal("file.read: expected an error for an option-injecting rev")
	}
}

func TestCommitDetailAndFileDiff_RejectOptionInjectingSHA(t *testing.T) {
	dir := t.TempDir()
	resetSmokeGit(t, dir, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("one\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	resetSmokeGit(t, dir, "add", "f.txt")
	resetSmokeGit(t, dir, "commit", "-q", "-m", "base")

	handlers, repoID := detailSecurityConn(t, dir)

	detailParams, _ := json.Marshal(CommitDetailParams{RepoID: repoID, SHA: "--all"})
	if _, err := handlers.Request(context.Background(), "commit.detail", detailParams); err == nil {
		t.Fatal("commit.detail: expected an error for an option-injecting sha")
	}

	diffParams, _ := json.Marshal(CommitFileDiffParams{RepoID: repoID, SHA: "--stdin", Path: "f.txt"})
	if _, err := handlers.Request(context.Background(), "commit.fileDiff", diffParams); err == nil {
		t.Fatal("commit.fileDiff: expected an error for an option-injecting sha")
	}
}
