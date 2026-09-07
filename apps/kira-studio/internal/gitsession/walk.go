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
}

func newWalk(entry *RepoEntry, gitPath string, spec porcelain.WalkSpec, pageSize int) *Walk {
	w := &Walk{entry: entry, gitPath: gitPath, spec: spec, pageSize: pageSize}
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
	w.store = gitstore.New()
	w.marks = map[int]int{0: 0}
	w.nextSeq = 0
	w.lastRemaining = 0
	w.log = logsession.Open(logsession.Deps{
		Runner:  w.entry.Repo.Runner(),
		GitPath: w.gitPath,
		Dir:     walkDir(w.entry.Summary),
		Read:    w.entry.Repo.Read,
	}, logsession.Options{Walk: w.spec, PageSize: w.pageSize})
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
		if _, _, err := w.readPageLocked(ctx); err != nil {
			return true, err
		}
	}
	return true, nil
}

// readPageLocked reads exactly one page from the log session into the store, retrying once
// (against a freshly reset session) if the reclaimed session's own resume found refs had moved —
// D10's own "the caller resets and retries" contract. Caller holds mu.
func (w *Walk) readPageLocked(ctx context.Context) (appended int, exhausted bool, err error) {
	for attempt := 0; attempt < 2; attempt++ {
		outcome, rerr := w.log.ReadPage(ctx, func(cr porcelain.CommitRecord) {
			w.store.Append(cr)
		})
		if rerr != nil {
			return 0, false, rerr
		}
		if outcome.Stale {
			w.resetLocked()
			continue
		}
		return outcome.Appended, outcome.Exhausted, nil
	}
	return 0, false, fmt.Errorf("gitsession: walk: refs kept moving across a reclaimed resume")
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

	emitRange := func(from, to int, source string, exhausted bool) error {
		packed := w.store.PackSlice(from, to, dictBase)
		remaining, err := w.log.Remaining(ctx)
		if err != nil {
			return err
		}
		w.lastRemaining = remaining
		chunk := StreamChunk{
			Seq: w.nextSeq, From: from, To: to, Source: source,
			Remaining: remaining, Exhausted: exhausted, Packed: packed,
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
		if err := emitRange(cursor, to, "cache", false); err != nil {
			return err
		}
		cursor = to
	}

	if w.log.Exhausted() {
		return nil
	}

	// Only the first stream for a repo reads from git; every later page is an explicit loadMore
	// (upstream's own rule) — but this Walk cannot tell "first" from "later" except by there
	// being nothing left cached, which is exactly the condition reached here.
	if _, exhausted, err := w.readPageLocked(ctx); err != nil {
		return err
	} else if newTotal := w.store.RowCount(); cursor < newTotal {
		for cursor < newTotal {
			to := cursor + chunkRows
			if to > newTotal {
				to = newTotal
			}
			if err := emitRange(cursor, to, "git", exhausted && to == newTotal); err != nil {
				return err
			}
			cursor = to
		}
	}
	return nil
}
