package appflow_test

import (
	"path/filepath"
	"slices"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitrpc"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/oplog"
	"github.com/kirathecat/kira-studio/internal/testx"
)

func openRepo(t *testing.T, gs *flowharness.GitStream, dir string) string {
	t.Helper()
	var res gitrpc.RepoOpenResult
	gs.MustRequest("repo.open", gitrpc.RepoOpenParams{Path: dir}, &res)
	if res.Kind != "ok" {
		t.Fatalf("repo.open %s = %+v", dir, res)
	}
	return res.Repo.RepoID
}

func recent(t *testing.T, app *flowharness.App) []oplog.Record {
	t.Helper()
	rows, err := app.W.Ops.Recent(bridge.OpsRecentArgs{Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	return rows
}

func kinds(rows []oplog.Record) []string {
	out := make([]string, len(rows))
	for i, r := range rows {
		out[i] = r.Kind
	}
	return out
}

func TestOpsLogAndCancel(t *testing.T) {
	app := flowharness.New(t)
	repo, _ := cloneWithMain(app, filepath.Join(app.Work, "api"))
	gs := app.OpenGitStream()
	id := openRepo(t, gs, repo.Dir)

	if _, err := app.W.Ops.Recent(bridge.OpsRecentArgs{Limit: 0}); err == nil {
		t.Fatal("Recent with a zero limit succeeded")
	}
	if err := app.W.Ops.Cancel(bridge.OpsCancelArgs{}); err == nil {
		t.Fatal("Cancel without an id succeeded")
	}

	var fetched gitsession.RemoteOpResult
	gs.MustRequest("remote.run", gitrpc.RemoteRunParams{RepoID: id, RemoteOpParams: gitsession.RemoteOpParams{Kind: "fetch", Remote: "origin"}}, &fetched)
	if !fetched.OK {
		t.Fatalf("fetch = %+v", fetched)
	}
	var op gitsession.OpResult
	gs.MustRequest("op.run", gitrpc.OpRunParams{RepoID: id, Op: gitsession.OpRequest{Kind: "branchCreate", Name: "topic", StartPoint: "main", Checkout: true}}, &op)
	gs.MustRequest("graph.reportFailure", gitrpc.GraphReportFailureParams{RepoID: id, Reason: "corrupted"}, nil)

	rows := recent(t, app)
	if want := []string{"graph.load", "branchCreate", "fetch"}; !slices.Equal(kinds(rows), want) {
		t.Fatalf("op kinds newest first = %v, want %v", kinds(rows), want)
	}
	for _, r := range rows {
		if r.RepoName != "api" || r.RepoRoot == "" || r.Status == oplog.StatusRunning || r.StartedAt == "" {
			t.Errorf("record %+v is incomplete", r)
		}
	}
	if rows[0].Status != oplog.StatusError || rows[0].Error == nil {
		t.Errorf("graph failure record = %+v, want an error status with a message", rows[0])
	}
	if rows[1].Status != oplog.StatusOK || rows[1].Command == nil {
		t.Errorf("branchCreate record = %+v, want ok with its git command", rows[1])
	}
	if got := recent(t, app); len(got) != 3 {
		t.Fatalf("ops = %d, want 3", len(got))
	}
	if limited, _ := app.W.Ops.Recent(bridge.OpsRecentArgs{Limit: 1}); len(limited) != 1 || limited[0].ID != rows[0].ID {
		t.Fatalf("Recent(1) = %+v, want the newest only", limited)
	}
	if err := app.W.Ops.Cancel(bridge.OpsCancelArgs{OpID: rows[2].ID}); err != nil {
		t.Fatalf("Cancel of a finished op: %v", err)
	}

	t.Run("cancel a slow fetch", func(t *testing.T) {
		flowharness.Complete(t)
		slow := filepath.Join(app.Work, "slow-upload-pack")
		writeExecutable(t, slow, "#!/bin/sh\nexec sleep 60\n")
		repo.Git("config", "remote.origin.uploadpack", slow)
		done := make(chan gitsession.RemoteOpResult, 1)
		go func() {
			var res gitsession.RemoteOpResult
			gs.MustRequest("remote.run", gitrpc.RemoteRunParams{RepoID: id, RemoteOpParams: gitsession.RemoteOpParams{Kind: "fetch", Remote: "origin"}}, &res)
			done <- res
		}()
		var running oplog.Record
		testx.WaitUntil(t, waitFor, func() bool {
			for _, r := range recent(t, app) {
				if r.Status == oplog.StatusRunning && r.Kind == "fetch" {
					running = r
					return true
				}
			}
			return false
		})
		if !running.Cancellable {
			t.Fatalf("running fetch %+v is not cancellable", running)
		}
		if err := app.W.Ops.Cancel(bridge.OpsCancelArgs{OpID: running.ID}); err != nil {
			t.Fatal(err)
		}
		res := <-done
		if res.OK {
			t.Fatalf("cancelled fetch reports ok: %+v", res)
		}
		testx.WaitUntil(t, waitFor, func() bool { return recent(t, app)[0].Status == oplog.StatusCancelled })
		if recent(t, app)[0].ID != running.ID {
			t.Fatalf("newest record %+v is not the cancelled fetch", recent(t, app)[0])
		}
	})
}
