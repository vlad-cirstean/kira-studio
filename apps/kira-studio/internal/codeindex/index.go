package codeindex

import (
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codeparse"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
)

// Index is one repository's own view over the shared Store (§5.1): enumeration, reconcile, and
// (from S7) its own worktree watcher — all scoped to one RepoID. Everything reachable from an
// Index — including its parser pool and resident-tree cache — belongs to that one repository;
// only the underlying codeindex.db connection pool (Store) is shared across every Index a process
// opens (§8: "One Index per repository, not shared with gitsession's registry").
type Index struct {
	store   *Store
	session *codeparse.Session

	repoID  string
	root    string
	gitPath string
	runner  gitclient.Runner
}

// Open returns an Index for one repository. store is the shared codeindex.db handle (§5.1),
// typically opened once per process and passed to every repository's own Index. repoID is
// gitclient's own repository identity (RepoSummary.RepoID, NFC-normalized tier 1); root is the
// repository's worktree root. gitPath and runner are injected rather than resolved here —
// gitclient's own locator is macOS-only, and injection is what lets a test run against the git on
// PATH (§6).
func Open(store *Store, runner gitclient.Runner, gitPath, repoID, root string) *Index {
	return &Index{
		store:   store,
		session: codeparse.NewSession(),
		repoID:  repoID,
		root:    root,
		gitPath: gitPath,
		runner:  runner,
	}
}

// RepoID returns the repository identity this Index was opened for.
func (idx *Index) RepoID() string { return idx.repoID }

// Close releases this Index's own parser pool and resident-tree cache. It does not close the
// shared Store, which may still be serving other repositories.
func (idx *Index) Close() {
	idx.session.Close()
}
