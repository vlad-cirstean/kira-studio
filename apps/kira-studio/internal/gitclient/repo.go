package gitclient

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"sync"
)

// HeadState is the wire shape crossing as RepoSummary.Head — structurally matching @kira/git-ipc's
// own HeadState union (contract.ts).
type HeadState struct {
	Kind string `json:"kind"` // "branch" | "detached" | "unborn"
	Name string `json:"name,omitempty"`
	SHA  string `json:"sha,omitempty"`
}

// RepoSummary is one repository's identity, exactly the fields P1's own exit criteria name:
// "root, git dir, common dir, bare, linked-worktree, HEAD" (§7). Structurally matches
// @kira/git-ipc's own RepoSummary.
type RepoSummary struct {
	RepoID           string    `json:"repoId"`
	Root             string    `json:"root"`
	GitDir           string    `json:"gitDir"`
	CommonDir        string    `json:"commonDir"`
	IsBare           bool      `json:"isBare"`
	IsLinkedWorktree bool      `json:"isLinkedWorktree"`
	Head             HeadState `json:"head"`
}

// maxConcurrentReads bounds a repo's own read pool (docs/v1.3/SPEC.md's P1 row: "a per-repository
// write queue with a bounded concurrent read pool"). Small on purpose: every real read this app
// runs against one repository is a single `git` process, and git itself already serialises on its
// own index/ref locks — this bound exists to cap how many such processes pile up concurrently
// against one repository, not to maximise throughput.
const maxConcurrentReads = 4

// Repo is one open repository: its identity plus the concurrency discipline every operation
// against it goes through — a reader-writer gate, not two independent pools: Write needs the
// repository entirely to itself (no concurrent Read, no concurrent Write), Read bounds itself to
// maxConcurrentReads but never runs alongside a Write. A blocked Read or Write retries against a
// closed-and-replaced `waitCh` rather than parking on a single channel's own token (F5/repo_test.go's
// own reasoning: acquiring a *set* of N tokens for Write, from the same pool Read draws single
// tokens from, is a classic deadlock shape — two Writers each holding some but not all of the N
// tokens would wait on each other forever), which is the standard broadcast-and-recheck shape for
// a condition variable that must also honour ctx cancellation (sync.Cond itself has no
// context-aware Wait to build that on).
type Repo struct {
	Summary RepoSummary

	runner  Runner
	gitPath string

	mu      sync.Mutex
	writing bool
	readers int
	waitCh  chan struct{}
}

func newRepo(summary RepoSummary, runner Runner, gitPath string) *Repo {
	return &Repo{
		Summary: summary,
		runner:  runner,
		gitPath: gitPath,
		waitCh:  make(chan struct{}),
	}
}

// ErrCancelled is returned by Read/Write when ctx is done before access was ever granted —
// distinct from a git error, since no process was spawned at all.
var ErrCancelled = errors.New("gitclient: cancelled waiting for the repository's write/read gate")

// notifyLocked wakes every goroutine currently parked in Read/Write's select below — called with
// mu held, after writing/readers changes in a way that might let a waiter proceed.
func (r *Repo) notifyLocked() {
	close(r.waitCh)
	r.waitCh = make(chan struct{})
}

// Write runs fn with exclusive access to this repo — no concurrent Read, no concurrent Write. No
// operation in P1 actually calls this yet (§0.2: no porcelain, no mutating command); it exists now
// so a later phase's first real write has nowhere else to go.
func (r *Repo) Write(ctx context.Context, fn func(ctx context.Context) error) error {
	for {
		r.mu.Lock()
		if !r.writing && r.readers == 0 {
			r.writing = true
			r.mu.Unlock()
			break
		}
		wait := r.waitCh
		r.mu.Unlock()
		select {
		case <-wait:
		case <-ctx.Done():
			return ErrCancelled
		}
	}
	defer func() {
		r.mu.Lock()
		r.writing = false
		r.notifyLocked()
		r.mu.Unlock()
	}()
	return fn(ctx)
}

// Read runs fn with one of maxConcurrentReads slots — many can run at once, bounded, and never
// alongside a Write.
func (r *Repo) Read(ctx context.Context, fn func(ctx context.Context) error) error {
	for {
		r.mu.Lock()
		if !r.writing && r.readers < maxConcurrentReads {
			r.readers++
			r.mu.Unlock()
			break
		}
		wait := r.waitCh
		r.mu.Unlock()
		select {
		case <-wait:
		case <-ctx.Done():
			return ErrCancelled
		}
	}
	defer func() {
		r.mu.Lock()
		r.readers--
		r.notifyLocked()
		r.mu.Unlock()
	}()
	return fn(ctx)
}

// run is repo.go's own one convenience over Runner.Run + Classify, used by identity() below and
// available to any later phase's Repo-scoped command.
func (r *Repo) run(ctx context.Context, spec Spec) (Result, error) {
	res, err := r.runner.Run(ctx, r.gitPath, spec)
	if cerr := Classify(ctx, spec.Args, res, err); cerr != nil {
		return res, cerr
	}
	return res, nil
}

// Registry is the per-app set of currently-open repositories, keyed by RepoID (repo.go's own
// choice: the absolute git-dir, unique per worktree even when several linked worktrees share one
// commonDir).
type Registry struct {
	runner Runner

	mu    sync.Mutex
	repos map[string]*Repo
}

// NewRegistry constructs an empty Registry over the given Runner.
func NewRegistry(runner Runner) *Registry {
	return &Registry{runner: runner, repos: make(map[string]*Repo)}
}

// Open resolves path's repository identity via `rev-parse` and registers it, reusing an existing
// entry if this path's repoId is already open (repeated repo.open on the same worktree is a
// read, not a second registration). gitPath is the already-discovered, floor-checked git binary
// — callers resolve GitStatus first (D4) and never reach here below "ok".
func (reg *Registry) Open(ctx context.Context, gitPath, path string) (*Repo, error) {
	summary, err := identify(ctx, reg.runner, gitPath, path)
	if err != nil {
		return nil, err
	}

	reg.mu.Lock()
	defer reg.mu.Unlock()
	if existing, ok := reg.repos[summary.RepoID]; ok {
		return existing, nil
	}
	repo := newRepo(summary, reg.runner, gitPath)
	reg.repos[summary.RepoID] = repo
	return repo, nil
}

// Get returns the already-open Repo for repoId, if any.
func (reg *Registry) Get(repoID string) (*Repo, bool) {
	reg.mu.Lock()
	defer reg.mu.Unlock()
	r, ok := reg.repos[repoID]
	return r, ok
}

// Close discards repoId's entry. No process, handle or lock needs releasing (every git spawn
// already ran to completion before returning) — this only stops Get from finding it again.
// Reports whether an entry was actually present.
func (reg *Registry) Close(repoID string) bool {
	reg.mu.Lock()
	defer reg.mu.Unlock()
	if _, ok := reg.repos[repoID]; !ok {
		return false
	}
	delete(reg.repos, repoID)
	return true
}

// identify runs the handful of `rev-parse` queries that make up a RepoSummary — line-based
// output only (§0.2: this is not a porcelain parser; every value here is a single trimmed line
// from a query whose shape `rev-parse` fixes).
func identify(ctx context.Context, runner Runner, gitPath, path string) (RepoSummary, error) {
	isBare, err := revParseBool(ctx, runner, gitPath, path, "--is-bare-repository")
	if err != nil {
		return RepoSummary{}, err
	}

	gitDir, err := revParseLine(ctx, runner, gitPath, path, "--path-format=absolute", "--absolute-git-dir")
	if err != nil {
		return RepoSummary{}, err
	}
	commonDir, err := revParseLine(ctx, runner, gitPath, path, "--path-format=absolute", "--git-common-dir")
	if err != nil {
		return RepoSummary{}, err
	}
	gitDir = filepath.Clean(gitDir)
	commonDir = filepath.Clean(commonDir)

	root := ""
	if !isBare {
		root, err = revParseLine(ctx, runner, gitPath, path, "--show-toplevel")
		if err != nil {
			return RepoSummary{}, err
		}
		root = filepath.Clean(root)
	}

	head, err := headState(ctx, runner, gitPath, path)
	if err != nil {
		return RepoSummary{}, err
	}

	return RepoSummary{
		RepoID: gitDir,
		Root:   root, GitDir: gitDir, CommonDir: commonDir,
		IsBare: isBare,
		// A linked worktree's own git-dir lives under <commonDir>/worktrees/<name>, distinct from
		// the main worktree's (whose git-dir IS the commonDir) — no separate query needed, this
		// falls straight out of the two paths rev-parse already gave us. A bare repo has no
		// worktree at all, so it is never "linked" regardless of what the path comparison says.
		IsLinkedWorktree: !isBare && gitDir != commonDir,
		Head:             head,
	}, nil
}

func revParseLine(ctx context.Context, runner Runner, gitPath, dir string, args ...string) (string, error) {
	res, err := runner.Run(ctx, gitPath, Spec{Dir: dir, Args: append([]string{"rev-parse"}, args...), ReadOnly: true})
	if cerr := Classify(ctx, args, res, err); cerr != nil {
		return "", cerr
	}
	return strings.TrimSpace(string(res.Stdout)), nil
}

func revParseBool(ctx context.Context, runner Runner, gitPath, dir string, flag string) (bool, error) {
	line, err := revParseLine(ctx, runner, gitPath, dir, flag)
	if err != nil {
		return false, err
	}
	return line == "true", nil
}

// headState determines HeadState per RepoSummary.Head's own three-way union: a symbolic ref that
// resolves is a branch, one that does not is an unborn branch (nothing committed yet), and no
// symbolic ref at all is a detached HEAD at a bare sha.
func headState(ctx context.Context, runner Runner, gitPath, dir string) (HeadState, error) {
	symArgs := []string{"symbolic-ref", "--short", "-q", "HEAD"}
	symRes, symErr := runner.Run(ctx, gitPath, Spec{Dir: dir, Args: symArgs, ReadOnly: true})
	if symErr != nil {
		return HeadState{}, Classify(ctx, symArgs, symRes, symErr)
	}

	if symRes.ExitCode == 0 {
		name := strings.TrimSpace(string(symRes.Stdout))
		verifyArgs := []string{"rev-parse", "-q", "--verify", "HEAD"}
		verifyRes, verifyErr := runner.Run(ctx, gitPath, Spec{Dir: dir, Args: verifyArgs, ReadOnly: true})
		if verifyErr != nil {
			return HeadState{}, Classify(ctx, verifyArgs, verifyRes, verifyErr)
		}
		if verifyRes.ExitCode == 0 {
			return HeadState{Kind: "branch", Name: name}, nil
		}
		// HEAD points at a branch ref that has never been committed to — an unborn branch, git
		// rev-parse's own "-q --verify" exits non-zero rather than erroring loudly, exactly the
		// signal this checks for.
		return HeadState{Kind: "unborn", Name: name}, nil
	}

	// symbolic-ref -q exits exactly 1 with no stderr for a detached HEAD (not an error condition,
	// "-q" is what keeps it off stderr entirely) — any other exit code is a real failure
	// (permission denied, not a repository at all) and goes through Classify like everything else.
	if symRes.ExitCode != 1 {
		return HeadState{}, Classify(ctx, symArgs, symRes, nil)
	}
	sha, err := revParseLine(ctx, runner, gitPath, dir, "HEAD")
	if err != nil {
		return HeadState{}, err
	}
	return HeadState{Kind: "detached", SHA: sha}, nil
}
