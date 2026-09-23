package gitsession

import (
	"context"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitreview"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
)

// testEntryOpts is newTestEntry's own optional extras (P107 I2-28) — incremental_test.go's,
// queries_test.go's, stack_test.go's and worktree_test.go's own newXTestEntry each set only the
// one or two fields their own scenario needs; the zero value is the queries_test.go shape (a
// plain ExecRunner, no review store, no worktree-prepare script override).
type testEntryOpts struct {
	runner gitclient.Runner // nil means gitclient.NewExecRunner()
	store  *gitreview.Store // wired as registry.Review when non-nil (incremental_test.go)
	script string           // sets RepoSettingsGet's WorktreePrepareScript when non-empty (worktree_test.go)
}

// newTestEntry is incremental_test.go's, queries_test.go's, stack_test.go's and worktree_test.go's
// own shared "open a fresh registry+conn against repoDir, return the held entry" shape (P107
// I2-28). connID stays each caller's own literal — stack_test.go's own RunOp calls elsewhere in
// that file re-pass "stack-test-conn" verbatim, so it cannot be genericized away.
func newTestEntry(t *testing.T, connID ConnID, repoDir string, opts testEntryOpts) (*Conn, *RepoEntry) {
	t.Helper()
	runner := opts.runner
	if runner == nil {
		runner = gitclient.NewExecRunner()
	}
	registry := NewRegistry(runner)
	if opts.store != nil {
		registry.Review = opts.store
	}
	if opts.script != "" {
		registry.RepoSettingsGet = func(string) (model.GitRepoSettings, error) {
			s := model.DefaultGitRepoSettings()
			s.WorktreePrepareScript = opts.script
			return s, nil
		}
	}
	t.Cleanup(registry.Close)

	conn := NewConn(connID, "test-client", "test-client-label", nil)
	summary, err := conn.Open(context.Background(), registry, "git", repoDir)
	if err != nil {
		t.Fatalf("conn.Open: %v", err)
	}
	t.Cleanup(conn.Close)

	entry, ok := conn.Entry(summary.RepoID)
	if !ok {
		t.Fatal("conn.Entry: not held after Open")
	}
	return conn, entry
}
