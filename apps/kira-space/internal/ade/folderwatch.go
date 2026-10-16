package ade

import (
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

const (
	folderScanDepth     = 3
	folderRescanDelay   = 500 * time.Millisecond
	folderWatcherEvents = "ade folder watch"
)

type folderScan struct {
	repos []string // repo roots, to import
	dirs  []string // visited non-repo directories, to watch
}

// scanFolder walks root to depth 3. It stops at a repo root (a .git directory), skips hidden
// directories, node_modules, bare repositories and linked worktrees (a .git file).
func scanFolder(root string) folderScan {
	var out folderScan
	var walk func(dir string, depth int)
	walk = func(dir string, depth int) {
		if info, err := os.Lstat(filepath.Join(dir, ".git")); err == nil {
			if info.IsDir() {
				out.repos = append(out.repos, dir)
			}
			return
		}
		if isBareRepo(dir) {
			return
		}
		out.dirs = append(out.dirs, dir)
		if depth >= folderScanDepth {
			return
		}
		entries, err := os.ReadDir(dir)
		if err != nil {
			return
		}
		for _, e := range entries {
			name := e.Name()
			if !e.IsDir() || strings.HasPrefix(name, ".") || name == "node_modules" {
				continue
			}
			walk(filepath.Join(dir, name), depth+1)
		}
	}
	walk(filepath.Clean(root), 0)
	return out
}

func isBareRepo(dir string) bool {
	for _, n := range []string{"HEAD", "objects", "refs"} {
		if _, err := os.Lstat(filepath.Join(dir, n)); err != nil {
			return false
		}
	}
	return true
}

// folderWatcher keeps one watched folder's repos imported: any entry created or renamed under the
// folder (or a visited non-repo directory) triggers a rescan after 500ms of quiet.
type folderWatcher struct {
	board *TaskBoard
	path  string
	w     *fsnotify.Watcher

	mu      sync.Mutex
	timer   *time.Timer
	stopped bool
	rescans sync.WaitGroup // in-flight rescan; stop waits for it
	done    chan struct{}
}

func (b *TaskBoard) startFolderWatch(path string) {
	b.folderWMu.Lock()
	if _, ok := b.folderW[path]; ok {
		b.folderWMu.Unlock()
		return
	}
	w, err := fsnotify.NewWatcher()
	if err != nil {
		b.folderWMu.Unlock()
		slog.Warn(folderWatcherEvents, "scope", "ade", "path", path, "err", err)
		return
	}
	fw := &folderWatcher{board: b, path: path, w: w, done: make(chan struct{})}
	b.folderW[path] = fw
	b.folderWMu.Unlock()
	fw.addDirs(scanFolder(path).dirs)
	go fw.loop()
	// Catch repos created while the app was not running.
	fw.schedule()
}

func (b *TaskBoard) stopFolderWatch(path string) {
	b.folderWMu.Lock()
	fw := b.folderW[path]
	delete(b.folderW, path)
	b.folderWMu.Unlock()
	if fw != nil {
		fw.stop()
	}
}

func (f *folderWatcher) addDirs(dirs []string) {
	for _, d := range dirs {
		if err := f.w.Add(d); err != nil {
			slog.Debug(folderWatcherEvents, "scope", "ade", "dir", d, "err", err)
		}
	}
}

func (f *folderWatcher) schedule() {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.stopped {
		return
	}
	if f.timer != nil {
		f.timer.Stop()
	}
	f.timer = time.AfterFunc(folderRescanDelay, f.rescan)
}

func (f *folderWatcher) rescan() {
	f.mu.Lock()
	if f.stopped {
		f.mu.Unlock()
		return
	}
	f.rescans.Add(1)
	f.mu.Unlock()
	defer f.rescans.Done()
	scan := scanFolder(f.path)
	f.addDirs(scan.dirs)
	imported, err := f.board.importFolder(f.board.ctx, f.path)
	if err != nil {
		slog.Warn(folderWatcherEvents, "scope", "ade", "path", f.path, "err", err)
		return
	}
	if len(imported) > 0 {
		f.board.notifyRepos()
	}
}

func (f *folderWatcher) loop() {
	defer close(f.done)
	for {
		select {
		case ev, ok := <-f.w.Events:
			if !ok {
				return
			}
			if ev.Has(fsnotify.Create) || ev.Has(fsnotify.Rename) {
				f.schedule()
			}
		case err, ok := <-f.w.Errors:
			if !ok {
				return
			}
			slog.Warn(folderWatcherEvents, "scope", "ade", "path", f.path, "err", err)
		}
	}
}

func (f *folderWatcher) stop() {
	f.mu.Lock()
	f.stopped = true
	if f.timer != nil {
		f.timer.Stop()
	}
	f.mu.Unlock()
	f.w.Close()
	<-f.done
	f.rescans.Wait()
}
