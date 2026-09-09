package gitrpc

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"sync/atomic"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitpreflight"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
)

// These tests exercise the real Router.ForConn dispatch (D16/§7.1 item 6) — the same convention
// worktree_test.go/gh_test.go already established: JSON decode through wire.go's own param types,
// handlers.go's four new switch cases, and gitsession's real orchestration underneath.

func stackRpcGit(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.com",
		"GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.com",
		"GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_SYSTEM=/dev/null",
	)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

func initStackRpcRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	stackRpcGit(t, dir, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("hello\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	stackRpcGit(t, dir, "add", "f.txt")
	stackRpcGit(t, dir, "commit", "-q", "-m", "base")
	return dir
}

// verbCountingRunner wraps a real Runner, counting spawns whose argv[0] matches one of the given
// verbs — the Router-level analogue of gitsession's own argSpawnCountingRunner.
type verbCountingRunner struct {
	gitclient.Runner
	counts map[string]*int32
}

func newVerbCountingRunner(verbs ...string) *verbCountingRunner {
	r := &verbCountingRunner{Runner: gitclient.NewExecRunner(), counts: map[string]*int32{}}
	for _, v := range verbs {
		var n int32
		r.counts[v] = &n
	}
	return r
}

func (r *verbCountingRunner) Start(ctx context.Context, gitPath string, spec gitclient.Spec) (gitclient.Process, error) {
	if len(spec.Args) > 0 {
		if n, ok := r.counts[spec.Args[0]]; ok {
			atomic.AddInt32(n, 1)
		}
	}
	return r.Runner.Start(ctx, gitPath, spec)
}

func (r *verbCountingRunner) count(verb string) int32 { return atomic.LoadInt32(r.counts[verb]) }

// TestStackList_UnstackedRepo_OneConfigReadNothingElse is §7.1 item 6's own exact exit criterion: a
// Router over a counting fake runner drives app.init, repo.open, refs.list, graph.loadMore,
// status.get, then stack.list — asserting exactly one `config --local --null --get-regexp` and no
// `rev-list`.
func TestStackList_UnstackedRepo_OneConfigReadNothingElse(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	dir := initStackRpcRepo(t)

	runner := newVerbCountingRunner("config", "rev-list")
	registry := gitsession.NewRegistry(runner)
	t.Cleanup(registry.Close)
	discovery := gitclient.NewDiscovery(alwaysGitLocator{}, runner, gitclient.NewRealClock())
	router := New(Deps{Discovery: discovery, Runner: runner, Registry: registry, ServerVersion: "test"})
	ctx := context.Background()

	_ = router.handleAppInit(ctx)

	conn := gitsession.NewConn(gitsession.ConnID("stack-rpc-zero-spawn-conn"), "test-client", "test-label", nil)
	t.Cleanup(conn.Close)
	handlers := router.ForConn(conn)

	openParams, _ := json.Marshal(RepoOpenParams{Path: dir})
	openResultAny, err := handlers.Request(ctx, "repo.open", openParams)
	if err != nil {
		t.Fatalf("repo.open: %v", err)
	}
	opened, ok := openResultAny.(RepoOpenResult)
	if !ok || opened.Kind != "ok" || opened.Repo == nil {
		t.Fatalf("repo.open result = %+v, want ok", openResultAny)
	}
	repoID := opened.Repo.RepoID

	refsParams, _ := json.Marshal(RefsListParams{RepoID: repoID})
	if _, err := handlers.Request(ctx, "refs.list", refsParams); err != nil {
		t.Fatalf("refs.list: %v", err)
	}
	loadMoreParams, _ := json.Marshal(GraphLoadMoreParams{RepoID: repoID})
	if _, err := handlers.Request(ctx, "graph.loadMore", loadMoreParams); err != nil {
		t.Fatalf("graph.loadMore: %v", err)
	}
	statusParams, _ := json.Marshal(StatusGetParams{RepoID: repoID})
	if _, err := handlers.Request(ctx, "status.get", statusParams); err != nil {
		t.Fatalf("status.get: %v", err)
	}

	if got := runner.count("config"); got != 0 {
		t.Fatalf("config spawns before stack.list = %d, want 0", got)
	}

	stackListParams, _ := json.Marshal(StackListParams{RepoID: repoID})
	res, err := handlers.Request(ctx, "stack.list", stackListParams)
	if err != nil {
		t.Fatalf("stack.list: %v", err)
	}
	result, ok := res.(gitpreflight.StackListResult)
	if !ok || len(result.Stacks) != 0 || len(result.Orphans) != 0 {
		t.Fatalf("stack.list result = %+v, want empty", res)
	}

	if got := runner.count("config"); got != 1 {
		t.Fatalf("config spawns = %d, want exactly 1", got)
	}
	if got := runner.count("rev-list"); got != 0 {
		t.Fatalf("rev-list spawns = %d, want 0", got)
	}
}

func TestStackRestack_BlockedPreflightSpawnsNoRebase(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	dir := initStackRpcRepo(t)

	runner := newVerbCountingRunner("rebase")
	registry := gitsession.NewRegistry(runner)
	t.Cleanup(registry.Close)
	discovery := gitclient.NewDiscovery(alwaysGitLocator{}, runner, gitclient.NewRealClock())
	router := New(Deps{Discovery: discovery, Runner: runner, Registry: registry, ServerVersion: "test"})
	ctx := context.Background()

	conn := gitsession.NewConn(gitsession.ConnID("stack-rpc-blocked-conn"), "test-client", "test-label", nil)
	t.Cleanup(conn.Close)
	handlers := router.ForConn(conn)

	openParams, _ := json.Marshal(RepoOpenParams{Path: dir})
	openResultAny, err := handlers.Request(ctx, "repo.open", openParams)
	if err != nil {
		t.Fatalf("repo.open: %v", err)
	}
	opened := openResultAny.(RepoOpenResult)
	repoID := opened.Repo.RepoID

	// "main" is not part of any stack at all -> preflight.restack answers "blocked", and
	// stack.restack must refuse with no rebase spawn.
	restackParams, _ := json.Marshal(StackRestackParams{RepoID: repoID, Branch: "main"})
	res, err := handlers.Request(ctx, "stack.restack", restackParams)
	if err != nil {
		t.Fatalf("stack.restack: %v", err)
	}
	result, ok := res.(gitsession.RestackResult)
	if !ok || result.OK {
		t.Fatalf("stack.restack result = %+v, want blocked", res)
	}
	if got := runner.count("rebase"); got != 0 {
		t.Fatalf("rebase spawns = %d, want 0 for a blocked restack", got)
	}
}

// TestStackRestack_ConflictOverDispatch is this step's own "manual smoke against a real
// three-branch fixture, including a deliberately conflicting one" (plan §6 step 9) — driven through
// the exact Router.ForConn dispatch path a raw socket client uses (JSON decode via wire.go's own
// param types, then gitsession's real orchestration), rather than gitsession's own direct-call
// tests.
func TestStackRestack_ConflictOverDispatch(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	dir := t.TempDir()
	stackRpcGit(t, dir, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "shared.txt"), []byte("line1\nline2\nline3\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	stackRpcGit(t, dir, "add", "shared.txt")
	stackRpcGit(t, dir, "commit", "-q", "-m", "c1")

	stackRpcGit(t, dir, "checkout", "-q", "-b", "feat1")
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("a\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	stackRpcGit(t, dir, "add", "a.txt")
	stackRpcGit(t, dir, "commit", "-q", "-m", "c2 feat1")

	stackRpcGit(t, dir, "checkout", "-q", "-b", "feat2")
	if err := os.WriteFile(filepath.Join(dir, "shared.txt"), []byte("line1\nline2-feat2\nline3\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	stackRpcGit(t, dir, "add", "shared.txt")
	stackRpcGit(t, dir, "commit", "-q", "-m", "c3 feat2 (will conflict)")

	stackRpcGit(t, dir, "checkout", "-q", "-b", "feat3")
	if err := os.WriteFile(filepath.Join(dir, "b.txt"), []byte("b\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	stackRpcGit(t, dir, "add", "b.txt")
	stackRpcGit(t, dir, "commit", "-q", "-m", "c4 feat3")

	for _, pair := range [][2]string{{"feat1", "main"}, {"feat2", "feat1"}, {"feat3", "feat2"}} {
		child, parent := pair[0], pair[1]
		cmd := exec.Command("git", "rev-parse", parent)
		cmd.Dir = dir
		out, err := cmd.Output()
		if err != nil {
			t.Fatalf("rev-parse %s: %v", parent, err)
		}
		tip := string(out[:len(out)-1])
		stackRpcGit(t, dir, "config", "--local", "branch."+child+".kirastackparent", parent)
		stackRpcGit(t, dir, "config", "--local", "branch."+child+".kirastackbase", tip)
	}

	// feat1 advances with a conflicting edit to the SAME line feat2 touched.
	stackRpcGit(t, dir, "checkout", "-q", "feat1")
	if err := os.WriteFile(filepath.Join(dir, "shared.txt"), []byte("line1\nline2-feat1\nline3\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	stackRpcGit(t, dir, "add", "shared.txt")
	stackRpcGit(t, dir, "commit", "-q", "-m", "c5 feat1 advances (conflicting)")
	stackRpcGit(t, dir, "checkout", "-q", "feat3")

	runner := gitclient.NewExecRunner()
	registry := gitsession.NewRegistry(runner)
	t.Cleanup(registry.Close)
	discovery := gitclient.NewDiscovery(alwaysGitLocator{}, runner, gitclient.NewRealClock())
	router := New(Deps{Discovery: discovery, Runner: runner, Registry: registry, ServerVersion: "test"})
	ctx := context.Background()

	conn := gitsession.NewConn(gitsession.ConnID("stack-rpc-conflict-conn"), "test-client", "test-label", nil)
	t.Cleanup(conn.Close)
	handlers := router.ForConn(conn)

	openParams, _ := json.Marshal(RepoOpenParams{Path: dir})
	openResultAny, err := handlers.Request(ctx, "repo.open", openParams)
	if err != nil {
		t.Fatalf("repo.open: %v", err)
	}
	repoID := openResultAny.(RepoOpenResult).Repo.RepoID

	// preflight.restack first, exactly as the client dialog does.
	pfParams, _ := json.Marshal(PreflightRestackParams{RepoID: repoID, Branch: "feat3"})
	pfRes, err := handlers.Request(ctx, "preflight.restack", pfParams)
	if err != nil {
		t.Fatalf("preflight.restack: %v", err)
	}
	pf, ok := pfRes.(gitpreflight.RestackPreflight)
	if !ok || pf.Verdict != "clean" || len(pf.Plan) != 2 {
		t.Fatalf("preflight.restack result = %+v, want a clean two-branch plan", pfRes)
	}

	restackParams, _ := json.Marshal(StackRestackParams{RepoID: repoID, Branch: "feat3"})
	restackRes, err := handlers.Request(ctx, "stack.restack", restackParams)
	if err != nil {
		t.Fatalf("stack.restack: %v", err)
	}
	result, ok := restackRes.(gitsession.RestackResult)
	if !ok || result.OK {
		t.Fatalf("stack.restack result = %+v, want a conflict", restackRes)
	}
	if result.Error == nil || result.Error.Kind != "Conflict" {
		t.Fatalf("result.Error = %+v, want Conflict", result.Error)
	}
	if result.StoppedAt == nil || *result.StoppedAt != "feat2" {
		t.Fatalf("stoppedAt = %v, want feat2", result.StoppedAt)
	}
	if result.Undo != nil {
		t.Fatal("D8: a conflicting restack must set no undo record")
	}
	if result.InProgress == nil || result.InProgress.Kind != gitpreflight.InProgressRebase {
		t.Fatalf("inProgress = %+v, want a rebase in progress", result.InProgress)
	}

	// G5's own banner is now actionable via op.run's opAbort (D12 flips canContinue too, but this
	// smoke only needs to prove the paused state is real and recoverable).
	abortParams, _ := json.Marshal(OpRunParams{RepoID: repoID, Op: gitsession.OpRequest{Kind: "opAbort"}})
	if _, err := handlers.Request(ctx, "op.run", abortParams); err != nil {
		t.Fatalf("op.run opAbort: %v", err)
	}
}

func TestStackCancelRestack_IdleReportsFalse(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	dir := initStackRpcRepo(t)
	runner := gitclient.NewExecRunner()
	registry := gitsession.NewRegistry(runner)
	t.Cleanup(registry.Close)
	discovery := gitclient.NewDiscovery(alwaysGitLocator{}, runner, gitclient.NewRealClock())
	router := New(Deps{Discovery: discovery, Runner: runner, Registry: registry, ServerVersion: "test"})
	ctx := context.Background()

	conn := gitsession.NewConn(gitsession.ConnID("stack-rpc-cancel-conn"), "test-client", "test-label", nil)
	t.Cleanup(conn.Close)
	handlers := router.ForConn(conn)

	openParams, _ := json.Marshal(RepoOpenParams{Path: dir})
	openResultAny, err := handlers.Request(ctx, "repo.open", openParams)
	if err != nil {
		t.Fatalf("repo.open: %v", err)
	}
	repoID := openResultAny.(RepoOpenResult).Repo.RepoID

	cancelParams, _ := json.Marshal(StackCancelRestackParams{RepoID: repoID})
	res, err := handlers.Request(ctx, "stack.cancelRestack", cancelParams)
	if err != nil {
		t.Fatalf("stack.cancelRestack: %v", err)
	}
	result, ok := res.(StackCancelRestackResult)
	if !ok || result.Cancelled {
		t.Fatalf("result = %+v, want {cancelled:false}", res)
	}
}

// TestOpRun_StackSet_OverDispatch proves stackSet is served through the ordinary op.run path (D10)
// — no dedicated handler needed.
func TestOpRun_StackSet_OverDispatch(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	dir := initStackRpcRepo(t)
	stackRpcGit(t, dir, "checkout", "-q", "-b", "feat1")
	runner := gitclient.NewExecRunner()
	registry := gitsession.NewRegistry(runner)
	t.Cleanup(registry.Close)
	discovery := gitclient.NewDiscovery(alwaysGitLocator{}, runner, gitclient.NewRealClock())
	router := New(Deps{Discovery: discovery, Runner: runner, Registry: registry, ServerVersion: "test"})
	ctx := context.Background()

	conn := gitsession.NewConn(gitsession.ConnID("stack-rpc-opset-conn"), "test-client", "test-label", nil)
	t.Cleanup(conn.Close)
	handlers := router.ForConn(conn)

	openParams, _ := json.Marshal(RepoOpenParams{Path: dir})
	openResultAny, err := handlers.Request(ctx, "repo.open", openParams)
	if err != nil {
		t.Fatalf("repo.open: %v", err)
	}
	repoID := openResultAny.(RepoOpenResult).Repo.RepoID

	parent := "main"
	opParams, _ := json.Marshal(OpRunParams{RepoID: repoID, Op: gitsession.OpRequest{Kind: "stackSet", Branch: "feat1", Parent: &parent}})
	res, err := handlers.Request(ctx, "op.run", opParams)
	if err != nil {
		t.Fatalf("op.run: %v", err)
	}
	result, ok := res.(gitsession.OpResult)
	if !ok || !result.OK {
		t.Fatalf("result = %+v, want ok", res)
	}
}
