package gitsession

import (
	"sync"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/catfile"
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
// subscriber fan-out. G4 adds the two caches SPEC §6 also lists (D7): the cat-file session,
// dropped-on-refsChanged detail cache, and never-invalidated diff cache. Still to come: head,
// stash shapes, undo slot and active remote op (G5-G9) — no placeholders for any of that here.
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
	// D7: dropped before the fan-out, exactly the ordering G3 D13 established for marking a Walk
	// stale — a client that reacts to repo.changed by re-requesting a detail must never be served
	// the pre-change decoration.
	if sig == gitclient.SignalRefsChanged {
		e.detail.dropAll()
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

	e.mu.Lock()
	subs := e.subs
	e.subs = nil
	e.mu.Unlock()
	for _, s := range subs {
		s.close()
	}
}
