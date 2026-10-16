//go:build darwin && cgo

package metrics

import (
	"os"
	"syscall"
	"testing"
	"time"
)

// C6 (P7 plan §6): calibrates probe_darwin.go's mach-timebase conversion
// (ri_user_time+ri_system_time -> seconds) against syscall.Getrusage(RUSAGE_SELF)'s Utime+Stime —
// a Timeval, unambiguously seconds and microseconds, POSIX, no cgo of its own. Apple's own
// proc_info.h documents no unit for the pti_total_user/_system fields rusage_info_v2's equivalents
// share the convention of (P7 §2.4, OQ-1); if mach_timebase_info's numer/denom is applied when the
// fields are already nanoseconds (or vice versa), the resulting error is ~41.7x on Apple silicon
// while still looking like a plausible CPU reading — nothing else in this package can catch that.
// Cannot run in this sandbox (§1.4, no macOS toolchain); must be run on a real Mac before P7 is
// closed (plan §7.2 item 4), and its result — including the machine's own mach_timebase_info
// numer/denom — belongs in docs/PERF.md (C8) once it has.
func TestDefaultProbe_CPUTimeMatchesGetrusage(t *testing.T) {
	pid := int32(os.Getpid())

	var before syscall.Rusage
	if err := syscall.Getrusage(syscall.RUSAGE_SELF, &before); err != nil {
		t.Fatalf("Getrusage: %v", err)
	}
	probeBefore, ok := defaultProbe(pid)
	if !ok {
		t.Fatal("defaultProbe failed reading this test's own process")
	}

	burnCPU(300 * time.Millisecond)

	var after syscall.Rusage
	if err := syscall.Getrusage(syscall.RUSAGE_SELF, &after); err != nil {
		t.Fatalf("Getrusage: %v", err)
	}
	probeAfter, ok := defaultProbe(pid)
	if !ok {
		t.Fatal("defaultProbe failed reading this test's own process")
	}

	wantDelta := (timevalSeconds(after.Utime) + timevalSeconds(after.Stime)) -
		(timevalSeconds(before.Utime) + timevalSeconds(before.Stime))
	gotDelta := probeAfter.cpuSeconds - probeBefore.cpuSeconds

	// Loose tolerance: two different syscalls, two different sampling instants either side of the
	// CPU burn, not lockstep reads of the same clock. This test exists to catch a ~41.7x unit
	// error, not to assert tight agreement between two independent accounting paths.
	const tolerance = 0.25 // seconds
	if diff := gotDelta - wantDelta; diff > tolerance || diff < -tolerance {
		t.Errorf("probe cpuSeconds delta = %.4fs, want ~%.4fs (getrusage, diff %.4fs > %.4fs tolerance) — "+
			"check probe_darwin.go's mach_timebase_info conversion", gotDelta, wantDelta, diff, tolerance)
	}
}

func timevalSeconds(tv syscall.Timeval) float64 {
	return float64(tv.Sec) + float64(tv.Usec)/1e6
}

// burnCPU spins (not sleeps) for at least d of wall-clock time, so RUSAGE_SELF's Utime actually
// accumulates something measurable within the test's own tolerance.
func burnCPU(d time.Duration) {
	deadline := time.Now().Add(d)
	x := 0
	for time.Now().Before(deadline) {
		x++
	}
	_ = x
}
