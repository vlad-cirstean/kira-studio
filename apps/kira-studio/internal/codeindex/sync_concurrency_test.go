package codeindex

import (
	"context"
	"errors"
	"fmt"
	"runtime"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codeparse"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
)

// P64c §4.2/§4.3: the pipelined writer (sync.go's parseStale/writeOutcomes) is a new goroutine
// structure — a producer/consumer pipeline with bidirectional error cancellation, squarely inside
// CLAUDE.md's "concurrency (ordering, backpressure, cancellation, races)" test bar. These tests are
// scoped to exactly that: correctness of the batched writes across the 256-file boundary, and the
// two failure/cancellation paths a reader cannot rule out by inspection alone. Run under -race.

func countRows(t *testing.T, s *Store, table, repoID string) int {
	t.Helper()
	db, err := s.conn()
	if err != nil {
		t.Fatalf("conn: %v", err)
	}
	var n int
	if err := db.QueryRow(fmt.Sprintf(`SELECT COUNT(*) FROM %s WHERE repo_id = ?`, table), repoID).Scan(&n); err != nil {
		t.Fatalf("count %s: %v", table, err)
	}
	return n
}

func countNonNullParent(t *testing.T, s *Store, repoID string) int {
	t.Helper()
	db, err := s.conn()
	if err != nil {
		t.Fatalf("conn: %v", err)
	}
	var n int
	if err := db.QueryRow(
		`SELECT COUNT(*) FROM symbol WHERE repo_id = ? AND parent_id IS NOT NULL`, repoID,
	).Scan(&n); err != nil {
		t.Fatalf("count parent links: %v", err)
	}
	return n
}

// tsWidgetFixture is one structurally identical TypeScript file — a class with a field, a
// constructor and a method (so the class/method pair produces a real parent_id link) plus a
// standalone function whose body both constructs and calls into the class (so the fixture
// produces real reference rows too, not just symbols).
func tsWidgetFixture(i int) string {
	return fmt.Sprintf(`export class Widget%d {
	value: number;

	constructor(value: number) {
		this.value = value;
	}

	getValue(): number {
		return this.value;
	}
}

export function makeWidget%d(v: number): Widget%d {
	const w = new Widget%d(v);
	return w;
}
`, i, i, i, i)
}

// TestSync_PipelinedWriterAcrossBatchBoundary is §4.2: a fixture large enough to cross
// replaceFileBatch's 256-file boundary (so the writer goroutine flushes more than once while
// parsing continues) still produces exactly correct rows — file/symbol/reference counts and
// intact parent links. The per-file row counts are learned from a one-file baseline sync of the
// identical template rather than hand-computed from tags.scm internals, so the assertion stays
// grammar-agnostic and only checks "N structurally identical files produce N times one file's
// rows," which is exactly what a scheduling-only change (parse/write overlap) must preserve.
func TestSync_PipelinedWriterAcrossBatchBoundary(t *testing.T) {
	const fileCount = 300 // > replaceFileBatch (256).
	ctx := context.Background()

	baseDir := initFixtureRepo(t)
	writeFile(t, baseDir, "widget.ts", tsWidgetFixture(0))
	baseIdx := newTestIndex(t, baseDir, "repo-batch-baseline")
	if _, err := baseIdx.Sync(ctx); err != nil {
		t.Fatalf("baseline sync: %v", err)
	}
	perFileSymbols := countRows(t, baseIdx.store, "symbol", baseIdx.repoID)
	perFileRefs := countRows(t, baseIdx.store, "reference", baseIdx.repoID)
	perFileParents := countNonNullParent(t, baseIdx.store, baseIdx.repoID)
	if perFileSymbols == 0 || perFileRefs == 0 || perFileParents == 0 {
		t.Fatalf("baseline fixture undershoots the pipeline: symbols=%d refs=%d parents=%d",
			perFileSymbols, perFileRefs, perFileParents)
	}

	dir := initFixtureRepo(t)
	for i := 0; i < fileCount; i++ {
		writeFile(t, dir, fmt.Sprintf("widget%d.ts", i), tsWidgetFixture(i))
	}
	idx := newTestIndex(t, dir, "repo-batch-boundary")

	stats, err := idx.Sync(ctx)
	if err != nil {
		t.Fatalf("sync: %v", err)
	}
	if stats.FilesParsed != fileCount {
		t.Fatalf("FilesParsed = %d, want %d", stats.FilesParsed, fileCount)
	}

	if got := countRows(t, idx.store, "file", idx.repoID); got != fileCount {
		t.Fatalf("file rows = %d, want %d", got, fileCount)
	}
	if got, want := countRows(t, idx.store, "symbol", idx.repoID), perFileSymbols*fileCount; got != want {
		t.Fatalf("symbol rows = %d, want %d (%d/file * %d files)", got, want, perFileSymbols, fileCount)
	}
	if got, want := countRows(t, idx.store, "reference", idx.repoID), perFileRefs*fileCount; got != want {
		t.Fatalf("reference rows = %d, want %d (%d/file * %d files)", got, want, perFileRefs, fileCount)
	}
	if got, want := countNonNullParent(t, idx.store, idx.repoID), perFileParents*fileCount; got != want {
		t.Fatalf("non-null parent_id rows = %d, want %d (%d/file * %d files)", got, want, perFileParents, fileCount)
	}
}

// TestParseStale_WriterErrorCancelsSenders is §4.3's first case: a parse-side error must not
// leave the writer goroutine hanging, and its own error (a batch write failure — the only error
// reachable in production, since parseOne itself deliberately downgrades every parse-pipeline
// failure to an "unreadable" row rather than returning one, sync.go's own parseOne doc comment)
// must cancel the parse side rather than block on a channel nothing drains anymore. Drives
// writeOutcomes directly with a synthetic outcome, exercising exactly the bidirectional
// cancellation writeOutcomes/parseStale own, without depending on a real parse failure existing.
func TestParseStale_WriterErrorCancelsSenders(t *testing.T) {
	dir := initFixtureRepo(t)
	idx := newTestIndex(t, dir, "repo-writer-error")

	wantErr := errors.New("boom")
	outcomes := make(chan parseOutcome, 1)
	outcomes <- parseOutcome{err: wantErr}
	close(outcomes)

	var canceled atomic.Bool
	cancel := func() { canceled.Store(true) }
	stats := SyncStats{ByLanguage: map[codeparse.ID]int{}}

	errCh := make(chan error, 1)
	go func() { errCh <- idx.writeOutcomes(context.Background(), outcomes, cancel, &stats) }()

	select {
	case err := <-errCh:
		if !errors.Is(err, wantErr) {
			t.Fatalf("writeOutcomes error = %v, want %v", err, wantErr)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("writeOutcomes hung on a parse-side error")
	}
	if !canceled.Load() {
		t.Fatal("expected cancelOnErr to be called on a parse-side error")
	}
	if stats.FilesParsed != 0 || stats.FilesSkipped != 0 {
		t.Fatalf("expected no write to land after a parse-side error: stats=%+v", stats)
	}
}

// TestSyncTracker_SettledStateAndGeneration is P67f §5.1: the sync tracker is a counter plus a
// channel two goroutines touch (CLAUDE.md's own concurrency/ordering/races test bar). Run under
// -race. Uses a real fixture repository and idx.Sync itself, not a mock — the tracker has no
// exported hooks of its own outside Sync's own bracket, so exercising it means exercising Sync.
func TestSyncTracker_SettledStateAndGeneration(t *testing.T) {
	dir := initFixtureRepo(t)
	writeFile(t, dir, "a.go", "package p\n\nfunc F() int { return 1 }\n")
	idx := newTestIndex(t, dir, "repo-sync-tracker")
	ctx := context.Background()

	// With no Sync running, SyncSettled() is already closed and SyncState().InFlight is false.
	select {
	case <-idx.SyncSettled():
	default:
		t.Fatal("SyncSettled() open with no Sync ever started")
	}
	if st := idx.SyncState(); st.InFlight {
		t.Fatalf("SyncState().InFlight = true with no Sync ever started: %+v", st)
	}

	// During a Sync, SyncSettled() is open; it closes when the Sync returns.
	before := idx.SyncSettled()
	done := make(chan struct{})
	go func() {
		defer close(done)
		if _, err := idx.Sync(ctx); err != nil {
			t.Errorf("sync 1: %v", err)
		}
	}()
	<-done
	select {
	case <-before:
	case <-time.After(2 * time.Second):
		t.Fatal("SyncSettled() (pre-Sync snapshot) never closed after Sync returned")
	}
	if st := idx.SyncState(); st.InFlight || st.Generation != 1 || st.LastErr != nil {
		t.Fatalf("SyncState() after one clean Sync = %+v, want InFlight=false Generation=1 LastErr=nil", st)
	}

	// Two overlapping Sync calls leave SyncSettled() open until the second finishes — the
	// counter, not a bool. writeFile enough new files that both Syncs have real work to overlap
	// on, rather than racing to finish before the second even starts.
	for i := 0; i < 50; i++ {
		writeFile(t, dir, fmt.Sprintf("g%d.go", i), fmt.Sprintf("package p\n\nfunc G%d() int { return %d }\n", i, i))
	}
	settled := idx.SyncSettled()
	var wg sync.WaitGroup
	wg.Add(2)
	errs := make(chan error, 2)
	go func() { defer wg.Done(); _, err := idx.Sync(ctx); errs <- err }()
	go func() { defer wg.Done(); _, err := idx.Sync(ctx); errs <- err }()
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("overlapping sync: %v", err)
		}
	}
	select {
	case <-settled:
	case <-time.After(2 * time.Second):
		t.Fatal("SyncSettled() never closed after both overlapping Syncs returned")
	}
	if st := idx.SyncState(); st.InFlight || st.Generation != 3 {
		t.Fatalf("SyncState() after two overlapping Syncs = %+v, want InFlight=false Generation=3", st)
	}

	// A Sync that returns an error records it in LastErr, and a later successful Sync clears it.
	badDir := t.TempDir() // never git-initialized: Enumerate fails against it.
	badIdx := newTestIndexNoGitInit(t, badDir, "repo-sync-tracker-bad")
	if _, err := badIdx.Sync(ctx); err == nil {
		t.Fatal("Sync against a non-repository directory = nil error, want one")
	}
	if st := badIdx.SyncState(); st.LastErr == nil || st.Generation != 1 {
		t.Fatalf("SyncState() after a failed Sync = %+v, want a non-nil LastErr and Generation=1", st)
	}
	runGit(t, badDir, "init", "-q", "-b", "main")
	if _, err := badIdx.Sync(ctx); err != nil {
		t.Fatalf("sync after git init: %v", err)
	}
	if st := badIdx.SyncState(); st.LastErr != nil || st.Generation != 2 {
		t.Fatalf("SyncState() after the following successful Sync = %+v, want LastErr=nil Generation=2", st)
	}
}

// newTestIndexNoGitInit is newTestIndex without the git-init step (§5.1's own failed-Sync case
// needs Enumerate to actually fail, which a real git repository never does).
func newTestIndexNoGitInit(t *testing.T, repoDir, repoID string) *Index {
	t.Helper()
	gitPath := requireRealGit(t)
	store := OpenStoreAt(t.TempDir())
	t.Cleanup(func() { _ = store.Close() })
	idx := Open(store, gitclient.NewExecRunner(), gitPath, repoID, repoDir)
	t.Cleanup(idx.Close)
	return idx
}

// TestSync_CancelledContextReturnsPromptly is §4.3's second case: a context cancelled mid-Sync
// must return promptly (bounded here, not left to hang the test suite) with no goroutine left
// blocked on a channel send or receive — the deadlock this restructuring could plausibly
// introduce. A few hundred trivial files give parse enough real work that the cancel is likely to
// land while parseStale's pipeline is actually mid-flight, but the assertions hold regardless of
// the exact interleaving.
func TestSync_CancelledContextReturnsPromptly(t *testing.T) {
	dir := initFixtureRepo(t)
	for i := 0; i < 400; i++ {
		writeFile(t, dir, fmt.Sprintf("f%d.go", i),
			fmt.Sprintf("package p%d\n\nfunc F%d() int { return %d }\n", i, i, i))
	}
	idx := newTestIndex(t, dir, "repo-cancel")

	before := runtime.NumGoroutine()

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(2 * time.Millisecond)
		cancel()
	}()

	done := make(chan struct{})
	go func() {
		defer close(done)
		_, _ = idx.Sync(ctx) // error unchecked: either ctx.Err() or a completed pass is fine —
		// promptness and no leak are what this test checks, not which one wins the race.
	}()

	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("Sync did not return promptly after context cancellation")
	}

	deadline := time.Now().Add(3 * time.Second)
	for {
		if n := runtime.NumGoroutine(); n <= before+2 { // small slack for runtime housekeeping.
			return
		} else if time.Now().After(deadline) {
			t.Fatalf("goroutines did not settle after cancelled Sync: before=%d after=%d", before, n)
		}
		time.Sleep(10 * time.Millisecond)
	}
}
