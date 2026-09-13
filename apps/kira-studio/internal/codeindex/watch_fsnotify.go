//go:build !darwin || !cgo

package codeindex

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"sync"

	"github.com/fsnotify/fsnotify"
)

// watcherBackend names the OS event source this build uses (mirrors gitclient/watcher_fsnotify.go's
// own const), logged once per watcher so an unexpected fallback on a darwin build says so out loud.
const watcherBackend = "fsnotify"

// fsnotifyBackend is the event source for every non-darwin build, and for a darwin build compiled
// with CGO_ENABLED=0. fsnotify has no recursive watch, so this backend adds exactly the
// directories that contain enumerated files (§7.1) rather than walking the whole worktree —
// `ls-files` already excludes ignored trees, so node_modules/target never get a watch descriptor —
// and extends reactively when a new directory appears, the same shape gitclient's own
// maybeWatchNewRefsDir uses.
type fsnotifyBackend struct {
	fsw *fsnotify.Watcher

	out  chan rawEvent
	stop chan struct{}
	done chan struct{}

	closeOnce sync.Once
}

// newBackend enumerates idx's repository once (best-effort: an enumeration failure here still
// starts a watcher over the worktree root alone, rather than failing to watch at all) and adds a
// watch on the root plus every directory an enumerated file lives in.
func newBackend(idx *Index) (backend, error) {
	fsw, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}

	dirs := map[string]bool{idx.root: true}
	if enumerated, enumErr := Enumerate(context.Background(), idx.runner, idx.gitPath, idx.root); enumErr == nil {
		for _, e := range enumerated {
			dirs[filepath.Dir(filepath.Join(idx.root, e.Path))] = true
		}
	} else {
		slog.Warn("codeindex: enumerate for initial watch set", "scope", "watch", "err", enumErr)
	}
	for dir := range dirs {
		if addErr := fsw.Add(dir); addErr != nil {
			slog.Warn("codeindex: watch directory", "scope", "watch", "dir", dir, "err", addErr)
		}
	}

	b := &fsnotifyBackend{fsw: fsw, out: make(chan rawEvent), stop: make(chan struct{}), done: make(chan struct{})}
	go b.run()
	return b, nil
}

func (b *fsnotifyBackend) Events() <-chan rawEvent { return b.out }

// Close stops fsw and joins the forwarding goroutine — closing b.stop first guarantees the
// goroutine exits promptly even mid-send into b.out with nobody left reading (mirrors gitclient/
// watcher_fsnotify.go's own Close ordering).
func (b *fsnotifyBackend) Close() error {
	b.closeOnce.Do(func() {
		close(b.stop)
		<-b.done
	})
	return b.fsw.Close()
}

func (b *fsnotifyBackend) run() {
	defer close(b.done)
	defer close(b.out)

	for {
		select {
		case ev, ok := <-b.fsw.Events:
			if !ok {
				return
			}
			// A newly created directory needs its own watch — a burst (an editor's save-as-
			// rename, a package manager unpacking a tree) can create a directory and its
			// children faster than this backend reacts to each level individually; extending
			// on Create is the same shape gitclient's own addRefsTree/maybeWatchNewRefsDir use.
			if info, statErr := os.Stat(ev.Name); statErr == nil && info.IsDir() {
				if addErr := b.fsw.Add(ev.Name); addErr != nil {
					slog.Warn("codeindex: watch new directory", "scope", "watch", "dir", ev.Name, "err", addErr)
				}
			}
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
				slog.Warn("codeindex: watcher error", "scope", "watch", "err", werr)
			}

		case <-b.stop:
			return
		}
	}
}
