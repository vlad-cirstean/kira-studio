//go:build unix

package repomap

import (
	"errors"
	"os"
	"sync"
	"syscall"
	"time"
)

// fileLock wraps one flock'd file — the per-repository sync lock (§5): LOCK_EX around the initial
// Sync only, so two server instances (embedded and headless, or two headless instances) never
// parse one repository twice at once.
//
// releaseOnce matters: runInitialSync releases this same lock value itself once Sync completes,
// and Close can run concurrently (an app-driven Stop/SetEnabled(false), or the process's own
// SIGTERM, can land at any point relative to the initial sync finishing) — both paths hold a
// reference to the identical *fileLock, so release() must tolerate being called twice
// concurrently without a double-close/double-unlock race, not merely be idempotent in sequence.
type fileLock struct {
	f           *os.File
	releaseOnce sync.Once
}

// lockPollInterval is how often acquireLock retries a non-blocking flock while waiting out its own
// timeout — deliberately a poll loop, not a blocking LOCK_EX handed to a background goroutine:
// racing that goroutine's own syscall.Flock(f.Fd()) against a timeout path's f.Close() is a real
// data race on *os.File's internal fd bookkeeping (Fd() marks the descriptor for a blocking
// syscall; Close() concurrently touches the same state) — caught by `go test -race`, not a
// hypothetical. A short poll avoids the concurrent access entirely at the cost of last-mile
// latency measured in tens of milliseconds against a lock held for, at most, minutes.
const lockPollInterval = 50 * time.Millisecond

// acquireLock opens (creating if needed) path and polls for an exclusive, non-blocking flock up to
// timeout. A timeout is not an error the caller must fail on — the caller proceeds without the
// lock rather than hang forever on a stuck one (§5: "a stuck lock must degrade, never hang").
func acquireLock(path string, timeout time.Duration) (*fileLock, bool, error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, false, err
	}
	deadline := time.Now().Add(timeout)
	for {
		err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
		if err == nil {
			return &fileLock{f: f}, true, nil
		}
		if !errors.Is(err, syscall.EWOULDBLOCK) {
			_ = f.Close()
			return nil, false, err
		}
		if time.Now().After(deadline) {
			_ = f.Close()
			return nil, false, nil
		}
		time.Sleep(lockPollInterval)
	}
}

// release unlocks and closes the underlying file, exactly once regardless of how many goroutines
// call it concurrently. Safe to call on a nil lock (the timeout/no-op path never acquired one).
func (l *fileLock) release() {
	if l == nil {
		return
	}
	l.releaseOnce.Do(func() {
		_ = syscall.Flock(int(l.f.Fd()), syscall.LOCK_UN)
		_ = l.f.Close()
	})
}
