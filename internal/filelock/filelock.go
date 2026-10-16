// Package filelock is the one exclusive, non-blocking advisory file lock of the repo.
package filelock

import (
	"os"
	"syscall"
)

// TryLock takes an exclusive non-blocking flock on path. syscall.Flock covers darwin (the shipped
// platform) and linux (tests), so golang.org/x/sys is not needed for one call.
//
// ok=false with a nil error means another holder has the lock: a supported state, not a failure.
// Keep the returned file open while the lock is needed; closing it releases the lock.
func TryLock(path string) (f *os.File, ok bool, err error) {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, false, err
	}
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		_ = file.Close()
		if err == syscall.EWOULDBLOCK {
			return nil, false, nil
		}
		return nil, false, err
	}
	return file, true, nil
}
