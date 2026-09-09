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

// G30 round-1 architecture/security finding #1: `remote.run`'s `remote` field reached `git
// fetch`/`push` argv as a bare, unguarded token — a remote beginning with "-" is read as an
// option rather than a remote name, and `git fetch --upload-pack=<cmd> <local-path-remote>`
// executes `<cmd>` through a shell. This test proves the same exploit the review verified against
// a real `git` (an `--upload-pack=` remote name spawning an arbitrary command) is now rejected at
// the RPC boundary, before any git process is spawned, rather than merely happening not to fire.
func TestRemoteRun_RejectsOptionInjectingRemoteName(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	dir := t.TempDir()
	resetSmokeGit(t, dir, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("one\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	resetSmokeGit(t, dir, "add", "f.txt")
	resetSmokeGit(t, dir, "commit", "-q", "-m", "base")

	// A bare local-path remote — exactly the shape ("worktree mirrors, `git clone /path` copies")
	// the review flagged as the realistic attack surface for `--upload-pack=`.
	upstream := t.TempDir()
	resetSmokeGit(t, upstream, "init", "-q", "--bare")
	resetSmokeGit(t, dir, "remote", "add", "origin", upstream)

	runner := gitclient.NewExecRunner()
	registry := gitsession.NewRegistry(runner)
	t.Cleanup(registry.Close)
	router := New(Deps{Runner: runner, Registry: registry, ServerVersion: "test"})
	conn := gitsession.NewConn(gitsession.ConnID("remote-rpc-test-conn"), "test-client", "test-label", nil)
	t.Cleanup(conn.Close)
	handlers := router.ForConn(conn)

	summary, err := conn.Open(context.Background(), registry, "git", dir)
	if err != nil {
		t.Fatalf("conn.Open: %v", err)
	}

	canary := filepath.Join(t.TempDir(), "pwned")
	maliciousRemote := "--upload-pack=touch " + canary + " && git-upload-pack"
	params, _ := json.Marshal(RemoteRunParams{
		RepoID: summary.RepoID,
		RemoteOpParams: gitsession.RemoteOpParams{
			Kind:   "fetch",
			Remote: maliciousRemote,
		},
	})

	_, err = handlers.Request(context.Background(), "remote.run", params)
	if err == nil {
		t.Fatal("remote.run: expected an error for an option-injecting remote name, got nil")
	}
	if !strings.Contains(err.Error(), "must not begin with '-'") {
		t.Fatalf("remote.run: expected a validRefArg rejection, got: %v", err)
	}
	if _, statErr := os.Stat(canary); statErr == nil {
		t.Fatalf("remote.run: canary file %s was created — the injected command ran", canary)
	}
}

// The same guard applies to remote.pushPreflight and remote.pullPreflight's own `branch`/`remote`
// fields — both reach the same class of argv position (pushPreflight calls gitops argv builders
// directly; pullPreflight's branch feeds gitpreflight's own resolver).
func TestRemotePreflight_RejectsOptionInjectingBranchOrRemote(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	dir := t.TempDir()
	resetSmokeGit(t, dir, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("one\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	resetSmokeGit(t, dir, "add", "f.txt")
	resetSmokeGit(t, dir, "commit", "-q", "-m", "base")

	runner := gitclient.NewExecRunner()
	registry := gitsession.NewRegistry(runner)
	t.Cleanup(registry.Close)
	router := New(Deps{Runner: runner, Registry: registry, ServerVersion: "test"})
	conn := gitsession.NewConn(gitsession.ConnID("remote-preflight-rpc-test-conn"), "test-client", "test-label", nil)
	t.Cleanup(conn.Close)
	handlers := router.ForConn(conn)

	summary, err := conn.Open(context.Background(), registry, "git", dir)
	if err != nil {
		t.Fatalf("conn.Open: %v", err)
	}

	pullParams, _ := json.Marshal(RemotePullPreflightParams{RepoID: summary.RepoID, Branch: "--force"})
	if _, err := handlers.Request(context.Background(), "remote.pullPreflight", pullParams); err == nil {
		t.Fatal("remote.pullPreflight: expected an error for a branch beginning with '-'")
	}

	pushParams, _ := json.Marshal(RemotePushPreflightParams{RepoID: summary.RepoID, Branch: "main", Remote: "--upload-pack=x"})
	if _, err := handlers.Request(context.Background(), "remote.pushPreflight", pushParams); err == nil {
		t.Fatal("remote.pushPreflight: expected an error for a remote beginning with '-'")
	}
}
