package gitrpc

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
)

// alwaysGitLocator is a gitclient.Locator fake that always reports the real "git" on PATH as
// found — handleSearchRun (like handleGraphLoadMore/handleGraphStream) resolves its own gitPath
// through Discovery.Status independently of conn.Open's own raw-gitPath bypass (resetSmokeConn's
// own doc comment), so a search.run end-to-end test needs a Discovery that actually succeeds,
// unlike reset_test.go's flow (preflight.reset/op.run/undo.peek), which never reaches Discovery.
type alwaysGitLocator struct{}

func (alwaysGitLocator) Locate(_ string) (string, []string, bool) { return "git", []string{"git"}, true }

// searchSmokeConn is resetSmokeConn's own shape plus a working Discovery — search.run's handler
// needs one to resolve the gitPath it hands to c.Walk, where reset/preflight/op.run never do.
func searchSmokeConn(t *testing.T, dir string) (Handlers, string) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	runner := gitclient.NewExecRunner()
	registry := gitsession.NewRegistry(runner)
	t.Cleanup(registry.Close)
	discovery := gitclient.NewDiscovery(alwaysGitLocator{}, runner, gitclient.NewRealClock())
	router := New(Deps{Discovery: discovery, Runner: runner, Registry: registry, ServerVersion: "test"})
	conn := gitsession.NewConn(gitsession.ConnID("search-rpc-test-conn"), "test-client", "test-label", nil)
	t.Cleanup(conn.Close)
	handlers := router.ForConn(conn)

	summary, err := conn.Open(context.Background(), registry, "git", dir)
	if err != nil {
		t.Fatalf("conn.Open: %v", err)
	}
	return handlers, summary.RepoID
}

func searchSmokeGit(t *testing.T, dir string, args ...string) {
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

// TestSearchRun_ParamValidation exercises handleSearchRun's own param checks through the real
// JSON-decoding dispatch path (handlers.go's switch, wire.go's SearchRunParams) — no repo needed.
func TestSearchRun_ParamValidation(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	dir := t.TempDir()
	searchSmokeGit(t, dir, "init", "-q", "-b", "main")
	handlers, _ := searchSmokeConn(t, dir)
	ctx := context.Background()

	if _, err := handlers.Request(ctx, "search.run", json.RawMessage(`{"query":{"text":"x","caseSensitive":false,"wholeWord":false,"regex":false}}`)); err == nil {
		t.Fatal("expected an error for a missing repoId")
	}
	if _, err := handlers.Request(ctx, "search.run", json.RawMessage(`not json`)); err == nil {
		t.Fatal("expected an error for malformed params")
	}
}

// TestSearchRun_EmptyQueryShortCircuits pins D7's own empty-text short-circuit: no walk needs to
// be opened, and the answer is the same {ok, hits:[], total:0, scanned:0, complete:true} the
// client's own compileQuery("empty") branch expects.
func TestSearchRun_EmptyQueryShortCircuits(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	dir := t.TempDir()
	searchSmokeGit(t, dir, "init", "-q", "-b", "main")
	handlers, repoID := searchSmokeConn(t, dir)
	ctx := context.Background()

	params, _ := json.Marshal(SearchRunParams{
		RepoID: repoID,
		Query:  SearchQueryParams{Text: ""},
	})
	resultAny, err := handlers.Request(ctx, "search.run", params)
	if err != nil {
		t.Fatalf("search.run: %v", err)
	}
	result, ok := resultAny.(SearchRunResult)
	if !ok {
		t.Fatalf("search.run result = %T, want SearchRunResult", resultAny)
	}
	if result.Kind != "ok" || len(result.Hits) != 0 || result.Total != 0 || !result.Complete {
		t.Fatalf("search.run(empty) = %+v, want kind=ok hits=[] total=0 complete=true", result)
	}
}

// TestSearchRun_EndToEnd is §7.1's own end-to-end socket-dispatch test: a real repo, a real
// search.run round trip, including a not-yet-loaded (never ReadPage'd) commit's hit and the
// `total`/`truncated`/`scanned` accounting.
func TestSearchRun_EndToEnd(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	dir := t.TempDir()
	searchSmokeGit(t, dir, "init", "-q", "-b", "main")
	for i, subject := range []string{"base commit", "middle commit", "the needle commit"} {
		if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte{byte(i)}, 0o644); err != nil {
			t.Fatal(err)
		}
		searchSmokeGit(t, dir, "add", "f.txt")
		searchSmokeGit(t, dir, "commit", "-q", "-m", subject)
	}

	handlers, repoID := searchSmokeConn(t, dir)
	ctx := context.Background()

	params, _ := json.Marshal(SearchRunParams{
		RepoID: repoID,
		Query:  SearchQueryParams{Text: "needle"},
	})
	resultAny, err := handlers.Request(ctx, "search.run", params)
	if err != nil {
		t.Fatalf("search.run: %v", err)
	}
	result, ok := resultAny.(SearchRunResult)
	if !ok {
		t.Fatalf("search.run result = %T, want SearchRunResult", resultAny)
	}
	if result.Kind != "ok" {
		t.Fatalf("search.run kind = %q, want ok (%+v)", result.Kind, result)
	}
	if result.Total != 1 || len(result.Hits) != 1 {
		t.Fatalf("search.run = %+v, want exactly one hit", result)
	}
	if result.Hits[0].Subject != "the needle commit" {
		t.Fatalf("Hits[0].Subject = %q, want %q", result.Hits[0].Subject, "the needle commit")
	}
	if result.Truncated {
		t.Fatal("expected Truncated = false")
	}
	if !result.Complete {
		t.Fatal("expected Complete = true")
	}
}

// TestSearchRun_UnsupportedPattern is D6's own honest answer for RE2-inexpressible syntax — never
// a smaller `ok`, never invalidPattern (the pattern IS valid JS).
func TestSearchRun_UnsupportedPattern(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	dir := t.TempDir()
	searchSmokeGit(t, dir, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	searchSmokeGit(t, dir, "add", "f.txt")
	searchSmokeGit(t, dir, "commit", "-q", "-m", "one commit")

	handlers, repoID := searchSmokeConn(t, dir)
	ctx := context.Background()

	params, _ := json.Marshal(SearchRunParams{
		RepoID: repoID,
		Query:  SearchQueryParams{Text: "(?=x)", Regex: true},
	})
	resultAny, err := handlers.Request(ctx, "search.run", params)
	if err != nil {
		t.Fatalf("search.run: %v", err)
	}
	result, ok := resultAny.(SearchRunResult)
	if !ok {
		t.Fatalf("search.run result = %T, want SearchRunResult", resultAny)
	}
	if result.Kind != "unsupportedPattern" {
		t.Fatalf("search.run kind = %q, want unsupportedPattern (%+v)", result.Kind, result)
	}
	if result.Message == "" {
		t.Fatal("expected a non-empty message")
	}
}
