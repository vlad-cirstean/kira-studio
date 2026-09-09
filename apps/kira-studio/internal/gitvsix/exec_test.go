package gitvsix

import (
	"context"
	"os"
	"path/filepath"
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
