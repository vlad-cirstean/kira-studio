package gitsession

import (
	"bytes"
	"context"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient/porcelain"
	"github.com/kirathecat/kira-studio/internal/testx"
)

// skipWithoutGitWalk is testx.SkipWithoutGit (P107 I2-28) — suffixed since stack_test.go's and
// queries_test.go's own copies live in this same package and can't all share the bare name.
var skipWithoutGitWalk = testx.SkipWithoutGit

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
	t.Parallel()
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

// scriptedProcess is a canned gitclient.Process: Stdout() streams stdout (for logsession's own
// streaming reads), Wait() returns waitResult (for gitclient.Run's buffered callers, e.g.
// logsession.snapshot). Close is a plain no-op close of the stream.
type scriptedProcess struct {
	stdout     io.ReadCloser
	waitResult gitclient.Result
}

func newBytesProcess(b []byte) *scriptedProcess {
	return &scriptedProcess{stdout: io.NopCloser(bytes.NewReader(b)), waitResult: gitclient.Result{Stdout: b, ExitCode: 0}}
}
func (p *scriptedProcess) Stdout() io.ReadCloser           { return p.stdout }
func (p *scriptedProcess) Stdin() io.WriteCloser           { return nil }
func (p *scriptedProcess) Wait() (gitclient.Result, error) { return p.waitResult, nil }
func (p *scriptedProcess) Close() error                    { return p.stdout.Close() }

// pipeProcess simulates a `git log` still running: its stdout delivers exactly one write's worth
// of bytes, then genuinely blocks (no EOF) until Close kills it — deterministic, unlike a real
// process's own OS-pipe buffering (which can make a "second raw read" resolve instantly regardless
// of cancellation timing).
type pipeProcess struct {
	pr *io.PipeReader
	pw *io.PipeWriter
}

func (p *pipeProcess) Stdout() io.ReadCloser           { return p.pr }
func (p *pipeProcess) Stdin() io.WriteCloser           { return nil }
func (p *pipeProcess) Wait() (gitclient.Result, error) { return gitclient.Result{ExitCode: 0}, nil }
func (p *pipeProcess) Close() error {
	_ = p.pw.CloseWithError(io.EOF)
	return p.pr.Close()
}

func argvEqual(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// scriptedWalkRunner delegates everything to a real exec runner EXCEPT the walk's own two exact
// commands (the ref snapshot and the log session's base/skip spawns), which it answers with
// pre-captured real git output under full test control — chunk1 (the log session's FIRST spawn)
// arrives through a still-open pipe (pipeProcess) so a second raw read genuinely blocks, giving a
// deterministic cancellation race instead of one that depends on OS pipe buffering.
type scriptedWalkRunner struct {
	real                       gitclient.Runner
	refArgs, logArgs, skipArgs []string
	refBytes, chunk1, chunk2   []byte
	logSpawns                  int32
}

func (r *scriptedWalkRunner) Start(ctx context.Context, gitPath string, spec gitclient.Spec) (gitclient.Process, error) {
	switch {
	case argvEqual(spec.Args, r.refArgs):
		return newBytesProcess(r.refBytes), nil
	case argvEqual(spec.Args, r.logArgs):
		atomic.AddInt32(&r.logSpawns, 1)
		pr, pw := io.Pipe()
		go func() { _, _ = pw.Write(r.chunk1) }() // never closed, nothing more written: the next
		// raw read past chunk1 must block for real.
		return &pipeProcess{pr: pr, pw: pw}, nil
	case argvEqual(spec.Args, r.skipArgs):
		atomic.AddInt32(&r.logSpawns, 1)
		return newBytesProcess(r.chunk2), nil
	default:
		return r.real.Start(ctx, gitPath, spec)
	}
}

func captureGitOutput(t *testing.T, dir string, args []string) []byte {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_SYSTEM=/dev/null")
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("git %v: %v", args, err)
	}
	return out
}

// TestWalk_ReadPageCancelDoesNotDiscardLoadedStore is F4's own regression proof (P108 Part 16
// review): Part 14's own F2 fix reset the whole walk on EVERY ReadPage error, not just a
// permanently-failed session. A client `cancel` frame cancels the host ctx — resumable, readCount
// left exact — but hit the same resetLocked call and wrongly discarded every row already loaded,
// breaking the "rows already read are kept" contract; the follow-up re-stream then reloaded from
// row 0 instead of resuming. Uses scriptedWalkRunner so the cancellation lands on a genuinely
// in-flight read, deterministically, rather than racing real OS pipe buffering.
func TestWalk_ReadPageCancelDoesNotDiscardLoadedStore(t *testing.T) {
	t.Parallel()
	skipWithoutGitWalk(t)
	repoDir := initWalkRepo(t, 6)
	spec := porcelain.WalkSpec{Scope: "all"}

	refArgs := porcelain.RefSnapshotArgs()
	logArgs := porcelain.LogSessionArgs(spec)
	// logsession's own lookahead (Part 14's G16 D6): a page never returns after exactly filling
	// pageSize alone — it keeps reading until one more record parks in pending (definite proof
	// there is more) or EOF (definite proof there is not). So chunk1 carries pageSize+1 (3)
	// records: page 1 delivers 2 and queues the 3rd to pending in ONE raw read, with nothing left
	// to force a second, blocking one — that second, genuinely blocking raw read only happens once
	// pending drains on the NEXT ReadPage call, which is exactly the one this test cancels.
	skipArgs := porcelain.LogSessionSkipArgs(spec, 3)
	rev := porcelain.WalkArgs(spec)
	base := logArgs[:len(logArgs)-len(rev)]
	chunk1Args := append(append(append([]string{}, base...), "-n", "3"), rev...)

	refBytes := captureGitOutput(t, repoDir, refArgs)
	chunk1 := captureGitOutput(t, repoDir, chunk1Args)
	chunk2 := captureGitOutput(t, repoDir, skipArgs)

	runner := &scriptedWalkRunner{
		real:    gitclient.NewExecRunner(),
		refArgs: refArgs, logArgs: logArgs, skipArgs: skipArgs,
		refBytes: refBytes, chunk1: chunk1, chunk2: chunk2,
	}
	conn, _, repoID := newWalkTestConnWithRunner(t, runner, repoDir)
	defer conn.Close()

	// pageSize 2: the first ReadPage(1) delivers 2 of chunk1's 3 records and queues the 3rd to
	// pending, leaving the session open (not exhausted) for the cancelled read that follows.
	w, err := conn.Walk(repoID, "git", spec, 2, nil)
	if err != nil {
		t.Fatalf("Walk: %v", err)
	}

	if _, err := w.ReadPage(context.Background(), 1); err != nil {
		t.Fatalf("ReadPage (first): %v", err)
	}
	loadedBefore, _, exhausted, err := w.Status(context.Background())
	if err != nil {
		t.Fatalf("Status (first): %v", err)
	}
	if loadedBefore != 2 || exhausted {
		t.Fatalf("first ReadPage: loaded=%d exhausted=%v, want loaded=2, exhausted=false", loadedBefore, exhausted)
	}
	logBefore := w.log

	// The cancelled call first drains chunk1's one pending (already-parsed, queued) record —
	// pending delivery never touches ctx — THEN tries a genuinely new raw read past it, which
	// blocks on the still-open pipe and is what the cancellation actually interrupts.
	cancelledCtx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := w.ReadPage(cancelledCtx, 1); err == nil {
		t.Fatal("ReadPage with an already-cancelled ctx: expected an error, got nil")
	}

	if w.log.Failed() {
		t.Fatal("a context cancellation must not mark the session permanently failed")
	}
	if w.log != logBefore {
		t.Fatal("a context cancellation must not reset (replace) the walk's own log session")
	}
	loadedAfterCancel, _, _, err := w.Status(context.Background())
	if err != nil {
		t.Fatalf("Status (after cancel): %v", err)
	}
	// The pending record drained (loadedBefore+1 = 3) before the read that actually got cancelled
	// — the important assertion either way is that it never drops BELOW loadedBefore (a reset to
	// row 0, this finding's own bug).
	if loadedAfterCancel < loadedBefore {
		t.Fatalf("loaded = %d after a cancelled read, want >= %d -- a plain cancel must not discard already-loaded rows", loadedAfterCancel, loadedBefore)
	}
	if loadedAfterCancel != loadedBefore+1 {
		t.Fatalf("loaded = %d after a cancelled read, want %d (the one already-pending record, delivered before the read that actually got cancelled)", loadedAfterCancel, loadedBefore+1)
	}

	// A fresh ctx must resume correctly from here (a fresh spawn with --skip=2) — no duplicated
	// or lost rows, ending exhausted at all 6 commits.
	for {
		started, err := w.ReadPage(context.Background(), 1)
		if err != nil {
			t.Fatalf("ReadPage (resume): %v", err)
		}
		if !started {
			break
		}
	}
	loadedFinal, _, exhaustedFinal, err := w.Status(context.Background())
	if err != nil {
		t.Fatalf("Status (final): %v", err)
	}
	if !exhaustedFinal {
		t.Fatal("expected the walk to be exhausted after resuming to the end")
	}
	if loadedFinal != 6 {
		t.Fatalf("loaded = %d after resuming to exhaustion, want 6 (no duplicates, nothing lost)", loadedFinal)
	}
	if got := atomic.LoadInt32(&runner.logSpawns); got != 2 {
		t.Fatalf("log spawns = %d, want 2 (the initial spawn plus exactly one resume after the cancel)", got)
	}
}

func TestWalk_RefsChangedResetsToRowZero(t *testing.T) {
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
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

// TestWalk_StreamReplayReportsExhausted is G16 F4's direct regression guard: a cache-replay
// re-stream of an already-exhausted walk must end with Exhausted:true, not the hardcoded false
// emitRange's replay loop used to pass. Every re-stream (a webview hide/reveal, graph.loadMore's
// own resync, the review sidebar's own always-from-zero replay) goes through exactly this path,
// and this is the state that produced the reported "Load the last 0" button. Before D5 this test
// fails on the second Stream call.
func TestWalk_StreamReplayReportsExhausted(t *testing.T) {
	t.Parallel()
	skipWithoutGitWalk(t)
	repoDir := initWalkRepo(t, 5)
	conn, _, repoID := newWalkTestConn(t, repoDir)
	defer conn.Close()

	// pageSize >= N: the walk's very first Stream reads everything in one page.
	w, err := conn.Walk(repoID, "git", porcelain.WalkSpec{Scope: "all"}, 100, nil)
	if err != nil {
		t.Fatalf("Walk: %v", err)
	}

	var first []StreamChunk
	if err := w.Stream(context.Background(), nil, 500, func(c StreamChunk) error {
		first = append(first, c)
		return nil
	}); err != nil {
		t.Fatalf("first Stream: %v", err)
	}
	if len(first) == 0 {
		t.Fatalf("first Stream emitted no chunks")
	}
	if last := first[len(first)-1]; last.Source != "git" || !last.Exhausted {
		t.Fatalf("first Stream's last chunk = %+v, want {Source:git Exhausted:true}", last)
	}

	// Re-stream from row 0: a fresh webview mount, or the review sidebar's own always-from-zero
	// replay (F4). Every chunk comes from cache -- no git read runs (D12's own guard).
	resume := 0
	var second []StreamChunk
	if err := w.Stream(context.Background(), &resume, 500, func(c StreamChunk) error {
		second = append(second, c)
		return nil
	}); err != nil {
		t.Fatalf("second Stream (replay): %v", err)
	}
	if len(second) == 0 {
		t.Fatalf("second Stream emitted no chunks")
	}
	last := second[len(second)-1]
	if last.Source != "cache" {
		t.Fatalf("second Stream's last chunk source = %q, want cache", last.Source)
	}
	if !last.Exhausted {
		t.Fatalf("second Stream's last chunk Exhausted = false, want true -- this is F4's bug: a cache replay must tell the truth about exhaustion")
	}
	if last.Remaining != 0 {
		t.Fatalf("second Stream's last chunk Remaining = %d, want 0", last.Remaining)
	}
}

func TestWalk_DisposingConnDoesNotBlockAFreshOpenOfTheSameRepo(t *testing.T) {
	t.Parallel()
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
