package catfile_test

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/catfile"
)

func skipWithoutGit(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
}

func initRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	run := func(args ...string) {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(),
			"GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.com",
			"GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.com",
		)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	run("init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "hello.txt"), []byte("hello world\n"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	run("add", "hello.txt")
	run("commit", "-q", "-m", "add hello.txt")
	return dir
}

func TestSession_Read_FoundBlob(t *testing.T) {
	skipWithoutGit(t)
	dir := initRepo(t)
	sess := catfile.NewSession(catfile.Deps{Runner: gitclient.NewExecRunner(), GitPath: "git", Dir: dir}, 0)
	defer sess.Close()

	info, content, err := sess.Read("HEAD:hello.txt")
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if info.Type != "blob" {
		t.Fatalf("type = %q, want blob", info.Type)
	}
	if string(content) != "hello world\n" {
		t.Fatalf("content = %q", content)
	}
	if info.Size != int64(len(content)) {
		t.Fatalf("size = %d, want %d", info.Size, len(content))
	}
}

func TestSession_Check_Missing(t *testing.T) {
	skipWithoutGit(t)
	dir := initRepo(t)
	sess := catfile.NewSession(catfile.Deps{Runner: gitclient.NewExecRunner(), GitPath: "git", Dir: dir}, 0)
	defer sess.Close()

	_, err := sess.Check("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef")
	if !errors.Is(err, catfile.ErrMissing) {
		t.Fatalf("got %v, want ErrMissing", err)
	}
}

// TestSession_CheckMany_MixOfFoundAndMissing is G30 round-1 performance review, finding #5's own
// regression guard: CheckMany writes every rev in one request() call and must read back exactly
// one header per rev, IN ORDER, correctly separating found entries (their own real ObjectInfo)
// from missing ones (a zero ObjectInfo, matching Check's own "" convention) — not just for an
// all-found or all-missing batch, but for one that interleaves both, which is where an off-by-one
// in the response-reading loop would actually surface.
func TestSession_CheckMany_MixOfFoundAndMissing(t *testing.T) {
	skipWithoutGit(t)
	dir := initRepo(t)
	if err := os.WriteFile(filepath.Join(dir, "second.txt"), []byte("second\n"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	cmd := exec.Command("git", "add", "second.txt")
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git add: %v\n%s", err, out)
	}
	cmd = exec.Command("git", "commit", "-q", "-m", "add second.txt")
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.com",
		"GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.com")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git commit: %v\n%s", err, out)
	}

	sess := catfile.NewSession(catfile.Deps{Runner: gitclient.NewExecRunner(), GitPath: "git", Dir: dir}, 0)
	defer sess.Close()

	infos, err := sess.CheckMany([]string{
		"HEAD:hello.txt",
		"HEAD:does-not-exist.txt",
		"HEAD:second.txt",
	})
	if err != nil {
		t.Fatalf("CheckMany: %v", err)
	}
	if len(infos) != 3 {
		t.Fatalf("len(infos) = %d, want 3", len(infos))
	}
	if infos[0].OID == "" || infos[0].Type != "blob" {
		t.Fatalf("infos[0] (hello.txt) = %+v, want a real found blob", infos[0])
	}
	if infos[1].OID != "" {
		t.Fatalf("infos[1] (missing) = %+v, want a zero ObjectInfo", infos[1])
	}
	if infos[2].OID == "" || infos[2].Type != "blob" {
		t.Fatalf("infos[2] (second.txt) = %+v, want a real found blob", infos[2])
	}
	if infos[0].OID == infos[2].OID {
		t.Fatalf("hello.txt and second.txt resolved to the SAME oid (%s) — the response reader misaligned", infos[0].OID)
	}

	// The session must still work normally afterward — a misaligned read would leave the process's
	// own response stream desynced for every subsequent request.
	single, err := sess.Check("HEAD:hello.txt")
	if err != nil || single.OID != infos[0].OID {
		t.Fatalf("Check after CheckMany = %+v, %v; want the same oid as infos[0] with no error", single, err)
	}
}

// TestSession_CheckMany_Empty proves the zero-revs edge case is a plain no-op, not a hang waiting
// on a response that was never requested.
func TestSession_CheckMany_Empty(t *testing.T) {
	skipWithoutGit(t)
	dir := initRepo(t)
	sess := catfile.NewSession(catfile.Deps{Runner: gitclient.NewExecRunner(), GitPath: "git", Dir: dir}, 0)
	defer sess.Close()

	infos, err := sess.CheckMany(nil)
	if err != nil || infos != nil {
		t.Fatalf("CheckMany(nil) = %+v, %v; want nil, nil", infos, err)
	}
}

// TestSession_Read_FoundBlob_PathWithSpace is D10's own "guard the existing fix" case (probe P3):
// a space-containing path resolved through the ordinary batch protocol, proving readHeader's
// suffix-based " missing" recognition does not also misfire on a *found* line whose echoed input
// happens to contain a space.
func TestSession_Read_FoundBlob_PathWithSpace(t *testing.T) {
	skipWithoutGit(t)
	dir := t.TempDir()
	run := func(args ...string) {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(),
			"GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.com",
			"GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.com",
		)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	run("init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "my file.txt"), []byte("spaced\n"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	run("add", "my file.txt")
	run("commit", "-q", "-m", "add spaced file")

	sess := catfile.NewSession(catfile.Deps{Runner: gitclient.NewExecRunner(), GitPath: "git", Dir: dir}, 0)
	defer sess.Close()

	info, content, err := sess.Read("HEAD:my file.txt")
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if info.Type != "blob" || string(content) != "spaced\n" {
		t.Fatalf("info=%+v content=%q", info, content)
	}
}

func TestSession_Check_MissingWithSpacesInEchoedInput(t *testing.T) {
	skipWithoutGit(t)
	dir := initRepo(t)
	sess := catfile.NewSession(catfile.Deps{Runner: gitclient.NewExecRunner(), GitPath: "git", Dir: dir}, 0)
	defer sess.Close()

	// git echoes this exact (space-containing) input back ahead of " missing" — the case
	// readHeader's suffix-based recognition exists for.
	_, err := sess.Check("HEAD:a file that does not exist.txt")
	if !errors.Is(err, catfile.ErrMissing) {
		t.Fatalf("got %v, want ErrMissing", err)
	}
}

// batchOnlyPanicRunner delegates every --batch-check spawn to the real exec runner and fails the
// test outright if --batch is ever spawned — the direct proof that an oversize blob is answered
// from --batch-check alone (Session.Read never asks --batch for content it is about to discard).
type batchOnlyPanicRunner struct {
	t    *testing.T
	real gitclient.Runner
}

func (r batchOnlyPanicRunner) Start(ctx context.Context, gitPath string, spec gitclient.Spec) (gitclient.Process, error) {
	for _, a := range spec.Args {
		if a == "--batch" {
			r.t.Fatal("--batch was spawned for a blob over the size gate — Read must never ask for its content")
		}
	}
	return r.real.Start(ctx, gitPath, spec)
}

// TestSession_ReadOneShot_NewlinePath is D10's own new case: a path containing a newline cannot be
// expressed in the batch protocol at all (one request per line), so it must resolve through the
// one-shot `git show` fallback instead.
func TestSession_ReadOneShot_NewlinePath(t *testing.T) {
	skipWithoutGit(t)
	dir := t.TempDir()
	run := func(args ...string) {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(),
			"GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.com",
			"GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.com",
		)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	run("init", "-q", "-b", "main")
	name := "weird\nname.txt"
	if err := os.WriteFile(filepath.Join(dir, name), []byte("newline path content\n"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	run("add", "-A")
	run("commit", "-q", "-m", "add newline-path file")

	sess := catfile.NewSession(catfile.Deps{Runner: gitclient.NewExecRunner(), GitPath: "git", Dir: dir}, 0)
	defer sess.Close()

	info, content, err := sess.ReadOneShot(context.Background(), "HEAD:"+name)
	if err != nil {
		t.Fatalf("ReadOneShot: %v", err)
	}
	if info.Type != "blob" || string(content) != "newline path content\n" {
		t.Fatalf("info=%+v content=%q", info, content)
	}
}

func TestSession_ReadOneShot_Missing(t *testing.T) {
	skipWithoutGit(t)
	dir := initRepo(t)
	sess := catfile.NewSession(catfile.Deps{Runner: gitclient.NewExecRunner(), GitPath: "git", Dir: dir}, 0)
	defer sess.Close()

	_, _, err := sess.ReadOneShot(context.Background(), "HEAD:does\nnot\nexist.txt")
	if !errors.Is(err, catfile.ErrMissing) {
		t.Fatalf("got %v, want ErrMissing", err)
	}
}

// TestSession_CheckOneShot_NewlineRev is G31 round-2 architecture/security review finding #2's
// own regression coverage — Check's counterpart to TestSession_ReadOneShot_NewlinePath above: a
// newline anywhere in the rev (not just the path half of it) cannot be expressed in the
// --batch-check protocol either, and must resolve through this one-shot `rev-parse --verify`
// fallback instead, giving the same OID Check's own batch header line would have.
func TestSession_CheckOneShot_NewlineRev(t *testing.T) {
	skipWithoutGit(t)
	dir := t.TempDir()
	run := func(args ...string) {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(),
			"GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.com",
			"GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.com",
		)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	run("init", "-q", "-b", "main")
	name := "weird\nname.txt"
	if err := os.WriteFile(filepath.Join(dir, name), []byte("newline path content\n"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	run("add", "-A")
	run("commit", "-q", "-m", "add newline-path file")

	// Independent oracle for the expected OID: `git hash-object` on the file's own bytes, a
	// wholly different code path than either Check or CheckOneShot's own rev-parse.
	hashOut, err := exec.Command("git", "-C", dir, "hash-object", name).Output()
	if err != nil {
		t.Fatalf("git hash-object: %v", err)
	}
	wantOID := strings.TrimSpace(string(hashOut))

	sess := catfile.NewSession(catfile.Deps{Runner: gitclient.NewExecRunner(), GitPath: "git", Dir: dir}, 0)
	defer sess.Close()

	info, err := sess.CheckOneShot(context.Background(), "HEAD:"+name)
	if err != nil {
		t.Fatalf("CheckOneShot: %v", err)
	}
	if info.OID != wantOID {
		t.Fatalf("CheckOneShot OID = %q, want %q (git hash-object)", info.OID, wantOID)
	}
}

func TestSession_CheckOneShot_Missing(t *testing.T) {
	skipWithoutGit(t)
	dir := initRepo(t)
	sess := catfile.NewSession(catfile.Deps{Runner: gitclient.NewExecRunner(), GitPath: "git", Dir: dir}, 0)
	defer sess.Close()

	_, err := sess.CheckOneShot(context.Background(), "HEAD:does\nnot\nexist.txt")
	if !errors.Is(err, catfile.ErrMissing) {
		t.Fatalf("got %v, want ErrMissing", err)
	}
}

func TestSession_Read_TooLarge_AnsweredFromCheckAlone(t *testing.T) {
	skipWithoutGit(t)
	dir := initRepo(t)
	runner := batchOnlyPanicRunner{t: t, real: gitclient.NewExecRunner()}
	sess := catfile.NewSession(catfile.Deps{Runner: runner, GitPath: "git", Dir: dir}, 5) // hello.txt is 12 bytes
	defer sess.Close()

	_, _, err := sess.Read("HEAD:hello.txt")
	if !errors.Is(err, catfile.ErrTooLarge) {
		t.Fatalf("got %v, want ErrTooLarge", err)
	}
}

// --- a killed process fails every queued request rather than hanging -----------------------

// killableProcess is a fake gitclient.Process whose Stdout can be switched, mid-life, to a
// reader that returns io.EOF — simulating the child having been killed underneath the session.
type killableProcess struct {
	stdout *swappableReader
	stdin  *bytes.Buffer
}

func (p *killableProcess) Stdout() io.ReadCloser { return io.NopCloser(p.stdout) }
func (p *killableProcess) Stdin() io.WriteCloser { return nopWriteCloser{p.stdin} }
func (p *killableProcess) Wait() (gitclient.Result, error) {
	return gitclient.Result{ExitCode: 0}, nil
}
func (p *killableProcess) Close() error { return nil }

type nopWriteCloser struct{ io.Writer }

func (nopWriteCloser) Close() error { return nil }

type swappableReader struct{ r io.Reader }

func (s *swappableReader) Read(p []byte) (int, error) { return s.r.Read(p) }

// killedAfterFirstRunner answers the first Start with a working process whose stdout is then
// swapped to EOF (simulating a kill); every subsequent Start fails outright, simulating a git
// binary that has become permanently unusable — the circuit breaker's own worst case.
type killedAfterFirstRunner struct {
	proc    *killableProcess
	starts  int
	failAll bool
}

func (r *killedAfterFirstRunner) Start(ctx context.Context, gitPath string, spec gitclient.Spec) (gitclient.Process, error) {
	r.starts++
	if r.failAll {
		return nil, errors.New("simulated: git is permanently broken")
	}
	stdout := "0123456789abcdef0123456789abcdef01234567 blob 5\nhello\n"
	r.proc = &killableProcess{stdout: &swappableReader{r: bytes.NewReader([]byte(stdout))}, stdin: &bytes.Buffer{}}
	return r.proc, nil
}

func TestSession_KilledProcess_FailsQueuedRequestsRatherThanHanging(t *testing.T) {
	runner := &killedAfterFirstRunner{}
	sess := catfile.NewSession(catfile.Deps{Runner: runner, GitPath: "git", Dir: "."}, 0)
	defer sess.Close()

	// First request succeeds against the live process.
	if _, _, err := sess.Read("first"); err != nil {
		t.Fatalf("first Read: %v", err)
	}

	// Simulate the process dying: its stdout now yields EOF immediately.
	runner.proc.stdout.r = bytes.NewReader(nil)
	runner.failAll = true // every respawn attempt from here on fails, tripping the circuit breaker.

	done := make(chan error, 4)
	for i := 0; i < 4; i++ {
		go func() {
			_, _, err := sess.Read("second")
			done <- err
		}()
	}
	deadline := time.After(5 * time.Second)
	for i := 0; i < 4; i++ {
		select {
		case err := <-done:
			if err == nil {
				t.Fatal("expected every queued request to fail once the process is dead and unrestartable")
			}
		case <-deadline:
			t.Fatal("a request against a killed, unrestartable process hung instead of failing")
		}
	}
}
