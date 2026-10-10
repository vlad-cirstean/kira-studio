package gitrpc

import (
	"context"
	"os"
	"os/exec"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsession"
)

// smokeGit runs one git command against dir with a fixed committer identity — reset_test.go's,
// search_test.go's and worktree_test.go's own shared shape (P107 I2-28). search_test.go's own
// version additionally isolates the process from any global/system git config
// (GIT_CONFIG_GLOBAL/GIT_CONFIG_SYSTEM=/dev/null, extraEnv here); reset's and worktree's pass nil.
func smokeGit(t *testing.T, dir string, extraEnv []string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.com",
		"GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.com",
	)
	cmd.Env = append(cmd.Env, extraEnv...)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

// smokeConnOpts is smokeConn's own optional extras (P107 I2-28). discovery, when non-nil, builds
// a working Discovery off the registry's own runner — search_test.go's own need (search.run
// resolves gitPath through Discovery.Status, where reset/preflight/op.run never do)..
type smokeConnOpts struct {
	discovery func(runner gitclient.Runner) *gitclient.Discovery
}

// smokeConn is resetSmokeConn's, searchSmokeConn's and worktreeSmokeConn's own shared shape (P107
// I2-28): open dir through a fresh Router.ForConn dispatch, Discovery bypassed via dir's own raw
// gitPath (D3, gitsession's own newQueriesTestEntry does the same) unless opts.discovery says
// otherwise. connID stays each caller's own literal.
func smokeConn(t *testing.T, connID gitsession.ConnID, dir string, opts smokeConnOpts) (Handlers, string) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	runner := gitclient.NewExecRunner()
	registry := gitsession.NewRegistry(runner)
	t.Cleanup(registry.Close)

	deps := Deps{Runner: runner, Registry: registry, ServerVersion: "test"}
	if opts.discovery != nil {
		deps.Discovery = opts.discovery(runner)
	}
	router := New(deps)
	conn := gitsession.NewConn(connID, "test-client", "test-label", nil)
	t.Cleanup(conn.Close)
	handlers := router.ForConn(conn)

	summary, err := conn.Open(context.Background(), registry, "git", dir)
	if err != nil {
		t.Fatalf("conn.Open: %v", err)
	}
	return handlers, summary.RepoID
}
