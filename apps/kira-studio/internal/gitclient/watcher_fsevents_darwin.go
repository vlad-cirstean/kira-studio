//go:build darwin && cgo

// The macOS event source (G9). FSEvents watches a whole tree through one stream, so this backend
// holds no per-directory state and no file descriptor per ref — unlike the kqueue backend it
// replaces, which opens one descriptor per file in every watched directory (G2 F10). It cannot be
// compiled or exercised outside a real macOS toolchain (the same wall internal/localauth hit):
// read it for structure, and see G9 §7.2 for what a human must run on a Mac to confirm it.
package gitclient

import (
	"path/filepath"
	"strings"
	"sync"

	"github.com/fsnotify/fsevents"
)

const watcherBackend = "fsevents"

// droppedFlags are the FSEvents flags that mean "something changed and we don't know what" —
// coalesced beyond recognition, dropped in the kernel or in our own client buffer, or the watched
// root itself moved or was deleted (G9 D9/F11). Mapped to rawEvent.Rescan, which the shared run
// loop (watcher.go) treats identically to the fsnotify backend's ErrEventOverflow: raise both
// pending signals.
const droppedFlags = fsevents.MustScanSubDirs | fsevents.KernelDropped | fsevents.UserDropped | fsevents.RootChanged

// fseventsBackend adapts one fsevents.EventStream to the backend seam (D6). It holds no
// repository knowledge at all — classification and the debounce live above the seam, in
// watcher.go — so the only logic here is starting the stream, translating its events, and
// tearing it down in the one order that cannot deadlock (D10).
type fseventsBackend struct {
	es  *fsevents.EventStream
	out chan rawEvent

	stopping chan struct{} // closed first: run() switches to drain-and-discard (D10 step 1).
	done     chan struct{} // closed second: run() may stop forwarding and return (D10 step 3).
	joined   chan struct{} // closed by run() itself on return, for Close to join on (D10 step 4).

	closeOnce sync.Once
}

// newBackend starts one FSEvents stream over commonDir, plus gitDir only when it is genuinely
// outside commonDir — a linked worktree's gitDir is always <commonDir>/worktrees/<name> (D8, F10),
// already covered by a recursive watch on commonDir. commonDir and gitDir arrive already
// symlink-resolved (D7).
func newBackend(commonDir, gitDir string) (backend, error) {
	paths := []string{commonDir}
	if gitDir != commonDir && !strings.HasPrefix(gitDir, commonDir+string(filepath.Separator)) {
		paths = append(paths, gitDir)
	}

	es := &fsevents.EventStream{
		Paths: paths,
		// FileEvents: without it FSEvents reports only the containing directory, and classify
		// could never tell refsChanged from worktreeChanged. WatchRoot: delivers RootChanged if
		// .git itself is moved or deleted, mapped to Rescan above — a lost-watch mode fsnotify
		// has no equivalent for.
		Flags: fsevents.FileEvents | fsevents.WatchRoot,
		// NoDefer is deliberately unset: it is a kernel-side leading-window debounce, and we
		// already run one, tested, at 200ms (watcher.go) — stacking a second would add an
		// unreasoned-about timing rule. IgnoreSelf is deliberately unset too: every write this
		// app makes is made by a `git` child process, not this one, so it would suppress nothing
		// while adding a "why did my own commit not fire" trap.
		Latency: 0,
		// Device MUST stay zero. A nonzero Device switches fsevents internally to
		// EventStreamCreateRelativeToDevice, which returns paths relative to the device with no
		// leading slash — classify's prefix/equality comparisons would then match nothing, ever,
		// with no error. The library's own example/ sets this field; do not copy that pattern.
		Device: 0,
		// Resume false: Start() watches only future events. Replaying history on every repo.open
		// would fire a spurious repo.changed at every window's startup.
		Resume: false,
	}
	if err := es.Start(); err != nil {
		return nil, err
	}

	b := &fseventsBackend{
		es:       es,
		out:      make(chan rawEvent),
		stopping: make(chan struct{}),
		done:     make(chan struct{}),
		joined:   make(chan struct{}),
	}
	go b.run()
	return b, nil
}

func (b *fseventsBackend) Events() <-chan rawEvent { return b.out }

// run is the sole reader of es.Events and the sole writer of b.out. es.Events is unbuffered and
// the C callback blocks on its send (F12 trap 2), so this loop must do nothing per event but
// translate and forward — and, once Close has begun tearing down (stopping closed), it must keep
// receiving from es.Events and discard, never blocking on a send into b.out, so that a callback
// parked mid-send can always complete (D10 step 1).
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
				continue // draining for Close (D10 step 1): discard, do not forward.
			default:
			}
			for _, ev := range batch {
				re := rawEvent{Path: ev.Path}
				if ev.Flags&droppedFlags != 0 {
					re = rawEvent{Rescan: true}
				}
				select {
				case b.out <- re:
				case <-b.done:
					close(b.out)
					return
				}
			}

		case <-b.done:
			close(b.out)
			return
		}
	}
}

// Close runs D10's exact sequence — drain, then stop, then let run() exit, then join — because
// fsevents.Stop() does not close Events (F12 trap 3) and the C callback can be parked mid-send on
// it while FSEventStreamStop/Invalidate want the very dispatch queue that callback runs on.
// Stopping the stream before a live drainer is guaranteed can deadlock; this ordering guarantees
// one is always live until Stop has nothing left to wait on. sync.Once-guarded: RepoWatcher.Close
// calls this on every Close(), not only the first.
func (b *fseventsBackend) Close() error {
	b.closeOnce.Do(func() {
		close(b.stopping) // 1: run() keeps draining es.Events and discards, unblocking any parked callback.
		b.es.Stop()       // 2: safe now — no callback can be blocked mid-send.
		close(b.done)     // 3: run() stops forwarding, closes b.out, and returns.
		<-b.joined        // 4: join — Close returns only once nothing is left running.
	})
	return nil
}
