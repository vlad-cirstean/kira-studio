package gitsession

import (
	"context"
	"errors"
	"sync"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ghclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/catfile"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitpreflight"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitreview"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// ErrRepoTornDown is returned by whatever still reaches a RepoEntry after its own teardown() ran
// (F2/F3) — Registry.Close() tears entries down regardless of refcount (D14), so a request still
// in flight at process shutdown can observe this instead of a nil-map panic or a double-close.
// gitrpc's default mapGitError arm maps it to E_INTERNAL like any other unrecognised error; the
// response is delivered nowhere anyway, since the socket is already closing.
var ErrRepoTornDown = errors.New("gitsession: repository entry has been torn down")

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

	mu       sync.Mutex
	subs     map[ConnID]*subscriber
	tornDown bool // set once, under mu, by teardown() (D4) — makes Subscribe/CatFile/teardown itself
	// safe against a concurrent subscribe or a second teardown call (F2/F3), guarded by the SAME
	// mu that already serialises subs.

	catfileMu sync.Mutex
	catfile   *catfile.Session

	detail *detailCache
	diff   *diffCache
	refs   *refsCache
	// stack is G26 D3/D16's own stack.list cache — one value per repository, dropped on
	// refsChanged and by invalidateAfterWrite exactly like refs.
	stack *stackCache

	// headMu guards head/headStale, separate from mu (subs' own lock): every read/status/pre-flight
	// spawn touches head far more often than it touches the subscriber set.
	headMu    sync.Mutex
	head      gitclient.HeadState
	headStale bool

	// undo is SPEC §6's undo slot — one per repo, not per connection (D7). Its own mutex, following
	// this file's own cache pattern.
	undo *gitpreflight.UndoSlot

	// rangeCount is G6 D9's one-entry range-count slot (review.go) — a fact about the repository,
	// shared the same way detail/diff/refs are.
	rangeCount reviewRangeCountSlot

	// remoteOp is SPEC §6's own "active remote op (≤1)" box (G7 D9/D11/D20/D21).
	remoteOp remoteOpSlot
	// autoFetch is G7 D23's own background-fetch timer — one per repository.
	autoFetch autoFetchState
	// askPassMu/askPassChecked/askPassValue cache `git config --get core.askPass` for this entry's
	// whole life (G7 D10) — read once, lazily, on the first remote op.
	askPassMu      sync.Mutex
	askPassChecked bool
	askPassValue   string
	// settings is G7 D16's server-owned settings accessor (protected-branch patterns, auto-fetch
	// minutes, and, since G18 D15, gitPath) — a plain func, not an interface, so this package
	// keeps importing only gitclient/gitaskpass/stdlib; threaded in by Registry.Acquire from its
	// own Registry.Settings field.
	settings func() (protectedBranches []string, autoFetchMinutes int, gitPath string)

	// repoSettingsGet is G18 D8's own per-repo settings accessor (the seven keys D3 moved into
	// their own table) — threaded in by Registry.Acquire from Registry.RepoSettingsGet, read
	// through RepoSettings() below rather than directly, so a nil closure or a storage error both
	// fall back to the schema's own defaults instead of every caller re-deriving that fallback.
	repoSettingsGet func(repoID string) (model.GitRepoSettings, error)

	// review is G11's own review.db handle (D3/D14) — shared off the Registry, not per-connection
	// (D12: "I have reviewed X" is a fact about the repository and the person, not the window).
	review *gitreview.Store

	// gh is G24 D6's own three-cache-plus-breaker slot (gh.go); ghClient is the process-wide
	// *ghclient.Client threaded in by Registry.Acquire from Registry.Gh, mirroring review's own
	// "shared off the Registry" shape — one GitHub surface, not one per repository.
	gh       *ghState
	ghClient *ghclient.Client

	// isOpen is G25 F7's own cross-window query, threaded in from Registry.IsOpen — a plain func,
	// the same "this package imports only gitclient/gitreview/stdlib, so a cross-entry fact reaches
	// here as a closure, never as a *Registry field" discipline settings/repoSettingsGet already
	// follow. nil-safe: every call site checks for nil before calling (a RepoEntry built directly
	// by an older test never worries about worktree cross-window checks in the first place).
	isOpen func(repoID string) bool

	// prepareScriptApprovalGet/prepareScriptApprovalSet are G25 D11's own two server-only accessors
	// (storage/repos.GitRepoSettingsRepo.{Get,Set}PrepareScriptApproval), threaded in the same way —
	// never exposed through repoSettingsGet/RepoSettings, which is exactly the point (F15).
	prepareScriptApprovalGet func(repoID string) (sha string, ok bool, err error)
	prepareScriptApprovalSet func(repoID, sha string) error

	// prepare is G25 D13's own "≤1 prepare run per repository" box — teardown force-cancels it
	// exactly like remoteOp.
	prepare prepareOpSlot

	done chan struct{}
}

func newRepoEntry(
	summary gitclient.RepoSummary, repo *gitclient.Repo, w Watcher,
	settings func() ([]string, int, string), repoSettingsGet func(string) (model.GitRepoSettings, error),
	review *gitreview.Store, ghClient *ghclient.Client, isOpen func(string) bool,
	prepareScriptApprovalGet func(string) (string, bool, error), prepareScriptApprovalSet func(string, string) error,
) *RepoEntry {
	e := &RepoEntry{
		Summary:                  summary,
		Repo:                     repo,
		watcher:                  w,
		subs:                     make(map[ConnID]*subscriber),
		detail:                   newDetailCache(),
		diff:                     newDiffCache(diffCacheCapBytes),
		refs:                     newRefsCache(),
		stack:                    newStackCache(),
		head:                     summary.Head,
		undo:                     &gitpreflight.UndoSlot{},
		settings:                 settings,
		repoSettingsGet:          repoSettingsGet,
		review:                   review,
		gh:                       newGhState(),
		ghClient:                 ghClient,
		isOpen:                   isOpen,
		prepareScriptApprovalGet: prepareScriptApprovalGet,
		prepareScriptApprovalSet: prepareScriptApprovalSet,
		done:                     make(chan struct{}),
	}
	go e.pump()
	if _, minutes, _ := settings(); minutes > 0 {
		e.startAutoFetch(minutes)
	}
	return e
}

// RepoSettings is G18 D6's own resolution point: entry.go's callers (graph.go/review.go/remote.go)
// use this instead of a hardcoded constant when a request's own optional field is empty. Falls
// back to the schema's own defaults (never errors, never panics) when repoSettingsGet is nil (a
// RepoEntry constructed directly by a test) or the storage read itself fails — the same "fail
// closed to a known-good value" discipline storage/repos.leaf already applies one layer down.
func (e *RepoEntry) RepoSettings() model.GitRepoSettings {
	if e.repoSettingsGet == nil {
		return model.DefaultGitRepoSettings()
	}
	s, err := e.repoSettingsGet(e.Summary.RepoID)
	if err != nil {
		return model.DefaultGitRepoSettings()
	}
	return s
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
		e.stack.drop()
		e.rangeCount.drop()
		e.headMu.Lock()
		e.headStale = true
		e.headMu.Unlock()
		// G24 D6/D8: the snapshot/per-branch/per-commit gh caches and the GitHub-remote detection
		// are all dropped here too — the breaker is not (D7: "refsChanged does not clear it"). The
		// bounded, gated eager re-resolve pass (D8) is scheduled AFTER the drop, in its own
		// goroutine, so it never delays this signal's own fan-out to subscribers.
		e.gh.drop()
		go e.eagerResolveClosedBranches()
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
// returned func unsubscribes and stops the subscriber's own goroutine; safe to call once. Returns
// a no-op unsubscribe, constructing no subscriber, when this entry has already been torn down
// (F2a: teardown may run concurrently with Open racing Registry.Close during app quit) — the
// caller (Conn.Open) then holds a ref on a dead entry for a moment and releases it normally.
func (e *RepoEntry) Subscribe(id ConnID, deliver func(Event)) func() {
	e.mu.Lock()
	if e.tornDown {
		e.mu.Unlock()
		return func() {}
	}
	s := newSubscriber(e.Summary.RepoID, deliver)
	e.subs[id] = s
	e.mu.Unlock()

	var once sync.Once
	return func() {
		once.Do(func() {
			e.mu.Lock()
			_, present := e.subs[id]
			if present {
				delete(e.subs, id)
			}
			e.mu.Unlock()
			// Close only the subscriber this call actually removed from the map — teardown (F2b)
			// may have already deleted it and closed it itself, and closing an already-closed
			// subscriber's channel a second time is the double-close this guard exists to avoid.
			if present {
				s.close()
			}
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
// invalidateAfterWrite drops exactly what a completed local write can have invalidated, without
// waiting for the watcher's own debounced signal (F5/D7): the same four drops note() makes on
// refsChanged. It is a second line of defence for OUR OWN writes, for the case a watch was lost
// (fsnotify's Add can fail with EMFILE, G2 D10 logs-and-skips; ErrEventOverflow is documented) — the
// watcher remains the ONLY thing that notices a write made outside this app, and the only thing
// that fans repo.changed out to subscribers. This emits no event (a second emitter would double
// every event a client sees) and marks no Walk stale (a Walk is per-connection; reaching from an
// entry into every connection's walks would invert the dependency the subscriber already owns).
func (e *RepoEntry) invalidateAfterWrite() {
	e.detail.dropAll()
	e.refs.drop()
	e.stack.drop()
	e.rangeCount.drop()
	e.headMu.Lock()
	e.headStale = true
	e.headMu.Unlock()
}

// CatFile returns nil once this entry has been torn down (F3) — a lazy, unguarded construction
// here is exactly what let auto-fetch (and any other reader racing teardown) start a fresh
// `cat-file --batch` pair nothing would ever close. Callers treat nil as ErrRepoTornDown.
func (e *RepoEntry) CatFile() *catfile.Session {
	e.mu.Lock()
	tornDown := e.tornDown
	e.mu.Unlock()
	if tornDown {
		return nil
	}

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

// closeCatFile closes and forgets the memoised cat-file session, if one exists — called by
// teardown, and by Registry.release at refcount zero (D13a): the pair is pure cost during the
// linger window (two OS processes for a session nobody is using) and restarts lazily on the next
// use, exactly as it already does on first use.
func (e *RepoEntry) closeCatFile() {
	e.catfileMu.Lock()
	defer e.catfileMu.Unlock()
	if e.catfile != nil {
		e.catfile.Close()
		e.catfile = nil
	}
}

// teardown stops the watcher, waits for pump to drain, stops every remaining subscriber, and
// closes the cat-file session if one was ever started — called by Registry once refcount and
// linger both say the entry is really done, or unconditionally by Registry.Close() at shutdown
// (D14) regardless of refcount. Idempotent (D4): Registry.Close no longer needs to be the only
// caller, since a concurrent Subscribe/CatFile now sees tornDown rather than racing the map/session
// this function clears.
func (e *RepoEntry) teardown() {
	e.mu.Lock()
	if e.tornDown {
		e.mu.Unlock()
		return
	}
	e.tornDown = true
	subs := e.subs
	e.subs = make(map[ConnID]*subscriber) // never nil (F2a) — a Subscribe losing this race must
	// find a real, writable-looking map rather than panic; it is refused by the tornDown check
	// above before it would ever write into it.
	e.mu.Unlock()

	e.stopAutoFetch()
	e.remoteOp.forceCancel()
	e.prepare.forceCancel() // G25 D13/3.12: a prepare run in flight is killed, not left orphaned.
	_ = e.watcher.Close()
	<-e.done

	e.closeCatFile()

	e.detail.dropAll()
	e.diff.clear()
	e.refs.drop()
	e.stack.drop()
	e.rangeCount.drop()
	e.undo.Set(nil)

	for _, s := range subs {
		s.close()
	}
}
