package keepawake

import (
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/internal/testx"
)

// TestCaffeinateArgvGolden asserts the spawn's exact argv, byte for byte — the same reasoning
// internal/startupfail's TestAlertArgvGolden states: the spawn is the whole security and
// correctness surface of this file.
func TestCaffeinateArgvGolden(t *testing.T) {
	got := caffeinateArgv(4242)
	want := []string{"-i", "-s", "-w", "4242"}
	if len(got) != len(want) {
		t.Fatalf("caffeinateArgv length = %d, want %d\ngot:  %#v\nwant: %#v", len(got), len(want), got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("caffeinateArgv[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

// processAlive/waitUntil are testx.ProcessAlive/testx.WaitUntil (P107 I2-28).
var (
	processAlive = testx.ProcessAlive
	waitUntil    = testx.WaitUntil
)

// TestCaffeinateDriverLifecycle is the one test that catches "release does not actually kill it",
// the leak this whole package exists to prevent — runnable on Linux because the driver is pure Go.
// lookPath is redirected to a tiny injected helper script (ignores the -i -s -w argv caffeinate
// itself would parse) rather than the real caffeinate, which this sandbox does not have.
// docs/DEV_ENVIRONMENT.md's own note that this container's minimal init reaps slowly is why this
// polls for ESRCH instead of asserting it on the first check (internal/preconnect's own precedent).
func TestCaffeinateDriverLifecycle(t *testing.T) {
	helper := writeSleepHelper(t)

	d := newCaffeinateDriver()
	d.lookPath = func(string) (string, error) { return helper, nil }

	if err := d.Acquire(); err != nil {
		t.Fatalf("Acquire: %v", err)
	}

	d.mu.Lock()
	pid := d.cmd.Process.Pid
	d.mu.Unlock()

	if !processAlive(pid) {
		t.Fatalf("pid %d is not alive right after Acquire", pid)
	}

	d.Release()

	waitUntil(t, 5*time.Second, func() bool { return !processAlive(pid) })
}

// TestCaffeinateDriverReapIgnoresSupersededChild deterministically reproduces F12's Rearm race:
// Release immediately followed by Acquire, with the old child's reap goroutine still not back to
// the lock when the new child's state is published. The review's own overlay test only landed this
// 1/40 runs at default GOMAXPROCS (37/40 at GOMAXPROCS=1) — real OS process-death timing in this
// sandbox doesn't reproduce it at all (fork/exec for the new child is slower than the kernel
// reaping a SIGKILLed one, so the old reaper usually wins the lock first). This test forces the
// exact interleaving instead of hoping for it: it holds d.mu itself across the kill-then-replace
// window — same critical section Release+Acquire run under, just driven from the test — guaranteeing
// child 2's state is visible before child 1's reap goroutine ever gets the lock.
func TestCaffeinateDriverReapIgnoresSupersededChild(t *testing.T) {
	helper := writeSleepHelper(t)

	d := newCaffeinateDriver()
	d.lookPath = func(string) (string, error) { return helper, nil }

	var lostErrs []error
	d.OnLost(func(err error) { lostErrs = append(lostErrs, err) })

	// Child 1 is started by hand, not via Acquire — Acquire spawns its own reap goroutine
	// internally, and os/exec.Cmd.Wait() must not be called twice concurrently on the same *Cmd.
	// This test drives exactly one reap(cmd1) call itself, below.
	path1, err := d.lookPath("caffeinate")
	if err != nil {
		path1 = caffeinateFallbackPath
	}
	cmd1 := exec.Command(path1, caffeinateArgv(os.Getpid())...)
	cmd1.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd1.Start(); err != nil {
		t.Fatalf("start child 1: %v", err)
	}
	d.mu.Lock()
	d.cmd = cmd1
	d.expected = false
	reapDone := make(chan struct{})
	go func() {
		d.reap(cmd1)
		close(reapDone)
	}()

	// Everything below runs while still holding d.mu, so reap(cmd1) can finish its Wait() but
	// cannot reach its own lock-guarded check until this whole block — Release's kill plus
	// Acquire's publish of child 2 — has already committed and unlocked.
	d.expected = true
	if err := cmd1.Process.Kill(); err != nil {
		d.mu.Unlock()
		t.Fatalf("kill child 1: %v", err)
	}

	path2, err := d.lookPath("caffeinate")
	if err != nil {
		path2 = caffeinateFallbackPath
	}
	cmd2 := exec.Command(path2, caffeinateArgv(os.Getpid())...)
	cmd2.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd2.Start(); err != nil {
		d.mu.Unlock()
		t.Fatalf("start child 2: %v", err)
	}
	d.cmd = cmd2
	d.expected = false
	d.mu.Unlock()
	go d.reap(cmd2)
	t.Cleanup(d.Release)

	select {
	case <-reapDone:
	case <-time.After(5 * time.Second):
		t.Fatal("child 1's reap never returned")
	}

	if len(lostErrs) != 0 {
		t.Fatalf("onLost fired %d time(s) for child 1's own intentional kill during Rearm: %v — child 1's reap must not report once it has been superseded", len(lostErrs), lostErrs)
	}

	d.mu.Lock()
	stillCurrent := d.cmd == cmd2
	d.mu.Unlock()
	if !stillCurrent {
		t.Fatal("child 1's reap cleared d.cmd even though child 2 is now current")
	}
}

// writeSleepHelper writes a tiny shell script that sleeps regardless of its own argv (so it
// tolerates caffeinateArgv's "-i -s -w <pid>", which a real `sleep` binary would reject as
// unrecognized flags) and returns its absolute path.
func writeSleepHelper(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "fake-caffeinate.sh")
	script := "#!/bin/sh\nexec sleep 300\n"
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatalf("write helper script: %v", err)
	}
	return path
}
