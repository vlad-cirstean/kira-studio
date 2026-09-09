package ghclient

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"syscall"
	"time"
)

// versionProbeTimeout/authProbeTimeout/apiTimeout are D2's three named timeouts — every spawn this
// package makes uses exactly one of them, never an undeadlined caller ctx alone (the same reasoning
// gitclient/discovery.go's own versionProbeTimeout documents: a wedged `gh` must not hang whatever
// asked for a Status forever).
const (
	versionProbeTimeout = 5 * time.Second
	authProbeTimeout    = 10 * time.Second
	apiTimeout          = 10 * time.Second
)

// maxStdoutBytes/maxStderrBytes bound how much of a child's output this package retains (D2) —
// stdout is a JSON body from GitHub itself, capped generously since a real answer is never anywhere
// near this large; stderr is `gh`'s own diagnostic text, capped the same as gitclient's own stderr
// cap.
const (
	maxStdoutBytes = 4 << 20
	maxStderrBytes = 1 << 20
)

// ghHygieneEnv is D2's exact table, appended after os.Environ() (later entries win on a duplicate
// key):
//   - GH_PROMPT_DISABLED=1 — gh must never block on an interactive prompt.
//   - GH_NO_UPDATE_NOTIFIER=1 — suppresses gh's own background release-check network call.
//   - GH_PAGER=, PAGER=cat — the --no-pager equivalent; gh has no --no-pager flag of its own.
//   - NO_COLOR=1, CLICOLOR=0 — no ANSI escapes in output this package parses as JSON/plain text.
//   - GH_REPO= — cleared always: an inherited GH_REPO would silently retarget every `gh api` call
//     away from the --hostname/path this package explicitly builds.
//   - GIT_TERMINAL_PROMPT=0 — gh shells out to git on some code paths (e.g. credential checks).
//   - LC_ALL=C — errors.go classifies by English substring match, exactly like gitclient's own
//     hygieneEnv comment for the identical reason.
//
// Deliberately NOT here, and never anywhere else in this package: GH_TOKEN, GITHUB_TOKEN. Both are
// inherited exactly as the calling process's own environment already has them (os.Environ(), below)
// — never read, overridden, cleared, or logged. This is the literal implementation of "own no
// credentials of any kind" (SPEC §3.5).
var ghHygieneEnv = []string{
	"GH_PROMPT_DISABLED=1",
	"GH_NO_UPDATE_NOTIFIER=1",
	"GH_PAGER=",
	"PAGER=cat",
	"NO_COLOR=1",
	"CLICOLOR=0",
	"GH_REPO=",
	"GIT_TERMINAL_PROMPT=0",
	"LC_ALL=C",
}

func buildEnv(base []string) []string {
	env := make([]string, 0, len(base)+len(ghHygieneEnv))
	env = append(env, base...)
	env = append(env, ghHygieneEnv...)
	return env
}

// Spec is one `gh` invocation. Args never includes "gh" itself (Runner owns the binary path); no
// shell is ever involved (os/exec.CommandContext never interprets Args).
type Spec struct {
	Args    []string
	Timeout time.Duration
}

// Result is the raw outcome of one Spec — Classify (errors.go) is what interprets it.
type Result struct {
	Stdout   []byte
	Stderr   []byte
	ExitCode int
}

// Runner is the spawn seam — one buffered method, unlike gitclient.Runner's own streaming
// Start/Process split: every `gh` call this package makes is small (a version string, an auth
// status line, a JSON body under a few MiB) and none is long-running, so there is no case here that
// needs a streaming Process the way gitclient's `log`/`diff` walks do.
type Runner interface {
	Run(ctx context.Context, ghPath string, spec Spec) (Result, error)
}

// NewExecRunner returns the real, os/exec-backed Runner.
func NewExecRunner() Runner { return execRunner{} }

type execRunner struct{}

// gracefulStopDelay mirrors gitclient/runner.go's own constant of the same name and purpose: on
// cancellation, the child's process group is sent SIGTERM and given this long to exit before
// escalating to SIGKILL.
const gracefulStopDelay = 2 * time.Second

func killGroup(pid int, sig syscall.Signal) error {
	if err := syscall.Kill(-pid, sig); err != nil && !errors.Is(err, syscall.ESRCH) {
		return err
	}
	return nil
}

func (execRunner) Run(ctx context.Context, ghPath string, spec Spec) (Result, error) {
	timeout := spec.Timeout
	if timeout <= 0 {
		timeout = apiTimeout
	}
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	cmd := exec.CommandContext(runCtx, ghPath, spec.Args...)
	cmd.Env = buildEnv(os.Environ())
	// Own process group (F5's own discipline, mirroring gitclient/runner.go:230): a group signal
	// reaches whatever `gh` itself forks, not just the direct child.
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error {
		_ = killGroup(cmd.Process.Pid, syscall.SIGTERM)
		time.AfterFunc(gracefulStopDelay, func() {
			_ = killGroup(cmd.Process.Pid, syscall.SIGKILL)
		})
		return nil
	}
	cmd.WaitDelay = gracefulStopDelay

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	runErr := cmd.Run()

	// runCtx's own deadline (spec.Timeout) or the caller's outer ctx being cancelled is reported as
	// a genuine error — never folded into Result.ExitCode — exactly mirroring
	// gitclient/discovery.go's own probeCtx.Err() check: the caller (discovery.go/api.go here) is
	// what turns this into D5's own "did not respond within Ns" notFound classification.
	if runCtx.Err() != nil {
		return Result{}, runCtx.Err()
	}

	stdoutBytes := stdout.Bytes()
	if len(stdoutBytes) > maxStdoutBytes {
		stdoutBytes = stdoutBytes[:maxStdoutBytes]
	}
	stderrBytes := stderr.Bytes()
	if len(stderrBytes) > maxStderrBytes {
		stderrBytes = stderrBytes[:maxStderrBytes]
	}

	if runErr != nil {
		var exitErr *exec.ExitError
		if errors.As(runErr, &exitErr) {
			return Result{Stdout: stdoutBytes, Stderr: stderrBytes, ExitCode: exitErr.ExitCode()}, nil
		}
		// Could not even start, or a genuine reap failure — no exit code to report.
		return Result{}, runErr
	}
	return Result{Stdout: stdoutBytes, Stderr: stderrBytes, ExitCode: 0}, nil
}
