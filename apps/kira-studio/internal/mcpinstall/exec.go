package mcpinstall

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

// gracefulStopDelay/spawnTimeout mirror gitclient/runner.go's own bounds (the same instinct
// gitvsix/exec.go already applied to a `code` spawn): this package's one spawn (`claude mcp add`)
// is a local, fast operation — no network round trip of its own — so a wedged child is the only
// failure mode a bound needs to guard against.
var gracefulStopDelay = 2 * time.Second

const (
	spawnTimeout = 30 * time.Second
	// maxDetailBytes bounds how much of a child's stderr this package retains for Result.Detail —
	// gitclient's own instinct that a child's stderr is untrusted text heading for a UI string,
	// applied at a far smaller scale since Detail is one line, not a diagnostic log.
	maxDetailBytes = 4096
)

// RunError is realRun's failure shape for a spawn that ran and exited non-zero — distinct from a
// spawn that could not start at all (a plain error), so Install can tell "claude refused" from
// "claude could not be launched".
type RunError struct {
	ExitCode int
	Stderr   string
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

func realLookPath(name string) (string, error)  { return exec.LookPath(name) }
func realStat(path string) (os.FileInfo, error) { return os.Stat(path) }

// killGroup signals pid's whole process group (gitclient/runner.go's own D3 convention, mirrored
// verbatim by gitvsix/exec.go for its own `code`/`open` spawns) — ESRCH (already gone) is not an
// error, every other Kill failure is.
var killGroup = func(pid int, sig syscall.Signal) error {
	if err := syscall.Kill(-pid, sig); err != nil && !errors.Is(err, syscall.ESRCH) {
		return err
	}
	return nil
}

// realRun is the argv-only spawn every Install call makes: os/exec never interprets args, so the
// header value (containing a space and, structurally, the token itself) is passed as one argument
// by construction — no sh, no -c, no string command line, no interpolation.
func realRun(ctx context.Context, path string, args []string) error {
	cmd := exec.CommandContext(ctx, path, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	// Unmodified: `claude` needs the user's own HOME/PATH to find its own config, unlike a spawn
	// this app has already fully resolved and can run against a scrubbed environment.
	cmd.Env = os.Environ()
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
