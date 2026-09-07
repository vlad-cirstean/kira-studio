// Package gitclient is the Go rewrite of the source project's Node `child_process`-based git
// driver (docs/v1.3/SPEC.md, "A Node → Go port of the process-spawning half"). It spawns the
// user's own `git` binary through os/exec — no bundled git, no native bindings — and owns every
// process this app runs against a repository. Zero I/O beyond os/exec and the filesystem, zero
// Wails dependency: bridge/git.go is the thin adapter that turns this package's plain Go types
// into bound-service and stream responses.
package gitclient

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"sync"
	"syscall"
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
	// ReadOnly appends --no-optional-locks: a read that never blocks on — or trips — a concurrent
	// write's lock. Never set for a command that itself writes (a future phase's checkout/reset/
	// stash), which needs the lock.
	ReadOnly bool
	// Stdin requests a writable stdin pipe on the returned Process (G2 §10's handed-forward seam;
	// G3's gitclient/catfile is its first caller — a persistent `cat-file --batch[-check]` process
	// is driven by writing one revision per line). False (the default) leaves stdin closed, exactly
	// as every G1/G2 spawn already behaves.
	Stdin bool
}

// Result is the raw outcome of one Spec — no interpretation of Stdout/Stderr's bytes at all
// (that is G3's porcelain-parsing job, explicitly out of scope here).
type Result struct {
	Stdout   []byte
	Stderr   []byte
	ExitCode int
}

// gracefulStopDelay bounds every graceful-stop window this package uses (G2 plan D3): on
// cancellation or explicit Close, the process group is sent SIGTERM and given this long to exit
// before escalating to SIGKILL — long enough for git to unwind an in-progress write cleanly, short
// enough that a Stop button or a window close is never left waiting on a hung child indefinitely.
// Matches this repo's own precedent (internal/preconnect/supervisor.go's killGrace) and upstream's
// SIGKILL_GRACE_MS.
const gracefulStopDelay = 2 * time.Second

// maxStderrBytes/stderrTruncationMarker bound how much of a child's stderr this package retains
// (G2 plan D4) — stderr is attacker-adjacent (a pre-push hook, a remote's message) and lands in an
// error message, so it is capped rather than trusted to be small the way a normal command's stdout
// is not (D4: stdout is never capped here, only stderr).
const maxStderrBytes = 1 << 20

const stderrTruncationMarker = "\n…[stderr truncated]"

// configOverrides are `-c` overrides applied to every spawn, first in argv, ahead of the caller's
// own subcommand (G2 plan D2):
//   - core.quotepath=false — non-ASCII paths as UTF-8 bytes, not octal escapes.
//   - color.ui=false — a user's color.ui=always must not inject ANSI escapes into output this
//     app parses.
//   - log.showSignature=false — nor log.showSignature=true inject PGP blocks into `git log`'s
//     record framing.
//   - i18n.logOutputEncoding=UTF-8 — commit text arrives in a known encoding, not the repo's own
//     configured (and possibly unset) one.
var configOverrides = []string{
	"-c", "core.quotepath=false",
	"-c", "color.ui=false",
	"-c", "log.showSignature=false",
	"-c", "i18n.logOutputEncoding=UTF-8",
}

// hygieneEnv is the fixed environment every spawned git process gets, appended onto the parent's
// own os.Environ() rather than replacing it (git still needs HOME, PATH, SSH_AUTH_SOCK, etc.) —
// later entries win on a duplicate key, which is how these override anything already set:
//   - GIT_TERMINAL_PROMPT=0 — git must never block this app waiting on an interactive credential
//     prompt in a terminal that does not exist.
//   - GIT_OPTIONAL_LOCKS=0 — belt-and-suspenders alongside the --no-optional-locks argv flag
//     (Spec.ReadOnly): some git subcommands only honour the env var, not the flag.
//   - GIT_PAGER=cat — paired with --no-pager in buildArgv; some git plumbing still consults
//     GIT_PAGER directly.
//   - GIT_EDITOR=true — no interactive editor exists here; without this, an operation like
//     `merge --continue` blocks forever and leaves MERGE_HEAD in place (a later phase's problem to
//     avoid, not this one's to introduce).
//   - LC_ALL=C — already load-bearing in this phase: errors.go classifies stderr by English
//     substring match, and this is what guarantees git's own messages are in English regardless of
//     the machine's locale. LC_ALL also overrides LANG/LC_MESSAGES per POSIX, so nothing else needs
//     unsetting.
var hygieneEnv = []string{
	"GIT_TERMINAL_PROMPT=0",
	"GIT_OPTIONAL_LOCKS=0",
	"GIT_PAGER=cat",
	"GIT_EDITOR=true",
	"LC_ALL=C",
}

// buildEnv returns the process environment for one spawn — os.Environ() (real inherited
// environment) is not read directly by tests, which pass their own base instead (see
// runner_test.go), keeping this pure and independent of the machine it runs on.
func buildEnv(base []string) []string {
	env := make([]string, 0, len(base)+len(hygieneEnv))
	env = append(env, base...)
	env = append(env, hygieneEnv...)
	return env
}

// buildArgv assembles the full argument list passed to the git binary: configOverrides always
// come first, then --no-pager (always — a pager that doesn't exist must never be invoked),
// --no-optional-locks for a read, then the caller's own subcommand and arguments.
func buildArgv(spec Spec) []string {
	argv := make([]string, 0, len(configOverrides)+len(spec.Args)+2)
	argv = append(argv, configOverrides...)
	argv = append(argv, "--no-pager")
	if spec.ReadOnly {
		argv = append(argv, "--no-optional-locks")
	}
	argv = append(argv, spec.Args...)
	return argv
}

// Process is one running git child. Every method is safe to call from the goroutine that started
// it; Stdout may be read from another.
type Process interface {
	// Stdout is the child's stdout pipe. It reaches EOF once every process holding the write end
	// closes it — which, because the child runs in its own process group (D3) and Cancel/Close
	// signal that whole group, is not delayed forever by a grandchild that outlives the direct
	// child.
	Stdout() io.ReadCloser
	// Stdin is the child's stdin pipe — nil unless Spec.Stdin was set. Closing it (or the caller's
	// own Close) is what lets a persistent process (git's own read loop) notice EOF and exit
	// cleanly; a caller that never sets Spec.Stdin never needs to look at this at all.
	Stdin() io.WriteCloser
	// Wait blocks until the child has exited and its stderr has been fully drained, then reports
	// the outcome. Result.Stdout is always nil: the caller owns that pipe. Calling Wait without
	// having read Stdout to EOF can block until the child's own write blocks and the context or
	// Close intervenes — the same constraint upstream's GitRead.done documents.
	Wait() (Result, error)
	// Close stops the child if it is still running (D3's group SIGTERM, escalating to SIGKILL
	// after gracefulStopDelay), closes Stdout, and waits. Idempotent; safe after Wait.
	Close() error
}

// Runner is the spawn seam. One method, because there is exactly one spawn path (a buffered read
// is a streaming read drained immediately by Run, below, never a second implementation that could
// be missing part of the hygiene above).
type Runner interface {
	Start(ctx context.Context, gitPath string, spec Spec) (Process, error)
}

// Run starts spec, drains stdout to completion and waits — the buffered shape most callers in this
// package use. It is a function, not a Runner method, precisely so a fake Runner cannot supply a
// buffered path that disagrees with its streaming one. err is non-nil only when the process could
// not be started or reaped at all; a non-zero exit is reported through Result.ExitCode, exactly the
// shape errors.go's Classify expects.
func Run(ctx context.Context, r Runner, gitPath string, spec Spec) (Result, error) {
	p, err := r.Start(ctx, gitPath, spec)
	if err != nil {
		return Result{}, err
	}
	stdout, readErr := io.ReadAll(p.Stdout())
	res, waitErr := p.Wait()
	if waitErr != nil {
		return Result{}, waitErr
	}
	if readErr != nil {
		return Result{}, readErr
	}
	res.Stdout = stdout
	return res, nil
}

// killGroup signals pid's whole process group — the negative pid targets the group (D3), which is
// what reaches a grandchild (ssh, a credential helper, a hook) the direct child spawned, not just
// the direct child itself. ESRCH (no such process/group — already gone) is not an error: the
// intended outcome already holds.
func killGroup(pid int, sig syscall.Signal) error {
	if err := syscall.Kill(-pid, sig); err != nil && !errors.Is(err, syscall.ESRCH) {
		return err
	}
	return nil
}

// execRunner is the one real Runner: os/exec, nothing else. Stateless — the resolved git path is
// passed per call rather than fixed at construction, so a single instance survives a git.path
// setting change or a discovery re-probe with nothing to reconstruct.
type execRunner struct{}

// NewExecRunner returns the real, os/exec-backed Runner.
func NewExecRunner() Runner { return execRunner{} }

func (execRunner) Start(ctx context.Context, gitPath string, spec Spec) (Process, error) {
	cmd := exec.CommandContext(ctx, gitPath, buildArgv(spec)...)
	cmd.Dir = spec.Dir
	cmd.Env = buildEnv(os.Environ())
	// D3: every git child gets its own process group, so a group signal reaches whatever it
	// forked (git fetch/push spawn ssh, git-remote-https, credential helpers).
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	// Replaces exec.CommandContext's default Cancel (an immediate, ungraceful Process.Kill()) with
	// a group SIGTERM, escalating to a group SIGKILL after gracefulStopDelay if the group hasn't
	// exited by then. This — not cmd.WaitDelay's own escalation, which reaches only the direct
	// child and never the pipes obtained via *Pipe() below — is what actually unblocks a Stdout
	// reader parked behind a grandchild that outlived git itself (F3): only a group-wide kill
	// reaches that grandchild and lets it close its own copy of the pipe.
	cmd.Cancel = func() error {
		_ = killGroup(cmd.Process.Pid, syscall.SIGTERM)
		time.AfterFunc(gracefulStopDelay, func() {
			_ = killGroup(cmd.Process.Pid, syscall.SIGKILL)
		})
		return nil
	}
	cmd.WaitDelay = gracefulStopDelay

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return nil, err
	}
	var stdin io.WriteCloser
	if spec.Stdin {
		stdin, err = cmd.StdinPipe()
		if err != nil {
			return nil, err
		}
	}

	if err := cmd.Start(); err != nil {
		return nil, err
	}

	p := &execProcess{cmd: cmd, stdout: stdout, stdin: stdin, stderr: &boundedWriter{max: maxStderrBytes}, stderrDone: make(chan struct{})}
	go p.drainStderr(stderrPipe)
	return p, nil
}

// boundedWriter caps how many bytes it retains, appending stderrTruncationMarker once the cap is
// reached and silently discarding the rest (D4). Not safe for concurrent use — the stderr-drain
// goroutine is its only writer, and its buffer is only ever read after that goroutine has finished
// (execProcess.stderrDone), so no lock is needed.
type boundedWriter struct {
	buf bytes.Buffer
	max int
}

func (w *boundedWriter) Write(p []byte) (int, error) {
	n := len(p)
	remaining := w.max - w.buf.Len()
	switch {
	case remaining <= 0:
		// Already at (or past) the cap from an earlier write — the marker was appended then;
		// nothing more to do.
	case len(p) > remaining:
		w.buf.Write(p[:remaining])
		w.buf.WriteString(stderrTruncationMarker)
	default:
		w.buf.Write(p)
	}
	return n, nil
}

// execProcess is the one real Process. cmd.Wait() is called at most once, guarded by waitOnce, so
// Process.Wait and Process.Close (both of which need the child reaped) can never race Go's own
// "Wait was already called" panic path.
type execProcess struct {
	cmd    *exec.Cmd
	stdout io.ReadCloser
	stdin  io.WriteCloser
	stderr *boundedWriter

	stderrDone chan struct{}

	waitOnce   sync.Once
	waitResult Result
	waitErr    error

	closeOnce sync.Once
}

func (p *execProcess) Stdout() io.ReadCloser { return p.stdout }
func (p *execProcess) Stdin() io.WriteCloser { return p.stdin }

func (p *execProcess) drainStderr(r io.Reader) {
	_, _ = io.Copy(p.stderr, r)
	close(p.stderrDone)
}

func (p *execProcess) reap() {
	// stderr must be fully drained before Wait reaps the process (internal/preconnect/
	// supervisor.go's own ordering) — reaping first can race the drain goroutine's last read and
	// truncate the message a classified failure needs.
	<-p.stderrDone
	err := p.cmd.Wait()
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			p.waitResult = Result{Stderr: p.stderr.buf.Bytes(), ExitCode: exitErr.ExitCode()}
			return
		}
		// Could not even start, or a genuine reap failure — no exit code to report.
		p.waitErr = err
		return
	}
	p.waitResult = Result{Stderr: p.stderr.buf.Bytes(), ExitCode: 0}
}

func (p *execProcess) Wait() (Result, error) {
	p.waitOnce.Do(p.reap)
	return p.waitResult, p.waitErr
}

func (p *execProcess) Close() error {
	p.closeOnce.Do(func() {
		// Closing Stdout first unblocks a concurrent reader immediately, independent of how long
		// the kill below takes to land.
		_ = p.stdout.Close()
		if p.stdin != nil {
			_ = p.stdin.Close()
		}
		if p.cmd.Process != nil {
			_ = killGroup(p.cmd.Process.Pid, syscall.SIGTERM)
			escalate := time.AfterFunc(gracefulStopDelay, func() {
				_ = killGroup(p.cmd.Process.Pid, syscall.SIGKILL)
			})
			_, _ = p.Wait()
			escalate.Stop()
		}
	})
	return nil
}
