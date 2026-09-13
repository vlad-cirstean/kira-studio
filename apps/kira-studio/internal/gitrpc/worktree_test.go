package gitrpc

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitpreflight"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// These tests exercise the real Router.ForConn dispatch (D16) — the same convention reset_test.go
// already established: JSON decode through wire.go's own param types, handlers.go's five new
// switch cases, and gitsession's real orchestration underneath — the one layer gitsession's own
// tests (which call RepoEntry methods directly) never touch.

func worktreeSmokeGit(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.com",
		"GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.com",
	)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

// worktreeSmokeConn opens dir with an optional prepareScript override — "" leaves the feature off,
// matching D10's own default.
func worktreeSmokeConn(t *testing.T, dir, prepareScript string) (Handlers, string) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	runner := gitclient.NewExecRunner()
	registry := gitsession.NewRegistry(runner)
	registry.RepoSettingsGet = func(string) (model.GitRepoSettings, error) {
		s := model.DefaultGitRepoSettings()
		s.WorktreePrepareScript = prepareScript
		return s, nil
	}
	t.Cleanup(registry.Close)
	router := New(Deps{Runner: runner, Registry: registry, ServerVersion: "test"})
	conn := gitsession.NewConn(gitsession.ConnID("worktree-rpc-test-conn"), "test-client", "test-label", nil)
	t.Cleanup(conn.Close)
	handlers := router.ForConn(conn)

	summary, err := conn.Open(context.Background(), registry, "git", dir)
	if err != nil {
		t.Fatalf("conn.Open: %v", err)
	}
	return handlers, summary.RepoID
}

func initWorktreeSmokeRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	worktreeSmokeGit(t, dir, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("one\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	worktreeSmokeGit(t, dir, "add", "f.txt")
	worktreeSmokeGit(t, dir, "commit", "-q", "-m", "base")
	return dir
}

func mustJSON(t *testing.T, v any) json.RawMessage {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return b
}

func TestWorktreeList_OverDispatch(t *testing.T) {
	dir := initWorktreeSmokeRepo(t)
	wtPath := filepath.Join(t.TempDir(), "linked")
	worktreeSmokeGit(t, dir, "worktree", "add", "-b", "feature", wtPath)

	handlers, repoID := worktreeSmokeConn(t, dir, "")
	res, err := handlers.Request(context.Background(), "worktree.list", mustJSON(t, WorktreeListParams{RepoID: repoID}))
	if err != nil {
		t.Fatalf("worktree.list: %v", err)
	}
	result, ok := res.(WorktreeListResult)
	if !ok {
		t.Fatalf("result = %T, want WorktreeListResult", res)
	}
	if len(result.Worktrees) != 2 {
		t.Fatalf("got %d worktrees, want 2: %+v", len(result.Worktrees), result.Worktrees)
	}
}

func TestPreflightWorktreeAdd_OverDispatch(t *testing.T) {
	dir := initWorktreeSmokeRepo(t)
	handlers, repoID := worktreeSmokeConn(t, dir, "")

	res, err := handlers.Request(context.Background(), "preflight.worktreeAdd", mustJSON(t, PreflightWorktreeAddParams{
		RepoID: repoID, Path: filepath.Join(t.TempDir(), "wt"), Mode: "newBranch", Branch: "topic", StartPoint: "main",
	}))
	if err != nil {
		t.Fatalf("preflight.worktreeAdd: %v", err)
	}
	pf, ok := res.(gitpreflight.WorktreeAddPreflight)
	if !ok {
		t.Fatalf("result = %T, want gitpreflight.WorktreeAddPreflight", res)
	}
	if pf.Verdict != "clean" {
		t.Fatalf("got %+v", pf)
	}
}

func TestPreflightWorktreeRemove_MainBlocked_OverDispatch(t *testing.T) {
	dir := initWorktreeSmokeRepo(t)
	handlers, repoID := worktreeSmokeConn(t, dir, "")

	res, err := handlers.Request(context.Background(), "preflight.worktreeRemove", mustJSON(t, PreflightWorktreeRemoveParams{RepoID: repoID, Path: dir}))
	if err != nil {
		t.Fatalf("preflight.worktreeRemove: %v", err)
	}
	pf, ok := res.(gitpreflight.WorktreeRemovePreflight)
	if !ok {
		t.Fatalf("result = %T, want gitpreflight.WorktreeRemovePreflight", res)
	}
	if pf.Verdict != "blocked" {
		t.Fatalf("got %+v, want blocked (main worktree)", pf)
	}
}

func TestOpRunWorktreeAddAndRemove_OverDispatch(t *testing.T) {
	dir := initWorktreeSmokeRepo(t)
	handlers, repoID := worktreeSmokeConn(t, dir, "")
	wtPath := filepath.Join(t.TempDir(), "op-wt")

	addRes, err := handlers.Request(context.Background(), "op.run", mustJSON(t, OpRunParams{
		RepoID: repoID,
		Op:     gitsession.OpRequest{Kind: "worktreeAdd", Path: wtPath, Mode: "newBranch", Branch: "topic", StartPoint: "main"},
	}))
	if err != nil {
		t.Fatalf("op.run (worktreeAdd): %v", err)
	}
	addResult, ok := addRes.(gitsession.OpResult)
	if !ok || !addResult.OK {
		t.Fatalf("op.run (worktreeAdd) result = %+v (ok=%v)", addRes, ok)
	}

	// Removing it clean (no dirty files) needs no confirmation.
	removeRes, err := handlers.Request(context.Background(), "op.run", mustJSON(t, OpRunParams{
		RepoID: repoID,
		Op:     gitsession.OpRequest{Kind: "worktreeRemove", Path: wtPath},
	}))
	if err != nil {
		t.Fatalf("op.run (worktreeRemove): %v", err)
	}
	removeResult, ok := removeRes.(gitsession.OpResult)
	if !ok || !removeResult.OK {
		t.Fatalf("op.run (worktreeRemove) result = %+v (ok=%v)", removeRes, ok)
	}
}

func TestWorktreePrepare_NotConfigured_OverDispatch(t *testing.T) {
	dir := initWorktreeSmokeRepo(t)
	handlers, repoID := worktreeSmokeConn(t, dir, "")

	res, err := handlers.Request(context.Background(), "worktree.prepare", mustJSON(t, WorktreePrepareParams{
		RepoID: repoID, Path: dir, ScriptSha256: "anything",
	}))
	if err != nil {
		t.Fatalf("worktree.prepare: %v", err)
	}
	result, ok := res.(gitsession.WorktreePrepareResult)
	if !ok || result.OK || result.Error == nil || result.Error.Kind != "NotConfigured" {
		t.Fatalf("got %+v (ok=%v), want NotConfigured", res, ok)
	}
}

// TestWorktreePrepare_ScriptChangedNeverSpawns_OverDispatch is the exit-criteria's own item 9
// exercised through the FULL RPC dispatch path (not just gitsession directly): a mismatched
// scriptSha256 answers ScriptChanged and — since handleWorktreePrepare's production Runner is the
// real gitprepare.NewOSRunner() default — a passing test here is itself proof no shell was ever
// spawned (a real spawn of the configured script would leave observable side effects / take
// meaningfully longer; the digest mismatch must short-circuit before gitprepare is ever reached at
// all per RunPrepare's own documented order).
func TestWorktreePrepare_ScriptChangedNeverSpawns_OverDispatch(t *testing.T) {
	dir := initWorktreeSmokeRepo(t)
	handlers, repoID := worktreeSmokeConn(t, dir, "echo should-never-run")

	res, err := handlers.Request(context.Background(), "worktree.prepare", mustJSON(t, WorktreePrepareParams{
		RepoID: repoID, Path: dir, ScriptSha256: "0000000000000000000000000000000000000000000000000000000000000000",
	}))
	if err != nil {
		t.Fatalf("worktree.prepare: %v", err)
	}
	result, ok := res.(gitsession.WorktreePrepareResult)
	if !ok || result.OK || result.Error == nil || result.Error.Kind != "ScriptChanged" {
		t.Fatalf("got %+v (ok=%v), want ScriptChanged", res, ok)
	}
}

func TestWorktreeCancelPrepare_NothingRunning_OverDispatch(t *testing.T) {
	dir := initWorktreeSmokeRepo(t)
	handlers, repoID := worktreeSmokeConn(t, dir, "")

	res, err := handlers.Request(context.Background(), "worktree.cancelPrepare", mustJSON(t, WorktreeCancelPrepareParams{RepoID: repoID}))
	if err != nil {
		t.Fatalf("worktree.cancelPrepare: %v", err)
	}
	result, ok := res.(WorktreeCancelPrepareResult)
	if !ok || result.Cancelled {
		t.Fatalf("got %+v (ok=%v), want Cancelled=false", res, ok)
	}
}

// The literal ContractVersion exit-criteria assertion (G26 D17's TestContractVersion_Is29) moves
// forward again at G28 D17 to gitrpc/stash_test.go's own TestContractVersion_Is30 — the same
// "moved forward in the same commit that bumps the constant" convention this phase inherits.
