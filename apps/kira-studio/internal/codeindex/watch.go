package codeindex

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codeparse"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
)

// watchDebounce is the same 200ms leading-window debounce gitclient's own repo watcher uses,
// measured from the first event of a burst rather than the last, so a continuous stream of writes
// cannot starve the signal indefinitely (§7.1).
const watchDebounce = 200 * time.Millisecond

// rawEvent is one filesystem notification, stripped of every backend-specific concept — mirrors
// gitclient/watcher.go's own shape, extended with a real Path (§7.1: "it carries paths," a
// two-valued signal cannot say which file changed). Path is meaningless when Rescan is set.
type rawEvent struct {
	Path   string
	Rescan bool
}

// backend is the OS event source — the only part of this watcher that differs by platform (same
// seam gitclient/watcher.go uses for its own two backends). Events is closed once the backend
// stops on its own; Close stops it and is idempotent.
type backend interface {
	Events() <-chan rawEvent
	Close() error
}

// newBackend is implemented once per platform: watch_fsevents_darwin.go (darwin && cgo) and
// watch_fsnotify.go (!darwin || !cgo). watcherBackend, a const naming which is active, is declared
// alongside each implementation.

// Watcher drives one Index's own worktree watcher (§7.1): a saved file reparses just that file
// (§7.2's derived-edit incremental path), and a Rescan (dropped/overflowed backend events) or a
// change under a path outside enumeration schedules a full Sync instead.
type Watcher struct {
	idx *Index
	src backend

	// onFire, when set, replaces the real Sync/reparse work with a direct call — the test seam
	// watch_test.go uses to exercise the debounce/coalesce/Rescan logic with no real repository
	// or store at all, the same role a fake backend plays for gitclient/watcher_test.go.
	onFire func(paths map[string]bool, rescan bool)

	stop chan struct{}
	done chan struct{}

	closeOnce sync.Once
}

// Watch starts idx's own worktree watcher. Close stops it; it does not stop idx itself.
func (idx *Index) Watch() (*Watcher, error) {
	src, err := newBackend(idx)
	if err != nil {
		return nil, err
	}
	return newWatcherWith(idx, src, nil), nil
}

func newWatcherWith(idx *Index, src backend, onFire func(paths map[string]bool, rescan bool)) *Watcher {
	w := &Watcher{idx: idx, src: src, onFire: onFire, stop: make(chan struct{}), done: make(chan struct{})}
	go w.run()
	return w
}

// Close stops the watcher goroutine and the underlying backend. Idempotent.
func (w *Watcher) Close() error {
	w.closeOnce.Do(func() {
		close(w.stop)
		<-w.done
	})
	return w.src.Close()
}

// run is the watcher's single goroutine (mirrors gitclient/watcher.go's own run(): it owns the
// pending path set and the leading-window debounce timer, and is the only reader of
// w.src.Events(), so neither needs a lock). Rescan means "something changed and we don't know
// what" — coalesced overflow/dropped events on either backend — and drops any pending path set in
// favour of a full Sync.
func (w *Watcher) run() {
	defer close(w.done)

	var timer *time.Timer
	var timerC <-chan time.Time
	pending := map[string]bool{}
	var rescan bool

	armIfNeeded := func() {
		if timer == nil && (len(pending) > 0 || rescan) {
			timer = time.NewTimer(watchDebounce)
			timerC = timer.C
		}
	}
	fire := func() {
		w.fire(pending, rescan)
		pending = map[string]bool{}
		rescan = false
		timer, timerC = nil, nil
	}

	for {
		select {
		case ev, ok := <-w.src.Events():
			if !ok {
				return
			}
			if ev.Rescan {
				// §7.1: "a Rescan event drops the path set and schedules a full Sync instead" —
				// any path accumulated so far in this window is superseded, not merely ignored.
				pending = map[string]bool{}
				rescan = true
			} else if !rescan {
				pending[ev.Path] = true
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

func (w *Watcher) fire(pending map[string]bool, rescan bool) {
	if w.onFire != nil {
		w.onFire(pending, rescan)
		return
	}
	ctx := context.Background() // watcher-driven work outlives any one caller's request context; Close() is its own cancellation.
	if rescan {
		if _, err := w.idx.Sync(ctx); err != nil {
			slog.Warn("codeindex: rescan sync", "scope", "watch", "repoId", w.idx.repoID, "err", err)
		}
		return
	}
	if len(pending) > 0 {
		w.idx.handleFiring(ctx, pending)
	}
}

// handleFiring classifies one debounce firing's changed absolute paths (§7.1): a path already a
// file row reparses (or its row is deleted, if the file is gone); an extension-supported path with
// no row yet is held as a candidate and flushed through one check-ignore call for the whole
// firing, never one git process per candidate.
func (idx *Index) handleFiring(ctx context.Context, paths map[string]bool) {
	var candidates []string
	for absPath := range paths {
		relPath, ok := idx.relPath(absPath)
		if !ok {
			continue
		}

		_, hadRow, err := idx.store.GetFile(ctx, idx.repoID, relPath)
		if err != nil {
			slog.Warn("codeindex: get file for watch event", "scope", "watch", "path", relPath, "err", err)
			continue
		}
		if hadRow {
			if err := idx.reparseChangedPath(ctx, absPath, relPath); err != nil {
				slog.Warn("codeindex: reparse on change", "scope", "watch", "path", relPath, "err", err)
			}
			continue
		}
		if _, ok := codeparse.Detect(relPath); ok {
			candidates = append(candidates, relPath)
		}
	}

	if len(candidates) > 0 {
		idx.indexNewCandidates(ctx, candidates)
	}

	if err := idx.touch(ctx, strconv.FormatInt(time.Now().UnixMilli(), 10)); err != nil {
		slog.Warn("codeindex: touch last_used_at", "scope", "watch", "repoId", idx.repoID, "err", err)
	}
}

// relPath resolves an absolute event path to a repository-relative one, rejecting anything
// outside idx.root (never handed to git as a pathspec if it could escape the worktree).
func (idx *Index) relPath(absPath string) (string, bool) {
	rel, err := filepath.Rel(idx.root, absPath)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", false
	}
	return filepath.ToSlash(rel), true
}

// reparseChangedPath handles an event path that is already a file row: reparse it, or delete its
// row (and forget its resident tree) if it no longer exists on disk.
func (idx *Index) reparseChangedPath(ctx context.Context, absPath, relPath string) error {
	row, hadRow, err := idx.store.GetFile(ctx, idx.repoID, relPath)
	if err != nil {
		return err
	}
	if !hadRow {
		return nil
	}
	if _, statErr := os.Stat(absPath); statErr != nil {
		if err := idx.store.DeleteFile(ctx, idx.repoID, relPath); err != nil {
			return err
		}
		idx.session.Forget(absPath)
		return nil
	}
	w, err := idx.parseOne(ctx, relPath, codeparse.ID(row.Language))
	if err != nil {
		return err
	}
	return idx.store.ReplaceFile(ctx, w)
}

// indexNewCandidates flushes every not-yet-indexed, extension-supported candidate from one
// debounce firing through a single `git check-ignore` call (§7.1) and indexes whatever comes back
// not ignored.
func (idx *Index) indexNewCandidates(ctx context.Context, candidates []string) {
	ignored, err := checkIgnored(ctx, idx.runner, idx.gitPath, idx.root, candidates)
	if err != nil {
		slog.Warn("codeindex: check-ignore", "scope", "watch", "repoId", idx.repoID, "err", err)
		return
	}
	for _, relPath := range candidates {
		if ignored[relPath] {
			continue
		}
		lang, ok := codeparse.Detect(relPath)
		if !ok {
			continue
		}
		w, err := idx.parseOne(ctx, relPath, lang)
		if err != nil {
			slog.Warn("codeindex: index new file", "scope", "watch", "path", relPath, "err", err)
			continue
		}
		if err := idx.store.ReplaceFile(ctx, w); err != nil {
			slog.Warn("codeindex: store new file", "scope", "watch", "path", relPath, "err", err)
		}
	}
}

// checkIgnored runs one `git check-ignore -z --stdin` for every candidate at once — one process
// per debounce window regardless of how many candidates, correct by using git's own ignore
// evaluation rather than a second one (§7.1). check-ignore exits non-zero when nothing is ignored,
// which is not a real error — the ignored set is simply empty — so this never runs the result
// through gitclient.Classify the way a normal read does.
func checkIgnored(ctx context.Context, runner gitclient.Runner, gitPath, root string, candidates []string) (map[string]bool, error) {
	p, err := runner.Start(ctx, gitPath, gitclient.Spec{
		Dir: root, Args: []string{"check-ignore", "-z", "--stdin"}, ReadOnly: true, Stdin: true,
	})
	if err != nil {
		return nil, err
	}

	go func() {
		stdin := p.Stdin()
		for _, c := range candidates {
			_, _ = stdin.Write([]byte(c))
			_, _ = stdin.Write([]byte{0})
		}
		_ = stdin.Close()
	}()

	out, readErr := io.ReadAll(p.Stdout())
	if _, err := p.Wait(); err != nil {
		return nil, err
	}
	if readErr != nil {
		return nil, readErr
	}

	ignored := map[string]bool{}
	trimmed := strings.TrimRight(string(out), "\x00")
	if trimmed == "" {
		return ignored, nil
	}
	for _, p := range strings.Split(trimmed, "\x00") {
		ignored[p] = true
	}
	return ignored, nil
}
