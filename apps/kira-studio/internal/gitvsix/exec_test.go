package gitvsix

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"syscall"
	"testing"
	"time"
)

// TestRealRun_CancelKillsGrandchild is G30 round-1 architecture/security review, finding #7:
// realRun set Setpgid and WaitDelay but installed no cmd.Cancel override, so exec.CommandContext's
// default cancel (Process.Kill(), the DIRECT CHILD ONLY) applied — a child that forked something
// long-lived left the grandchild running after the parent was killed/timed out. This spawns a
// shell that forks a background sleep (the "grandchild") and writes its pid to a file, then lets
// the context deadline fire realRun's own cancellation, and proves the grandchild is gone
// afterward — not just that realRun itself returned.
func TestRealRun_CancelKillsGrandchild(t *testing.T) {
	if _, err := os.Stat("/bin/sh"); err != nil {
		t.Skip("/bin/sh not available")
	}
	pidFile := filepath.Join(t.TempDir(), "grandchild.pid")
	script := "#!/bin/sh\n" +
		"sleep 30 &\n" +
		"echo $! > " + pidFile + "\n" +
		"sleep 30\n" // the direct child also sleeps, so it is still alive when the context expires.

	scriptPath := filepath.Join(t.TempDir(), "spawn.sh")
	if err := os.WriteFile(scriptPath, []byte(script), 0o755); err != nil {
		t.Fatalf("write script: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	_ = realRun(ctx, scriptPath, nil) // an error/timeout here is expected and not what this test checks.

	grandchildPid := waitForPidFile(t, pidFile)

	// Give the WaitDelay-driven SIGKILL escalation a little room beyond the process's own exit —
	// realRun's own cmd.Cancel already fired SIGTERM immediately on context expiry.
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if err := syscall.Kill(grandchildPid, 0); err != nil {
			return // ESRCH (or any other error probing it) — the grandchild is gone.
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("grandchild pid %d is still alive — realRun's cancellation did not reach it", grandchildPid)
}

// TestRealRun_CancellationStopsEscalationTimerAfterCleanExit is G31 round-2 architecture/security
// review, finding #11: cmd.Cancel's own SIGKILL-escalation timer (armed on SIGTERM, to fire after
// gracefulStopDelay) used to never be stopped once the process actually exited — a clean SIGTERM
// exit (the overwhelmingly common case, exactly what this test's script does) still left the timer
// ticking toward a SIGKILL nothing needs. gracefulStopDelay and killGroup are both package vars
// specifically so this test can shrink the window and observe the escalation directly, rather than
// relying on an on-demand-unreproducible real pid reuse.
func TestRealRun_CancellationStopsEscalationTimerAfterCleanExit(t *testing.T) {
	if _, err := os.Stat("/bin/sh"); err != nil {
		t.Skip("/bin/sh not available")
	}

	oldDelay := gracefulStopDelay
	gracefulStopDelay = 100 * time.Millisecond
	t.Cleanup(func() { gracefulStopDelay = oldDelay })

	var mu sync.Mutex
	var sigkillCalls int
	oldKillGroup := killGroup
	killGroup = func(pid int, sig syscall.Signal) error {
		if sig == syscall.SIGKILL {
			mu.Lock()
			sigkillCalls++
			mu.Unlock()
		}
		return oldKillGroup(pid, sig)
	}
	t.Cleanup(func() { killGroup = oldKillGroup })

	scriptPath := filepath.Join(t.TempDir(), "spawn.sh")
	if err := os.WriteFile(scriptPath, []byte("#!/bin/sh\nsleep 30\n"), 0o755); err != nil {
		t.Fatalf("write script: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		_ = realRun(ctx, scriptPath, nil)
		close(done)
	}()

	time.Sleep(50 * time.Millisecond) // let the script actually be sleeping before cancelling.
	cancel()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("realRun did not return after cancellation")
	}

	// The process is confirmed reaped at this point — the escalation timer (armed for a mere
	// 100ms above) must already have been stopped. Wait comfortably past that window and confirm
	// no SIGKILL was ever attempted.
	time.Sleep(3 * gracefulStopDelay)
	mu.Lock()
	defer mu.Unlock()
	if sigkillCalls != 0 {
		t.Fatalf("SIGKILL attempted %d time(s) after a clean SIGTERM exit — the escalation timer was not stopped", sigkillCalls)
	}
}

func waitForPidFile(t *testing.T, path string) int {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if data, err := os.ReadFile(path); err == nil && len(data) > 0 {
			pid := 0
			for _, c := range data {
				if c < '0' || c > '9' {
					break
				}
				pid = pid*10 + int(c-'0')
			}
			if pid > 0 {
				return pid
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("grandchild pid file %s was never written", path)
	return 0
}
