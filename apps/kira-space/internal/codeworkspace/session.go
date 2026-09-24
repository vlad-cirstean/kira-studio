// Package codeworkspace is C5's own read-only surface over an imported repository: listing its
// files (§7.1), reading one (§8.1), and validating every path crossing the boundary (§11), plus
// diff reading (diff.go) and repository-wide search (search.go). It imports gitclient/catfile but
// never internal/bridge (internal/layering_test.go picks this up automatically) — the bound
// service (internal/bridge/codeworkspace.go) is the one place that resolves a `code_repos` row and
// this app's own git.path setting into the Session this package's functions take.
package codeworkspace

import (
	"context"
	"errors"
	"sync"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient/catfile"
)

// ErrSessionClosed is returned by any Session operation attempted after Close has already run
// (F4): a caller can still be holding a *Session another goroutine just closed (CloseWorkspace,
// RemoveRepo, or a git.path change through Registry.Open replacing it) — without this guard,
// catfileSession would spawn a fresh, never-closed cat-file pair on a session already out of the
// registry (CloseAll cannot reach it either), and BeginSearch would hand out a live, uncancellable
// search (CancelSearch only ever reaches the registry's current session via Peek).
var ErrSessionClosed = errors.New("codeworkspace: session is closed")

// Session is one open repository's own read context — root, the app's own repo id (code_repos.id,
// distinct from gitclient's RepoID), and the runner/gitPath pair every git invocation needs, plus
// the catfile session a diff view needs and cannot rebuild on every request.
type Session struct {
	RepoID  string // code_repos.id — the app's own handle, not gitclient's RepoID.
	Root    string
	Runner  gitclient.Runner
	GitPath string

	mu      sync.Mutex
	catfile *catfile.Session
	closed  bool

	// searchCancel is C7 D8's own one-in-flight-per-workspace state: beginSearch cancels whatever
	// this workspace's previous search was running, under the same mutex as every other field here.
	searchCancel context.CancelFunc

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
// last call (C6 §3.2) — a catfile.Session's two cat-file processes cannot be torn down and rebuilt
// on every bound-service request the way C5's stateless four-field Session could. A Root or
// GitPath change (a git.path setting edit, or — in principle — a repository moved on disk) closes
// the stale session (catfile stopped) and builds a fresh one, so C5's own stated property ("a
// git.path change takes effect on the next call, with no explicit reopen step") still holds; a
// call that changes nothing reuses the live cat-file processes instead of leaking a new pair every
// time the tree panel refreshes.
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

// Peek returns repoID's own live session, or nil if none is open — C7's CancelSearch's own
// accessor: stopping a search must never create a session the way Open's normal fallback would,
// and must not depend on git being reachable right now the way every read path's own availability
// check does.
func (r *Registry) Peek(repoID string) *Session {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.sessions[repoID]
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

// catfileSession lazily constructs this session's own catfile.Session on first use (diff.go's own
// HEAD-side reader) — a workspace that never opens a diff tab never pays for the two extra
// processes. Returns ErrSessionClosed once Close has run (F4) rather than building a pair nothing
// will ever stop.
func (s *Session) catfileSession() (*catfile.Session, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil, ErrSessionClosed
	}
	if s.catfile == nil {
		s.catfile = catfile.NewSession(catfile.Deps{Runner: s.Runner, GitPath: s.GitPath, Dir: s.Root}, MaxReadBytes)
	}
	return s.catfile, nil
}

// Close stops this session's catfile session and cancels any in-flight search (C7 D8). Idempotent.
// Marks the session closed under the same lock (F4), so any later catfileSession/BeginSearch call
// on this exact *Session — held by a caller that raced this Close — fails or self-cancels instead
// of quietly reviving a session already out of the registry.
func (s *Session) Close() {
	s.closeOnce.Do(func() {
		s.mu.Lock()
		s.closed = true
		searchCancel := s.searchCancel
		cf := s.catfile
		s.catfile = nil
		s.searchCancel = nil
		s.mu.Unlock()

		if searchCancel != nil {
			searchCancel()
		}
		if cf != nil {
			cf.Close()
		}
	})
}

// BeginSearch cancels this workspace's previous search, if any (C7 D8: one in flight per
// workspace — starting a new one is by construction the only way a user's single query box can
// mean "stop the old one and run this instead"), and returns the context the new one runs under.
// Rooted at context.Background(), not any per-call ctx: StartSearch's own bound call returns long
// before a full-worktree scan finishes, so the search must outlive it — CancelSearch and
// Session.Close are the only two ways this context ever ends. Exported (the plan's own §4.3 names
// it lowercase, but internal/bridge — a separate package — is its one caller alongside Close, so it
// must be; disclosed as a plan correction, not a design change).
//
// F4: on a session Close already ran on, returns an already-cancelled context instead of
// installing a live searchCancel — codeworkspace.Search then sees ctx.Err() == context.Canceled
// immediately, the same clean "user stopped it" path StartSearch's own caller already treats a
// real CancelSearch as, rather than running a full-worktree scan nothing can reach to cancel
// (CancelSearch's Registry.Peek only ever sees the registry's *current* session for this id).
func (s *Session) BeginSearch() context.Context {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.searchCancel != nil {
		s.searchCancel()
	}
	ctx, cancel := context.WithCancel(context.Background())
	if s.closed {
		cancel()
		return ctx
	}
	s.searchCancel = cancel
	return ctx
}

// CancelSearch stops this workspace's own in-flight search (if any) — a no-op otherwise. Takes no
// search id (D8: the bound service's CancelSearch(workspace id) always means "stop whatever this
// panel is running", never a specific search).
func (s *Session) CancelSearch() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.searchCancel != nil {
		s.searchCancel()
		s.searchCancel = nil
	}
}
