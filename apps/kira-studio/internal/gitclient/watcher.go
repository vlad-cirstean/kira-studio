package gitclient

import (
	"errors"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
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
	return "", false
}

// addRefsTree walks root (commonDir/refs) and Adds every directory found to fsw — the walk this
// plan must do itself (F9): fsnotify has no recursive watch, so this is what stands in for one. A
// missing root (a repository mid-init) is not an error, matching D10; an Add failure on any one
// directory is logged and skipped rather than aborting the rest.
func addRefsTree(fsw *fsnotify.Watcher, root string) {
	_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || !d.IsDir() {
			return nil //nolint:nilerr // one bad entry (including a missing root) must not abort the walk.
		}
		if addErr := fsw.Add(path); addErr != nil {
			slog.Warn("gitclient: watch refs directory", "scope", "watcher", "dir", path, "err", addErr)
		}
		return nil
	})
}

// RepoWatcher watches one repository's .git directories and reports debounced, coalesced signals.
// Directories only, never individual files (D10, matching fsnotify's own recommendation). Closing
// it stops its goroutine and closes Signals.
type RepoWatcher struct {
	summary RepoSummary
	fsw     *fsnotify.Watcher

	out  chan Signal
	stop chan struct{}
	done chan struct{}

	closeOnce sync.Once
}

// NewRepoWatcher starts watching summary's repository: commonDir and, for a linked worktree,
// gitDir too (D9's table) — plus commonDir/refs and everything under it, enumerated now and
// extended as new directories appear (D10).
func NewRepoWatcher(summary RepoSummary) (*RepoWatcher, error) {
	fsw, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}

	w := &RepoWatcher{
		summary: summary,
		fsw:     fsw,
		out:     make(chan Signal, 2), // at most one of each kind pending per debounce firing.
		stop:    make(chan struct{}),
		done:    make(chan struct{}),
	}

	watchDirs := []string{summary.CommonDir}
	if summary.IsLinkedWorktree {
		watchDirs = append(watchDirs, summary.GitDir)
	}
	for _, dir := range watchDirs {
		if addErr := fsw.Add(dir); addErr != nil {
			slog.Warn("gitclient: watch directory", "scope", "watcher", "dir", dir, "err", addErr)
		}
	}
	addRefsTree(fsw, filepath.Join(summary.CommonDir, "refs"))

	go w.run()
	return w, nil
}

// Signals is the debounced, coalesced output — at most one refsChanged and one worktreeChanged per
// debounce firing (D11), closed once the watcher stops.
func (w *RepoWatcher) Signals() <-chan Signal { return w.out }

// Close stops the watcher goroutine and the underlying fsnotify watcher. Idempotent.
func (w *RepoWatcher) Close() error {
	w.closeOnce.Do(func() {
		close(w.stop)
		<-w.done
	})
	return w.fsw.Close()
}

func (w *RepoWatcher) emit(sig Signal) {
	select {
	case w.out <- sig:
	case <-w.stop:
	}
}

// maybeWatchNewRefsDir extends the watch when a burst under commonDir/refs materialises a new
// directory in one go (a clone/fetch can create refs/remotes/origin/ and children faster than this
// watcher can react to each level individually) — D10's "on Create, add it and walk it".
func (w *RepoWatcher) maybeWatchNewRefsDir(path string) {
	refsRoot := filepath.Join(filepath.Clean(w.summary.CommonDir), "refs")
	clean := filepath.Clean(path)
	if clean != refsRoot && !strings.HasPrefix(clean, refsRoot+string(filepath.Separator)) {
		return
	}
	if info, err := os.Stat(path); err == nil && info.IsDir() {
		addRefsTree(w.fsw, path)
	}
}

// run is the watcher's single goroutine (D11): it owns the two pending flags and the leading-
// window debounce timer, and is the only place that reads fsw.Events/Errors or writes pendingRefs/
// pendingWorktree, so neither needs a lock.
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
		case ev, ok := <-w.fsw.Events:
			if !ok {
				return
			}
			w.maybeWatchNewRefsDir(ev.Name)
			switch sig, matched := classify(w.summary, ev.Name); {
			case matched && sig == SignalRefsChanged:
				pendingRefs = true
			case matched && sig == SignalWorktreeChanged:
				pendingWorktree = true
			}
			armIfNeeded()

		case werr, ok := <-w.fsw.Errors:
			if !ok {
				return
			}
			if errors.Is(werr, fsnotify.ErrEventOverflow) {
				// Something changed, we don't know what — raise both signals (D10).
				pendingRefs, pendingWorktree = true, true
				armIfNeeded()
			} else {
				slog.Warn("gitclient: watcher error", "scope", "watcher", "err", werr)
			}

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
