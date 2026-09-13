//go:build darwin && cgo

// The macOS event source (mirrors gitclient/watcher_fsevents_darwin.go's own design, §7.1).
// FSEvents watches the whole worktree through one recursive stream, which is what eliminates the
// fsnotify backend's own per-directory file-descriptor cost on a repository with many source
// directories — the same reason gitclient's own repo watcher prefers it on this platform. It
// cannot be compiled or exercised outside a real macOS toolchain: read it for structure, matching
// gitclient's own precedent for what a human must confirm on real hardware.
package codeindex

import (
	"path/filepath"
	"strings"
	"sync"

	"github.com/fsnotify/fsevents"
)

const watcherBackend = "fsevents"

// droppedFlags mean "something changed and we don't know what" — coalesced beyond recognition,
// dropped in the kernel or in our own client buffer, or the watched root itself moved or was
// deleted. Mapped to rawEvent.Rescan, which the shared run loop (watch.go) treats identically to
// the fsnotify backend's ErrEventOverflow.
const droppedFlags = fsevents.MustScanSubDirs | fsevents.KernelDropped | fsevents.UserDropped | fsevents.RootChanged

// fseventsBackend adapts one fsevents.EventStream to the backend seam. It holds no repository
// knowledge beyond its own root and the .git exclusion below — classification, debounce and the
// check-ignore candidate flush all live above the seam, in watch.go.
type fseventsBackend struct {
	es     *fsevents.EventStream
	gitDir string // idx.root/.git — excluded, git's own writes are not source changes.
	out    chan rawEvent

	stopping chan struct{} // closed first: run() switches to drain-and-discard.
	done     chan struct{} // closed second: run() may stop forwarding and return.
	joined   chan struct{} // closed by run() itself on return, for Close to join on.

	closeOnce sync.Once
}

// newBackend starts one FSEvents stream over idx.root, recursively — the fsnotify backend's own
// per-directory enumeration (§7.1) is exactly the cost this backend structurally avoids.
func newBackend(idx *Index) (backend, error) {
	es := &fsevents.EventStream{
		Paths: []string{idx.root},
		// FileEvents: without it FSEvents reports only the containing directory, and this
		// backend could never say which file changed. WatchRoot: delivers RootChanged if the
		// worktree itself is moved or deleted, mapped to Rescan below.
		Flags: fsevents.FileEvents | fsevents.WatchRoot,
		// NoDefer unset deliberately: it is a kernel-side leading-window debounce, and watch.go
		// already runs one, tested, at 200ms — stacking a second would add an unreasoned-about
		// timing rule (gitclient's own fsevents backend makes the same choice).
		Latency: 0,
		// Device MUST stay zero — see gitclient/watcher_fsevents_darwin.go's own comment on
		// EventStreamCreateRelativeToDevice silently breaking every path comparison downstream.
		Device: 0,
		// Resume false: Start() watches only future events. Replaying history on every
		// repository open would fire spurious reparses at every window's startup.
		Resume: false,
	}
	if err := es.Start(); err != nil {
		return nil, err
	}

	b := &fseventsBackend{
		es:       es,
		gitDir:   filepath.Join(idx.root, ".git"),
		out:      make(chan rawEvent),
		stopping: make(chan struct{}),
		done:     make(chan struct{}),
		joined:   make(chan struct{}),
	}
	go b.run()
	return b, nil
}

func (b *fseventsBackend) Events() <-chan rawEvent { return b.out }

// run is the sole reader of es.Events and the sole writer of b.out — the same one-goroutine
// discipline gitclient's own fsevents backend uses, for the same reason: es.Events is unbuffered
// and the C callback blocks on its send, so once Close begins tearing down (stopping closed) this
// loop must keep receiving and discard, never blocking on a send into b.out.
func (b *fseventsBackend) run() {
	defer close(b.joined)
	for {
		select {
		case batch, ok := <-b.es.Events:
			if !ok {
				close(b.out)
				return
			}
			select {
			case <-b.stopping:
				continue // draining for Close: discard, do not forward.
			default:
			}
			for _, ev := range batch {
				if ev.Flags&droppedFlags != 0 {
					if !b.forward(rawEvent{Rescan: true}) {
						return
					}
					continue
				}
				// git's own writes under .git (refs, index, objects) are not source changes —
				// excluded here rather than in watch.go, since the fsnotify backend never
				// watches .git in the first place and needs no equivalent filter.
				path := ev.Path
				if path == b.gitDir || strings.HasPrefix(path, b.gitDir+string(filepath.Separator)) {
					continue
				}
				if !b.forward(rawEvent{Path: path}) {
					return
				}
			}

		case <-b.done:
			close(b.out)
			return
		}
	}
}

// forward sends ev, honouring the same teardown priority as gitclient's own fsevents backend:
// b.done wins over a blocked send. Returns false once the backend has been asked to stop.
func (b *fseventsBackend) forward(ev rawEvent) bool {
	select {
	case b.out <- ev:
		return true
	case <-b.done:
		close(b.out)
		return false
	}
}

// Close runs the same drain-then-stop-then-join sequence gitclient/watcher_fsevents_darwin.go's
// own Close documents in full: fsevents.Stop() does not close Events, and its C callback can be
// parked mid-send on it while FSEventStreamStop/Invalidate want the very dispatch queue that
// callback runs on. Stopping the stream before a live drainer is guaranteed can deadlock.
func (b *fseventsBackend) Close() error {
	b.closeOnce.Do(func() {
		close(b.stopping) // 1: run() keeps draining es.Events and discards, unblocking any parked callback.
		b.es.Stop()       // 2: safe now — no callback can be blocked mid-send.
		close(b.done)     // 3: run() stops forwarding, closes b.out, and returns.
		<-b.joined        // 4: join — Close returns only once nothing is left running.
	})
	return nil
}
