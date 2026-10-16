package config

import (
	"os"

	"github.com/kirathecat/kira-studio/internal/filelock"
)

// AcquireLock takes an exclusive non-blocking flock on path; see filelock.TryLock. ok=false with a
// nil error means another instance holds the lock. Keep the returned file open for the process
// lifetime.
func AcquireLock(path string) (f *os.File, ok bool, err error) { return filelock.TryLock(path) }
