package repomap

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codeindex"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
)

// TestWaitReadyBlocksThenProceeds is §11.2's own first claim: a tool call before ready blocks and
// then proceeds once the gate closes.
func TestWaitReadyBlocksThenProceeds(t *testing.T) {
	// idx.SyncSettled() is P67f's own second wait — an already-closed default (no Sync ever run,
	// codeindex.Open's own initialization) so this test still proceeds past it immediately, the
	// same as before P67f.
	idx := codeindex.Open(nil, nil, "", "test-repo", "/repo")
	inst := &repoInstance{root: "/repo", ready: make(chan struct{}), done: make(chan struct{}), idx: idx}

	done := make(chan error, 1)
	go func() { done <- inst.waitReady(context.Background()) }()

	select {
	case err := <-done:
		t.Fatalf("waitReady returned before the gate closed (err=%v)", err)
	case <-time.After(50 * time.Millisecond):
		// still blocked, as expected
	}

	close(inst.ready)

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("waitReady after close(ready) = %v, want nil", err)
		}
	case <-time.After(time.Second):
		t.Fatal("waitReady did not return promptly after the gate closed")
	}
}

// TestWaitReadyTimesOut is §11.2's second claim: a tool call that outlasts the bound returns an
// error naming the repository — repomap/tools.go's own notReadyResult turns this into IsError,
// never an empty result.
func TestWaitReadyTimesOut(t *testing.T) {
	old := readyTimeout
	readyTimeout = 20 * time.Millisecond
	defer func() { readyTimeout = old }()

	inst := &repoInstance{root: "/repo", ready: make(chan struct{}), done: make(chan struct{})}
	err := inst.waitReady(context.Background())
	if err == nil {
		t.Fatal("waitReady = nil, want a timeout error")
	}
	if !strings.Contains(err.Error(), "/repo") || !strings.Contains(err.Error(), "still building") {
		t.Fatalf("waitReady error = %q, want it to name the repository and say it is still building", err.Error())
	}
}

// TestWaitReadyRespectsContextCancellation covers Detach/Close-during-a-pending-wait (§11.2's fourth
// claim): a cancelled context returns immediately rather than waiting out the full timeout.
func TestWaitReadyRespectsContextCancellation(t *testing.T) {
	old := readyTimeout
	readyTimeout = time.Minute
	defer func() { readyTimeout = old }()

	ctx, cancel := context.WithCancel(context.Background())
	inst := &repoInstance{root: "/repo", ready: make(chan struct{}), done: make(chan struct{})}

	done := make(chan error, 1)
	go func() { done <- inst.waitReady(ctx) }()
	cancel()

	select {
	case err := <-done:
		if err == nil {
			t.Fatal("waitReady after cancel = nil, want context.Canceled")
		}
	case <-time.After(time.Second):
		t.Fatal("waitReady did not return promptly after context cancellation")
	}
}

// TestWaitReadyWaitsOutInFlightSyncThenTimesOut is P67f §5.2's one added case: with the initial
// gate already open and a full Sync in flight (§1.2 W2's own shape — a watcher rescan running
// behind an already-open gate), a tool call blocks rather than answering, and returns the
// "reindexing" message once the bound elapses. The first wait's own behavior is already covered
// above, so this is the one case that matters: the second wait actually blocks on a real Sync.
func TestWaitReadyWaitsOutInFlightSyncThenTimesOut(t *testing.T) {
	old := readyTimeout
	readyTimeout = 10 * time.Millisecond
	defer func() { readyTimeout = old }()

	gitPath, err := exec.LookPath("git")
	if err != nil {
		t.Skip("no git on PATH in this environment")
	}
	dir := t.TempDir()
	cmd := exec.Command(gitPath, "init", "-q", "-b", "main")
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git init: %v\n%s", err, out)
	}
	// Enough files that Sync stays in flight through the polling detection below and the lowered
	// readyTimeout that follows it.
	for i := 0; i < 400; i++ {
		content := fmt.Sprintf("package p%d\n\nfunc F%d() int { return %d }\n", i, i, i)
		if err := os.WriteFile(filepath.Join(dir, fmt.Sprintf("f%d.go", i)), []byte(content), 0o644); err != nil {
			t.Fatalf("write: %v", err)
		}
	}

	store := codeindex.OpenStoreAt(t.TempDir())
	idx := codeindex.Open(store, gitclient.NewExecRunner(), gitPath, "test-repo-rescan", dir)

	syncCtx, cancelSync := context.WithCancel(context.Background())
	syncDone := make(chan struct{})
	go func() { defer close(syncDone); _, _ = idx.Sync(syncCtx) }()
	// Cancel and drain the background Sync, then close idx/store, before TempDir cleanup runs —
	// otherwise a still-running Sync can still be writing when cleanup removes its directories.
	t.Cleanup(func() {
		cancelSync()
		<-syncDone
		idx.Close()
		_ = store.Close()
	})

	deadline := time.Now().Add(5 * time.Second)
	for !idx.SyncState().InFlight {
		if time.Now().After(deadline) {
			t.Fatal("Sync never became visible as in-flight")
		}
		time.Sleep(50 * time.Microsecond)
	}

	inst := &repoInstance{root: dir, ready: make(chan struct{}), done: make(chan struct{}), idx: idx}
	close(inst.ready) // initial gate already open — §1.2 W2's own shape.

	err = inst.waitReady(context.Background())
	if err == nil {
		t.Fatal("waitReady = nil, want a reindexing timeout error")
	}
	if !strings.Contains(err.Error(), "reindexing") {
		t.Fatalf("waitReady error = %q, want it to say the index is reindexing", err.Error())
	}
}
