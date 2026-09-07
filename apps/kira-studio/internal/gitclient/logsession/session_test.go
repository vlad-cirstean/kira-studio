package logsession_test

import (
	"bytes"
	"context"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/logsession"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
)

func skipWithoutGit(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
}

func passthroughRead(ctx context.Context, fn func(ctx context.Context) error) error { return fn(ctx) }

// countingRunner delegates to the real exec runner, counting spawns whose argv[0] is "log" —
// what the reclaim/skip-resume tests need to prove a respawn actually happened.
type countingRunner struct {
	real gitclient.Runner
	mu   sync.Mutex
	logs int
}

func (r *countingRunner) Start(ctx context.Context, gitPath string, spec gitclient.Spec) (gitclient.Process, error) {
	if len(spec.Args) > 0 && spec.Args[0] == "log" {
		r.mu.Lock()
		r.logs++
		r.mu.Unlock()
	}
	return r.real.Start(ctx, gitPath, spec)
}
func (r *countingRunner) logSpawns() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.logs
}

func initRepoWithCommits(t *testing.T, n int) string {
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
	for i := 0; i < n; i++ {
		name := filepath.Join(dir, "f.txt")
		if err := os.WriteFile(name, []byte{byte(i)}, 0o644); err != nil {
			t.Fatalf("write: %v", err)
		}
		run("add", "f.txt")
		run("commit", "-q", "-m", "commit "+string(rune('a'+i)))
	}
	return dir
}

func TestSession_PageBoundary_NoRecordsDropped(t *testing.T) {
	skipWithoutGit(t)
	dir := initRepoWithCommits(t, 7)
	sess := logsession.Open(
		logsession.Deps{Runner: gitclient.NewExecRunner(), GitPath: "git", Dir: dir, Read: passthroughRead},
		logsession.Options{Walk: porcelain.WalkSpec{Scope: "all"}, PageSize: 3, IdleReclaim: -1},
	)
	defer sess.Close()

	var all []porcelain.CommitRecord
	var appendedPerPage []int
	for {
		outcome, err := sess.ReadPage(context.Background(), func(cr porcelain.CommitRecord) { all = append(all, cr) })
		if err != nil {
			t.Fatalf("ReadPage: %v", err)
		}
		appendedPerPage = append(appendedPerPage, outcome.Appended)
		if outcome.Exhausted {
			break
		}
	}
	if len(all) != 7 {
		t.Fatalf("got %d total records across all pages, want 7 (none dropped): %v", len(all), appendedPerPage)
	}
	if appendedPerPage[0] != 3 || appendedPerPage[1] != 3 || appendedPerPage[2] != 1 {
		t.Fatalf("appended per page = %v, want [3 3 1]", appendedPerPage)
	}
	seen := make(map[string]bool)
	for _, r := range all {
		if seen[r.SHA] {
			t.Fatalf("duplicate sha %s across pages", r.SHA)
		}
		seen[r.SHA] = true
	}
}

func TestSession_Exhaustion_FurtherReadIsNoOp(t *testing.T) {
	skipWithoutGit(t)
	dir := initRepoWithCommits(t, 2)
	sess := logsession.Open(
		logsession.Deps{Runner: gitclient.NewExecRunner(), GitPath: "git", Dir: dir, Read: passthroughRead},
		logsession.Options{Walk: porcelain.WalkSpec{Scope: "all"}, PageSize: 100, IdleReclaim: -1},
	)
	defer sess.Close()

	outcome, err := sess.ReadPage(context.Background(), func(porcelain.CommitRecord) {})
	if err != nil || !outcome.Exhausted || outcome.Appended != 2 {
		t.Fatalf("first ReadPage: outcome=%+v err=%v", outcome, err)
	}

	called := false
	outcome2, err2 := sess.ReadPage(context.Background(), func(porcelain.CommitRecord) { called = true })
	if err2 != nil {
		t.Fatalf("second ReadPage: %v", err2)
	}
	if !outcome2.Exhausted || outcome2.Appended != 0 || called {
		t.Fatalf("second ReadPage after exhaustion: outcome=%+v called=%v, want a no-op", outcome2, called)
	}
}

func TestSession_ReclaimAndSkipResume(t *testing.T) {
	skipWithoutGit(t)
	dir := initRepoWithCommits(t, 4)
	runner := &countingRunner{real: gitclient.NewExecRunner()}
	sess := logsession.Open(
		logsession.Deps{Runner: runner, GitPath: "git", Dir: dir, Read: passthroughRead},
		logsession.Options{Walk: porcelain.WalkSpec{Scope: "all"}, PageSize: 2, IdleReclaim: 300 * time.Millisecond},
	)
	defer sess.Close()

	var page1 []porcelain.CommitRecord
	outcome1, err := sess.ReadPage(context.Background(), func(cr porcelain.CommitRecord) { page1 = append(page1, cr) })
	if err != nil || outcome1.Exhausted || outcome1.Appended != 2 {
		t.Fatalf("page 1: outcome=%+v err=%v", outcome1, err)
	}
	if runner.logSpawns() != 1 {
		t.Fatalf("log spawns after page 1 = %d, want 1", runner.logSpawns())
	}

	time.Sleep(1 * time.Second) // comfortably past the 300ms reclaim window.

	var page2 []porcelain.CommitRecord
	outcome2, err := sess.ReadPage(context.Background(), func(cr porcelain.CommitRecord) { page2 = append(page2, cr) })
	if err != nil {
		t.Fatalf("page 2 (post-reclaim): %v", err)
	}
	// Exactly 2 commits remain (4 total, pageSize 2): the page fills at exactly the walk's last
	// record, so exhaustion is only discovered on the *next* read attempt (there is no way to know
	// a page was the last without trying to read one more and observing EOF).
	if outcome2.Exhausted || outcome2.Appended != 2 {
		t.Fatalf("page 2 (post-reclaim): outcome=%+v, want {Appended:2 Exhausted:false}", outcome2)
	}
	if runner.logSpawns() != 2 {
		t.Fatalf("log spawns after reclaim+resume = %d, want 2 (a fresh --skip respawn)", runner.logSpawns())
	}
	outcome3, err := sess.ReadPage(context.Background(), func(porcelain.CommitRecord) {})
	if err != nil || !outcome3.Exhausted || outcome3.Appended != 0 {
		t.Fatalf("page 3 (drain to EOF): outcome=%+v err=%v, want {Appended:0 Exhausted:true}", outcome3, err)
	}
	for _, r := range page2 {
		for _, p1 := range page1 {
			if r.SHA == p1.SHA {
				t.Fatalf("record %s repeated across the reclaim boundary", r.SHA)
			}
		}
	}
}

func TestSession_StalenessGuard_RefsChangedBetweenPages(t *testing.T) {
	skipWithoutGit(t)
	dir := initRepoWithCommits(t, 4)
	sess := logsession.Open(
		logsession.Deps{Runner: gitclient.NewExecRunner(), GitPath: "git", Dir: dir, Read: passthroughRead},
		logsession.Options{Walk: porcelain.WalkSpec{Scope: "all"}, PageSize: 2, IdleReclaim: 20 * time.Millisecond},
	)
	defer sess.Close()

	if _, err := sess.ReadPage(context.Background(), func(porcelain.CommitRecord) {}); err != nil {
		t.Fatalf("page 1: %v", err)
	}

	time.Sleep(120 * time.Millisecond) // reclaim the process.

	// Move refs before the resume — a genuinely new commit.
	cmd := exec.Command("git", "commit", "-q", "--allow-empty", "-m", "moved refs")
	cmd.Dir = dir
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.com",
		"GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.com",
	)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git commit: %v\n%s", err, out)
	}

	outcome, err := sess.ReadPage(context.Background(), func(porcelain.CommitRecord) {
		t.Fatal("sink must not be called for a stale resume")
	})
	if err != nil {
		t.Fatalf("ReadPage: %v", err)
	}
	if !outcome.Stale {
		t.Fatalf("outcome = %+v, want Stale:true", outcome)
	}
}

// --- cancellation, against a deterministic fake process --------------------------------------

// blockingProcess simulates a paused `git log` whose stdout has nothing more buffered — Read
// blocks until Close (a real cancellation must kill it to unblock).
type blockingProcess struct {
	pr        *io.PipeReader
	pw        *io.PipeWriter
	closed    chan struct{}
	closeOnce sync.Once
}

func newBlockingProcess() *blockingProcess {
	pr, pw := io.Pipe()
	return &blockingProcess{pr: pr, pw: pw, closed: make(chan struct{})}
}
func (p *blockingProcess) Stdout() io.ReadCloser { return p.pr }
func (p *blockingProcess) Stdin() io.WriteCloser { return nil }
func (p *blockingProcess) Wait() (gitclient.Result, error) {
	<-p.closed
	return gitclient.Result{ExitCode: 0}, nil
}
func (p *blockingProcess) Close() error {
	p.closeOnce.Do(func() {
		_ = p.pw.CloseWithError(io.EOF)
		close(p.closed)
	})
	return nil
}

type staticProcess struct{ stdout []byte }

func (p *staticProcess) Stdout() io.ReadCloser { return io.NopCloser(bytes.NewReader(p.stdout)) }
func (p *staticProcess) Stdin() io.WriteCloser { return nil }
func (p *staticProcess) Wait() (gitclient.Result, error) {
	return gitclient.Result{ExitCode: 0}, nil
}
func (p *staticProcess) Close() error { return nil }

// routingRunner answers a for-each-ref (the ref-snapshot guard) with a canned empty snapshot and
// a log spawn with a process that blocks forever until killed.
type routingRunner struct{ blocking *blockingProcess }

func (r *routingRunner) Start(ctx context.Context, gitPath string, spec gitclient.Spec) (gitclient.Process, error) {
	if len(spec.Args) > 0 && spec.Args[0] == "for-each-ref" {
		return &staticProcess{stdout: nil}, nil
	}
	return r.blocking, nil
}

func TestSession_CancellationMidPage_KillsChildAndReturnsPromptly(t *testing.T) {
	runner := &routingRunner{blocking: newBlockingProcess()}
	sess := logsession.Open(
		logsession.Deps{Runner: runner, GitPath: "git", Dir: ".", Read: passthroughRead},
		logsession.Options{Walk: porcelain.WalkSpec{Scope: "all"}, PageSize: 10, IdleReclaim: -1},
	)
	defer sess.Close()

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(30 * time.Millisecond)
		cancel()
	}()

	start := time.Now()
	done := make(chan struct{})
	var outErr error
	go func() {
		_, outErr = sess.ReadPage(ctx, func(porcelain.CommitRecord) {})
		close(done)
	}()

	select {
	case <-done:
		if time.Since(start) > 2*time.Second {
			t.Fatalf("ReadPage took %s to return after cancellation, want promptly", time.Since(start))
		}
		if outErr == nil {
			t.Fatal("expected a cancellation error")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("ReadPage hung past cancellation instead of killing the child and returning")
	}

	select {
	case <-runner.blocking.closed:
	default:
		t.Fatal("cancellation did not close/kill the blocking child process")
	}
}
