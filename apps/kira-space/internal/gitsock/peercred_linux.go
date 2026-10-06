//go:build linux

package gitsock

import (
	"net"

	"golang.org/x/sys/unix"
)

// peerCred reads the connecting process's uid and pid from the kernel (SO_PEERCRED).
func peerCred(nc net.Conn) (peer, error) {
	rc, err := rawConn(nc)
	if err != nil {
		return peer{}, err
	}
	var cred *unix.Ucred
	var sockErr error
	if err := rc.Control(func(fd uintptr) {
		cred, sockErr = unix.GetsockoptUcred(int(fd), unix.SOL_SOCKET, unix.SO_PEERCRED)
	}); err != nil {
		return peer{}, err
	}
	if sockErr != nil {
		return peer{}, sockErr
	}
	return peer{UID: int(cred.Uid), PID: int(cred.Pid)}, nil
}
