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
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/kirathecat/kira-studio/internal/procgroup"
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
	// Env is appended AFTER hygieneEnv (G7 D5), so a spec's own entry wins on a duplicate key — the
	// askpass broker's only caller: GIT_ASKPASS/SSH_ASKPASS, SSH_ASKPASS_REQUIRE and the broker's
	// own session/op tokens. Every other caller leaves this nil and is byte-for-byte unaffected.
	Env []string
	// OnStderr is called with each stderr chunk as it arrives, from the drain goroutine, BEFORE the
	// chunk is appended to the bounded buffer Wait() reports (G7 D5) — one read, two consumers,
	// never a second reader that could disagree with the buffer classification depends on. Never
	// called after Wait returns. A panic in it would take the drain goroutine down, so gitops' own
	// progress pump is written not to panic; nothing else is defended here.
	OnStderr func([]byte)
	// Setsid opts one spawn into a new session: the child loses any controlling terminal, which
	// closes the one remaining no-hang gap `GIT_TERMINAL_PROMPT=0` does not — ssh reads a
	// passphrase straight from /dev/tty when one exists (consulting SSH_ASKPASS only when it does
	// not), and so does gpg's pinentry for a commit-signing passphrase, or a custom merge driver
	// writing to a tty. G7 D6 opted in every remote-op spawn; G8 D6 extends this to every LOCAL
	// WRITE spawn too (op.run's ten kinds, undo.run's replays, pull's integrate phase) — a write can
	// invoke exactly the same interactive helpers a remote op can, and a hang there blocks
	// Repo.Write, which blocks every read in every window sharing the repository (G7 F8), the worst
	// blocking outcome in the whole concurrency model. Every READ spawn (log, diff, status,
	// cat-file, rev-parse, for-each-ref) stays on Setpgid — a read cannot trigger an interactive
	// prompt, so it is safe by construction and untouched since G2.
	Setsid bool
	// buffered is Run's own private signal to Start (F5, unexported — never set by a caller of
	// Run, which is the only place that sets it): give cmd.Stdout/cmd.Stderr a plain io.Writer
	// directly rather than StdoutPipe()/StderrPipe(). Go's os/exec spins its own internal copy
	// goroutine only for the direct-Writer form, and WaitDelay can force-close ITS OWN pipe once
	// the child has exited even if a grandchild (a hook's `cmd &` inheriting stdout/stderr) still
	// holds the write end open — a *Pipe()-obtained reader gets no such rescue (verified against
	// Go 1.27's os/exec), which is what left Run blocked forever reading to EOF that never comes.
	// A genuinely streaming caller (logsession, gitsearch, catfile) needs the incremental *Pipe()
	// form and leaves this false.
	buffered bool
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
//
// A var, not a const (mirrors internal/preconnect/supervisor.go's own killGrace/settleWindow
// precedent, P55 §2 D9): runner_test.go lowers it so a G31 round-2 architecture/security review
// finding #11 regression test — proving cmd.Cancel's escalation timer is actually stopped once the
// process exits cleanly, not left armed toward a SIGKILL nothing needs — doesn't cost 2s of real
// wall-clock time.
var gracefulStopDelay = 2 * time.Second

// maxStderrBytes/stderrTruncationMarker bound how much of a child's stderr this package retains
// (G2 plan D4) — stderr is attacker-adjacent (a pre-push hook, a remote's message) and lands in an
// error message, so it is capped rather than trusted to be small the way a normal command's stdout
// is not (D4: stdout is never capped here, only stderr).
const maxStderrBytes = 1 << 20

const stderrTruncationMarker = "\n…[stderr truncated]"

// configOverrides are `-c` overrides applied to every spawn, first in argv, ahead of the caller's
// own subcommand (G2 plan D2):
//   - core.quotepath=false — non-ASCII paths as UTF-8 bytes, not octal escapes.
//   - core.precomposeunicode=true — G27 D3: makes git precompose the names it reads from
//     `readdir` (the only place git's own output can disagree with itself about a repository-
//     relative path, G27 F3), so `status`'s untracked/ignored entries agree with the index/tree
//     inside one command's output. This is a restatement of the value git itself writes into
//     `.git/config` at `init`/`clone` on macOS for essentially every repository (G27 M3), and is
//     accepted without error by a git built without PRECOMPOSE_UNICODE support (G27 P2), so it is
//     safe on every platform this app runs on.
//   - color.ui=false — a user's color.ui=always must not inject ANSI escapes into output this
//     app parses.
//   - log.showSignature=false — nor log.showSignature=true inject PGP blocks into `git log`'s
//     record framing.
//   - i18n.logOutputEncoding=UTF-8 — commit text arrives in a known encoding, not the repo's own
//     configured (and possibly unset) one.
//   - diff.suppressBlankEmpty=false (F3 Part 14 review F4) — a user's own diff.suppressBlankEmpty=
//     true (verified against real git 2.43) makes `diff-tree -p`/`diff` print a bare empty line
//     (no leading " ") for a blank CONTEXT line inside a hunk, instead of the single space every
//     unified-diff context line otherwise starts with — porcelain/diff.go's parseOneHunk rejects
//     that as "empty content line inside a hunk", breaking every commit file diff, drift re-map
//     and review diff whose hunk happens to contain a blank context line. Explicit override, not
//     just defense-in-depth on the parser side, since a differently-configured git could still
//     reach this parser some other way (a future direct-git-binary path, a test harness).
var configOverrides = []string{
	"-c", "core.quotepath=false",
	"-c", "core.precomposeunicode=true", // G27 D3
	"-c", "color.ui=false",
	"-c", "log.showSignature=false",
	"-c", "i18n.logOutputEncoding=UTF-8",
	"-c", "diff.suppressBlankEmpty=false",
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

// gitRedirectEnvKeys (F16) retarget every git spawn to a DIFFERENT repository regardless of
// Spec.Dir when inherited from this process's own parent (a wrapper script, an IDE task runner):
// GIT_DIR/GIT_WORK_TREE point git at a whole different repo/worktree; GIT_INDEX_FILE, GIT_OBJECT_
// DIRECTORY and GIT_COMMON_DIR retarget the index/object store/shared dir of whatever repo IS
// used; GIT_NAMESPACE silently prefixes every ref this app reads or writes. Stripped from the base
// environment before spawning (not merely overridden with an empty value — git does not treat an
// empty GIT_DIR the same as unset) — the same precaution ghclient's own GH_REPO= clear takes for
// `gh api`, applied by removal here since these can't be safely neutralised with an empty value.
var gitRedirectEnvKeys = []string{
	"GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_COMMON_DIR", "GIT_NAMESPACE",
}

// stripEnvKeys returns base with every "KEY=value" entry whose KEY is in keys removed, preserving
// the relative order of everything else.
func stripEnvKeys(base []string, keys []string) []string {
	out := make([]string, 0, len(base))
	for _, kv := range base {
		key, _, _ := strings.Cut(kv, "=")
		stripped := false
		for _, k := range keys {
			if key == k {
				stripped = true
				break
			}
		}
		if !stripped {
			out = append(out, kv)
		}
	}
	return out
}

// buildEnv returns the process environment for one spawn — os.Environ() (real inherited
// environment) is not read directly by tests, which pass their own base instead (see
// runner_test.go), keeping this pure and independent of the machine it runs on. base is stripped
// of gitRedirectEnvKeys first (F16) — before hygieneEnv and extra are appended, so neither could
// ever reintroduce one of them by accident. extra (G7 D5) is appended last, so a spec's own entry
// wins over hygieneEnv on a duplicate key — the askpass broker's own GIT_ASKPASS/SSH_ASKPASS/
// tokens are the one caller today.
func buildEnv(base []string, extra []string) []string {
	base = stripEnvKeys(base, gitRedirectEnvKeys)
	env := make([]string, 0, len(base)+len(hygieneEnv)+len(extra))
	env = append(env, base...)
	env = append(env, hygieneEnv...)
	env = append(env, extra...)
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

// Run starts spec, captures stdout/stderr to completion and waits — the buffered shape most
// callers in this package use. It is a function, not a Runner method, precisely so a fake Runner
// cannot supply a buffered path that disagrees with its streaming one. err is non-nil only when
// the process could not be started or reaped at all; a non-zero exit is reported through
// Result.ExitCode, exactly the shape errors.go's Classify expects.
//
// F5: sets spec.buffered so Start gives cmd.Stdout/cmd.Stderr a direct io.Writer instead of
// *Pipe() — see Spec.buffered's own doc comment for why that is what lets WaitDelay actually
// unblock this call against a hook's background process inheriting stdout/stderr, rather than
// leaving Run blocked reading to an EOF a live grandchild can hold off forever.
func Run(ctx context.Context, r Runner, gitPath string, spec Spec) (Result, error) {
	spec.buffered = true
	p, err := r.Start(ctx, gitPath, spec)
	if err != nil {
		return Result{}, err
	}
	res, waitErr := p.Wait()
	if waitErr != nil {
		return Result{}, waitErr
	}
	return res, nil
}

// killGroup signals pid's whole process group — the negative pid targets the group (D3), which is
// what reaches a grandchild (ssh, a credential helper, a hook) the direct child spawned, not just
// the direct child itself. ESRCH (no such process/group — already gone) is not an error: the
// intended outcome already holds.
//
// A var, not a plain func (internal/preconnect/supervisor.go's own killSignal is this codebase's
// precedent for the pattern) so a test can observe whether cmd.Cancel's SIGKILL escalation was
// actually invoked — proving a stopped timer, not merely inferring it from a real pid-reuse
// scenario, which isn't reproducible on demand.
var killGroup = procgroup.Kill

// killAndWait is execProcess.Close/bufferedExecProcess.Close's own shared shape (P113 G10): send a
// group SIGTERM, arm a SIGKILL escalation, wait for the process to actually exit, then disarm the
// timer. Unlike cmd.Cancel's own escalation (wired once, at Start, for a ctx-driven cancellation),
// this is a second, explicit kill path a caller triggers directly by calling Close — so it arms its
// own separate timer rather than reusing stopEscalate/cmd.Cancel's.
func killAndWait(pid int, wait func()) {
	_ = killGroup(pid, syscall.SIGTERM)
	escalate := time.AfterFunc(gracefulStopDelay, func() {
		_ = killGroup(pid, syscall.SIGKILL)
	})
	wait()
	escalate.Stop()
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
	cmd.Env = buildEnv(os.Environ(), spec.Env)
	// D3: every git child gets its own process group, so a group signal reaches whatever it
	// forked (git fetch/push spawn ssh, git-remote-https, credential helpers). Setsid (G7 D6 for
	// remote ops, G8 D6 for local writes too) additionally detaches the child from any controlling
	// terminal — pgid == pid either way, so killGroup(-pid, …) is unaffected by which one a spawn
	// asked for.
	if spec.Setsid {
		cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	} else {
		cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	}
	// Replaces exec.CommandContext's default Cancel (an immediate, ungraceful Process.Kill()) with
	// a group SIGTERM, escalating to a group SIGKILL after gracefulStopDelay if the group hasn't
	// exited by then. This — not cmd.WaitDelay's own escalation, which reaches only the direct
	// child and never the pipes obtained via *Pipe() below — is what actually unblocks a Stdout
	// reader parked behind a grandchild that outlived git itself (F3): only a group-wide kill
	// reaches that grandchild and lets it close its own copy of the pipe.
	//
	// stopEscalate is read by execProcess.reap, below, once cmd.Wait has returned — G31 round-2
	// architecture/security review, finding #11: without stopping it there, a group that exits
	// cleanly on SIGTERM (the overwhelmingly common case) still left this timer armed for the full
	// gracefulStopDelay, each one a live goroutine referencing this cmd, and — narrower but
	// real — a SIGKILL fired at cmd.Process.Pid's process GROUP after that delay could land on an
	// unrelated group that has since reused the same pid. Calling stopEscalate only after cmd.Wait
	// returns is safe with no lock: Wait is documented to block until any goroutine running Cancel
	// has finished, which is exactly the happens-before this needs (execProcess.Close, just below,
	// already relies on the identical guarantee for its own, separately-armed escalate timer).
	stopEscalate := procgroup.GracefulCancel(cmd, gracefulStopDelay, killGroup)

	if spec.buffered {
		return startBuffered(cmd, spec, stopEscalate)
	}
	return startStreaming(cmd, spec, stopEscalate)
}

// startStreaming is Start's own non-buffered path: cmd.Stdout/cmd.Stderr are left unset and the
// caller reads through *Pipe() instead, for a genuinely incremental/paused reader (logsession,
// gitsearch, catfile) that must not buffer a whole command's output in memory up front.
func startStreaming(cmd *exec.Cmd, spec Spec, stopEscalate func()) (Process, error) {
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

	p := &execProcess{
		cmd: cmd, stdout: stdout, stdin: stdin,
		stderr: &boundedWriter{max: maxStderrBytes}, stderrDone: make(chan struct{}),
		onStderr:     spec.OnStderr,
		stopEscalate: stopEscalate,
	}
	go p.drainStderr(stderrPipe)
	return p, nil
}

// startBuffered is Run's own path (F5): cmd.Stdout/cmd.Stderr get a plain io.Writer directly, so
// Go's own internal copy goroutines run — and WaitDelay can force-close ITS OWN pipe against a
// hook's background process still holding the write end open, once the direct child has exited —
// instead of this package reading a *Pipe() to an EOF that process could hold off forever.
// Spec.buffered's own doc comment has the full reasoning. stderrTee gives the same
// OnStderr-then-bounded-buffer behavior the streaming path's drainStderr gives, just invoked by
// Go's own copy goroutine instead of one of ours.
func startBuffered(cmd *exec.Cmd, spec Spec, stopEscalate func()) (Process, error) {
	if spec.Stdin {
		// No caller combines Stdin with the buffered (Run) path today (catfile, the one Spec.Stdin
		// user, always streams via Start directly) — refused rather than silently ignored, so a
		// future caller does not quietly lose its stdin pipe.
		return nil, errors.New("gitclient: Spec.Stdin is not supported on the buffered Run path")
	}
	var stdout bytes.Buffer
	stderr := &boundedWriter{max: maxStderrBytes}
	cmd.Stdout = &stdout
	cmd.Stderr = &stderrTee{onStderr: spec.OnStderr, dest: stderr}

	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return &bufferedExecProcess{cmd: cmd, stdout: &stdout, stderr: stderr, stopEscalate: stopEscalate}, nil
}

// stderrTee is startBuffered's own cmd.Stderr: every Write is handed to onStderr (if set), then to
// dest — the same order and "before it's appended to the bounded buffer" guarantee Spec.OnStderr's
// own doc comment promises.
type stderrTee struct {
	onStderr func([]byte)
	dest     *boundedWriter
}

func (t *stderrTee) Write(p []byte) (int, error) {
	if t.onStderr != nil {
		t.onStderr(p)
	}
	return t.dest.Write(p)
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
	// onStderr is G7 D5's tee — nil for every caller before this phase (fetch/push/pull's progress
	// pump is the first).
	onStderr func([]byte)
	// stopEscalate stops cmd.Cancel's own SIGKILL-escalation timer, if one was ever armed (G31
	// round-2 architecture/security review, finding #11) — called from reap, below, once cmd.Wait
	// has confirmed the process is actually gone, so a clean SIGTERM exit never leaves that timer
	// ticking uselessly toward a SIGKILL nothing needs.
	stopEscalate func()

	stderrDone chan struct{}

	waitOnce   sync.Once
	waitResult Result
	waitErr    error

	closeOnce sync.Once
}

func (p *execProcess) Stdout() io.ReadCloser { return p.stdout }
func (p *execProcess) Stdin() io.WriteCloser { return p.stdin }

// drainStderr reads r in fixed chunks rather than io.Copy so onStderr sees each chunk exactly once,
// before it is appended to the bounded buffer (G7 D5) — the tee and the buffer can never disagree
// about what stderr contained, because they are fed from the same read.
func (p *execProcess) drainStderr(r io.Reader) {
	buf := make([]byte, 32*1024)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			chunk := buf[:n]
			if p.onStderr != nil {
				p.onStderr(chunk)
			}
			_, _ = p.stderr.Write(chunk)
		}
		if err != nil {
			break
		}
	}
	close(p.stderrDone)
}

func (p *execProcess) reap() {
	// stderr must be fully drained before Wait reaps the process (internal/preconnect/
	// supervisor.go's own ordering) — reaping first can race the drain goroutine's last read and
	// truncate the message a classified failure needs.
	<-p.stderrDone
	err := p.cmd.Wait()
	p.stopEscalate()
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
			killAndWait(p.cmd.Process.Pid, func() { _, _ = p.Wait() })
		}
	})
	return nil
}

// bufferedExecProcess is Process for the F5 buffered path (Run's only spawn shape): stdout/stderr
// are captured directly by cmd's own internal copy goroutines rather than read incrementally by
// this package (startBuffered's own doc comment), so Stdout/Stdin return placeholders — nothing in
// this package reads either on a bufferedExecProcess; Wait's own Result carries everything a
// buffered caller needs. cmd.Wait() is called at most once, guarded by waitOnce, exactly like
// execProcess's own (Process.Wait and Process.Close can never race Go's "Wait was already called"
// panic path).
type bufferedExecProcess struct {
	cmd          *exec.Cmd
	stdout       *bytes.Buffer
	stderr       *boundedWriter
	stopEscalate func()

	waitOnce   sync.Once
	waitResult Result
	waitErr    error

	closeOnce sync.Once
}

func (p *bufferedExecProcess) Stdout() io.ReadCloser { return io.NopCloser(bytes.NewReader(nil)) }
func (p *bufferedExecProcess) Stdin() io.WriteCloser { return nil }

func (p *bufferedExecProcess) reap() {
	err := p.cmd.Wait()
	p.stopEscalate()
	// cmd.ProcessState is set once the DIRECT CHILD itself has exited — before Wait ever gets to
	// the separate "wait for the I/O copy goroutines" phase WaitDelay bounds — so it is populated
	// for a clean exit, a non-zero exit (err is *exec.ExitError), AND F5's own scenario: a
	// grandchild still holding cmd.Stdout/cmd.Stderr's write end open after the direct child has
	// already exited, which surfaces as a distinct "WaitDelay expired before I/O complete" error,
	// not an *exec.ExitError. That last case is not a spawn/reap failure — the command itself
	// completed; the data captured in stdout/stderr up to the forced close is exactly what the
	// direct child wrote (it has already exited, so it wrote nothing more after that point), only
	// possibly missing whatever a STILL-RUNNING grandchild might separately write to the same fd —
	// never the case for git's own child processes. Reporting the real exit code either way is
	// what lets a caller no longer wait forever on a hook's background process (F5) while still
	// treating an ordinary non-zero git exit exactly as before.
	if p.cmd.ProcessState != nil {
		p.waitResult = Result{Stdout: p.stdout.Bytes(), Stderr: p.stderr.buf.Bytes(), ExitCode: p.cmd.ProcessState.ExitCode()}
		return
	}
	// Could not even start, or a genuine reap failure — no exit code to report.
	p.waitErr = err
}

func (p *bufferedExecProcess) Wait() (Result, error) {
	p.waitOnce.Do(p.reap)
	return p.waitResult, p.waitErr
}

func (p *bufferedExecProcess) Close() error {
	p.closeOnce.Do(func() {
		if p.cmd.Process != nil {
			killAndWait(p.cmd.Process.Pid, func() { _, _ = p.Wait() })
		}
	})
	return nil
}
