package gitsession

import (
	"context"
	"errors"
	"sync"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
)

// ErrRepoNotHeld is returned by Conn.Walk when this connection has no open hold on repoID —
// repo.open must precede any graph.* call, exactly as it must for every other per-repo request.
var ErrRepoNotHeld = errors.New("gitsession: repository is not open on this connection")

// ConnID identifies one accepted connection — the handshake's own minted session id (gitsock D19),
// opaque here.
type ConnID string

// hold is one (connection, repository) pairing: the ref this connection took on the entry, and the
// subscription that delivers repo.changed to it.
type hold struct {
	entry       *RepoEntry
	release     func()
	unsubscribe func()
}

// Conn is one connection's private session state — SPEC §6's Conn box, minus Walk (G6). Emit is
// supplied by gitsock so this package never imports bridge or rpcstream (SPEC §7's layering rule);
// it is called from a subscriber's own goroutine (D14), never from the watcher's.
type Conn struct {
	ID       ConnID
	ClientID string
	Emit     func(method string, payload any)

	mu    sync.Mutex
	held  map[string]*hold // RepoID -> hold
	walks map[string]*Walk // RepoID -> Walk (D13), created lazily
}

// NewConn constructs a Conn with an empty hold set.
func NewConn(id ConnID, clientID string, emit func(method string, payload any)) *Conn {
	return &Conn{ID: id, ClientID: clientID, Emit: emit, held: make(map[string]*hold), walks: make(map[string]*Walk)}
}

// Open acquires path's repository and subscribes this connection to it — idempotent per (Conn,
// RepoID): a second Open for a repo this connection already holds releases the ref it just took
// and returns the existing hold's summary (D15, resolving F15). RepoID is only known after Identify
// runs inside Acquire, so this is acquire-then-release rather than check-then-acquire — identifying
// under this connection's own lock would serialise every Open this connection makes.
func (c *Conn) Open(ctx context.Context, reg *Registry, gitPath, path string) (gitclient.RepoSummary, error) {
	entry, release, err := reg.Acquire(ctx, gitPath, path)
	if err != nil {
		return gitclient.RepoSummary{}, err
	}
	repoID := entry.Summary.RepoID

	if existing, ok := c.alreadyHeld(repoID); ok {
		release()
		return existing.Summary, nil
	}

	unsubscribe := entry.Subscribe(c.ID, func(ev Event) {
		// Mark before emitting (D13): a client that reacts to repo.changed by re-opening its
		// stream must never be able to observe a walk that has not yet been told refs moved.
		if ev.Kind == string(gitclient.SignalRefsChanged) {
			if w, ok := c.WalkFor(ev.RepoID); ok {
				w.MarkStale()
			}
		}
		if c.Emit != nil {
			c.Emit("repo.changed", ev)
		}
	})

	c.mu.Lock()
	if existing, ok := c.held[repoID]; ok {
		// Lost a race against a concurrent Open for the same repo on this connection (two
		// repo.open requests dispatched on their own goroutines by rpcstream) — clean up the
		// work just done rather than leaking it.
		c.mu.Unlock()
		unsubscribe()
		release()
		return existing.entry.Summary, nil
	}
	c.held[repoID] = &hold{entry: entry, release: release, unsubscribe: unsubscribe}
	c.mu.Unlock()
	return entry.Summary, nil
}

func (c *Conn) alreadyHeld(repoID string) (*RepoEntry, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	h, ok := c.held[repoID]
	if !ok {
		return nil, false
	}
	return h.entry, true
}

// Entry returns the RepoEntry this connection holds for repoID — the seam every per-repo request
// that is not a graph.* walk needs (D18/F7): a commit's detail, a file's patch and a blob's bytes
// are facts about the repository (SPEC §6's split rule), not about one viewer's walk. Reports
// false under the same condition ErrRepoNotHeld names — repo.open must precede this call, exactly
// as it must for every other per-repo request.
func (c *Conn) Entry(repoID string) (*RepoEntry, bool) {
	return c.alreadyHeld(repoID)
}

// CloseRepo releases this connection's hold on repoID, if any, reporting whether one was present —
// the RPC ignores the bool and answers {} either way, preserving repo.close's idempotency. Any
// walk over repoID is disposed (its git log process killed) before the ref is released (D13), so
// the registry's refcount can never reach zero while a walk still holds a process against it.
func (c *Conn) CloseRepo(repoID string) bool {
	c.mu.Lock()
	h, ok := c.held[repoID]
	if ok {
		delete(c.held, repoID)
	}
	w, hasWalk := c.walks[repoID]
	if hasWalk {
		delete(c.walks, repoID)
	}
	c.mu.Unlock()

	if hasWalk {
		w.dispose()
	}
	if !ok {
		return false
	}
	h.unsubscribe()
	h.release()
	return true
}

// Close releases every hold this connection has — gitsock's own disconnect teardown (SPEC §6:
// "release its RepoEntry refcounts"). Every walk is disposed first (D13), same ordering as
// CloseRepo.
func (c *Conn) Close() {
	c.mu.Lock()
	holds := c.held
	c.held = make(map[string]*hold)
	walks := c.walks
	c.walks = make(map[string]*Walk)
	c.mu.Unlock()

	for _, w := range walks {
		w.dispose()
	}
	for _, h := range holds {
		h.unsubscribe()
		h.release()
	}
}

// Walk returns this connection's Walk for repoID — created lazily on first call, rebuilt (the old
// one disposed) whenever spec no longer matches what it was built with (a scope change, D13's own
// #ensureReviewWalk shape). Errors with ErrRepoNotHeld if this connection has not opened repoID.
//
// pageSize (D6's own graph.pageSize) only takes effect on first construction — the underlying log
// session's own page size is fixed at Open time and a later call with a different value does not
// rebuild an otherwise-matching walk (rebuild is scope's own axis, D13); it is not part of
// matchesSpec.
func (c *Conn) Walk(repoID string, gitPath string, spec porcelain.WalkSpec, pageSize int) (*Walk, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	h, ok := c.held[repoID]
	if !ok {
		return nil, ErrRepoNotHeld
	}

	if w, ok := c.walks[repoID]; ok {
		if w.matchesSpec(spec) {
			return w, nil
		}
		w.dispose()
		delete(c.walks, repoID)
	}

	w := newWalk(h.entry, gitPath, spec, pageSize)
	c.walks[repoID] = w
	return w, nil
}

// WalkFor returns this connection's existing Walk for repoID, if any, without creating one.
func (c *Conn) WalkFor(repoID string) (*Walk, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	w, ok := c.walks[repoID]
	return w, ok
}
