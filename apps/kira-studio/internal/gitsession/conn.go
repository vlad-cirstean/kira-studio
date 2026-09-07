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

// walkPair is SPEC §6's per-(connection, repository) walk box, read literally: "log session,
// commit store, dictionary marks, scroll/paging state, the active review-range walk if any". Two
// slots, never a map keyed by range — §6.8 is explicit that the review view holds exactly one
// review session, and reviewing another branch replaces its contents rather than opening a second
// view (D3).
type walkPair struct {
	graph  *Walk
	review *Walk
}

// Conn is one connection's private session state — SPEC §6's Conn box, minus Walk (G6). Emit is
// supplied by gitsock so this package never imports bridge or rpcstream (SPEC §7's layering rule);
// it is called from a subscriber's own goroutine (D14), never from the watcher's.
type Conn struct {
	ID       ConnID
	ClientID string
	// ClientLabel is the handshake's own clamped label (gitsock's clampLabel) — G5's own addition
	// (F11), threaded through so the undo slot can attribute a record to "this window" for every
	// OTHER connection's reader (D7's SnapshotFor).
	ClientLabel string
	Emit        func(method string, payload any)

	mu    sync.Mutex
	held  map[string]*hold     // RepoID -> hold
	walks map[string]*walkPair // RepoID -> walkPair (D3), allocated lazily by whichever walk is created first
}

// NewConn constructs a Conn with an empty hold set.
func NewConn(id ConnID, clientID, clientLabel string, emit func(method string, payload any)) *Conn {
	return &Conn{
		ID: id, ClientID: clientID, ClientLabel: clientLabel, Emit: emit,
		held: make(map[string]*hold), walks: make(map[string]*walkPair),
	}
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
		// Marks BOTH the graph and review walk (D5) — a deliberate departure from upstream, whose
		// review walk dies on hide and so never needs this: ours persists across hide/show, and
		// without this the client's own "the comparison has changed" banner would replay a stale
		// store instead of re-walking.
		if ev.Kind == string(gitclient.SignalRefsChanged) {
			c.markWalksStale(ev.RepoID)
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
	pair, hasWalk := c.walks[repoID]
	if hasWalk {
		delete(c.walks, repoID)
	}
	c.mu.Unlock()

	if hasWalk {
		disposePair(pair)
	}
	if !ok {
		return false
	}
	h.unsubscribe()
	h.release()
	return true
}

// Close releases every hold this connection has — gitsock's own disconnect teardown (SPEC §6:
// "release its RepoEntry refcounts"). Every walk (both slots of every pair) is disposed first
// (D13), same ordering as CloseRepo.
func (c *Conn) Close() {
	c.mu.Lock()
	holds := c.held
	c.held = make(map[string]*hold)
	walks := c.walks
	c.walks = make(map[string]*walkPair)
	c.mu.Unlock()

	for _, pair := range walks {
		disposePair(pair)
	}
	for _, h := range holds {
		h.unsubscribe()
		h.release()
	}
}

// disposePair disposes both slots of pair, whichever are non-nil.
func disposePair(pair *walkPair) {
	if pair.graph != nil {
		pair.graph.dispose()
	}
	if pair.review != nil {
		pair.review.dispose()
	}
}

// Walk returns this connection's Walk for repoID — created lazily on first call, rebuilt (the old
// one disposed) whenever spec no longer matches what it was built with (a scope or range change,
// D13/D3's own #ensureReviewWalk shape). Errors with ErrRepoNotHeld if this connection has not
// opened repoID.
//
// spec.Range == nil selects the graph slot; spec.Range != nil selects the review slot (D3) — both
// slots live in one walkPair per repoID, so a ranged request can never disturb the graph's own
// walk and vice versa. Reviewing a second branch replaces the first review walk; there is never
// more than one per (connection, repository).
//
// pageSize (D6's own graph.pageSize) only takes effect on first construction of a given slot — the
// underlying log session's own page size is fixed at Open time and a later call with a different
// value does not rebuild an otherwise-matching walk; it is not part of matchesSpec.
//
// precomputedTotal (D9) is threaded into a freshly-built walk only — an already-matching walk
// reused here keeps whatever total it already has (a peeked count is a hint for the walk's own
// FIRST open, never a value that overwrites a walk already under way).
func (c *Conn) Walk(repoID string, gitPath string, spec porcelain.WalkSpec, pageSize int, precomputedTotal *int) (*Walk, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	h, ok := c.held[repoID]
	if !ok {
		return nil, ErrRepoNotHeld
	}

	pair, ok := c.walks[repoID]
	if !ok {
		pair = &walkPair{}
		c.walks[repoID] = pair
	}

	slot := &pair.graph
	if spec.Range != nil {
		slot = &pair.review
	}

	if *slot != nil {
		if (*slot).matchesSpec(spec) {
			return *slot, nil
		}
		(*slot).dispose()
		*slot = nil
	}

	w := newWalk(h.entry, gitPath, spec, pageSize, precomputedTotal)
	*slot = w
	return w, nil
}

// WalkFor returns this connection's existing GRAPH walk for repoID, if any, without creating one.
func (c *Conn) WalkFor(repoID string) (*Walk, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	pair, ok := c.walks[repoID]
	if !ok || pair.graph == nil {
		return nil, false
	}
	return pair.graph, true
}

// ReviewWalkFor returns this connection's existing REVIEW (ranged) walk for repoID, if any,
// without creating one.
func (c *Conn) ReviewWalkFor(repoID string) (*Walk, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	pair, ok := c.walks[repoID]
	if !ok || pair.review == nil {
		return nil, false
	}
	return pair.review, true
}

// markWalksStale marks BOTH slots of repoID's walk pair stale (D5) — called by Open's own
// subscriber on refsChanged, in place of reaching into a single walk. Never takes a walk's own mu
// (MarkStale's own doc): the subscriber's goroutine must not block behind a page read.
func (c *Conn) markWalksStale(repoID string) {
	c.mu.Lock()
	pair, ok := c.walks[repoID]
	c.mu.Unlock()
	if !ok {
		return
	}
	if pair.graph != nil {
		pair.graph.MarkStale()
	}
	if pair.review != nil {
		pair.review.MarkStale()
	}
}
