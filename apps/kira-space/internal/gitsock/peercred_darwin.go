//go:build darwin

package gitsock

import (
	"net"

	"golang.org/x/sys/unix"
)

// peerCred reads the connecting process's uid (LOCAL_PEERCRED) and pid (LOCAL_PEERPID).
func peerCred(nc net.Conn) (peer, error) {
	rc, err := rawConn(nc)
	if err != nil {
		return peer{}, err
	}
	var cred *unix.Xucred
	var pid int
	var credErr, pidErr error
	if err := rc.Control(func(fd uintptr) {
		cred, credErr = unix.GetsockoptXucred(int(fd), unix.SOL_LOCAL, unix.LOCAL_PEERCRED)
		pid, pidErr = unix.GetsockoptInt(int(fd), unix.SOL_LOCAL, unix.LOCAL_PEERPID)
	}); err != nil {
		return peer{}, err
	}
	if credErr != nil {
		return peer{}, credErr
	}
	if pidErr != nil {
		return peer{}, pidErr
	}
	return peer{UID: int(cred.Uid), PID: pid}, nil
}
