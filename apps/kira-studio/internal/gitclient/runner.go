// Package gitclient is the Go rewrite of the source project's Node `child_process`-based git
// driver (docs/v1.3/SPEC.md, "A Node → Go port of the process-spawning half"). It spawns the
// user's own `git` binary through os/exec — no bundled git, no native bindings — and owns every
// process this app runs against a repository. Zero I/O beyond os/exec and the filesystem, zero
// Wails dependency (D1): bridge/git.go is the thin adapter that turns this package's plain Go
// types into bound-service and stream responses.
package gitclient

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"time"
)

// Spec is one git invocation, deliberately narrow: Args never includes "git" itself (Runner owns
// the binary path), and there is no shell anywhere in this path — os/exec.CommandContext never
// interprets Args, so argv injection through a malformed ref name or path is structurally not a
// concern here the way it would be if this shelled out through /bin/sh -c.
type Spec struct {
	// Dir is the working directory the command runs in — a repository's root or git-dir,
	// depending on what the caller is asking. Required; a caller with no repository yet (pure
	// discovery) runs from "" (Wails' own default: os.Getwd() at process start).
	Dir string
	// Args is the subcommand and its own arguments — e.g. []string{"rev-parse", "--is-bare-repository"}.
	Args []string
	// ReadOnly appends --no-optional-locks (P1's own env-hygiene requirement, docs/v1.3/SPEC.md's
	// P1 row): a read that never blocks on — or trips — a concurrent write's lock. Never set for
	// a command that itself writes (a future phase's checkout/reset/stash), which needs the lock.
	ReadOnly bool
}

// Result is the raw outcome of one Spec — no interpretation of Stdout/Stderr's bytes at all
// (that is P2's porcelain-parsing job, explicitly out of scope here, §0.2).
type Result struct {
	Stdout   []byte
	Stderr   []byte
	ExitCode int
}

// Runner is D2's spawn seam: gitclient depends on this interface, never on os/exec directly, so
// discovery/spawn-hygiene/error-classification are unit-testable against a fake with no real git
// binary anywhere on the test machine.
type Runner interface {
	// Run executes gitPath with spec's args, returning once the process exits or ctx is done.
	// A non-zero exit is not itself a Go error — Result.ExitCode carries it, exactly the shape
	// errors.go's Classify expects to receive. err is non-nil only when the process could not be
	// run or reaped at all (binary missing, permission denied, ctx cancelled/deadline before
	// start) — Classify still has an opinion on those (KindCancelled/KindTimeout), so Run reports
	// them as (Result{}, err) rather than swallowing the distinction.
	Run(ctx context.Context, gitPath string, spec Spec) (Result, error)
}

// gracefulStopDelay is Cmd.WaitDelay (F5): on cancellation, os/exec sends the graceful signal
// Cmd.Cancel defines and gives the process this long to exit before escalating to SIGKILL — long
// enough for git to unwind an in-progress write cleanly, short enough that a Stop button or a
// window close is never left waiting on a hung child indefinitely.
const gracefulStopDelay = 2 * time.Second

// hygieneEnv is the fixed environment every spawned git process gets, appended onto the parent's
// own os.Environ() rather than replacing it (git still needs HOME, PATH, SSH_AUTH_SOCK, etc.) —
// later entries win on a duplicate key, which is how these two override anything already set:
//   - GIT_TERMINAL_PROMPT=0 — git must never block this app waiting on an interactive credential
//     prompt in a terminal that does not exist.
//   - GIT_OPTIONAL_LOCKS=0 — belt-and-suspenders alongside the --no-optional-locks argv flag
//     (ReadOnly above): some git subcommands only honour the env var, not the flag.
var hygieneEnv = []string{"GIT_TERMINAL_PROMPT=0", "GIT_OPTIONAL_LOCKS=0"}

// buildEnv returns the process environment for one spawn — os.Environ() (real inherited
// environment) is not read directly by tests, which pass their own base instead (see
// runner_test.go), keeping this pure and independent of the machine it runs on.
func buildEnv(base []string) []string {
	env := make([]string, 0, len(base)+len(hygieneEnv))
	env = append(env, base...)
	env = append(env, hygieneEnv...)
	return env
}

// buildArgv assembles the full argument list passed to the git binary: -c core.quotepath=false
// always comes first (P1's own env-hygiene requirement — a path with non-ASCII bytes must not be
// octal-escaped in output this app might one day parse), then --no-optional-locks for a read,
// then the caller's own subcommand and arguments.
func buildArgv(spec Spec) []string {
	argv := make([]string, 0, len(spec.Args)+3)
	argv = append(argv, "-c", "core.quotepath=false")
	if spec.ReadOnly {
		argv = append(argv, "--no-optional-locks")
	}
	argv = append(argv, spec.Args...)
	return argv
}

// execRunner is the one real Runner: os/exec, nothing else. Stateless — the resolved git path is
// passed per call rather than fixed at construction, so a single instance survives a git.path
// setting change or a discovery re-probe with nothing to reconstruct.
type execRunner struct{}

// NewExecRunner returns the real, os/exec-backed Runner.
func NewExecRunner() Runner { return execRunner{} }

func (execRunner) Run(ctx context.Context, gitPath string, spec Spec) (Result, error) {
	cmd := exec.CommandContext(ctx, gitPath, buildArgv(spec)...)
	cmd.Dir = spec.Dir
	cmd.Env = buildEnv(os.Environ())
	// F5 (plan §2 Findings): graceful-then-forceful stop on cancellation, not an immediate kill —
	// exec.CommandContext's own default (SIGKILL the instant ctx is done) can leave an
	// in-progress write half-applied. Cancel here just requests the OS default graceful signal
	// (SIGKILL is still what Cancel does absent an override on this platform's exec.Cmd, but the
	// explicit WaitDelay below is what actually buys the grace period regardless).
	cmd.WaitDelay = gracefulStopDelay

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	runErr := cmd.Run()
	if runErr != nil {
		var exitErr *exec.ExitError
		if errors.As(runErr, &exitErr) {
			// A non-zero exit is a successful spawn+reap — not a Go error (see Runner.Run's own
			// doc comment) — so it is reported through Result, not err.
			return Result{Stdout: stdout.Bytes(), Stderr: stderr.Bytes(), ExitCode: exitErr.ExitCode()}, nil
		}
		// Could not even start (binary missing, not executable, ctx already done) — no exit code
		// to report, so Classify must work from runErr/ctx.Err() alone (errors.go).
		return Result{}, runErr
	}
	return Result{Stdout: stdout.Bytes(), Stderr: stderr.Bytes(), ExitCode: 0}, nil
}
