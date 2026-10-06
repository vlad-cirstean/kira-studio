package gitsock

import (
	"fmt"
	"net"

	"github.com/shirou/gopsutil/v4/process"
)

// peer is the kernel-reported identity of a socket client. Unlike hello.client, a client cannot
// assert it.
type peer struct {
	UID int
	PID int
}

// Peer is the process behind a pairing request, shown in the approval prompt. Exe is "" when the
// lookup failed; the prompt then says so rather than hiding it.
type Peer struct {
	PID int
	Exe string
}

// rawConn returns nc's raw socket control handle.
func rawConn(nc net.Conn) (interface {
	Control(func(fd uintptr)) error
}, error) {
	uc, ok := nc.(*net.UnixConn)
	if !ok {
		return nil, fmt.Errorf("gitsock: peer credentials: %T is not a unix connection", nc)
	}
	rc, err := uc.SyscallConn()
	if err != nil {
		return nil, fmt.Errorf("gitsock: peer credentials: %w", err)
	}
	return rc, nil
}

func peerExe(pid int) string {
	if pid <= 0 {
		return ""
	}
	p, err := process.NewProcess(int32(pid))
	if err != nil {
		return ""
	}
	exe, err := p.Exe()
	if err != nil {
		return ""
	}
	return exe
}
