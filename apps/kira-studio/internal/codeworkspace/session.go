// Package codeworkspace is C5's own read-only surface over an imported repository: listing its
// files (§7.1), reading one (§8.1), and validating every path crossing the boundary (§11). It
// imports codeindex and gitclient only, never internal/bridge (internal/layering_test.go picks
// this up automatically) — the bound service (internal/bridge/codeworkspace.go) is the one place
// that resolves a `code_repos` row and this app's own git.path setting into the Session this
// package's functions take.
package codeworkspace

import (
	"sync"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
)

// Session is one open repository's own read context — root, the app's own repo id (code_repos.id,
// distinct from gitclient's RepoID), and the runner/gitPath pair every git invocation needs.
// Minimal today by design: C6 (§12) extends this same struct with a *codeindex.Index and a
// *catfile.Session, so this shape exists now for that phase to grow into rather than being
// invented alongside it.
type Session struct {
	RepoID  string // code_repos.id — the app's own handle, not gitclient's RepoID.
	Root    string
	Runner  gitclient.Runner
	GitPath string
}

// Registry holds one Session per open code_repos.id. Construction is cheap (no process spawned,
// no file opened) — Open is safe to call on every request rather than caching sessions across
// calls; the registry exists so Close has one place to release whatever C6's own extension adds
// (a long-lived catfile.Session), not because Session itself needs pooling today.
type Registry struct {
	mu       sync.Mutex
	sessions map[string]*Session
}

func NewRegistry() *Registry {
	return &Registry{sessions: map[string]*Session{}}
}

// Open records (or replaces) repoID's own session — called on every bound-service request rather
// than only on import, so a git.path setting change or a runner swap takes effect on the next call
// with no explicit "reopen" step.
func (r *Registry) Open(repoID, root string, runner gitclient.Runner, gitPath string) *Session {
	s := &Session{RepoID: repoID, Root: root, Runner: runner, GitPath: gitPath}
	r.mu.Lock()
	r.sessions[repoID] = s
	r.mu.Unlock()
	return s
}

// Close drops repoID's own session — called by RemoveRepo (§3.3). A no-op today beyond freeing the
// map entry; C6's own extension is what gives this a process to actually stop.
func (r *Registry) Close(repoID string) {
	r.mu.Lock()
	delete(r.sessions, repoID)
	r.mu.Unlock()
}
