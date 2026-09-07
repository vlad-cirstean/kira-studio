package gitsession

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
)

func skipWithoutGitWalk(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
}

func initWalkRepo(t *testing.T, n int) string {
	t.Helper()
	dir := t.TempDir()
	run := func(args ...string) {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(),
			"GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.com",
			"GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.com",
			"GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_SYSTEM=/dev/null",
		)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	run("init", "-q", "-b", "main")
	for i := 0; i < n; i++ {
		if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte{byte(i)}, 0o644); err != nil {
			t.Fatalf("write: %v", err)
		}
		run("add", "f.txt")
		run("commit", "-q", "-m", "commit")
	}
	return dir
}

// newWalkTestConn opens repoDir on a fresh Conn/Registry pair, over the real exec runner (Walk
// needs a genuine `git log` to page against) — returns the conn (caller must Close it or rely on
// registry.Close via t.Cleanup) and the RepoID conn.Walk expects.
func newWalkTestConn(t *testing.T, repoDir string) (*Conn, *Registry, string) {
	t.Helper()
	return newWalkTestConnWithRunner(t, gitclient.NewExecRunner(), repoDir)
}

// countingRunner wraps a real Runner, counting `git log` spawns — D12's own proof needs to know
// whether a re-open spawned a second one.
type countingRunner struct {
	gitclient.Runner
	logSpawns *int32
}

func (r countingRunner) Start(ctx context.Context, gitPath string, spec gitclient.Spec) (gitclient.Process, error) {
	if len(spec.Args) > 0 && spec.Args[0] == "log" {
		atomic.AddInt32(r.logSpawns, 1)
	}
	return r.Runner.Start(ctx, gitPath, spec)
}

func newWalkTestConnWithRunner(t *testing.T, runner gitclient.Runner, repoDir string) (*Conn, *Registry, string) {
	t.Helper()
	registry := NewRegistry(runner)
	t.Cleanup(registry.Close)
	conn := NewConn(ConnID("test-conn"), "test-client", "test-client-label", nil)
	summary, err := conn.Open(context.Background(), registry, "git", repoDir)
	if err != nil {
		t.Fatalf("conn.Open: %v", err)
	}
	return conn, registry, summary.RepoID
}

func TestWalk_StreamAndLoadMoreRaceProduceConsistentStore(t *testing.T) {
	skipWithoutGitWalk(t)
	repoDir := initWalkRepo(t, 12)
	conn, _, repoID := newWalkTestConn(t, repoDir)
	defer conn.Close()

	w, err := conn.Walk(repoID, "git", porcelain.WalkSpec{Scope: "all"}, 0, nil)
	if err != nil {
		t.Fatalf("Walk: %v", err)
	}

	var wg sync.WaitGroup
	var streamErr, loadErr error
	wg.Add(2)
	go func() {
		defer wg.Done()
		streamErr = w.Stream(context.Background(), nil, 5, func(StreamChunk) error { return nil })
	}()
	go func() {
		defer wg.Done()
		_, loadErr = w.ReadPage(context.Background(), 1)
	}()
	wg.Wait()
	if streamErr != nil {
		t.Fatalf("Stream: %v", streamErr)
	}
	if loadErr != nil {
		t.Fatalf("ReadPage: %v", loadErr)
	}

	loaded, _, exhausted, err := w.Status(context.Background())
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	if loaded != 12 {
		t.Fatalf("loaded = %d, want 12 -- a race between Stream and ReadPage on one Walk must not duplicate rows", loaded)
	}
	if !exhausted {
		t.Fatalf("expected the walk to be exhausted after either race outcome reads all 12 commits")
	}
}

func TestWalk_RefsChangedResetsToRowZero(t *testing.T) {
	skipWithoutGitWalk(t)
	repoDir := initWalkRepo(t, 3)
	conn, _, repoID := newWalkTestConn(t, repoDir)
	defer conn.Close()

	w, err := conn.Walk(repoID, "git", porcelain.WalkSpec{Scope: "all"}, 0, nil)
	if err != nil {
		t.Fatalf("Walk: %v", err)
	}

	var first []StreamChunk
	if err := w.Stream(context.Background(), nil, 2, func(c StreamChunk) error {
		first = append(first, c)
		return nil
	}); err != nil {
		t.Fatalf("first Stream: %v", err)
	}
	if len(first) == 0 || first[0].From != 0 {
		t.Fatalf("first stream chunks = %+v, want a chunk starting at row 0", first)
	}

	// The watcher fan-out marks stale without ever taking the walk's mutex (D13) -- MarkStale is
	// exactly that call.
	w.MarkStale()

	var second []StreamChunk
	if err := w.Stream(context.Background(), nil, 2, func(c StreamChunk) error {
		second = append(second, c)
		return nil
	}); err != nil {
		t.Fatalf("second Stream: %v", err)
	}
	if len(second) == 0 || second[0].From != 0 {
		t.Fatalf("second stream (after a refsChanged) first chunk = %+v, want From:0", second[0])
	}
}

func TestWalk_MarklessRowReplaysFromZeroWithBaseZero(t *testing.T) {
	skipWithoutGitWalk(t)
	repoDir := initWalkRepo(t, 5)
	conn, _, repoID := newWalkTestConn(t, repoDir)
	defer conn.Close()

	w, err := conn.Walk(repoID, "git", porcelain.WalkSpec{Scope: "all"}, 0, nil)
	if err != nil {
		t.Fatalf("Walk: %v", err)
	}

	// Rows loaded purely via ReadPage/loadMore never get a mark (only Stream's own packing loop
	// records one).
	if _, err := w.ReadPage(context.Background(), 1); err != nil {
		t.Fatalf("ReadPage: %v", err)
	}
	loaded, _, _, err := w.Status(context.Background())
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	if loaded != 5 {
		t.Fatalf("loaded = %d, want 5", loaded)
	}

	// resumeThroughRow == the store's own row count, but with no mark for it: falls back to row
	// 0, base 0.
	resume := loaded
	var chunks []StreamChunk
	if err := w.Stream(context.Background(), &resume, 500, func(c StreamChunk) error {
		chunks = append(chunks, c)
		return nil
	}); err != nil {
		t.Fatalf("Stream: %v", err)
	}
	if len(chunks) == 0 || chunks[0].From != 0 || chunks[0].Packed.DictionaryBase != 0 {
		t.Fatalf("chunks = %+v, want a first chunk {From:0 DictionaryBase:0} (mark-less fallback)", chunks)
	}
}

func TestWalk_ResumeThroughRowPastStoreClamps(t *testing.T) {
	skipWithoutGitWalk(t)
	repoDir := initWalkRepo(t, 5)
	conn, _, repoID := newWalkTestConn(t, repoDir)
	defer conn.Close()

	w, err := conn.Walk(repoID, "git", porcelain.WalkSpec{Scope: "all"}, 0, nil)
	if err != nil {
		t.Fatalf("Walk: %v", err)
	}
	if _, err := w.ReadPage(context.Background(), 1); err != nil {
		t.Fatalf("ReadPage: %v", err)
	}
	loaded, _, _, err := w.Status(context.Background())
	if err != nil || loaded != 5 {
		t.Fatalf("Status: loaded=%d err=%v", loaded, err)
	}

	// resumeThroughRow past the store's actual row count clamps down to the row count rather than
	// erroring or reading out of bounds -- and, mark-less there (nothing has streamed yet), falls
	// back to row 0/base 0 the same way a mark-less exact row does.
	pastEnd := loaded + 100
	var chunks []StreamChunk
	if err := w.Stream(context.Background(), &pastEnd, 500, func(c StreamChunk) error {
		chunks = append(chunks, c)
		return nil
	}); err != nil {
		t.Fatalf("Stream (resumeThroughRow past the end): %v", err)
	}
	if len(chunks) == 0 || chunks[0].From != 0 {
		t.Fatalf("chunks = %+v, want a first chunk From:0", chunks)
	}
}

// TestWalk_ReopenDoesNotReadAnUnrequestedPage is D12's own proof: a graph.loadMore round trip
// (an explicit ReadPage) followed by the client's own stream re-open must read exactly one page in
// total, not two.
func TestWalk_ReopenDoesNotReadAnUnrequestedPage(t *testing.T) {
	skipWithoutGitWalk(t)
	repoDir := initWalkRepo(t, 10)
	var logSpawns int32
	runner := countingRunner{Runner: gitclient.NewExecRunner(), logSpawns: &logSpawns}
	conn, _, repoID := newWalkTestConnWithRunner(t, runner, repoDir)
	defer conn.Close()

	w, err := conn.Walk(repoID, "git", porcelain.WalkSpec{Scope: "all"}, 3, nil)
	if err != nil {
		t.Fatalf("Walk: %v", err)
	}

	// The walk's very first stream is allowed to read exactly one page (nothing cached yet).
	if err := w.Stream(context.Background(), nil, 500, func(StreamChunk) error { return nil }); err != nil {
		t.Fatalf("first Stream: %v", err)
	}
	loaded, _, exhausted, err := w.Status(context.Background())
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	if loaded != 3 || exhausted {
		t.Fatalf("after first Stream: loaded=%d exhausted=%v, want loaded=3 exhausted=false", loaded, exhausted)
	}

	// A graph.loadMore click: an explicit ReadPage.
	if _, err := w.ReadPage(context.Background(), 1); err != nil {
		t.Fatalf("ReadPage: %v", err)
	}
	loaded, _, _, err = w.Status(context.Background())
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	if loaded != 6 {
		t.Fatalf("after loadMore: loaded=%d, want 6", loaded)
	}

	// The client's own stream re-open, immediately after: must replay the store, never read a
	// further page.
	var gotChunks []StreamChunk
	resume := loaded
	if err := w.Stream(context.Background(), &resume, 500, func(c StreamChunk) error {
		gotChunks = append(gotChunks, c)
		return nil
	}); err != nil {
		t.Fatalf("second Stream (re-open): %v", err)
	}
	for _, c := range gotChunks {
		if c.Source != "cache" {
			t.Fatalf("re-open chunk source = %q, want cache -- a re-open must never read an unrequested page", c.Source)
		}
	}
	loaded, _, _, err = w.Status(context.Background())
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	if loaded != 6 {
		t.Fatalf("after re-open: loaded=%d, want 6 unchanged -- a re-open read an extra page it was not asked for", loaded)
	}
}

func TestWalk_DisposingConnDoesNotBlockAFreshOpenOfTheSameRepo(t *testing.T) {
	skipWithoutGitWalk(t)
	repoDir := initWalkRepo(t, 3)
	conn, registry, repoID := newWalkTestConn(t, repoDir)

	w, err := conn.Walk(repoID, "git", porcelain.WalkSpec{Scope: "all"}, 0, nil)
	if err != nil {
		t.Fatalf("Walk: %v", err)
	}
	// Force the walk to actually spawn its paused `git log` process.
	if _, err := w.ReadPage(context.Background(), 1); err != nil {
		t.Fatalf("ReadPage: %v", err)
	}

	// Close disposes the walk (killing its process) before releasing the repo ref (D13) --
	// synchronously, so by the time this returns nothing from the old walk should still be
	// holding the repository.
	conn.Close()

	conn2 := NewConn(ConnID("test-conn-2"), "test-client-2", "test-client-2-label", nil)
	defer conn2.Close()
	if _, err := conn2.Open(context.Background(), registry, "git", repoDir); err != nil {
		t.Fatalf("second conn.Open after disposing the first: %v", err)
	}
}
