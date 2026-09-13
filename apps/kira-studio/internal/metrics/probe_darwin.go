//go:build darwin && cgo

package metrics

/*
#include <libproc.h>
#include <mach/mach_time.h>
#include <string.h>
#include <errno.h>

// kira_probe_rusage wraps proc_pid_rusage(RUSAGE_INFO_V2) with out-parameters of unambiguous C
// types, so the Go side never has to reason about rusage_info_t's own pointer indirection — its
// header declares "rusage_info_t *buffer" for what every real caller (Apple's own sample code,
// gopsutil's dynamically-loaded call in IOCountersWithContext) passes as a plain pointer to the
// version struct; the cast below matches that established, working convention. Returns 0 on
// success, or the raw errno on failure — notably EPERM, a real possibility for this app's own
// WebKit helpers per the P7 plan's §7.2 item 3, not merely hypothetical — captured immediately
// after the syscall so a goroutine reschedule onto a different OS thread can never read a stale
// value (the reason gopsutil's own equivalent call bothers with runtime.LockOSThread).
static int kira_probe_rusage(pid_t pid, uint64_t *user_time, uint64_t *system_time,
                              uint64_t *phys_footprint, uint64_t *start_abstime) {
	struct rusage_info_v2 ri;
	memset(&ri, 0, sizeof(ri));
	if (proc_pid_rusage(pid, RUSAGE_INFO_V2, (rusage_info_t *)&ri) != 0) {
		return errno;
	}
	*user_time = ri.ri_user_time;
	*system_time = ri.ri_system_time;
	*phys_footprint = ri.ri_phys_footprint;
	*start_abstime = ri.ri_proc_start_abstime;
	return 0;
}

// kira_probe_taskinfo is kira_probe_rusage's EPERM fallback: proc_pidinfo(PROC_PIDTASKINFO) with
// its return value actually checked against sizeof(struct proc_taskinfo) — unlike gopsutil's own
// two calls to the same syscall (process_darwin.go's MemoryInfo/Times), which discard it entirely
// and return a zeroed, indistinguishable-from-real struct on failure (P7 F2). Returns 0 on success,
// -1 on failure.
static int kira_probe_taskinfo(pid_t pid, uint64_t *user_time, uint64_t *system_time,
                                uint64_t *resident_size) {
	struct proc_taskinfo pti;
	memset(&pti, 0, sizeof(pti));
	int n = proc_pidinfo(pid, PROC_PIDTASKINFO, 0, &pti, sizeof(pti));
	if (n != (int)sizeof(pti)) {
		return -1;
	}
	*user_time = pti.pti_total_user;
	*system_time = pti.pti_total_system;
	*resident_size = pti.pti_resident_size;
	return 0;
}

static void kira_mach_timebase(uint32_t *numer, uint32_t *denom) {
	struct mach_timebase_info info;
	mach_timebase_info(&info);
	*numer = info.numer;
	*denom = info.denom;
}
*/
import "C"

import (
	"log/slog"
	"sync"
)

// machTimebase is macOS's own tick->nanosecond ratio (mach_timebase_info(3)): 1/1 on x86_64, ~125/3
// on Apple silicon (the P7 plan's §2.4). Read once, since it is fixed for the life of a process,
// and applied to ri_user_time/ri_system_time — Apple's own proc_info.h header documents no unit for
// the equivalent pti_total_user/_system fields, but secondary sources agree they are mach absolute
// time, which is exactly what this conversion assumes. C6's real-Mac calibration test (against
// syscall.Getrusage) is what actually settles this rather than assumes it (P7 OQ-1) — if it turns
// out these fields are already nanoseconds, this conversion is the one line that changes.
var machTimebase = sync.OnceValues(func() (numer, denom float64) {
	var n, d C.uint32_t
	C.kira_mach_timebase(&n, &d)
	if d == 0 { // never happens per Apple's own docs; a guaranteed non-zero divisor is cheap insurance
		return 1, 1
	}
	return float64(n), float64(d)
})

func machTicksToSeconds(ticks uint64) float64 {
	numer, denom := machTimebase()
	return float64(ticks) * numer / denom / 1e9
}

// epermLogged tracks which pids have already had their proc_pid_rusage EPERM fallback logged, so a
// pid stuck on the fallback for its whole lifetime logs once, not once per 5s tick forever.
var epermLogged sync.Map // map[int32]struct{}

// defaultProbe is darwin's native probe: one proc_pid_rusage(RUSAGE_INFO_V2) syscall returns CPU
// time, physical-footprint memory and process-start time together (P7 F7) — the same fields, from
// the same API, Activity Monitor's own %CPU/Memory columns are built on (P7 §2.1/§2.2). A pid that
// returns EPERM falls back to taskinfoFallback rather than to a silent zero, so a permission
// failure degrades to today's RSS-based reading for that pid instead of a lifetime-CPU spike on the
// tick it recovers (F2, D7). Any other failure (ESRCH — exited between discovery and sampling, most
// commonly) drops the pid for this tick, same as every other probe failure.
func defaultProbe(pid int32) (procSample, bool) {
	var userTime, systemTime, physFootprint, startAbstime C.uint64_t
	errno := C.kira_probe_rusage(C.pid_t(pid), &userTime, &systemTime, &physFootprint, &startAbstime)
	switch {
	case errno == 0:
		cpuSeconds := machTicksToSeconds(uint64(userTime)) + machTicksToSeconds(uint64(systemTime))
		return procSample{
			cpuSeconds: cpuSeconds,
			memBytes:   uint64(physFootprint),
			createTime: int64(startAbstime),
		}, true
	case errno == C.EPERM:
		if _, already := epermLogged.LoadOrStore(pid, struct{}{}); !already {
			slog.Warn("proc_pid_rusage: permission denied, falling back to RSS accounting", "scope", "metrics", "pid", pid)
		}
		return taskinfoFallback(pid)
	default:
		return procSample{}, false
	}
}

// taskinfoFallback is defaultProbe's EPERM path. struct proc_taskinfo carries no process-start
// time of its own, so the identity tag comes from gopsutilCreateTime instead — a separate, cheap
// sysctl unrelated to the PROC_PIDTASKINFO call above, so it isn't tied to the RSS/CPU reads'
// success or failure. Its value space (epoch-derived) differs from the primary path's
// (mach-absolute-time-since-boot), but createTime is only ever compared for equality, never
// interpreted as a timestamp, so a pid that flips between the two paths across ticks is treated
// (conservatively, not dangerously) as a new process for that one tick rather than mismatched.
func taskinfoFallback(pid int32) (procSample, bool) {
	var userTime, systemTime, residentSize C.uint64_t
	if C.kira_probe_taskinfo(C.pid_t(pid), &userTime, &systemTime, &residentSize) != 0 {
		return procSample{}, false
	}
	createTime, ok := gopsutilCreateTime(pid)
	if !ok {
		return procSample{}, false
	}
	cpuSeconds := machTicksToSeconds(uint64(userTime)) + machTicksToSeconds(uint64(systemTime))
	return procSample{cpuSeconds: cpuSeconds, memBytes: uint64(residentSize), createTime: createTime}, true
}
