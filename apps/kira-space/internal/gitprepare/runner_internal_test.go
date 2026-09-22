package gitprepare

import (
	"context"
	"sync"
	"syscall"
	"testing"
	"time"
)

// TestRun_CancellationStopsEscalationTimerAfterCleanExit is G31 round-2 architecture/security
// review, finding #11: cmd.Cancel's own SIGKILL-escalation timer (armed on SIGTERM, to fire after
// gracefulStopDelay) used to never be stopped once the process actually exited — a clean SIGTERM
// exit (the overwhelmingly common case, exactly what this test's script does) still left the timer
// ticking toward a SIGKILL nothing needs, each one a live goroutine referencing this process for
// the whole gracefulStopDelay window; narrower but real, a SIGKILL later fired at a pid that has
// since been reused by an unrelated process group would land on the wrong target.
// gracefulStopDelay and killGroup are both package vars specifically so this test can shrink the
// window and observe the escalation directly, rather than relying on an on-demand-unreproducible
// real pid reuse. This is an internal (same-package) test file — runner_test.go's own external
// gitprepare_test package has no access to these unexported vars.
func TestRun_CancellationStopsEscalationTimerAfterCleanExit(t *testing.T) {
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

	ctx, cancel := context.WithCancel(context.Background())
	dir := t.TempDir()
	done := make(chan struct{})
	go func() {
		_, _ = NewOSRunner().Run(ctx, Spec{
			Shell: "/bin/sh", Script: "sleep 30", Dir: dir, Env: []string{"PATH=/usr/bin:/bin"},
		})
		close(done)
	}()

	time.Sleep(50 * time.Millisecond) // let the script actually be sleeping before cancelling.
	cancel()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Run did not return after cancellation")
	}

	// Run has already returned, meaning cmd.Wait confirmed the process reaped — the escalation
	// timer armed above must already have been stopped. Wait comfortably past that window and
	// confirm no SIGKILL was ever attempted.
	time.Sleep(3 * gracefulStopDelay)
	mu.Lock()
	defer mu.Unlock()
	if sigkillCalls != 0 {
		t.Fatalf("SIGKILL attempted %d time(s) after a clean SIGTERM exit — the escalation timer was not stopped", sigkillCalls)
	}
}
