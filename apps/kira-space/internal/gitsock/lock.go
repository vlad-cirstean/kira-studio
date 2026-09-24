package gitsock

import (
	"os"
	"syscall"
)

// AcquireLock implements D3/D5's flock discipline over syscall.Flock — darwin (the only shipped
// platform) and linux (where the tests run) both have it, which is the whole set of platforms this
// code ever runs on, so promoting golang.org/x/sys from an indirect dependency for one call is not
// justified.
//
// ok=false with a nil error means another instance already holds the lock — not a failure, a
// supported state (SPEC §3.2: "this instance does not listen"). The returned file must be kept
// open for the process's lifetime; closing it releases the lock.
//
// Exported (P108 Part 20 F7): main.go calls this directly, on its own lock file, before
// storage.Open — an app-wide single-instance guard distinct from Server's own git.sock.lock below,
// so the two never flock the same path from the same process (two independent open file
// descriptions on one path would make the second call see EWOULDBLOCK even though it is this same
// process holding the first).
func AcquireLock(path string) (f *os.File, ok bool, err error) {
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
