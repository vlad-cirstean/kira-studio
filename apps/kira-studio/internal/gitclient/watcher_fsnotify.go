//go:build !darwin || !cgo

package gitclient

import (
	"errors"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/fsnotify/fsnotify"
)

// watcherBackend names the OS event source this build uses (G9 D5), logged once per watcher
// (watcher.go's newRepoWatcherWith) so a darwin build that unexpectedly falls back to this
// backend — CGO_ENABLED=0, which build/darwin/Taskfile.yml never sets — says so out loud, matching
// internal/localauth/evaluate_other.go's own pattern.
const watcherBackend = "fsnotify"

// fsnotifyBackend is the event source for every non-darwin build, and for a darwin build compiled
// with CGO_ENABLED=0. fsnotify has no recursive watch, so this backend walks commonDir/refs once
// and extends the walk as new directories appear (addRefsTree/maybeWatchNewRefsDir, G2 F9) —
// machinery the FSEvents backend needs none of, because FSEvents is recursive by construction
// (G9 D6/D10).
type fsnotifyBackend struct {
	fsw *fsnotify.Watcher

	out  chan rawEvent
	stop chan struct{}
	done chan struct{}

	closeOnce sync.Once
}

// newBackend is this platform's backend constructor (D5). commonDir and gitDir arrive already
// symlink-resolved (D7) — which is what keeps fsnotify's own echoed-back event paths agreeing
// with classify's comparison target on every platform, not only darwin.
func newBackend(commonDir, gitDir string) (backend, error) {
	fsw, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}

	watchDirs := []string{commonDir}
	if gitDir != commonDir {
		watchDirs = append(watchDirs, gitDir)
	}
	for _, dir := range watchDirs {
		if addErr := fsw.Add(dir); addErr != nil {
			slog.Warn("gitclient: watch directory", "scope", "watcher", "dir", dir, "err", addErr)
		}
	}
	addRefsTree(fsw, filepath.Join(commonDir, "refs"))

	b := &fsnotifyBackend{
		fsw:  fsw,
		out:  make(chan rawEvent),
		stop: make(chan struct{}),
		done: make(chan struct{}),
	}
	go b.run(commonDir)
	return b, nil
}

func (b *fsnotifyBackend) Events() <-chan rawEvent { return b.out }

// Close stops fsw and joins the forwarding goroutine. Closing b.stop first — rather than closing
// fsw and waiting for its channels to close — guarantees the goroutine exits promptly even if it
// is currently blocked trying to forward an event into b.out with nobody left reading it (the
// RepoWatcher having already returned from its own select on w.stop). fsw.Close() is idempotent,
// matching this method being called on every RepoWatcher.Close(), not only the first.
func (b *fsnotifyBackend) Close() error {
	b.closeOnce.Do(func() {
		close(b.stop)
		<-b.done
	})
	return b.fsw.Close()
}

// run forwards fsnotify's own Events/Errors into rawEvent, extending the refs-tree watch on the
// way (maybeWatchNewRefsDir) exactly as this package's single watcher goroutine did before the
// backend split.
func (b *fsnotifyBackend) run(commonDir string) {
	defer close(b.done)
	defer close(b.out)

	for {
		select {
		case ev, ok := <-b.fsw.Events:
			if !ok {
				return
			}
			maybeWatchNewRefsDir(b.fsw, commonDir, ev.Name)
			select {
			case b.out <- rawEvent{Path: ev.Name}:
			case <-b.stop:
				return
			}

		case werr, ok := <-b.fsw.Errors:
			if !ok {
				return
			}
			if errors.Is(werr, fsnotify.ErrEventOverflow) {
				select {
				case b.out <- rawEvent{Rescan: true}:
				case <-b.stop:
					return
				}
			} else {
				slog.Warn("gitclient: watcher error", "scope", "watcher", "err", werr)
			}

		case <-b.stop:
			return
		}
	}
}

// addRefsTree walks root (commonDir/refs) and Adds every directory found to fsw — the walk this
// backend must do itself (G2 F9): fsnotify has no recursive watch, so this is what stands in for
// one. A missing root (a repository mid-init) is not an error, matching D10; an Add failure on
// any one directory is logged and skipped rather than aborting the rest.
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

// maybeWatchNewRefsDir extends the watch when a burst under commonDir/refs materialises a new
// directory in one go (a clone/fetch can create refs/remotes/origin/ and children faster than this
// backend can react to each level individually) — G2 D10's "on Create, add it and walk it".
func maybeWatchNewRefsDir(fsw *fsnotify.Watcher, commonDir, path string) {
	refsRoot := filepath.Join(filepath.Clean(commonDir), "refs")
	clean := filepath.Clean(path)
	if clean != refsRoot && !strings.HasPrefix(clean, refsRoot+string(filepath.Separator)) {
		return
	}
	if info, err := os.Stat(path); err == nil && info.IsDir() {
		addRefsTree(fsw, path)
	}
}
