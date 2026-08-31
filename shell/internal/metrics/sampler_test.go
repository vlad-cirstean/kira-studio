package metrics

import (
	"os"
	"os/exec"
	"testing"
)

// cpuDeltaPercent is the pure delta math cpuState/Sample pull apart to test the P2 R1 pid-reuse
// guard without a real OS process: a pid contributes to the delta only when its createTime is
// unchanged between the two snapshots.

func TestCpuDeltaPercent_SamePidSameProcess_ContributesDelta(t *testing.T) {
	prev := map[int32]cpuState{100: {time: 1.0, createTime: 5000}}
	cur := map[int32]cpuState{100: {time: 1.5, createTime: 5000}}
	got := cpuDeltaPercent(prev, cur, 1.0)
	if got != 50 {
		t.Errorf("cpuDeltaPercent = %v, want 50 (0.5s of CPU time over 1s elapsed)", got)
	}
}

func TestCpuDeltaPercent_ReusedPidDifferentCreateTime_ContributesNothing(t *testing.T) {
	// pid 100 named a process that had accumulated 100s of CPU time, then exited; the OS handed
	// pid 100 to a brand-new, unrelated process before the next sample. Computing a delta against
	// the old process's cumulative time would produce a large, spurious negative contribution.
	prev := map[int32]cpuState{100: {time: 100.0, createTime: 5000}}
	cur := map[int32]cpuState{100: {time: 0.1, createTime: 9999}}
	got := cpuDeltaPercent(prev, cur, 1.0)
	if got != 0 {
		t.Errorf("cpuDeltaPercent = %v, want 0 (reused pid must not mix the old process's cumulative time into the delta)", got)
	}
}

func TestCpuDeltaPercent_NewPid_ContributesNothingThisTick(t *testing.T) {
	prev := map[int32]cpuState{}
	cur := map[int32]cpuState{200: {time: 0.3, createTime: 1234}}
	got := cpuDeltaPercent(prev, cur, 1.0)
	if got != 0 {
		t.Errorf("cpuDeltaPercent = %v, want 0 (a pid with no prior sample has no delta to report yet)", got)
	}
}

func TestCpuDeltaPercent_ZeroElapsed_ReturnsZero(t *testing.T) {
	prev := map[int32]cpuState{100: {time: 1.0, createTime: 5000}}
	cur := map[int32]cpuState{100: {time: 2.0, createTime: 5000}}
	if got := cpuDeltaPercent(prev, cur, 0); got != 0 {
		t.Errorf("cpuDeltaPercent = %v, want 0 for zero elapsed seconds (avoid a divide-by-zero blowup)", got)
	}
}

// includeHelper is AppProcessSet's own inclusion rule, pulled out pure so both the tracked
// (darwin) and untracked (every other platform) branches are testable regardless of which
// platform actually runs this test binary.

func TestIncludeHelper_TrackedFailsClosedOnUnknownResponsible(t *testing.T) {
	if includeHelper(true, false) {
		t.Error("tracked platform: a helper whose responsible pid is not one of our own anchors must be excluded, not included")
	}
}

func TestIncludeHelper_TrackedIncludesOwnAnchor(t *testing.T) {
	if !includeHelper(true, true) {
		t.Error("tracked platform: a helper whose responsible pid is one of our own anchors must be included")
	}
}

func TestIncludeHelper_UntrackedAlwaysIncludes(t *testing.T) {
	if !includeHelper(false, false) {
		t.Error("untracked platform: every helper-needle match must be included unfiltered, responsibility tracking not being available there")
	}
}

// CachedPIDs: resolve (the expensive full process-table walk) should run once up front and then
// only every rescanEvery calls — everything in between must be answered from cheap per-pid
// revalidation instead.

func TestCachedPIDs_ResolveOnlyRunsEveryRescanEvery(t *testing.T) {
	self := int32(os.Getpid())
	resolveCalls := 0
	c := NewCachedPIDs(func() ([]int32, error) {
		resolveCalls++
		return []int32{self}, nil
	}, 3)

	for i := 1; i <= 7; i++ {
		pids, err := c.PIDs()
		if err != nil {
			t.Fatalf("PIDs() call %d: %v", i, err)
		}
		if len(pids) != 1 || pids[0] != self {
			t.Fatalf("PIDs() call %d = %v, want [%d]", i, pids, self)
		}
	}
	if resolveCalls != 3 {
		t.Errorf("resolveCalls = %d, want 3 (once at call 1, then every 3rd call: 4 and 7)", resolveCalls)
	}
}

func TestCachedPIDs_DropsExitedPidBeforeNextRescan(t *testing.T) {
	self := int32(os.Getpid())

	// A short sleep, not an instantly-exiting command: the child must still be alive when the
	// first PIDs() call (the full rescan) runs, or this test would not be exercising what it
	// claims to.
	cmd := exec.Command("sleep", "0.3")
	if err := cmd.Start(); err != nil {
		t.Skipf("could not start a throwaway child process: %v", err)
	}
	childPID := int32(cmd.Process.Pid)

	c := NewCachedPIDs(func() ([]int32, error) {
		return []int32{self, childPID}, nil
	}, 10) // large enough that the second PIDs() call below stays on the cheap revalidation path

	first, err := c.PIDs()
	if err != nil {
		t.Fatalf("PIDs() (rescan): %v", err)
	}
	if !containsPID(first, self) || !containsPID(first, childPID) {
		t.Fatalf("PIDs() (rescan) = %v, want both %d and %d (child must still be alive here)", first, self, childPID)
	}

	if err := cmd.Wait(); err != nil {
		t.Fatalf("child process exited with error: %v", err)
	}
	exitedPID := childPID

	second, err := c.PIDs()
	if err != nil {
		t.Fatalf("PIDs() (revalidate): %v", err)
	}
	if !containsPID(second, self) {
		t.Errorf("PIDs() (revalidate) = %v, want %d (still alive) kept", second, self)
	}
	if containsPID(second, exitedPID) {
		t.Errorf("PIDs() (revalidate) = %v, want exited pid %d dropped, not kept or misattributed to whatever now has that pid number", second, exitedPID)
	}
}

func containsPID(pids []int32, want int32) bool {
	for _, p := range pids {
		if p == want {
			return true
		}
	}
	return false
}
