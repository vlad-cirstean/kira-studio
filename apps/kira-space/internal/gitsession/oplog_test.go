package gitsession

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/oplog"
)

func newOpLogRepo(t *testing.T) string {
	t.Helper()
	skipWithoutGitStack(t)
	dir := t.TempDir()
	runGitStack(t, dir, "init", "-q", "-b", "main")
	writeFileStack(t, dir, "f.txt", "x\n")
	runGitStack(t, dir, "add", "f.txt")
	runGitStack(t, dir, "commit", "-q", "-m", "c1")
	return dir
}

func TestOpLog_RunOpSuccessRecordsCommandAndSource(t *testing.T) {
	t.Parallel()
	log := oplog.New()
	conn, entry := newTestEntry(t, "oplog-conn", newOpLogRepo(t), testEntryOpts{opLog: log})

	res, err := entry.RunOp(context.Background(), conn.ID, conn.ClientLabel, OpRequest{Kind: "branchCreate", Name: "feat", StartPoint: "main"})
	if err != nil || !res.OK {
		t.Fatalf("RunOp(branchCreate) = %+v, %v", res, err)
	}

	recs := log.Recent(10)
	if len(recs) != 1 {
		t.Fatalf("records = %d, want 1", len(recs))
	}
	r := recs[0]
	if r.Status != oplog.StatusOK || r.Kind != "branchCreate" || r.Source != "test-client-label" {
		t.Fatalf("record = %+v", r)
	}
	if r.Command == nil || !strings.HasPrefix(*r.Command, "git branch") {
		t.Fatalf("command = %v, want a git branch invocation", r.Command)
	}
	if r.DurationMs == nil || r.RepoName == "" || r.RepoRoot == "" {
		t.Fatalf("record missing duration or repo identity: %+v", r)
	}
}

func TestOpLog_RunOpFailureRecordsError(t *testing.T) {
	t.Parallel()
	log := oplog.New()
	conn, entry := newTestEntry(t, "oplog-conn", newOpLogRepo(t), testEntryOpts{opLog: log})

	res, err := entry.RunOp(context.Background(), conn.ID, conn.ClientLabel, OpRequest{Kind: "checkout", Target: "no-such-ref", Mode: "switch"})
	if err != nil || res.OK {
		t.Fatalf("RunOp(checkout missing) = %+v, %v, want a classified failure", res, err)
	}
	recs := log.Recent(10)
	if len(recs) != 1 || recs[0].Status != oplog.StatusError || recs[0].Error == nil || *recs[0].Error == "" {
		t.Fatalf("records = %+v, want one error record with a message", recs)
	}
}

func TestOpLog_NilConnRemoteIsNotLogged(t *testing.T) {
	t.Parallel()
	dir := newOpLogRepo(t)
	remoteDir := t.TempDir()
	runGitStack(t, remoteDir, "init", "-q", "--bare", "-b", "main")
	runGitStack(t, dir, "remote", "add", "origin", remoteDir)
	runGitStack(t, dir, "push", "-q", "origin", "main")
	log := oplog.New()
	_, entry := newTestEntry(t, "oplog-conn", dir, testEntryOpts{opLog: log})

	res, err := entry.RunRemote(context.Background(), nil, RemoteOpParams{Kind: "fetch", Remote: "origin"}, RemoteDeps{})
	if err != nil || !res.OK {
		t.Fatalf("RunRemote(fetch, nil conn) = %+v, %v", res, err)
	}
	if recs := log.Recent(10); len(recs) != 0 {
		t.Fatalf("records = %+v, want none for a nil-conn fetch", recs)
	}
}

// parkFetchRunner parks a fetch spawn until its ctx is cancelled.
type parkFetchRunner struct {
	gitclient.Runner
	started chan struct{}
}

func (r *parkFetchRunner) Start(ctx context.Context, gitPath string, spec gitclient.Spec) (gitclient.Process, error) {
	if len(spec.Args) > 0 && spec.Args[0] == "fetch" {
		close(r.started)
		<-ctx.Done()
		return nil, ctx.Err()
	}
	return r.Runner.Start(ctx, gitPath, spec)
}

func TestOpLog_CancelledFetchEndsCancelled(t *testing.T) {
	t.Parallel()
	dir := newOpLogRepo(t)
	remoteDir := t.TempDir()
	runGitStack(t, remoteDir, "init", "-q", "--bare", "-b", "main")
	runGitStack(t, dir, "remote", "add", "origin", remoteDir)
	runGitStack(t, dir, "push", "-q", "origin", "main")

	log := oplog.New()
	runner := &parkFetchRunner{Runner: gitclient.NewExecRunner(), started: make(chan struct{})}
	conn, entry := newTestEntry(t, "oplog-conn", dir, testEntryOpts{opLog: log, runner: runner})

	type outcome struct {
		res RemoteOpResult
		err error
	}
	done := make(chan outcome, 1)
	go func() {
		res, err := entry.RunRemote(context.Background(), conn, RemoteOpParams{Kind: "fetch", Remote: "origin"}, RemoteDeps{})
		done <- outcome{res, err}
	}()

	select {
	case <-runner.started:
	case <-time.After(10 * time.Second):
		t.Fatal("fetch spawn never started")
	}
	recs := log.Recent(1)
	if len(recs) != 1 || !recs[0].Cancellable || recs[0].Status != oplog.StatusRunning {
		t.Fatalf("running record = %+v, want one cancellable running record", recs)
	}
	if !log.Cancel(recs[0].ID) {
		t.Fatal("Log.Cancel returned false for a running fetch")
	}

	select {
	case o := <-done:
		if o.err != nil && !errors.Is(o.err, context.Canceled) {
			t.Fatalf("RunRemote: %v", o.err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("RunRemote did not return after cancel")
	}
	final := log.Recent(1)[0]
	if final.Status != oplog.StatusCancelled || final.Cancellable {
		t.Fatalf("final record = %+v, want cancelled and not cancellable", final)
	}
}
