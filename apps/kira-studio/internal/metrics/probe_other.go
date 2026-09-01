//go:build !darwin || !cgo

package metrics

// defaultProbe is gopsutilProbe unchanged (RSS-based) on every platform without a native
// footprint syscall wired up — every non-darwin build — and on darwin itself when cgo is
// unavailable to reach probe_darwin.go's proc_pid_rusage call (this app never ships that way,
// see build/darwin/Taskfile.yml, but CGO_ENABLED=0 GOOS=darwin must still type-check, D5) (D3).
func defaultProbe(pid int32) (procSample, bool) {
	return gopsutilProbe(pid)
}
