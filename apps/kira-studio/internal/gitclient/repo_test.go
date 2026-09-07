package gitclient

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// --- Repo.Write / Repo.Read: ordering, bounded concurrency, cancellation ----------------------
// AGENTS.md's own bar for a dedicated unit test ("concurrency: ordering, backpressure,
// cancellation, races") is exactly what this section is for.

func newTestRepo() *Repo {
	return newRepo(RepoSummary{RepoID: "test"}, &fakeRunner{}, "/usr/bin/git")
}

func TestRepo_WriteSerialises(t *testing.T) {
	r := newTestRepo()
	var active int32
	var maxActive int32
	var wg sync.WaitGroup

	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = r.Write(context.Background(), func(context.Context) error {
				n := atomic.AddInt32(&active, 1)
				for {
					m := atomic.LoadInt32(&maxActive)
					if n <= m || atomic.CompareAndSwapInt32(&maxActive, m, n) {
						break
					}
				}
				time.Sleep(2 * time.Millisecond)
				atomic.AddInt32(&active, -1)
				return nil
			})
		}()
	}
	wg.Wait()

	if maxActive != 1 {
		t.Fatalf("max concurrent Write executions = %d, want 1", maxActive)
	}
}

// TestRepo_WriteQueuesWithoutLossOrOverlap: N concurrent Writes queued behind one already in
// flight all eventually run, exactly once each, never overlapping — the "write queue" half of
// docs/v1.3/SPEC.md's P1 row. Strict FIFO order is deliberately not asserted (Repo's own doc
// comment on why: a broadcast-and-recheck gate, not a single ordered channel, is what avoids the
// N-token deadlock a naive "Write grabs every Read slot" design would have).
func TestRepo_WriteQueuesWithoutLossOrOverlap(t *testing.T) {
	r := newTestRepo()
	const n = 20
	var overlap int32
	var inFlight int32
	var completed int32
	var wg sync.WaitGroup

	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = r.Write(context.Background(), func(context.Context) error {
				if atomic.AddInt32(&inFlight, 1) > 1 {
					atomic.StoreInt32(&overlap, 1)
				}
				time.Sleep(time.Millisecond)
				atomic.AddInt32(&inFlight, -1)
				atomic.AddInt32(&completed, 1)
				return nil
			})
		}()
	}
	wg.Wait()

	if overlap != 0 {
		t.Fatal("two Write executions overlapped")
	}
	if completed != n {
		t.Fatalf("completed = %d, want %d (every Write must run exactly once)", completed, n)
	}
}

func TestRepo_ReadBoundsConcurrency(t *testing.T) {
	r := newTestRepo()
	var active int32
	var maxActive int32
	var wg sync.WaitGroup

	for i := 0; i < maxConcurrentReads*3; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = r.Read(context.Background(), func(context.Context) error {
				n := atomic.AddInt32(&active, 1)
				for {
					m := atomic.LoadInt32(&maxActive)
					if n <= m || atomic.CompareAndSwapInt32(&maxActive, m, n) {
						break
					}
				}
				time.Sleep(3 * time.Millisecond)
				atomic.AddInt32(&active, -1)
				return nil
			})
		}()
	}
	wg.Wait()

	if maxActive > maxConcurrentReads {
		t.Fatalf("max concurrent Read executions = %d, want <= %d", maxActive, maxConcurrentReads)
	}
	if maxActive < 2 {
		t.Fatalf("max concurrent Read executions = %d, want > 1 (reads should overlap)", maxActive)
	}
}

func TestRepo_WriteCancelledWhileQueued(t *testing.T) {
	r := newTestRepo()
	// Hold the gate open with a real in-flight Write so the next one genuinely has to queue.
	holding := make(chan struct{})
	release := make(chan struct{})
	go func() {
		_ = r.Write(context.Background(), func(context.Context) error {
			close(holding)
			<-release
			return nil
		})
	}()
	<-holding
	defer close(release)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	err := r.Write(ctx, func(context.Context) error {
		t.Fatal("fn must not run when ctx was already cancelled before access was granted")
		return nil
	})
	if !errors.Is(err, ErrCancelled) {
		t.Fatalf("err = %v, want ErrCancelled", err)
	}
}

func TestRepo_ReadAndWriteAreMutuallyExclusive(t *testing.T) {
	r := newTestRepo()
	var readActive, writeActive int32
	var overlapped int32
	var wg sync.WaitGroup

	wg.Add(1)
	go func() {
		defer wg.Done()
		_ = r.Write(context.Background(), func(context.Context) error {
			atomic.StoreInt32(&writeActive, 1)
			if atomic.LoadInt32(&readActive) == 1 {
				atomic.StoreInt32(&overlapped, 1)
			}
			time.Sleep(5 * time.Millisecond)
			atomic.StoreInt32(&writeActive, 0)
			return nil
		})
	}()
	time.Sleep(1 * time.Millisecond) // let the Write above claim the token first.
	wg.Add(1)
	go func() {
		defer wg.Done()
		_ = r.Read(context.Background(), func(context.Context) error {
			atomic.StoreInt32(&readActive, 1)
			if atomic.LoadInt32(&writeActive) == 1 {
				atomic.StoreInt32(&overlapped, 1)
			}
			atomic.StoreInt32(&readActive, 0)
			return nil
		})
	}()
	wg.Wait()

	if overlapped == 1 {
		t.Fatal("a Read and a Write observed each other active at the same time")
	}
}

// --- Registry.Open / Close ---------------------------------------------------------------------

func TestRegistry_OpenReusesSameRepoID(t *testing.T) {
	dir := initFixtureRepo(t)
	reg := NewRegistry(NewExecRunner())
	gitPath := requireRealGit(t)

	r1, err := reg.Open(context.Background(), gitPath, dir)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	r2, err := reg.Open(context.Background(), gitPath, dir)
	if err != nil {
		t.Fatalf("Open (again): %v", err)
	}
	if r1 != r2 {
		t.Fatal("Open on the same path twice returned two different *Repo instances")
	}
}

func TestRegistry_CloseThenGet(t *testing.T) {
	dir := initFixtureRepo(t)
	reg := NewRegistry(NewExecRunner())
	gitPath := requireRealGit(t)

	r, err := reg.Open(context.Background(), gitPath, dir)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if !reg.Close(r.Summary.RepoID) {
		t.Fatal("Close on an open repoId reported false")
	}
	if reg.Close(r.Summary.RepoID) {
		t.Fatal("Close on an already-closed repoId reported true")
	}
	if _, ok := reg.Get(r.Summary.RepoID); ok {
		t.Fatal("Get found a repo after Close")
	}
}

// --- identify() against a real repository --------------------------------------------------
// Skipped when no git is on PATH — this package's own binary discovery is exercised elsewhere
// (discovery_test.go, entirely faked); this is the one place a real `git init`-produced repo
// proves rev-parse's own output is read correctly.

func requireRealGit(t *testing.T) string {
	t.Helper()
	path, err := exec.LookPath("git")
	if err != nil {
		t.Skip("no git on PATH in this environment")
	}
	return path
}

func runGit(t *testing.T, dir string, args ...string) string {
	t.Helper()
	gitPath := requireRealGit(t)
	cmd := exec.Command(gitPath, args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0",
		"GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.com",
		"GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.com")
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	if err := cmd.Run(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out.String())
	}
	return out.String()
}

func initFixtureRepo(t *testing.T) string {
	t.Helper()
	requireRealGit(t)
	dir := t.TempDir()
	runGit(t, dir, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte("hello\n"), 0o644); err != nil {
		t.Fatalf("write README: %v", err)
	}
	runGit(t, dir, "add", "README.md")
	runGit(t, dir, "commit", "-q", "-m", "initial commit")
	return dir
}

func TestIdentify_OrdinaryRepoOnBranch(t *testing.T) {
	dir := initFixtureRepo(t)
	gitPath := requireRealGit(t)

	summary, err := identify(context.Background(), NewExecRunner(), gitPath, dir)
	if err != nil {
		t.Fatalf("identify: %v", err)
	}
	if summary.IsBare {
		t.Error("IsBare = true, want false")
	}
	if summary.IsLinkedWorktree {
		t.Error("IsLinkedWorktree = true, want false")
	}
	realDir, err := filepath.EvalSymlinks(dir)
	if err != nil {
		t.Fatalf("EvalSymlinks: %v", err)
	}
	if summary.Root != realDir {
		t.Errorf("Root = %q, want %q", summary.Root, realDir)
	}
	if summary.GitDir != filepath.Join(realDir, ".git") {
		t.Errorf("GitDir = %q, want %s/.git", summary.GitDir, realDir)
	}
	if summary.CommonDir != summary.GitDir {
		t.Errorf("CommonDir = %q, want it to equal GitDir for the main worktree", summary.CommonDir)
	}
	if summary.Head.Kind != "branch" || summary.Head.Name != "main" {
		t.Errorf("Head = %+v, want {branch main}", summary.Head)
	}
	if summary.RepoID != summary.GitDir {
		t.Errorf("RepoID = %q, want it to equal GitDir", summary.RepoID)
	}
}

func TestIdentify_UnbornBranch(t *testing.T) {
	gitPath := requireRealGit(t)
	dir := t.TempDir()
	runGit(t, dir, "init", "-q", "-b", "main")

	summary, err := identify(context.Background(), NewExecRunner(), gitPath, dir)
	if err != nil {
		t.Fatalf("identify: %v", err)
	}
	if summary.Head.Kind != "unborn" || summary.Head.Name != "main" {
		t.Errorf("Head = %+v, want {unborn main}", summary.Head)
	}
}

func TestIdentify_DetachedHead(t *testing.T) {
	dir := initFixtureRepo(t)
	gitPath := requireRealGit(t)
	sha := strings.TrimSpace(runGit(t, dir, "rev-parse", "HEAD"))
	runGit(t, dir, "checkout", "-q", "--detach", sha)

	summary, err := identify(context.Background(), NewExecRunner(), gitPath, dir)
	if err != nil {
		t.Fatalf("identify: %v", err)
	}
	if summary.Head.Kind != "detached" || summary.Head.SHA != sha {
		t.Errorf("Head = %+v, want {detached %s}", summary.Head, sha)
	}
}

func TestIdentify_BareRepo(t *testing.T) {
	gitPath := requireRealGit(t)
	dir := t.TempDir()
	runGit(t, dir, "init", "-q", "--bare", "-b", "main")

	summary, err := identify(context.Background(), NewExecRunner(), gitPath, dir)
	if err != nil {
		t.Fatalf("identify: %v", err)
	}
	if !summary.IsBare {
		t.Error("IsBare = false, want true")
	}
	if summary.Root != "" {
		t.Errorf("Root = %q, want empty for a bare repo", summary.Root)
	}
	if summary.IsLinkedWorktree {
		t.Error("IsLinkedWorktree = true, want false for a bare repo")
	}
}

func TestIdentify_LinkedWorktree(t *testing.T) {
	dir := initFixtureRepo(t)
	gitPath := requireRealGit(t)
	wtDir := filepath.Join(t.TempDir(), "linked")
	runGit(t, dir, "worktree", "add", "-q", "-b", "feature", wtDir)

	summary, err := identify(context.Background(), NewExecRunner(), gitPath, wtDir)
	if err != nil {
		t.Fatalf("identify: %v", err)
	}
	if !summary.IsLinkedWorktree {
		t.Error("IsLinkedWorktree = false, want true")
	}
	if summary.GitDir == summary.CommonDir {
		t.Error("GitDir == CommonDir, want them to differ for a linked worktree")
	}
	mainRealDir, err := filepath.EvalSymlinks(dir)
	if err != nil {
		t.Fatalf("EvalSymlinks: %v", err)
	}
	if summary.CommonDir != filepath.Join(mainRealDir, ".git") {
		t.Errorf("CommonDir = %q, want the main worktree's .git", summary.CommonDir)
	}
}

func TestIdentify_NotARepository(t *testing.T) {
	gitPath := requireRealGit(t)
	dir := t.TempDir() // not initialised as a repo at all.

	_, err := identify(context.Background(), NewExecRunner(), gitPath, dir)
	kind, ok := KindOf(err)
	if !ok || kind != KindNotARepository {
		t.Fatalf("KindOf(err) = (%v, %v), want (%v, true)", kind, ok, KindNotARepository)
	}
}

// --- Client.OpenRepo / Status --------------------------------------------------------------

func TestClient_OpenRepo_GitUnavailableShortCircuits(t *testing.T) {
	c := &Client{
		Runner:    &fakeRunner{},
		Discovery: NewDiscovery(fakeLocator{found: false, probed: []string{"a"}}, &fakeRunner{}, &fakeClock{}),
		Registry:  NewRegistry(&fakeRunner{}),
	}
	result, err := c.OpenRepo(context.Background(), "", "/some/path")
	if err != nil {
		t.Fatalf("OpenRepo: %v", err)
	}
	if result.Kind != "gitUnavailable" || result.Git == nil || result.Git.Kind != "notFound" {
		t.Fatalf("result = %+v, want gitUnavailable/notFound", result)
	}
}

// clientOverRealGit builds a Client whose Discovery reports the test machine's real git as "ok"
// directly (bypassing NewPlatformLocator's darwin-only strategy, D3) — this file's job is proving
// Client.OpenRepo's own orchestration against a real repository on whatever OS the test runs on,
// not re-proving D3's platform selection (discovery_test.go already covers that end to end).
func clientOverRealGit(t *testing.T) *Client {
	t.Helper()
	gitPath := requireRealGit(t)
	runner := NewExecRunner()
	return &Client{
		Runner:    runner,
		Discovery: NewDiscovery(fakeLocator{found: true, path: gitPath}, runner, NewRealClock()),
		Registry:  NewRegistry(runner),
	}
}

func TestClient_OpenRepo_RealRepoEndToEnd(t *testing.T) {
	dir := initFixtureRepo(t)
	c := clientOverRealGit(t)

	result, err := c.OpenRepo(context.Background(), "", dir)
	if err != nil {
		t.Fatalf("OpenRepo: %v", err)
	}
	if result.Kind != "ok" || result.Repo == nil {
		t.Fatalf("result = %+v, want ok with a repo", result)
	}
	if result.Repo.Head.Kind != "branch" {
		t.Errorf("Head.Kind = %q, want branch", result.Repo.Head.Kind)
	}

	if !c.CloseRepo(result.Repo.RepoID) {
		t.Fatal("CloseRepo reported false for a just-opened repo")
	}
}

func TestClient_OpenRepo_NotARepository(t *testing.T) {
	c := clientOverRealGit(t)
	result, err := c.OpenRepo(context.Background(), "", t.TempDir())
	if err != nil {
		t.Fatalf("OpenRepo: %v", err)
	}
	if result.Kind != "notARepository" {
		t.Fatalf("result.Kind = %q, want notARepository", result.Kind)
	}
}
