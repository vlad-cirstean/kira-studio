package gitsession

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/logsession"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitstore"
)

// StreamChunk is one packed slice of commits plus the envelope metadata graph.stream needs to
// answer with — gitrpc wraps this directly into the wire's chunk shape (D14). Declared here
// (not in gitrpc) so gitsession stays free of any wire-format opinion; gitrpc is the layer that
// knows what JSON this becomes.
type StreamChunk struct {
	Seq       int
	From, To  int
	Source    string // "git" | "cache"
	Remaining int
	Exhausted bool
	Packed    gitstore.PackedChunk
}

// Walk is SPEC §6's per-connection paging state (D13): one repository's history, walked and
// cached privately for one connection — two windows scrolled to different depths in the same
// repository is precisely the case a single per-repo session (upstream's own shape) never had.
type Walk struct {
	entry    *RepoEntry
	gitPath  string
	spec     porcelain.WalkSpec
	pageSize int // the underlying log session's own page size — fixed at construction (D6)

	// precomputedTotal is G6 D9's own seam: a rev-list --count already known for this exact range
	// (from RepoEntry's own range-count slot), threaded into the next resetLocked's
	// logsession.Options and then consumed (nilled) — only the walk's first open (or the open right
	// after a reset) benefits; a later reset recounts rather than reusing a stale number. nil for
	// every graph walk (G3 never sets it).
	precomputedTotal *int

	mu    sync.Mutex // serialises every operation on this walk, including Stream's own emit
	log   *logsession.Session
	store *gitstore.Store
	// marks maps a boundary row to the dictionary size (interner.Size()) once every chunk up to
	// that row has been packed and sent — a delta keyed by a per-row mark, never a running cursor.
	// Seeded {0: 0}.
	marks         map[int]int
	nextSeq       int
	lastRemaining int

	// staleRefs/staleRefresh are set by the watcher fan-out and graph.refresh respectively, and
	// must never take mu (D13): the subscriber's own goroutine (G2 D14) must not block behind a
	// page read. ensureFreshLocked (under mu, at the top of every operation) tests-and-clears both.
	staleRefs    atomic.Bool
	staleRefresh atomic.Bool

	// searchCancel (G23 D12) cancels this walk's own in-flight search.run scan, if any — the
	// host-side belt to the client's own abort-on-supersede brace (F8). searchGen distinguishes
	// "my own scan finished, clear the slot" from "a NEWER scan already installed its own cancel
	// here, leave it alone" — see (*Walk).Search's own doc comment for why a plain nil-check is
	// not enough.
	searchCancel context.CancelFunc
	searchGen    uint64
}

func newWalk(entry *RepoEntry, gitPath string, spec porcelain.WalkSpec, pageSize int, precomputedTotal *int) *Walk {
	w := &Walk{entry: entry, gitPath: gitPath, spec: spec, pageSize: pageSize, precomputedTotal: precomputedTotal}
	w.resetLocked()
	return w
}

// matchesSpec reports whether spec is the same rev-set selection this walk was built with — a
// scope change rebuilds the walk (Conn.Walk's own job), matching it does not.
func (w *Walk) matchesSpec(spec porcelain.WalkSpec) bool {
	if w.spec.Scope != spec.Scope || w.spec.IncludeStash != spec.IncludeStash {
		return false
	}
	if (w.spec.Range == nil) != (spec.Range == nil) {
		return false
	}
	if w.spec.Range != nil && *w.spec.Range != *spec.Range {
		return false
	}
	if len(w.spec.StashShas) != len(spec.StashShas) {
		return false
	}
	for i := range w.spec.StashShas {
		if w.spec.StashShas[i] != spec.StashShas[i] {
			return false
		}
	}
	return true
}

func walkDir(s gitclient.RepoSummary) string {
	if s.IsBare {
		return s.GitDir
	}
	return s.Root
}

// resetLocked drops the store, reseeds marks to {0:0} and reopens the log session — upstream's
// own #resetSession minus the stash refresh (G8). Caller holds mu (or this is the constructor,
// where no other goroutine can see w yet).
func (w *Walk) resetLocked() {
	if w.log != nil {
		w.log.Close()
	}
	// G23 D12: a walk rebuild (refs moved, an explicit graph.refresh) invalidates any scan
	// already reading the walk's OLD rev set — cancel it rather than let it finish and answer a
	// question that is no longer being asked.
	if w.searchCancel != nil {
		w.searchCancel()
		w.searchCancel = nil
	}
	w.store = gitstore.New()
	w.marks = map[int]int{0: 0}
	w.nextSeq = 0
	w.lastRemaining = 0
	w.log = logsession.Open(logsession.Deps{
		Runner:  w.entry.Repo.Runner(),
		GitPath: w.gitPath,
		Dir:     walkDir(w.entry.Summary),
		Read:    w.entry.Repo.Read,
	}, logsession.Options{Walk: w.spec, PageSize: w.pageSize, PrecomputedTotal: w.precomputedTotal})
	// Consumed: only THIS open uses a count computed before whatever reset triggered it (D9) — a
	// later reset (refs moved) recounts rather than reusing a now-stale number.
	w.precomputedTotal = nil
	w.staleRefs.Store(false)
	w.staleRefresh.Store(false)
}

// ensureFreshLocked tests-and-clears staleRefs/staleRefresh; either resets the walk. Caller holds
// mu, at the top of every operation.
func (w *Walk) ensureFreshLocked() {
	refs := w.staleRefs.Swap(false)
	refresh := w.staleRefresh.Swap(false)
	if refs || refresh {
		w.resetLocked()
	}
}

// MarkStale flags that refs moved under this walk — never takes mu (see the field's own doc).
func (w *Walk) MarkStale() { w.staleRefs.Store(true) }

// MarkRefresh flags an explicit graph.refresh — never takes mu.
func (w *Walk) MarkRefresh() { w.staleRefresh.Store(true) }

// dispose stops the walk's log session (killing its git log process). Called by Conn before
// releasing the repo ref that backs it (D13).
func (w *Walk) dispose() {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.log != nil {
		w.log.Close()
	}
	// G23 D12: a disposed walk must not leave an orphaned scan running against a repo ref this
	// connection is about to release.
	if w.searchCancel != nil {
		w.searchCancel()
		w.searchCancel = nil
	}
}

// Spec returns a copy of this walk's own WalkSpec (F14) — gitsession/search.go's own source for
// the rev set gitsearch.Scan runs against, and probe 11's ordering-identity guarantee that a hit
// is always a row this same walk can reveal.
func (w *Walk) Spec() porcelain.WalkSpec {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.spec
}

// Status is graph.status's own answer.
func (w *Walk) Status(ctx context.Context) (loaded, remaining int, exhausted bool, err error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.ensureFreshLocked()
	remaining, err = w.log.Remaining(ctx)
	if err != nil {
		return 0, 0, false, err
	}
	w.lastRemaining = remaining
	return w.store.RowCount(), remaining, w.log.Exhausted(), nil
}

// ReadPage reads up to `pages` pages from git into the store — graph.loadMore's own work. started
// is false only when the walk was already exhausted and nothing was attempted.
func (w *Walk) ReadPage(ctx context.Context, pages int) (started bool, err error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.ensureFreshLocked()
	if w.log.Exhausted() {
		return false, nil
	}
	if pages <= 0 {
		pages = 1
	}
	for i := 0; i < pages && !w.log.Exhausted(); i++ {
		if _, err := w.readPageLocked(ctx); err != nil {
			return true, err
		}
	}
	return true, nil
}

// readPageLocked reads exactly one page from the log session into the store, retrying once
// (against a freshly reset session) if the reclaimed session's own resume found refs had moved —
// D10's own "the caller resets and retries" contract. Caller holds mu.
//
// G16 D5: narrowed from (appended int, exhausted bool, err error) — neither caller needs
// outcome.Exhausted once Stream's emit site reads w.log.Exhausted() directly (see emitRange
// below), and leaving an ignored return in place invited exactly the bug this phase fixes:
// trusting a caller-supplied exhaustion flag instead of the walk's own truth.
func (w *Walk) readPageLocked(ctx context.Context) (appended int, err error) {
	for attempt := 0; attempt < 2; attempt++ {
		outcome, rerr := w.log.ReadPage(ctx, func(cr porcelain.CommitRecord) {
			w.store.Append(cr)
		})
		if rerr != nil {
			return 0, rerr
		}
		if outcome.Stale {
			w.resetLocked()
			continue
		}
		return outcome.Appended, nil
	}
	return 0, fmt.Errorf("gitsession: walk: refs kept moving across a reclaimed resume")
}

// Stream is D14's own streamGraph transcribed: ensureFresh, clamp resumeThroughRow to the store's
// row count, resolve the dictionary base from marks (falling back to row 0/base 0 when the
// clamped row has no mark — a mark only exists for a row a previous Stream call actually packed
// up to; a row the store grew past purely via ReadPage/loadMore has none), replay [cursor,
// cachedThrough) as source:"cache" in chunkRows-sized pieces, read one page from git only when
// nothing is cached beyond the cursor, then emit the newly-read rows as source:"git". emit runs
// synchronously while mu is held for the whole call (D13) — a stalled emit blocks every other
// graph.* call this connection makes against this repository until it returns or ctx is done.
func (w *Walk) Stream(ctx context.Context, resumeThroughRow *int, chunkRows int, emit func(StreamChunk) error) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.ensureFreshLocked()

	if chunkRows <= 0 {
		chunkRows = 500
	}

	cachedThrough := w.store.RowCount()
	cursor := 0
	if resumeThroughRow != nil {
		cursor = *resumeThroughRow
		if cursor < 0 {
			cursor = 0
		}
		if cursor > cachedThrough {
			cursor = cachedThrough
		}
	}
	dictBase, ok := w.marks[cursor]
	if !ok {
		cursor = 0
		dictBase = 0
	}

	// G16 D5: emitRange's fourth parameter is `last` — a fact about this chunk's position in the
	// stream, not a value the caller invents — and the wire's Exhausted flag is derived from the
	// walk's own truth (w.log.Exhausted()) once, here, at the single point every chunk is built.
	// F4's bug was exactly a caller (the replay loop, below) inventing a literal `false`.
	emitRange := func(from, to int, source string, last bool) error {
		packed := w.store.PackSlice(from, to, dictBase)
		remaining, err := w.log.Remaining(ctx)
		if err != nil {
			return err
		}
		w.lastRemaining = remaining
		chunk := StreamChunk{
			Seq: w.nextSeq, From: from, To: to, Source: source,
			Remaining: remaining, Exhausted: last && w.log.Exhausted(), Packed: packed,
		}
		w.nextSeq++
		if err := emit(chunk); err != nil {
			return err
		}
		dictBase += len(packed.Dictionary)
		w.marks[to] = dictBase
		return nil
	}

	for cursor < cachedThrough {
		to := cursor + chunkRows
		if to > cachedThrough {
			to = cachedThrough
		}
		// A non-empty replay is never followed by a git read in the same call — line ~285's
		// `cachedThrough > 0` guard sees to it, since a page is read here only on a walk's very
		// first stream. So the last replayed chunk (to == cachedThrough) really is the stream's
		// terminal chunk whenever this loop runs at all, and w.log.Exhausted() here is the same
		// answer the git loop below would give.
		if err := emitRange(cursor, to, "cache", to == cachedThrough); err != nil {
			return err
		}
		cursor = to
	}

	if w.log.Exhausted() {
		return nil
	}

	// Upstream's own guard (repoService.ts:1080-1084) and §5.1.1's rule: a page is read here only
	// on the very first stream for this walk — cachedThrough == 0, nothing cached at all. Every
	// later page is an explicit loadMore; without this a re-open of a non-exhausted walk would
	// silently read a page the caller did not ask for, on top of whatever it already had cached.
	if cachedThrough > 0 {
		return nil
	}
	if _, err := w.readPageLocked(ctx); err != nil {
		return err
	} else if newTotal := w.store.RowCount(); cursor < newTotal {
		for cursor < newTotal {
			to := cursor + chunkRows
			if to > newTotal {
				to = newTotal
			}
			if err := emitRange(cursor, to, "git", to == newTotal); err != nil {
				return err
			}
			cursor = to
		}
	}
	// G16 D5/F7: a zero-chunk re-stream (cursor == cachedThrough and the walk already exhausted,
	// or a first stream whose page read yields zero records) emits nothing here — no chunk exists
	// to carry a terminal flag. That hole is closed client-side (graph.status, packages/git-ui's
	// GraphViewState#runLoad) rather than by inventing an empty terminal chunk, which would collide
	// with packedStream.ts's from === 0 restart-and-reset rule.
	return nil
}
