package gitsock

import (
	"os"
	"syscall"
)

// acquireLock implements D3/D5's flock discipline over syscall.Flock — darwin (the only shipped
// platform) and linux (where the tests run) both have it, which is the whole set of platforms this
// code ever runs on, so promoting golang.org/x/sys from an indirect dependency for one call is not
// justified.
//
// ok=false with a nil error means another instance already holds the lock — not a failure, a
// supported state (SPEC §3.2: "this instance does not listen"). The returned file must be kept
// open for the process's lifetime; closing it releases the lock.
func acquireLock(path string) (f *os.File, ok bool, err error) {
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
