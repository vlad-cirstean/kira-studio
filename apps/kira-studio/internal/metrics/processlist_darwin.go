//go:build darwin && cgo

package metrics

/*
#include <libproc.h>
*/
import "C"

import (
	"errors"
	"unsafe"
)

// pidPathBufSize is PROC_PIDPATHINFO_MAXSIZE (4*MAXPATHLEN, MAXPATHLEN=1024 on darwin) — one
// buffer, reused across every pid in a listing rather than gopsutil's fresh ~1KB allocation per
// process on the machine (P7 F8).
const pidPathBufSize = 4 * 1024

// listProcesses is AppProcessSet's darwin process-table source: one proc_listpids(PROC_ALL_PIDS)
// call, sized by its own documented convention (call once with a NULL buffer to learn the byte
// count, then once for real), then one proc_pidpath per pid into a single reused buffer — 1+N
// syscalls and one allocation total, replacing gopsutil's process.Processes()+Exe() (~5 syscalls
// and a fresh allocation per process on the machine to find this app's own handful of pids, F8). A
// pid whose path cannot be read is skipped, exactly as the gopsutil-based path does — proc_pidpath
// failing *is* the liveness answer AppProcessSet needs, no separate existence check required.
func listProcesses() ([]procEntry, error) {
	sizeBytes := C.proc_listpids(C.PROC_ALL_PIDS, 0, nil, 0)
	if sizeBytes <= 0 {
		return nil, errors.New("metrics: proc_listpids sizing call failed")
	}

	pidSize := C.int(unsafe.Sizeof(C.pid_t(0)))
	// Headroom over the sizing call's snapshot: a process can spawn between it and the real call
	// below, and proc_listpids never writes past buffersize regardless, so this only guards against
	// truncating the list on a machine that's actively spawning processes at this exact moment.
	capacity := sizeBytes/pidSize + 64
	buf := make([]C.pid_t, capacity)

	n := C.proc_listpids(C.PROC_ALL_PIDS, 0, unsafe.Pointer(&buf[0]), capacity*pidSize)
	if n <= 0 {
		return nil, errors.New("metrics: proc_listpids failed")
	}
	pids := buf[:n/pidSize]

	var pathBuf [pidPathBufSize]C.char
	entries := make([]procEntry, 0, len(pids))
	for _, pid := range pids {
		ret := C.proc_pidpath(C.int(pid), unsafe.Pointer(&pathBuf[0]), C.uint32_t(pidPathBufSize))
		if ret <= 0 {
			continue
		}
		entries = append(entries, procEntry{pid: int32(pid), exe: C.GoStringN(&pathBuf[0], ret)})
	}
	return entries, nil
}
