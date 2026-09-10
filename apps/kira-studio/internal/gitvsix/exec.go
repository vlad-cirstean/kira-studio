package gitvsix

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// gracefulStopDelay/spawnTimeout mirror gitclient/runner.go's own bounds (D12): both spawns this
// package makes are local, fast operations — code --install-extension and open -R never touch the
// network — so a wedged child is the only failure mode a bound needs to guard against.
//
// gracefulStopDelay is a var, not a const (mirrors internal/preconnect/supervisor.go's own
// killGrace/settleWindow precedent, P55 §2 D9, and gitclient/runner.go's own identical G31 round-2
// fix): exec_test.go lowers it so a regression test proving cmd.Cancel's SIGKILL escalation timer
// is actually stopped once the process exits cleanly doesn't cost 2s of real wall-clock time.
var gracefulStopDelay = 2 * time.Second

const (
	spawnTimeout = 60 * time.Second
	// maxDetailBytes bounds how much of a child's stderr this package retains for Result.Detail —
	// gitclient's own maxStderrBytes instinct that a child's stderr is untrusted text heading for
	// a UI string, applied at a far smaller scale since Detail is one line, not a diagnostic log.
	maxDetailBytes = 4096
)

// RunError is realRun's failure shape for a spawn that ran and exited non-zero — distinct from a
// spawn that could not start at all (a plain error), so Install can tell "code refused" from
// "code could not be launched".
type RunError struct {
	ExitCode int
	// Stderr is bounded to maxDetailBytes and truncated to its first line — never the whole of a
	// child's stderr verbatim (it may itself carry a path or, for a wrapped git remote command,
	// something a user typed).
	Stderr string
}

func (e *RunError) Error() string {
	if e.Stderr == "" {
		return "exit " + strconv.Itoa(e.ExitCode)
	}
	return "exit " + strconv.Itoa(e.ExitCode) + ": " + e.Stderr
}

func firstLineBounded(s string, max int) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	s = strings.TrimSpace(s)
	if len(s) > max {
		s = s[:max]
	}
	return s
}

// realExecutable/realLookPath/realStat are Deps' zero-value fallbacks — os.Executable/
// exec.LookPath/os.Stat, unwrapped, so a caller providing no Deps at all gets the real OS.
func realExecutable() (string, error)           { return os.Executable() }
func realLookPath(name string) (string, error)  { return exec.LookPath(name) }
func realStat(path string) (os.FileInfo, error) { return os.Stat(path) }

// killGroup signals pid's whole process group (the negative pid targets the group, D3's own
// convention in gitclient/runner.go/gitprepare/runner.go/ghclient/runner.go) — ESRCH (already
// gone) is not an error, every other Kill failure is.
//
// A var, not a plain func (internal/preconnect/supervisor.go's own killSignal is this codebase's
// precedent) so a test can observe whether cmd.Cancel's SIGKILL escalation was actually invoked.
var killGroup = func(pid int, sig syscall.Signal) error {
	if err := syscall.Kill(-pid, sig); err != nil && !errors.Is(err, syscall.ESRCH) {
		return err
	}
	return nil
}

// realRun is D13's argv-only spawn: os/exec never interprets args, so a `.vsix` path containing a
// space (the app's own executable is literally "Contents/MacOS/Kira Studio", space included) is
// passed as one argument by construction — no sh, no -c, no string command line, no
// interpolation. Setpgid (not Setsid) matches gitclient/runner.go's own choice for a short-lived,
// non-interactive spawn: a group signal reaches a stray grandchild without detaching from the
// caller's own session.
//
// cmd.Cancel overrides exec.CommandContext's own default (an immediate, ungraceful
// Process.Kill() of the DIRECT CHILD ONLY) with the same group SIGTERM-then-SIGKILL sequence
// every other spawn in this codebase uses (G30 round-1 architecture/security review, finding #7):
// without it, a `code --install-extension` that forks something long-lived left the grandchild
// running and this call blocked on the inherited stderr pipe past spawnTimeout — exactly the F3
// failure gitclient/runner.go's own doc comment defends against, but this package's copy of the
// same primitive had drifted to not actually install the override.
func realRun(ctx context.Context, path string, args []string) error {
	cmd := exec.CommandContext(ctx, path, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	// Unmodified: `code`/`open` need the user's own HOME/PATH to find their own install, unlike a
	// git spawn this app has already located and can run against a scrubbed environment.
	cmd.Env = os.Environ()
	// escalate is read after cmd.Run() returns, below — G31 round-2 architecture/security review,
	// finding #11: without stopping it there, a group that exits cleanly on SIGTERM left this timer
	// armed for the full gracefulStopDelay regardless, and a SIGKILL fired at cmd.Process.Pid's
	// process group after that delay could — narrowly, but really — land on an unrelated group that
	// has since reused the same pid. No lock is needed: cmd.Run (Start+Wait) is documented to block
	// until any goroutine running Cancel has finished, which is exactly the happens-before this
	// needs.
	var escalate *time.Timer
	cmd.Cancel = func() error {
		_ = killGroup(cmd.Process.Pid, syscall.SIGTERM)
		escalate = time.AfterFunc(gracefulStopDelay, func() { _ = killGroup(cmd.Process.Pid, syscall.SIGKILL) })
		return nil
	}
	cmd.WaitDelay = gracefulStopDelay

	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	err := cmd.Run()
	if escalate != nil {
		escalate.Stop()
	}
	if err == nil {
		return nil
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return &RunError{ExitCode: exitErr.ExitCode(), Stderr: firstLineBounded(stderr.String(), maxDetailBytes)}
	}
	return err
}
