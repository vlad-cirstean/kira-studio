// Package procgroup is gitclient/ghclient/gitprepare/toolexec's own shared process-group
// termination shape (P113 G10): SIGTERM the whole group, then escalate to SIGKILL after a grace
// window if it hasn't exited by then. Every one of those packages spawns via os/exec with its own
// process group (Setsid or Setpgid) precisely so a group signal reaches whatever the direct child
// itself forked (ssh, a credential helper, a hook, a build's own child) — not just the child.
package procgroup

import (
	"errors"
	"os/exec"
	"syscall"
	"time"
)

// Kill signals pid's whole process group — the negative pid targets the group. ESRCH (no such
// process/group — already gone) is not an error: the intended outcome already holds.
func Kill(pid int, sig syscall.Signal) error {
	if err := syscall.Kill(-pid, sig); err != nil && !errors.Is(err, syscall.ESRCH) {
		return err
	}
	return nil
}

// GracefulCancel wires cmd.Cancel (and cmd.WaitDelay) to a SIGTERM-then-SIGKILL escalation: on
// cancellation, kill(pid, SIGTERM) fires immediately, and a SIGKILL follows after delay unless the
// returned stop is called first. kill is a caller-supplied seam (each package's own killGroup var)
// rather than a direct call to Kill, so a test can observe or fake the signal.
//
// stop must be called only once cmd has actually exited (Wait returning, or Close's own explicit
// kill-and-wait) — cmd.Wait is documented to block until any goroutine running Cancel has
// finished, which is exactly the happens-before this needs. Calling stop any earlier could race the
// escalation goroutine reading cmd.Process.Pid after the process (and pid) has already been reaped
// and reused by an unrelated process group.
func GracefulCancel(cmd *exec.Cmd, delay time.Duration, kill func(int, syscall.Signal) error) (stop func()) {
	var escalate *time.Timer
	cmd.Cancel = func() error {
		_ = kill(cmd.Process.Pid, syscall.SIGTERM)
		escalate = time.AfterFunc(delay, func() {
			_ = kill(cmd.Process.Pid, syscall.SIGKILL)
		})
		return nil
	}
	cmd.WaitDelay = delay
	return func() {
		if escalate != nil {
			escalate.Stop()
		}
	}
}
