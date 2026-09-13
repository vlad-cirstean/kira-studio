// Package codeworkspace is C5's own read-only surface over an imported repository: listing its
// files (§7.1), reading one (§8.1), and validating every path crossing the boundary (§11). C6
// extends it with a real index lifecycle (this file), byte/UTF-16 conversion (textpos.go), diff
// reading (diff.go) and navigation (nav.go). It imports codeindex, codegraph and gitclient/catfile
// but never internal/bridge (internal/layering_test.go picks this up automatically) — the bound
// service (internal/bridge/codeworkspace.go) is the one place that resolves a `code_repos` row and
// this app's own git.path setting into the Session this package's functions take.
package codeworkspace

import (
	"context"
	"log/slog"
	"sync"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codegraph"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codeindex"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/catfile"
)

// Session is one open repository's own read context — root, the app's own repo id (code_repos.id,
// distinct from gitclient's RepoID), and the runner/gitPath pair every git invocation needs, plus
// (C6) the index/graph/watcher/catfile session a navigating workspace needs and cannot rebuild on
// every request the way C5's four original fields could.
type Session struct {
	RepoID  string // code_repos.id — the app's own handle, not gitclient's RepoID.
	Root    string
	Runner  gitclient.Runner
	GitPath string

	// IndexRepoID is gitclient's own RepoSummary.RepoID (code_repos.repo_id) — codeindex and
	// codegraph are keyed by that, never by code_repos.id.
	IndexRepoID string

	mu      sync.Mutex
	index   *codeindex.Index
	graph   *codegraph.Graph
	watcher *codeindex.Watcher
	catfile *catfile.Session
	ready   chan struct{} // closed when the initial Sync has finished, success or not
	cancel  context.CancelFunc

	closeOnce sync.Once
}

// Registry holds one Session per open code_repos.id.
type Registry struct {
	mu       sync.Mutex
	sessions map[string]*Session
}

func NewRegistry() *Registry {
	return &Registry{sessions: map[string]*Session{}}
}

// Open returns repoID's own session, reusing it when its Root and GitPath are unchanged from the
// last call (C6 §3.2) — an Index, a Watcher and a catfile.Session cannot be torn down and rebuilt
// on every bound-service request the way C5's stateless four-field Session could. A Root or
// GitPath change (a git.path setting edit, or — in principle — a repository moved on disk) closes
// the stale session (index/watcher/catfile all stopped) and builds a fresh one, so C5's own stated
// property ("a git.path change takes effect on the next call, with no explicit reopen step") still
// holds; a call that changes nothing reuses the live index and its two cat-file processes instead
// of leaking a new pair every time the tree panel refreshes.
func (r *Registry) Open(repoID, root string, runner gitclient.Runner, gitPath string) *Session {
	r.mu.Lock()
	defer r.mu.Unlock()

	if existing, ok := r.sessions[repoID]; ok {
		if existing.Root == root && existing.GitPath == gitPath {
			return existing
		}
		existing.Close()
	}

	s := &Session{RepoID: repoID, Root: root, Runner: runner, GitPath: gitPath}
	r.sessions[repoID] = s
	return s
}

// Close stops repoID's own session (if any) and drops the map entry — called by RemoveRepo and by
// CloseWorkspace (state/workspace.ts's closeRepoWorkspace).
func (r *Registry) Close(repoID string) {
	r.mu.Lock()
	s, ok := r.sessions[repoID]
	delete(r.sessions, repoID)
	r.mu.Unlock()
	if ok {
		s.Close()
	}
}

// CloseAll stops every open session — process teardown (main.go's own teardown, beside
// repositories.Close()).
func (r *Registry) CloseAll() {
	r.mu.Lock()
	sessions := make([]*Session, 0, len(r.sessions))
	for _, s := range r.sessions {
		sessions = append(sessions, s)
	}
	r.sessions = map[string]*Session{}
	r.mu.Unlock()
	for _, s := range sessions {
		s.Close()
	}
}

// EnsureIndex starts this session's own Index/Graph/Watcher if not already running — idempotent,
// returns immediately regardless of how long the initial Sync takes (C6 §3.3). Called by
// OpenWorkspace (the warm-up path) and by Definitions itself, so a navigation request that somehow
// arrives first is still correct without OpenWorkspace ever having been called.
func (s *Session) EnsureIndex(store *codeindex.Store, home string, log *slog.Logger) {
	s.mu.Lock()
	if s.index != nil {
		s.mu.Unlock()
		return
	}
	if log == nil {
		log = slog.Default()
	}

	idx := codeindex.Open(store, s.Runner, s.GitPath, s.IndexRepoID, s.Root)
	graph := codegraph.New(store, s.IndexRepoID)
	ready := make(chan struct{})
	ctx, cancel := context.WithCancel(context.Background())

	s.index = idx
	s.graph = graph
	s.ready = ready
	s.cancel = cancel
	s.mu.Unlock()

	// A direct port of repomap.Server's own runInitialSync — the identical lock discipline (C6
	// D11) so the desktop app's own native workspace and an embedded/headless repo-map server
	// never parse one repository's initial sync twice at once.
	go func() {
		lock, acquired, err := codeindex.AcquireSyncLock(home, s.IndexRepoID, codeindex.DefaultSyncLockTimeout)
		if err != nil {
			log.Warn("codeworkspace sync lock", "scope", "codeworkspace", "repo", s.IndexRepoID, "err", err)
		}
		if !acquired {
			log.Debug("codeworkspace sync lock: proceeding without it (timeout or unsupported platform)", "scope", "codeworkspace", "repo", s.IndexRepoID)
		}

		stats, err := idx.Sync(ctx)
		if lock != nil {
			lock.Release()
		}
		if err != nil {
			log.Error("codeworkspace initial sync", "scope", "codeworkspace", "repo", s.IndexRepoID, "err", err)
		} else {
			log.Info("codeworkspace initial sync complete", "scope", "codeworkspace", "repo", s.IndexRepoID,
				"filesParsed", stats.FilesParsed, "filesSkipped", stats.FilesSkipped, "filesDeleted", stats.FilesDeleted)
		}
		// Closed exactly once, regardless of outcome — a failed sync still opens the gate with a
		// partial index (honest), and must never hang a caller waiting on it.
		close(ready)
	}()

	w, err := idx.Watch()
	if err != nil {
		// A watcher failure is not fatal to serving what has already synced — logged, not
		// returned, same posture as repomap.Server's own construction.
		log.Warn("codeworkspace watcher", "scope", "codeworkspace", "repo", s.IndexRepoID, "err", err)
	}
	s.mu.Lock()
	s.watcher = w
	s.mu.Unlock()
}

// IndexReady reports whether this session's initial Sync has completed — a non-blocking check
// (C6 D8: a navigation request must never wait on it the way an MCP tool call's 25s bound does).
// ready is nil (never started, or EnsureIndex has not yet run) or already closed both report true.
func (s *Session) IndexReady() bool {
	s.mu.Lock()
	ready := s.ready
	s.mu.Unlock()
	if ready == nil {
		return false
	}
	select {
	case <-ready:
		return true
	default:
		return false
	}
}

// graphAndReady returns this session's own graph and readiness channel under the lock — nav.go's
// own accessor, since Definitions needs both without racing EnsureIndex's own writes to them.
func (s *Session) graphAndReady() (*codegraph.Graph, chan struct{}) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.graph, s.ready
}

// catfileSession lazily constructs this session's own catfile.Session on first use (diff.go's own
// HEAD-side reader) — a workspace that never opens a diff tab never pays for the two extra
// processes.
func (s *Session) catfileSession() *catfile.Session {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.catfile == nil {
		s.catfile = catfile.NewSession(catfile.Deps{Runner: s.Runner, GitPath: s.GitPath, Dir: s.Root}, MaxReadBytes)
	}
	return s.catfile
}

// Close stops this session's watcher, index and catfile session, and cancels its own sync
// context. Idempotent.
func (s *Session) Close() {
	s.closeOnce.Do(func() {
		s.mu.Lock()
		cancel := s.cancel
		watcher := s.watcher
		index := s.index
		cf := s.catfile
		s.watcher, s.index, s.graph, s.catfile = nil, nil, nil, nil
		s.mu.Unlock()

		if cancel != nil {
			cancel()
		}
		if watcher != nil {
			_ = watcher.Close()
		}
		if index != nil {
			index.Close()
		}
		if cf != nil {
			cf.Close()
		}
	})
}
