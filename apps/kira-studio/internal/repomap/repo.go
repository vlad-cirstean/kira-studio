package repomap

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codeindex"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
)

// ErrNoRepository is returned when neither gitclient.Identify nor the Store.ListRepos fallback
// (§4.4) can name a repository for dir — reached only from AttachDir, the headless binary's own
// entry point (cmd/kira-repo-map). The embedded instance never calls it: since P67d it resolves
// every repository it serves from code_repos (bridge.RepoMapService), never from this process's own
// working directory, so this is no longer a failure mode a packaged app's Settings tab can hit.
var ErrNoRepository = errors.New("repomap: no repository found for this working directory")

// resolvedRepo is what repository resolution (§4.1/§4.4) hands back to New.
type resolvedRepo struct {
	repoID  string
	root    string
	gitPath string
	runner  gitclient.Runner
}

// resolveRepo implements §4.1's identity resolution plus §4.4's degraded fallback. dir is --repo
// when given, else the process's own cwd (a Wails app process's cwd for the embedded instance,
// §3.2's own honestly-limited resolution). store is consulted only in degraded mode.
func resolveRepo(ctx context.Context, store *codeindex.Store, dir string) (resolvedRepo, error) {
	if dir == "" {
		wd, err := os.Getwd()
		if err != nil {
			return resolvedRepo{}, fmt.Errorf("repomap: getwd: %w", err)
		}
		dir = wd
	}
	dir, err := filepath.Abs(dir)
	if err != nil {
		return resolvedRepo{}, fmt.Errorf("repomap: resolve %s: %w", dir, err)
	}

	gitPath, lookErr := exec.LookPath("git")
	if lookErr == nil {
		runner := gitclient.NewExecRunner()
		summary, err := gitclient.Identify(ctx, runner, gitPath, dir)
		if err == nil {
			if summary.IsBare {
				return resolvedRepo{}, fmt.Errorf("repomap: %s is a bare repository, which has no worktree to index", dir)
			}
			return resolvedRepo{repoID: summary.RepoID, root: summary.Root, gitPath: gitPath, runner: runner}, nil
		}
		// Identify failed (not a repository, or a real git error) — fall through to the degraded
		// path below rather than surfacing a raw gitclient error for what is very often simply "this
		// directory is not a git checkout" (the embedded instance's own common case, §3.2).
	}

	// §4.4: no git on PATH, or Identify failed — serve read-only from whatever the desktop app has
	// already indexed, matched by longest path prefix.
	repos, err := store.ListRepos(ctx)
	if err != nil {
		return resolvedRepo{}, fmt.Errorf("repomap: list repos: %w", err)
	}
	best := ""
	bestRoot := ""
	for _, r := range repos {
		if r.Root == dir || strings.HasPrefix(dir, r.Root+string(filepath.Separator)) {
			if len(r.Root) > len(bestRoot) {
				bestRoot = r.Root
				best = r.RepoID
			}
		}
	}
	if best == "" {
		return resolvedRepo{}, ErrNoRepository
	}
	return resolvedRepo{repoID: best, root: bestRoot, gitPath: gitPath, runner: gitclient.NewExecRunner()}, nil
}
