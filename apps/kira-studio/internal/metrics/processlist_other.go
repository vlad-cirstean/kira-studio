//go:build !darwin || !cgo

package metrics

import "github.com/shirou/gopsutil/v4/process"

// listProcesses is AppProcessSet's process-table source on every platform without a native
// enumeration syscall wired up (or without cgo to reach the one on darwin) — unchanged from before
// the darwin/other split: process.Processes() then Exe() per process (D3).
func listProcesses() ([]procEntry, error) {
	procs, err := process.Processes()
	if err != nil {
		return nil, err
	}
	entries := make([]procEntry, 0, len(procs))
	for _, p := range procs {
		exe, err := p.Exe()
		if err != nil || exe == "" {
			continue
		}
		entries = append(entries, procEntry{pid: p.Pid, exe: exe})
	}
	return entries, nil
}
