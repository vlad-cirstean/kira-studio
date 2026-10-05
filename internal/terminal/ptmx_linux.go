//go:build linux

package terminal

import (
	"os"
	"syscall"
	"unsafe"

	"github.com/creack/pty"
)

// pollablePtmx re-wraps the master as a non-blocking, netpoller-registered file. creack/pty calls
// f.Fd() for its ioctls, which forces blocking mode and drops the fd from the poller; a blocked
// read(2) then survives Close, so Session.Close could never unblock readLoop. It consumes ptmx.
func pollablePtmx(ptmx *os.File) (*os.File, error) {
	fd, err := syscall.Dup(int(ptmx.Fd()))
	_ = ptmx.Close()
	if err != nil {
		return nil, err
	}
	syscall.CloseOnExec(fd)
	if err := syscall.SetNonblock(fd, true); err != nil {
		_ = syscall.Close(fd)
		return nil, err
	}
	return os.NewFile(uintptr(fd), "/dev/ptmx"), nil
}

// setWinsize issues TIOCSWINSZ through SyscallConn so the file stays non-blocking (pty.Setsize
// would call Fd()).
func setWinsize(ptmx *os.File, ws *pty.Winsize) error {
	rc, err := ptmx.SyscallConn()
	if err != nil {
		return err
	}
	var errno syscall.Errno
	if err := rc.Control(func(fd uintptr) {
		_, _, errno = syscall.Syscall(syscall.SYS_IOCTL, fd, syscall.TIOCSWINSZ, uintptr(unsafe.Pointer(ws)))
	}); err != nil {
		return err
	}
	if errno != 0 {
		return errno
	}
	return nil
}
