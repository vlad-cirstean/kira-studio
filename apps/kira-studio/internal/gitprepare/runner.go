package gitprepare

import (
	"context"
	"errors"
	"os/exec"
	"syscall"
	"time"
)

// PrepareTimeout is D12's own hard timeout — unconditional, no setting anywhere raises it. A
// runaway script (an interactive prompt it silently hangs on, an infinite build loop) is killed
// rather than left to run indefinitely.
const PrepareTimeout = 15 * time.Minute

// gracefulStopDelay is SIGTERM's own grace window before escalating to SIGKILL — mirrors
// ghclient/runner.go's own constant of the same name and purpose exactly (this package's own
// precedent for "a spawned non-git binary gets a real chance to clean up, then dies for real").
const gracefulStopDelay = 2 * time.Second

// Spec is one prepare-script invocation — everything Run needs. Shell/LoginShell/Script are fed
// straight to BuildArgv; Env is the FULL child environment (BuildEnv's own output, never appended
// to os.Environ() a second time by this file).
type Spec struct {
	Shell      string
	LoginShell bool
	Script     string
	Dir        string
	Env        []string
	// OnBatch, when non-nil, is called with every throttled, capped batch of sanitized output
	// lines as they arrive (D12) — never called again after Run returns. May be called from a
	// goroutine other than Run's own caller; callers that touch shared state from it must
	// synchronize themselves (gitsession's own conn.Emit already does).
	OnBatch func([]Line)
}

// Result is Run's own outcome — Output is the FINAL, capped/sanitized transcript (never the live
// stream OnBatch already delivered piecemeal).
type Result struct {
	ExitCode  int
	TimedOut  bool
	Cancelled bool
	Output    []Line
	Truncated bool
}

// Runner is the spawn seam (D18/F5) — the one thing gitsession's own tests fake; NewOSRunner is the
// only production implementation, and nothing in this package's own test suite calls it.
type Runner interface {
	Run(ctx context.Context, spec Spec) (Result, error)
}

// NewOSRunner returns the real, os/exec-backed Runner.
func NewOSRunner() Runner { return osRunner{} }

type osRunner struct{}

func killGroup(pid int, sig syscall.Signal) error {
	if err := syscall.Kill(-pid, sig); err != nil && !errors.Is(err, syscall.ESRCH) {
		return err
	}
	return nil
}

// Run spawns BuildArgv(spec.Shell, spec.LoginShell, spec.Script) under spec.Dir/spec.Env, per
// D12: stdin is never set on the *exec.Cmd, which os/exec documents as reading from the null
// device — so the child never inherits this process's own stdin and is never attached to a pty;
// Setsid puts it in its own session so a group signal reaches whatever it forks, not just the
// shell itself; a PrepareTimeout deadline is layered onto ctx (which is ALSO ctx's own
// cancellation — either one triggers the same SIGTERM-then-SIGKILL sequence cmd.Cancel/WaitDelay
// implement, mirroring ghclient/runner.go's own precedent exactly). Output is sanitized, capped and
// streamed through outputCollector as it arrives — never buffered raw and processed only at exit.
func (osRunner) Run(ctx context.Context, spec Spec) (Result, error) {
	runCtx, cancel := context.WithTimeout(ctx, PrepareTimeout)
	defer cancel()

	argv := BuildArgv(spec.Shell, spec.LoginShell, spec.Script)
	cmd := exec.CommandContext(runCtx, argv[0], argv[1:]...)
	cmd.Dir = spec.Dir
	cmd.Env = spec.Env
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	cmd.Cancel = func() error {
		_ = killGroup(cmd.Process.Pid, syscall.SIGTERM)
		time.AfterFunc(gracefulStopDelay, func() { _ = killGroup(cmd.Process.Pid, syscall.SIGKILL) })
		return nil
	}
	cmd.WaitDelay = gracefulStopDelay

	collector := newOutputCollector(spec.OnBatch)
	cmd.Stdout = collector.stdoutWriter()
	cmd.Stderr = collector.stderrWriter()

	if err := cmd.Start(); err != nil {
		return Result{}, err
	}

	tickerDone := make(chan struct{})
	ticker := time.NewTicker(batchInterval)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				collector.tick()
			case <-tickerDone:
				return
			}
		}
	}()

	waitErr := cmd.Wait()
	close(tickerDone)
	collector.flush()

	timedOut := errors.Is(runCtx.Err(), context.DeadlineExceeded)
	cancelled := !timedOut && ctx.Err() != nil

	result := Result{
		Output: collector.finalLines(), Truncated: collector.isTruncated(),
		TimedOut: timedOut, Cancelled: cancelled,
	}
	if waitErr == nil {
		return result, nil
	}
	var exitErr *exec.ExitError
	if errors.As(waitErr, &exitErr) {
		result.ExitCode = exitErr.ExitCode()
		return result, nil
	}
	if timedOut || cancelled {
		// The process was killed by our own cancellation/timeout — Wait's error in that case is
		// "signal: killed" or similar, not a genuine spawn failure; TimedOut/Cancelled already say
		// what happened, so this is a normal (if unsuccessful) result, not a Go error.
		return result, nil
	}
	return Result{}, waitErr
}
