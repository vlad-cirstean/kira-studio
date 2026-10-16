//go:build linux || darwin

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
//
// Shared by darwin and Linux since P180: darwin used to keep the creack/pty default (blocking
// fd), on the theory that kqueue might not poll a pty master. Verified on real Mac hardware
// instead of assumed: TestSessionCloseKillsProcessGroup, plus a one-off regression backgrounding
// a job detached into its own session (setsid) so it survives the shell's SIGHUP/SIGKILL and
// keeps the slave held open — Close still unblocked readLoop in well under a millisecond, both
// with this non-blocking rewrap and with the old blocking fd (the kernel hangs up the line once
// the controlling shell exits, independent of fd mode). kqueue polls a pty master fine; this fd
// also gets real read traffic through it throughout every terminal test, on both platforms.
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
