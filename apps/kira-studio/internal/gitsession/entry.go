package gitsession

import (
	"context"
	"sync"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/catfile"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitpreflight"
)

// Watcher is the minimal seam RepoEntry needs from a repo watcher — gitclient.RepoWatcher
// satisfies it structurally. Declared here (not imported as a concrete type) and exported so both
// registry_test.go (same package) and gitsock's own integration test (a different package,
// injecting a counting fake through Registry.NewWatcher) can drive refcount/linger logic with no
// filesystem and no real git (§3.5/§3.9).
type Watcher interface {
	Signals() <-chan gitclient.Signal
	Close() error
}

// Event is repo.changed's payload, SPEC §6/D20's shape verbatim — crossed as-is by
// (*rpcstream.Session).Emit's own json.Marshal.
type Event struct {
	RepoID string `json:"repoId"`
	Kind   string `json:"kind"` // "refsChanged" | "worktreeChanged"
}

// RepoEntry is one repository's SHARED state — everything true of the repository rather than of
// one viewer (SPEC §6's split rule). G2 gave it the identity, the reader/writer gate (unchanged
// from gitclient, now shared across connections instead of within one), the watcher, and the
// subscriber fan-out. G4 added the cat-file session and the two detail/diff caches. G5 adds the
// live head, the refs cache and the per-repo undo slot (D7/D10/D16) — still to come: stash shapes
// and active remote op (G7/G12).
type RepoEntry struct {
	Summary gitclient.RepoSummary
	Repo    *gitclient.Repo

	watcher Watcher

	mu   sync.Mutex
	subs map[ConnID]*subscriber

	catfileMu sync.Mutex
	catfile   *catfile.Session

	detail *detailCache
	diff   *diffCache
	refs   *refsCache

	// headMu guards head/headStale, separate from mu (subs' own lock): every read/status/pre-flight
	// spawn touches head far more often than it touches the subscriber set.
	headMu    sync.Mutex
	head      gitclient.HeadState
	headStale bool

	// undo is SPEC §6's undo slot — one per repo, not per connection (D7). Its own mutex, following
	// this file's own cache pattern.
	undo *gitpreflight.UndoSlot

	done chan struct{}
}

func newRepoEntry(summary gitclient.RepoSummary, repo *gitclient.Repo, w Watcher) *RepoEntry {
	e := &RepoEntry{
		Summary: summary,
		Repo:    repo,
		watcher: w,
		subs:    make(map[ConnID]*subscriber),
		detail:  newDetailCache(),
		diff:    newDiffCache(diffCacheCapBytes),
		refs:    newRefsCache(),
		head:    summary.Head,
		undo:    &gitpreflight.UndoSlot{},
		done:    make(chan struct{}),
	}
	go e.pump()
	return e
}

// pump is the entry's watcher-draining goroutine: one signal in, fanned out to every current
// subscriber. It exits when the watcher's Signals channel closes (teardown calls watcher.Close,
// which is what closes it).
func (e *RepoEntry) pump() {
	defer close(e.done)
	for sig := range e.watcher.Signals() {
		e.note(sig)
	}
}

func (e *RepoEntry) note(sig gitclient.Signal) {
	// D7/D10/D16: dropped before the fan-out, exactly the ordering G3 D13 established for marking
	// a Walk stale — a client that reacts to repo.changed by re-requesting a detail, a ref list or
	// a fresh head must never be served the pre-change decoration.
	if sig == gitclient.SignalRefsChanged {
		e.detail.dropAll()
		e.refs.drop()
		e.headMu.Lock()
		e.headStale = true
		e.headMu.Unlock()
	}
	e.mu.Lock()
	subs := make([]*subscriber, 0, len(e.subs))
	for _, s := range e.subs {
		subs = append(subs, s)
	}
	e.mu.Unlock()
	for _, s := range subs {
		s.note(sig)
	}
}

// Subscribe registers deliver for every future signal on this entry, wrapped in D14's coalescing
// subscriber so a slow deliver can never stall another subscriber or the watcher itself. The
// returned func unsubscribes and stops the subscriber's own goroutine; safe to call once.
func (e *RepoEntry) Subscribe(id ConnID, deliver func(Event)) func() {
	s := newSubscriber(e.Summary.RepoID, deliver)
	e.mu.Lock()
	e.subs[id] = s
	e.mu.Unlock()

	var once sync.Once
	return func() {
		once.Do(func() {
			e.mu.Lock()
			delete(e.subs, id)
			e.mu.Unlock()
			s.close()
		})
	}
}

// Head returns the entry's live head, re-resolving through gitclient.ResolveHead first if a
// refsChanged signal marked it stale (D16) — a lazy refresh, never eager: the extra two spawns
// this costs only happen when a ref changed AND the next reader is refs.list rather than
// status.get/RunOp, both of which set the head for free from their own spawn's output (setHead).
func (e *RepoEntry) Head(ctx context.Context) (gitclient.HeadState, error) {
	e.headMu.Lock()
	if !e.headStale {
		h := e.head
		e.headMu.Unlock()
		return h, nil
	}
	e.headMu.Unlock()

	var h gitclient.HeadState
	err := e.Repo.Read(ctx, func(ctx context.Context) error {
		var rerr error
		h, rerr = gitclient.ResolveHead(ctx, e.Repo.Runner(), e.Repo.GitPath(), repoWorkingDir(e.Summary))
		return rerr
	})
	if err != nil {
		return gitclient.HeadState{}, err
	}
	e.setHead(h)
	return h, nil
}

// setHead writes a freshly-resolved head (from a status --branch header, or ResolveHead above) and
// clears the stale flag — called by statusAndInProgress and RunOp's own read-back, both of which
// already have a fresh head for free from their own spawn's output (D16).
func (e *RepoEntry) setHead(h gitclient.HeadState) {
	e.headMu.Lock()
	e.head = h
	e.headStale = false
	e.headMu.Unlock()
}

// CatFile returns this entry's cat-file batch session (D11), starting it lazily on first use — a
// connection that never reads a blob or a commit's metadata never spawns the two extra
// `cat-file` processes. No production caller reaches this in G3 (its first is G4's commit.detail/
// commit.fileDiff/blob reads); it exists now so RepoEntry's own teardown has somewhere real to
// tear down, per SPEC §6 putting the cat-file session in the shared (per-repo, not per-connection)
// box.
func (e *RepoEntry) CatFile() *catfile.Session {
	e.catfileMu.Lock()
	defer e.catfileMu.Unlock()
	if e.catfile == nil {
		dir := e.Summary.Root
		if e.Summary.IsBare {
			dir = e.Summary.GitDir
		}
		e.catfile = catfile.NewSession(catfile.Deps{
			Runner: e.Repo.Runner(), GitPath: e.Repo.GitPath(), Dir: dir,
		}, 0)
	}
	return e.catfile
}

// teardown stops the watcher, waits for pump to drain, stops every remaining subscriber, and
// closes the cat-file session if one was ever started — called by Registry once refcount and
// linger both say the entry is really done. Not idempotent on its own; Registry only ever calls it
// once per entry (guarded by deleting it from the map first).
func (e *RepoEntry) teardown() {
	_ = e.watcher.Close()
	<-e.done

	e.catfileMu.Lock()
	if e.catfile != nil {
		e.catfile.Close()
	}
	e.catfileMu.Unlock()

	e.detail.dropAll()
	e.diff.clear()
	e.refs.drop()
	e.undo.Set(nil)

	e.mu.Lock()
	subs := e.subs
	e.subs = nil
	e.mu.Unlock()
	for _, s := range subs {
		s.close()
	}
}
