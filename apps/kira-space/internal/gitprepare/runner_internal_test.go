package gitprepare

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"syscall"
	"testing"
	"time"
)

// TestRun_CancellationSendsExactlyOneImmediateSIGKILL_EscalationTimerNeverFires updates G31 round-2
// architecture/security review finding #11's own regression proof for P108 Part 15 F8's fix, which
// changes the exact behavior this test pins.
//
// Original (G31 round-2 #11): cmd.Cancel's own SIGKILL-escalation timer (armed on SIGTERM, to fire
// after gracefulStopDelay) used to never be stopped once the process actually exited — a clean
// SIGTERM exit (the overwhelmingly common case, exactly what this test's script does) still left
// the timer ticking toward a SIGKILL nothing needs; narrower but real, a SIGKILL later fired at a
// pid that has since been reused by an unrelated process group would land on the wrong target. The
// fix stops that DELAYED timer the instant Wait returns — a guarantee this test still checks.
//
// F8 fix: stopping the delayed timer left a real gap of its own — any OTHER process-group member
// that ignores SIGTERM (the shell itself here honors it and exits quickly, so Wait returns well
// before gracefulStopDelay elapses) could outlive the documented hard timeout entirely, since
// nothing else was left to kill it. Run now ALSO sends one immediate, unconditional SIGKILL to the
// whole group the instant Wait returns, whenever the run was cancelled/timed out — harmless here
// (tolerated ESRCH: `sleep 30` already exited cleanly on its own SIGTERM), but what actually reaches
// a SIGTERM-ignoring descendant in the sibling test below. So this test's own assertion changes
// from "zero SIGKILL calls" to "exactly one, and it lands promptly" — proving the fix's own
// immediate kill fired, and the delayed escalation timer still never separately fires a second one.
//
// gracefulStopDelay and killGroup are both package vars specifically so this test can shrink the
// window and observe both kills directly, rather than relying on an on-demand-unreproducible real
// pid reuse. This is an internal (same-package) test file — runner_test.go's own external
// gitprepare_test package has no access to these unexported vars.
func TestRun_CancellationSendsExactlyOneImmediateSIGKILL_EscalationTimerNeverFires(t *testing.T) {
	oldDelay := gracefulStopDelay
	gracefulStopDelay = 100 * time.Millisecond
	t.Cleanup(func() { gracefulStopDelay = oldDelay })

	var mu sync.Mutex
	var sigkillCalls int
	var firstSigkillAt time.Time
	oldKillGroup := killGroup
	killGroup = func(pid int, sig syscall.Signal) error {
		if sig == syscall.SIGKILL {
			mu.Lock()
			sigkillCalls++
			if sigkillCalls == 1 {
				firstSigkillAt = time.Now()
			}
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
	cancelledAt := time.Now()
	cancel()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Run did not return after cancellation")
	}

	// Wait comfortably past the (now-defused) delayed escalation window and confirm exactly one
	// SIGKILL was attempted, promptly — never a second, later one from the delayed timer.
	time.Sleep(3 * gracefulStopDelay)
	mu.Lock()
	defer mu.Unlock()
	if sigkillCalls != 1 {
		t.Fatalf("SIGKILL attempted %d time(s), want exactly 1 (F8's own immediate kill; the delayed "+
			"escalation timer must still never separately fire)", sigkillCalls)
	}
	if elapsed := firstSigkillAt.Sub(cancelledAt); elapsed >= gracefulStopDelay {
		t.Fatalf("the one SIGKILL landed %s after cancellation, want well under gracefulStopDelay (%s) — "+
			"this must be F8's own immediate kill, not the delayed escalation timer", elapsed, gracefulStopDelay)
	}
}

// TestRun_DescendantIgnoringSIGTERMIsKilledPromptlyAfterCancel is P108 Part 15 F8's own regression
// proof: a process-group member that ignores SIGTERM (the shell itself honors it and exits
// quickly, so cmd.Wait returns well before gracefulStopDelay elapses) used to outlive the
// documented hard timeout entirely — escalate.Stop() cancelled the ONLY pending SIGKILL before it
// ever fired. A backgrounded subshell traps SIGTERM away and writes an incrementing counter to a
// file every 20ms; whether that counter keeps moving after Run returns is what distinguishes "the
// fix's own immediate, unconditional SIGKILL actually reached it" from "it is still running."
func TestRun_DescendantIgnoringSIGTERMIsKilledPromptlyAfterCancel(t *testing.T) {
	oldDelay := gracefulStopDelay
	gracefulStopDelay = 100 * time.Millisecond
	t.Cleanup(func() { gracefulStopDelay = oldDelay })

	dir := t.TempDir()
	counterFile := filepath.Join(dir, "counter")
	script := fmt.Sprintf(
		`(trap '' TERM; i=0; while :; do i=$((i+1)); printf '%%s' "$i" > %q; sleep 0.02; done) &`,
		counterFile,
	)

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		_, _ = NewOSRunner().Run(ctx, Spec{Shell: "/bin/sh", Script: script, Dir: dir, Env: []string{"PATH=/usr/bin:/bin"}})
		close(done)
	}()

	// Wait for the counter loop to actually start before cancelling.
	readCounter := func() (int, bool) {
		b, err := os.ReadFile(counterFile)
		if err != nil || len(b) == 0 {
			return 0, false
		}
		var n int
		if _, serr := fmt.Sscanf(string(b), "%d", &n); serr != nil {
			return 0, false
		}
		return n, true
	}
	deadline := time.Now().Add(2 * time.Second)
	for {
		if _, ok := readCounter(); ok {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the counter file never appeared — the backgrounded descendant never started")
		}
		time.Sleep(5 * time.Millisecond)
	}

	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Run did not return after cancellation")
	}

	afterReturn, _ := readCounter()
	time.Sleep(200 * time.Millisecond) // comfortably past several of the descendant's own 20ms ticks.
	afterGrace, _ := readCounter()
	if afterGrace > afterReturn {
		t.Fatalf("counter kept advancing (%d -> %d) after Run returned — the SIGTERM-ignoring "+
			"descendant is still running past the documented hard timeout", afterReturn, afterGrace)
	}
}

// TestRun_BackgroundChildHoldingPipesReturnsIncompleteResult is P108 Part 15 F7's own regression
// proof: a script that exits 0 while a background child it spawned still holds stdout/stderr open
// must not turn into a bare Go error and lose the whole transcript — cmd.Wait returns a wrapped
// exec.ErrWaitDelay once WaitDelay's own deadline stops waiting on that redirection, which is
// neither a timeout nor a cancellation nor a genuine spawn failure.
func TestRun_BackgroundChildHoldingPipesReturnsIncompleteResult(t *testing.T) {
	oldDelay := gracefulStopDelay
	gracefulStopDelay = 100 * time.Millisecond
	t.Cleanup(func() { gracefulStopDelay = oldDelay })

	dir := t.TempDir()
	// `(sleep 5 &)` backgrounds a grandchild that inherits this process's own stdout/stderr fds
	// but is disowned from the subshell — the outer `sh` exits 0 immediately, while the sleep
	// keeps the pipe's write end open well past gracefulStopDelay.
	res, err := NewOSRunner().Run(context.Background(), Spec{
		Shell: "/bin/sh", LoginShell: false, Script: "echo hello; (sleep 5 &); exit 0",
		Dir: dir, Env: []string{"PATH=/usr/bin:/bin"},
	})
	if err != nil {
		t.Fatalf("Run returned an error %v, want a normal (if incomplete) result — the transcript must not be discarded", err)
	}
	if res.ExitCode != 0 {
		t.Fatalf("ExitCode = %d, want 0 (the script itself exited cleanly)", res.ExitCode)
	}
	if res.TimedOut || res.Cancelled {
		t.Fatalf("TimedOut=%v Cancelled=%v, want both false — WaitDelay is not a script timeout", res.TimedOut, res.Cancelled)
	}
	if !res.Incomplete {
		t.Fatal("Incomplete = false, want true — a background child still held stdout/stderr open")
	}
}
