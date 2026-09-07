package gitsession

import (
	"context"
	"sync"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
)

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

	mu   sync.Mutex
	held map[string]*hold // RepoID -> hold
}

// NewConn constructs a Conn with an empty hold set.
func NewConn(id ConnID, clientID string, emit func(method string, payload any)) *Conn {
	return &Conn{ID: id, ClientID: clientID, Emit: emit, held: make(map[string]*hold)}
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

// CloseRepo releases this connection's hold on repoID, if any, reporting whether one was present —
// the RPC ignores the bool and answers {} either way, preserving repo.close's idempotency.
func (c *Conn) CloseRepo(repoID string) bool {
	c.mu.Lock()
	h, ok := c.held[repoID]
	if ok {
		delete(c.held, repoID)
	}
	c.mu.Unlock()
	if !ok {
		return false
	}
	h.unsubscribe()
	h.release()
	return true
}

// Close releases every hold this connection has — gitsock's own disconnect teardown (SPEC §6:
// "release its RepoEntry refcounts").
func (c *Conn) Close() {
	c.mu.Lock()
	holds := c.held
	c.held = make(map[string]*hold)
	c.mu.Unlock()

	for _, h := range holds {
		h.unsubscribe()
		h.release()
	}
}
