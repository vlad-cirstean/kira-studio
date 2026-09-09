package gitclient

import (
	"context"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"testing"
	"time"
)

// A test asserting the exact env and argv of a spawn is worth more than it looks — every later
// phase's write queue, discovery probe and porcelain parser inherits whatever buildEnv/buildArgv
// get wrong here.

func TestBuildEnv_AppendsHygieneOntoBase(t *testing.T) {
	base := []string{"PATH=/usr/bin", "HOME=/home/kira"}
	got := buildEnv(base, nil)

	want := append(slices.Clone(base), "GIT_TERMINAL_PROMPT=0", "GIT_OPTIONAL_LOCKS=0", "GIT_PAGER=cat", "GIT_EDITOR=true", "LC_ALL=C")
	if !slices.Equal(got, want) {
		t.Fatalf("buildEnv(%v, nil) = %v, want %v", base, got, want)
	}
}

// TestBuildEnv_ExtraWinsOverHygieneOnDuplicateKey is G7 D5's own guarantee — Spec.Env's only
// caller (the askpass broker) relies on GIT_ASKPASS overriding nothing hygieneEnv sets today, but
// the ordering itself (extra last, so it would win on any future collision) is worth pinning.
func TestBuildEnv_ExtraWinsOverHygieneOnDuplicateKey(t *testing.T) {
	got := buildEnv([]string{"PATH=/usr/bin"}, []string{"GIT_EDITOR=nano"})
	want := []string{"PATH=/usr/bin", "GIT_TERMINAL_PROMPT=0", "GIT_OPTIONAL_LOCKS=0", "GIT_PAGER=cat", "GIT_EDITOR=true", "LC_ALL=C", "GIT_EDITOR=nano"}
	if !slices.Equal(got, want) {
		t.Fatalf("buildEnv with extra = %v, want %v", got, want)
	}
}

func TestBuildArgv_ConfigOverridesThenNoPagerFirst(t *testing.T) {
	got := buildArgv(Spec{Args: []string{"status"}})
	want := []string{
		"-c", "core.quotepath=false",
		"-c", "core.precomposeunicode=true",
		"-c", "color.ui=false",
		"-c", "log.showSignature=false",
		"-c", "i18n.logOutputEncoding=UTF-8",
		"--no-pager",
		"status",
	}
	if !slices.Equal(got, want) {
		t.Fatalf("buildArgv = %v, want %v", got, want)
	}
}

func TestBuildArgv_ReadOnlyAddsNoOptionalLocks(t *testing.T) {
	got := buildArgv(Spec{Args: []string{"log"}, ReadOnly: true})
	want := []string{
		"-c", "core.quotepath=false",
		"-c", "core.precomposeunicode=true",
		"-c", "color.ui=false",
		"-c", "log.showSignature=false",
		"-c", "i18n.logOutputEncoding=UTF-8",
		"--no-pager", "--no-optional-locks", "log",
	}
	if !slices.Equal(got, want) {
		t.Fatalf("buildArgv(ReadOnly) = %v, want %v", got, want)
	}
}

func TestBuildArgv_WriteOmitsNoOptionalLocks(t *testing.T) {
	got := buildArgv(Spec{Args: []string{"commit"}, ReadOnly: false})
	for _, a := range got {
		if a == "--no-optional-locks" {
			t.Fatalf("buildArgv(ReadOnly: false) = %v, must not carry --no-optional-locks", got)
		}
	}
}

// requireExecGit is runner_test.go's own git-on-PATH skip — repo_test.go's requireRealGit is not
// visible from tests that would rather not depend on repo_test.go's fixture helpers.
func requireExecGit(t *testing.T) string {
	t.Helper()
	gitPath, err := exec.LookPath("git")
	if err != nil {
		t.Skip("no git on PATH in this environment")
	}
	return gitPath
}

// TestRun is the one place this package spawns a real process through the Run convenience — proves
// execRunner's own env/argv assembly reaches a real child correctly, which a fake cannot show.
func TestRun(t *testing.T) {
	gitPath := requireExecGit(t)
	r := NewExecRunner()

	t.Run("ok exit", func(t *testing.T) {
		res, err := Run(context.Background(), r, gitPath, Spec{Args: []string{"--version"}})
		if err != nil {
			t.Fatalf("Run: %v", err)
		}
		if res.ExitCode != 0 {
			t.Fatalf("ExitCode = %d, want 0 (stderr: %s)", res.ExitCode, res.Stderr)
		}
		if len(res.Stdout) == 0 {
			t.Fatalf("Stdout is empty, want a version string")
		}
	})

	t.Run("nonzero exit is not a Go error", func(t *testing.T) {
		res, err := Run(context.Background(), r, gitPath, Spec{Args: []string{"not-a-real-subcommand"}})
		if err != nil {
			t.Fatalf("Run: %v, want nil error with ExitCode carrying the failure", err)
		}
		if res.ExitCode == 0 {
			t.Fatalf("ExitCode = 0, want non-zero for an unknown subcommand")
		}
	})

	t.Run("context cancellation stops the process", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		_, err := Run(ctx, r, gitPath, Spec{Args: []string{"--version"}})
		if err == nil {
			t.Fatalf("Run with an already-cancelled context: want an error")
		}
	})

	t.Run("missing binary reports an error, not a panic", func(t *testing.T) {
		_, err := Run(context.Background(), r, "/no/such/git-binary", Spec{Args: []string{"--version"}})
		if err == nil {
			t.Fatalf("Run with a missing binary: want an error")
		}
	})
}

// TestStart_StdoutStreamsBeforeWait proves Start's whole reason to exist: bytes are readable
// before Wait returns, the property a buffered Run structurally cannot have.
func TestStart_StdoutStreamsBeforeWait(t *testing.T) {
	gitPath := requireExecGit(t)
	r := NewExecRunner()

	p, err := r.Start(context.Background(), gitPath, Spec{Args: []string{"--version"}})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	first := make([]byte, 4)
	n, err := io.ReadFull(p.Stdout(), first)
	if err != nil || n != 4 {
		t.Fatalf("reading before Wait: n=%d err=%v", n, err)
	}
	if string(first) != "git " {
		t.Fatalf("first bytes = %q, want %q", first, "git ")
	}
	if _, err := io.ReadAll(p.Stdout()); err != nil {
		t.Fatalf("draining the rest: %v", err)
	}
	if _, err := p.Wait(); err != nil {
		t.Fatalf("Wait: %v", err)
	}
}

// TestStart_CancellationKillsAndUnblocksReader is D3's own proof: cancelling the context sends
// SIGTERM to the process group, and the reader — blocked on a command that would otherwise run far
// longer than the test's patience — sees EOF/error promptly rather than hanging.
func TestStart_CancellationKillsAndUnblocksReader(t *testing.T) {
	requireExecGit(t)
	r := NewExecRunner()

	ctx, cancel := context.WithCancel(context.Background())
	// No real git subcommand both needs no repository and reliably runs for 30s, so this stands one
	// up with a shell shim instead.
	dir := t.TempDir()
	shim := writeSleepyGitShim(t, dir, 30)

	start := time.Now()
	p, err := r.Start(ctx, shim, Spec{Args: []string{"--version"}})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	done := make(chan struct{})
	go func() {
		_, _ = io.ReadAll(p.Stdout())
		close(done)
	}()

	// Give the shim a moment to actually be sleeping before cancelling.
	time.Sleep(50 * time.Millisecond)
	cancel()

	select {
	case <-done:
	case <-time.After(gracefulStopDelay + 2*time.Second):
		t.Fatal("Stdout did not reach EOF within the graceful-stop window after cancellation")
	}
	if elapsed := time.Since(start); elapsed > gracefulStopDelay+2*time.Second {
		t.Fatalf("cancellation took %v to unblock the reader, want well under %v", elapsed, gracefulStopDelay+2*time.Second)
	}
	// A SIGTERM'd process is a successful spawn+reap that exited abnormally, not a Go error — the
	// same "non-zero exit reports through Result, not err" contract Run's own doc states.
	res, err := p.Wait()
	if err != nil {
		t.Fatalf("Wait: %v", err)
	}
	if res.ExitCode == 0 {
		t.Fatalf("ExitCode = 0, want non-zero for a signal-terminated process")
	}
}

// TestExecProcess_CloseIsIdempotentAndSafeAfterWait.
func TestExecProcess_CloseIsIdempotentAndSafeAfterWait(t *testing.T) {
	gitPath := requireExecGit(t)
	r := NewExecRunner()

	p, err := r.Start(context.Background(), gitPath, Spec{Args: []string{"--version"}})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if _, err := io.ReadAll(p.Stdout()); err != nil {
		t.Fatalf("drain stdout: %v", err)
	}
	if _, err := p.Wait(); err != nil {
		t.Fatalf("Wait: %v", err)
	}
	if err := p.Close(); err != nil {
		t.Fatalf("Close after Wait: %v", err)
	}
	if err := p.Close(); err != nil {
		t.Fatalf("second Close: %v", err)
	}
}

// TestStart_GrandchildDoesNotHoldPipeOpen is the one test that proves D3's Setpgid is doing
// anything at all: the direct child (the "git" shim) exits almost immediately, but a grandchild it
// backgrounded inherits stdout and keeps its write end open. Without a group-wide kill the reader
// would block for the grandchild's full 30s; with one (triggered here by cancelling ctx once the
// direct child has had time to exit on its own), it must unblock within the graceful-stop window.
func TestStart_GrandchildDoesNotHoldPipeOpen(t *testing.T) {
	requireExecGit(t)
	r := NewExecRunner()
	dir := t.TempDir()
	shim := writeGrandchildGitShim(t, dir)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	p, err := r.Start(ctx, shim, Spec{Args: []string{}})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}

	done := make(chan []byte, 1)
	go func() {
		b, _ := io.ReadAll(p.Stdout())
		done <- b
	}()

	// Let the shim itself finish (it exits almost instantly) before cancelling — the grandchild it
	// left behind is what this test is actually about.
	time.Sleep(100 * time.Millisecond)
	cancel()

	select {
	case b := <-done:
		if string(b) != "hello\n" {
			t.Fatalf("stdout = %q, want %q", b, "hello\n")
		}
	case <-time.After(gracefulStopDelay + 3*time.Second):
		t.Fatal("Stdout never reached EOF — a backgrounded grandchild held the pipe open despite the group kill")
	}
	// The shim itself exited successfully, but Cancel was called on it (racing an already-dead
	// process is exactly what killGroup's ESRCH tolerance is for) — Wait's own documented contract
	// is a non-nil error in that combination; reaping is what matters here, not its exact shape.
	_, _ = p.Wait()
}

// writeSleepyGitShim writes an executable shell script masquerading as "git": it sleeps for
// seconds before ever producing output, standing in for a git invocation this test wants to cancel
// mid-flight.
func writeSleepyGitShim(t *testing.T, dir string, seconds int) string {
	t.Helper()
	path := filepath.Join(dir, "git")
	script := "#!/bin/sh\nsleep " + strconv.Itoa(seconds) + "\necho done\n"
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatalf("write shim: %v", err)
	}
	return path
}

// writeGrandchildGitShim writes an executable shell script masquerading as "git": it prints
// "hello\n", backgrounds a `sleep 30` that inherits its stdout (the grandchild), and exits
// immediately — F3's exact shape (nodeProcessRunner.ts's own test scenario).
func writeGrandchildGitShim(t *testing.T, dir string) string {
	t.Helper()
	path := filepath.Join(dir, "git")
	script := "#!/bin/sh\necho hello\n( sleep 30 & )\nexit 0\n"
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatalf("write shim: %v", err)
	}
	return path
}
