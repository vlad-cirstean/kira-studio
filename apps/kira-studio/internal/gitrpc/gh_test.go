package gitrpc

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"sync/atomic"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ghclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// countingGhRunner is this file's own minimal ghclient.Runner fake (F13: no real `gh` anywhere) —
// every invocation, of any kind, increments calls; D13's own exit criterion is a spawn count of
// exactly 0 across six methods, then > 0 after one commit.resolvePr.
type countingGhRunner struct{ calls int32 }

func (r *countingGhRunner) Run(_ context.Context, _ string, spec ghclient.Spec) (ghclient.Result, error) {
	atomic.AddInt32(&r.calls, 1)
	if len(spec.Args) > 0 && spec.Args[0] == "api" {
		return ghclient.Result{ExitCode: 0, Stdout: []byte(`[]`)}, nil
	}
	return ghclient.Result{ExitCode: 0, Stdout: []byte("gh version 2.42.0 (2024-01-08)\n")}, nil
}

func (r *countingGhRunner) count() int { return int(atomic.LoadInt32(&r.calls)) }

type fakeGhLocatorForActivationTest struct{}

func (fakeGhLocatorForActivationTest) Locate() (string, []string, bool) {
	return "/usr/local/bin/gh", []string{"/usr/local/bin/gh"}, true
}

func activationGit(t *testing.T, dir string, args ...string) {
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

// TestActivation_ZeroGhSpawnsUntilResolvePr is D13's own exit criterion 7, verbatim: driving
// app.init, repo.open, refs.list, graph.loadMore, status.get and commit.detail against a COUNTING
// fake ghclient.Runner must produce EXACTLY ZERO spawns of any kind — this feature probes nothing,
// spawns nothing, and caches nothing until the very first commit.resolvePr/branch.resolvePr a
// client actually makes.
func TestActivation_ZeroGhSpawnsUntilResolvePr(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	dir := t.TempDir()
	activationGit(t, dir, "init", "-q", "-b", "main")
	activationGit(t, dir, "remote", "add", "origin", "https://github.com/acme/widgets.git")
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	activationGit(t, dir, "add", "f.txt")
	activationGit(t, dir, "commit", "-q", "-m", "first commit")
	sha := gitRevParseHEAD(t, dir)

	runner := gitclient.NewExecRunner()
	registry := gitsession.NewRegistry(runner)
	t.Cleanup(registry.Close)
	discovery := gitclient.NewDiscovery(alwaysGitLocator{}, runner, gitclient.NewRealClock())

	ghRunner := &countingGhRunner{}
	registry.Gh = ghclient.NewClient(
		ghclient.NewDiscovery(fakeGhLocatorForActivationTest{}, ghRunner, ghclient.NewRealClock()),
		ghRunner,
	)

	router := New(Deps{Discovery: discovery, Runner: runner, Registry: registry, ServerVersion: "test"})
	ctx := context.Background()

	// app.init: no repo held at all yet.
	_ = router.handleAppInit(ctx)
	if ghRunner.count() != 0 {
		t.Fatalf("app.init spawned gh %d times, want 0", ghRunner.count())
	}

	conn := gitsession.NewConn(gitsession.ConnID("gh-zero-spawn-conn"), "test-client", "test-label", nil)
	t.Cleanup(conn.Close)
	handlers := router.ForConn(conn)

	openParams, _ := json.Marshal(RepoOpenParams{Path: dir})
	openResultAny, err := handlers.Request(ctx, "repo.open", openParams)
	if err != nil {
		t.Fatalf("repo.open: %v", err)
	}
	if ghRunner.count() != 0 {
		t.Fatalf("repo.open spawned gh %d times, want 0", ghRunner.count())
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
	if ghRunner.count() != 0 {
		t.Fatalf("refs.list spawned gh %d times, want 0", ghRunner.count())
	}

	loadMoreParams, _ := json.Marshal(GraphLoadMoreParams{RepoID: repoID})
	if _, err := handlers.Request(ctx, "graph.loadMore", loadMoreParams); err != nil {
		t.Fatalf("graph.loadMore: %v", err)
	}
	if ghRunner.count() != 0 {
		t.Fatalf("graph.loadMore spawned gh %d times, want 0", ghRunner.count())
	}

	statusParams, _ := json.Marshal(StatusGetParams{RepoID: repoID})
	if _, err := handlers.Request(ctx, "status.get", statusParams); err != nil {
		t.Fatalf("status.get: %v", err)
	}
	if ghRunner.count() != 0 {
		t.Fatalf("status.get spawned gh %d times, want 0", ghRunner.count())
	}

	detailParams, _ := json.Marshal(CommitDetailParams{RepoID: repoID, SHA: sha})
	if _, err := handlers.Request(ctx, "commit.detail", detailParams); err != nil {
		t.Fatalf("commit.detail: %v", err)
	}
	if ghRunner.count() != 0 {
		t.Fatalf("commit.detail spawned gh %d times, want 0 (zero-spawn window)", ghRunner.count())
	}

	// Now the one call that DOES touch ghclient — spawn count must become > 0.
	resolveParams, _ := json.Marshal(CommitResolvePrParams{RepoID: repoID, SHA: sha})
	resolveResultAny, err := handlers.Request(ctx, "commit.resolvePr", resolveParams)
	if err != nil {
		t.Fatalf("commit.resolvePr: %v", err)
	}
	if _, ok := resolveResultAny.(PrLookupResult); !ok {
		t.Fatalf("commit.resolvePr result = %T, want PrLookupResult", resolveResultAny)
	}
	if ghRunner.count() == 0 {
		t.Fatal("commit.resolvePr spawned gh 0 times, want > 0")
	}
}

func gitRevParseHEAD(t *testing.T, dir string) string {
	t.Helper()
	cmd := exec.Command("git", "rev-parse", "HEAD")
	cmd.Dir = dir
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("git rev-parse HEAD: %v", err)
	}
	return trimTrailingNLGh(string(out))
}

func trimTrailingNLGh(s string) string {
	for len(s) > 0 && (s[len(s)-1] == '\n' || s[len(s)-1] == '\r') {
		s = s[:len(s)-1]
	}
	return s
}

// TestBranchResolvePr_DisabledWhenGithubSettingOff proves the settings.get-driven disabled path
// (D16) spawns nothing at all.
func TestBranchResolvePr_DisabledWhenGithubSettingOff(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	dir := t.TempDir()
	activationGit(t, dir, "init", "-q", "-b", "main")
	activationGit(t, dir, "commit", "-q", "--allow-empty", "-m", "first commit")

	runner := gitclient.NewExecRunner()
	registry := gitsession.NewRegistry(runner)
	t.Cleanup(registry.Close)
	ghRunner := &countingGhRunner{}
	registry.Gh = ghclient.NewClient(
		ghclient.NewDiscovery(fakeGhLocatorForActivationTest{}, ghRunner, ghclient.NewRealClock()),
		ghRunner,
	)
	registry.RepoSettingsGet = func(string) (model.GitRepoSettings, error) {
		s := model.DefaultGitRepoSettings()
		s.GithubEnabled = false
		return s, nil
	}
	discovery := gitclient.NewDiscovery(alwaysGitLocator{}, runner, gitclient.NewRealClock())
	router := New(Deps{Discovery: discovery, Runner: runner, Registry: registry, ServerVersion: "test"})
	conn := gitsession.NewConn(gitsession.ConnID("gh-disabled-conn"), "test-client", "test-label", nil)
	t.Cleanup(conn.Close)
	handlers := router.ForConn(conn)

	openParams, _ := json.Marshal(RepoOpenParams{Path: dir})
	openResultAny, err := handlers.Request(context.Background(), "repo.open", openParams)
	if err != nil {
		t.Fatalf("repo.open: %v", err)
	}
	repoID := openResultAny.(RepoOpenResult).Repo.RepoID

	params, _ := json.Marshal(BranchResolvePrParams{RepoID: repoID, Branch: "main"})
	resultAny, err := handlers.Request(context.Background(), "branch.resolvePr", params)
	if err != nil {
		t.Fatalf("branch.resolvePr: %v", err)
	}
	result, ok := resultAny.(PrLookupResult)
	if !ok || result.Kind != "disabled" {
		t.Fatalf("branch.resolvePr result = %+v, want disabled", resultAny)
	}
	if ghRunner.count() != 0 {
		t.Fatalf("gh runner invoked %d times for a github.enabled=false repo, want 0", ghRunner.count())
	}
}
