package gitclient

import (
	"log/slog"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Signal is one coalesced, debounced repository-change notification (SPEC §6's repo.changed
// payload, minus the repo id gitsession attaches).
type Signal string

const (
	SignalRefsChanged     Signal = "refsChanged"
	SignalWorktreeChanged Signal = "worktreeChanged"
)

// debounceWindow is a leading-window debounce measured from the first event of a burst (G2 plan
// D11; SPEC §6): fires 200ms after the first event, not 200ms after the last, so a continuous
// `git fetch --prune` cannot starve the signal indefinitely.
const debounceWindow = 200 * time.Millisecond

// refIshNames are the basenames (after stripping a trailing .lock, F12) that mean "refs changed"
// when found directly inside commonDir or gitDir — SPEC §6's list plus BISECT_LOG, upstream's set
// verbatim (D9).
var refIshNames = map[string]bool{
	"HEAD":             true,
	"packed-refs":      true,
	"FETCH_HEAD":       true,
	"MERGE_HEAD":       true,
	"rebase-merge":     true,
	"rebase-apply":     true,
	"CHERRY_PICK_HEAD": true,
	"REVERT_HEAD":      true,
	"BISECT_LOG":       true,
	"sequencer":        true,
}

// stripLockSuffix undoes git's own write-by-rename discipline (F12): every one of the paths above
// is written as "<name>.lock" and renamed onto "<name>", and the rename's source-side event names
// the .lock file — a classifier that doesn't strip it silently misses every ref/index write.
func stripLockSuffix(name string) string {
	return strings.TrimSuffix(name, ".lock")
}

// classify decides what path changing means for summary's repository, in upstream's own order
// (D9): a path under commonDir/refs is always refsChanged; gitDir's own index is worktreeChanged;
// only then do the ref-ish basenames (checked in either commonDir or gitDir, so a linked
// worktree's own MERGE_HEAD/sequencer/rebase-* are covered too) apply.
func classify(summary RepoSummary, path string) (Signal, bool) {
	commonDir := filepath.Clean(summary.CommonDir)
	gitDir := filepath.Clean(summary.GitDir)
	path = filepath.Clean(path)

	if refsRoot := filepath.Join(commonDir, "refs"); path == refsRoot || strings.HasPrefix(path, refsRoot+string(filepath.Separator)) {
		return SignalRefsChanged, true
	}

	dir, base := filepath.Split(path)
	dir = filepath.Clean(dir)
	base = stripLockSuffix(base)

	if base == "index" && dir == gitDir {
		return SignalWorktreeChanged, true
	}
	if refIshNames[base] && (dir == commonDir || dir == gitDir) {
		return SignalRefsChanged, true
	}

	// G25 D17/F9: a detached `worktree add`/`remove` writes only under commonDir/worktrees/<name>/
	// (its own per-worktree HEAD, gitdir file, lock file) — for any worktree OTHER than this
	// summary's own gitDir, none of the two rules just above ever matches (dir is neither gitDir
	// nor commonDir), a real, pre-existing G5-era gap this phase makes reachable for the first time
	// (creating/removing a worktree was not something this app could do before now). Checked LAST,
	// after the more specific gitDir-scoped rules above, so this summary's OWN worktree files (in
	// particular its own index, which lives at exactly this same path) keep resolving through the
	// more specific rule that already names the right signal for them. Treated as refsChanged, not
	// a new third Signal kind: the same read (refs.list/worktree.list) is what a client re-requests
	// either way, and G5 never introduced worktreeChanged for anything but the index.
	if worktreesRoot := filepath.Join(commonDir, "worktrees"); path == worktreesRoot || strings.HasPrefix(path, worktreesRoot+string(filepath.Separator)) {
		return SignalRefsChanged, true
	}
	return "", false
}

// rawEvent is one filesystem notification, stripped of every backend-specific concept (G9 D6).
// Path is meaningless when Rescan is set. Both backends deliver Path already agreeing with
// classify's comparison target: resolved once, in NewRepoWatcher, against a watcher-local copy of
// the summary (D7) — necessary because FSEvents itself always reports realpaths (F9).
type rawEvent struct {
	Path   string
	Rescan bool
}

// backend is the OS event source, and the only part of the watcher's job that differs by
// platform (G9 D6). Events is closed once the backend stops on its own (after Close, or if the
// underlying source ends); Close stops the backend and is idempotent.
type backend interface {
	Events() <-chan rawEvent
	Close() error
}

// newBackend is implemented once per platform: watcher_fsevents_darwin.go (darwin && cgo) and
// watcher_fsnotify.go (!darwin || !cgo). commonDir and gitDir are already symlink-resolved (D7).
// watcherBackend, a const naming which one is active, is declared alongside each implementation.

// RepoWatcher watches one repository's .git directories and reports debounced, coalesced signals.
// Closing it stops its goroutine and closes Signals.
type RepoWatcher struct {
	summary RepoSummary // watcher-local: CommonDir/GitDir are resolved (D7); RepoID is not.
	src     backend

	out  chan Signal
	stop chan struct{}
	done chan struct{}

	closeOnce sync.Once
}

// resolveOrKeep resolves path to its realpath, falling back to path unchanged if it does not
// exist yet (a repository mid-init) or cannot be resolved for any other reason — matching what
// the fsnotify backend already tolerated before this phase.
func resolveOrKeep(path string) string {
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		return path
	}
	return resolved
}

// NewRepoWatcher starts watching summary's repository.
//
// FSEvents reports realpaths, always (F9): on macOS /tmp and /var are symlinks into /private, so
// an unresolved commonDir would never prefix-match an event path and the watcher would silently
// classify nothing, forever. Resolving once here — into a copy local to the watcher — is what
// makes the backend's watch roots and classify's comparisons agree by construction, on every
// platform (D7). The resolved copy never escapes this file: summary.RepoID and every wire/cache
// value elsewhere keep using the original, unresolved paths.
func NewRepoWatcher(summary RepoSummary) (*RepoWatcher, error) {
	resolved := summary
	resolved.CommonDir = resolveOrKeep(summary.CommonDir)
	resolved.GitDir = resolveOrKeep(summary.GitDir)

	src, err := newBackend(resolved.CommonDir, resolved.GitDir)
	if err != nil {
		return nil, err
	}
	return newRepoWatcherWith(resolved, src), nil
}

// newRepoWatcherWith is the shared constructor: NewRepoWatcher calls it with a real backend over
// a resolved summary, and watcher_test.go calls it directly with a fake backend to drive the
// debounce/Rescan rule (which lives here, above the seam, D6) without a filesystem or real git.
func newRepoWatcherWith(summary RepoSummary, src backend) *RepoWatcher {
	w := &RepoWatcher{
		summary: summary,
		src:     src,
		out:     make(chan Signal, 2), // at most one of each kind pending per debounce firing.
		stop:    make(chan struct{}),
		done:    make(chan struct{}),
	}

	watchedPaths := []string{summary.CommonDir}
	if summary.GitDir != summary.CommonDir {
		watchedPaths = append(watchedPaths, summary.GitDir)
	}
	slog.Info("gitclient: repo watcher started", "scope", "watcher",
		"backend", watcherBackend, "paths", watchedPaths)

	go w.run()
	return w
}

// Signals is the debounced, coalesced output — at most one refsChanged and one worktreeChanged per
// debounce firing (D11), closed once the watcher stops.
func (w *RepoWatcher) Signals() <-chan Signal { return w.out }

// Close stops the watcher goroutine and the underlying backend. Idempotent.
func (w *RepoWatcher) Close() error {
	w.closeOnce.Do(func() {
		close(w.stop)
		<-w.done
	})
	return w.src.Close()
}

func (w *RepoWatcher) emit(sig Signal) {
	select {
	case w.out <- sig:
	case <-w.stop:
	}
}

// run is the watcher's single goroutine (D11): it owns the two pending flags and the leading-
// window debounce timer, and is the only place that reads w.src.Events() or writes pendingRefs/
// pendingWorktree, so neither needs a lock. Rescan means "something changed and we don't know
// what" — coalesced overflow/dropped events on either backend (D9) — and raises both signals,
// exactly as the fsnotify-only version of this file always did for ErrEventOverflow.
func (w *RepoWatcher) run() {
	defer close(w.done)
	defer close(w.out)

	var timer *time.Timer
	var timerC <-chan time.Time
	var pendingRefs, pendingWorktree bool

	armIfNeeded := func() {
		if timer == nil && (pendingRefs || pendingWorktree) {
			timer = time.NewTimer(debounceWindow)
			timerC = timer.C
		}
	}
	fire := func() {
		if pendingRefs {
			w.emit(SignalRefsChanged)
		}
		if pendingWorktree {
			w.emit(SignalWorktreeChanged)
		}
		pendingRefs, pendingWorktree = false, false
		timer, timerC = nil, nil
	}

	for {
		select {
		case ev, ok := <-w.src.Events():
			if !ok {
				return
			}
			if ev.Rescan {
				pendingRefs, pendingWorktree = true, true
			} else {
				switch sig, matched := classify(w.summary, ev.Path); {
				case matched && sig == SignalRefsChanged:
					pendingRefs = true
				case matched && sig == SignalWorktreeChanged:
					pendingWorktree = true
				}
			}
			armIfNeeded()

		case <-timerC:
			fire()

		case <-w.stop:
			if timer != nil {
				timer.Stop()
			}
			return
		}
	}
}
