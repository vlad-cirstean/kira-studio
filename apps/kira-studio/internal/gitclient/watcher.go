package gitclient

import (
	"os"
	"sync"
	"time"
)

// Watcher is D2's filesystem-notification seam — the Go equivalent of the source project's
// FileWatcher port (docs/v1.3/SPEC.md, "What deliberately does not come across"). Declared as an
// interface from this package's first commit alongside Runner and Clock, even though nothing in
// P1 wires its signal into a stream event yet: debouncing a real watch into `repo.changed`
// (refsChanged/worktreeChanged) is P2's own row (docs/v1.3/SPEC.md's phasing table), and building
// the seam now rather than after P2 needs it is what D2 exists to avoid re-litigating.
type Watcher interface {
	// Watch polls paths for a change (any file under them created, removed, or modified) and
	// calls notify — from an internal goroutine, so notify must not block — at most once per
	// detected change, until the returned stop func is called. A path that does not exist yet
	// (e.g. a lockfile that appears mid-operation) is tolerated, not an error.
	Watch(paths []string) (events <-chan struct{}, stop func())
}

// pollInterval is deliberately not configurable per call — P1 has no consumer sensitive to this
// number (see the interface doc comment above); P2, the first real consumer, is free to change it
// or replace this implementation outright once it knows what "no worse than one visible frame of
// staleness" actually requires.
const pollInterval = 500 * time.Millisecond

// pollingWatcher is the one real Watcher: stdlib os.Stat on a ticker, no OS-specific notification
// API. AGENTS.md's "reach for an existing library" rule is not in tension here — P1 has nothing
// that depends on this watcher's latency or CPU cost (it is wired to no event yet), so reaching
// for fsnotify now would add a dependency against a requirement nothing in this phase states; P2
// is where that trade gets made against a real one.
type pollingWatcher struct{}

// NewPollingWatcher returns the real, os.Stat-polling Watcher.
func NewPollingWatcher() Watcher { return pollingWatcher{} }

// snapshot is the one fact this watcher tracks per path: its last-observed modification time
// (zero value for "did not exist"), which already covers create/modify/delete without needing to
// distinguish them — P2's own debounce logic is what would ever care which.
func snapshot(paths []string) []time.Time {
	out := make([]time.Time, len(paths))
	for i, p := range paths {
		if info, err := os.Stat(p); err == nil {
			out[i] = info.ModTime()
		}
	}
	return out
}

func (pollingWatcher) Watch(paths []string) (<-chan struct{}, func()) {
	events := make(chan struct{}, 1)
	done := make(chan struct{})
	var stopOnce sync.Once

	go func() {
		ticker := time.NewTicker(pollInterval)
		defer ticker.Stop()
		last := snapshot(paths)
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				current := snapshot(paths)
				changed := false
				for i := range current {
					if !current[i].Equal(last[i]) {
						changed = true
						break
					}
				}
				last = current
				if changed {
					select {
					case events <- struct{}{}:
					default:
						// A prior signal is still unread — coalesced, matching notify's own
						// "at most once per detected change" contract rather than queuing.
					}
				}
			}
		}
	}()

	stop := func() {
		stopOnce.Do(func() { close(done) })
	}
	return events, stop
}
