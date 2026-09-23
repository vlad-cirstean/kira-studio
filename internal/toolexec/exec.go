// Package toolexec is the argv-only, bounded-output local-tool runner mcpinstall's `claude mcp
// add` spawn and gitvsix's `code`/`open` spawns both carried verbatim (P107 T2-6): the
// SIGTERM-then-SIGKILL process-group cancellation, bounded stderr capture, and the PATH-then-
// candidates executable probe every discovery package in this codebase repeats.
package toolexec

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

// GracefulStopDelay bounds Run's own cmd.Cancel SIGTERM-then-SIGKILL escalation and cmd.WaitDelay
// — a var, not a const (gitvsix/exec_test.go's own precedent), so a test can shrink it rather than
// costing real wall-clock time.
var GracefulStopDelay = 2 * time.Second

// MaxDetailBytes bounds how much of a child's stderr a caller retains for a UI string — one line,
// not a diagnostic log.
const MaxDetailBytes = 4096

// ExecError is Run's own failure shape for a spawn that ran and exited non-zero — distinct from a
// spawn that could not start at all (a plain error), so a caller can tell "the tool refused" from
// "the tool could not be launched".
type ExecError struct {
	ExitCode int
	// Stderr is bounded to MaxDetailBytes and truncated to its first line — never the whole of a
	// child's stderr verbatim (it may itself carry a path or something a user typed).
	Stderr string
}

func (e *ExecError) Error() string {
	if e.Stderr == "" {
		return "exit " + strconv.Itoa(e.ExitCode)
	}
	return "exit " + strconv.Itoa(e.ExitCode) + ": " + e.Stderr
}

// FirstLineBounded returns s's first line, trimmed and bounded to max bytes.
func FirstLineBounded(s string, max int) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	s = strings.TrimSpace(s)
	if len(s) > max {
		s = s[:max]
	}
	return s
}

// IsExecutable reports whether path exists, is a regular file (or a symlink to one), and has at
// least one executable bit set — the same check exec.LookPath makes internally, exposed here so
// an absolute-path candidate check (one that never goes through LookPath) can make it too.
func IsExecutable(stat func(string) (os.FileInfo, error), path string) bool {
	info, err := stat(path)
	if err != nil || info.IsDir() {
		return false
	}
	return info.Mode()&0o111 != 0
}

// Locate finds name first via lookPath, then by testing each absolute candidate in order with
// stat — every path considered is recorded in probed regardless of outcome, so a miss can be
// explained, not just reported.
func Locate(lookPath func(string) (string, error), stat func(string) (os.FileInfo, error), name string, candidates []string) (path string, probed []string, found bool) {
	if resolved, err := lookPath(name); err == nil {
		probed = append(probed, resolved)
		return resolved, probed, true
	}
	probed = append(probed, name+" (on PATH)")

	for _, candidate := range candidates {
		probed = append(probed, candidate)
		if IsExecutable(stat, candidate) {
			return candidate, probed, true
		}
	}
	return "", probed, false
}

// killGroup signals pid's whole process group — ESRCH (already gone) is not an error, every other
// Kill failure is. A var, not a plain func, so a test can observe whether Run's own SIGKILL
// escalation was actually invoked.
var killGroup = func(pid int, sig syscall.Signal) error {
	if err := syscall.Kill(-pid, sig); err != nil && !errors.Is(err, syscall.ESRCH) {
		return err
	}
	return nil
}

// Run is the argv-only spawn every local tool in this codebase makes: os/exec never interprets
// args, so a path or token containing a space is passed as one argument by construction — no sh,
// no -c, no string command line, no interpolation. Setpgid (not Setsid) targets a group signal at
// a stray grandchild without detaching from the caller's own session.
//
// cmd.Cancel overrides exec.CommandContext's own default (an immediate, ungraceful
// Process.Kill() of the direct child only) with a SIGTERM-then-SIGKILL escalation: without it, a
// spawn that forked something long-lived left the grandchild running after the parent was
// killed/timed out (G30 round-1 finding #7). The escalation timer is stopped once cmd.Run()
// returns, whether that was a clean exit or the escalation itself firing (G31 round-2 finding
// #11) — otherwise a group that exits cleanly on SIGTERM left the timer armed regardless, and a
// SIGKILL fired after the full delay could land on an unrelated group that has since reused the
// same pid.
func Run(ctx context.Context, path string, args []string) error {
	cmd := exec.CommandContext(ctx, path, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	// Unmodified: a local tool needs the user's own HOME/PATH to find its own config/install,
	// unlike a spawn this app has already fully resolved and can run against a scrubbed
	// environment.
	cmd.Env = os.Environ()
	var escalate *time.Timer
	cmd.Cancel = func() error {
		_ = killGroup(cmd.Process.Pid, syscall.SIGTERM)
		escalate = time.AfterFunc(GracefulStopDelay, func() { _ = killGroup(cmd.Process.Pid, syscall.SIGKILL) })
		return nil
	}
	cmd.WaitDelay = GracefulStopDelay

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
		return &ExecError{ExitCode: exitErr.ExitCode(), Stderr: FirstLineBounded(stderr.String(), MaxDetailBytes)}
	}
	return err
}
