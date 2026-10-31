package appflow_test

import (
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

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

// foreground drops the hidden-by-default background reads.
func foreground(rows []oplog.Record) []oplog.Record {
	return slices.DeleteFunc(slices.Clone(rows), func(r oplog.Record) bool { return r.Background })
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

	all := recent(t, app)
	rows := foreground(all)
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
	if len(rows[1].Steps) == 0 || rows[1].Module != oplog.ModuleGit || rows[1].Trigger != oplog.TriggerUser {
		t.Errorf("branchCreate steps/origin = %+v", rows[1])
	}
	var bgReads int
	for _, r := range all {
		if r.Background && r.Category == oplog.CategoryGit && r.Command != nil {
			bgReads++
		}
	}
	if bgReads == 0 {
		t.Error("no background git read recorded")
	}
	if limited, _ := app.W.Ops.Recent(bridge.OpsRecentArgs{Limit: 1}); len(foreground(limited)) != 1 || foreground(limited)[0].ID != rows[0].ID {
		t.Fatalf("Recent(1) = %+v, want the newest foreground op", limited)
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
			for _, r := range foreground(recent(t, app)) {
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
		testx.WaitUntil(t, waitFor, func() bool { return foreground(recent(t, app))[0].Status == oplog.StatusCancelled })
		if got := foreground(recent(t, app))[0]; got.ID != running.ID {
			t.Fatalf("newest record %+v is not the cancelled fetch", got)
		}
	})
}

// Backend half of the Operations panel contract; UI half: tests/ui/operations.spec.ts.
func TestOpsEveryGitSpawn(t *testing.T) {
	app := flowharness.New(t)
	repo, _ := cloneWithMain(app, filepath.Join(app.Work, "api"))
	gs := app.OpenGitStream()
	mark := app.Events.Mark()
	id := openRepo(t, gs, repo.Dir)

	t.Run("background", func(t *testing.T) {
		batch := app.Events.WaitAfter(t, mark, "kira:op:batch", nil, 1500*time.Millisecond)
		rows, _ := batch.Data.([]oplog.Record)
		var bare []oplog.Record
		for _, r := range rows {
			if r.Command != nil && *r.Command == "git rev-parse --is-bare-repository" {
				bare = append(bare, r)
			}
		}
		if len(bare) != 1 {
			t.Fatalf("batch rows = %d, want one --is-bare-repository read in %+v", len(rows), rows)
		}
		app.Contract(t, "space-ops", "event:kira:op:batch#background", []oplog.Record{bare[0]}, flowharness.Mask("id", "startedAt", "durationMs", "parentId"), flowharness.Replace(repo.Dir, "<repo>"))
		for _, r := range recent(t, app) {
			if !r.Background || r.Module != oplog.ModuleGit {
				t.Errorf("repo open row %+v is not a background git read", r)
			}
		}
		if n := persisted(t, app, ""); n != 0 {
			t.Errorf("op_log rows after a repo open = %d, want 0", n)
		}
	})

	t.Run("write", func(t *testing.T) {
		gs.MustRequest("op.run", gitrpc.OpRunParams{RepoID: id, Op: gitsession.OpRequest{Kind: "branchCreate", Name: "topic", StartPoint: "main"}}, nil)
		row := foreground(recent(t, app))[0]
		if row.Kind != "branchCreate" || row.Module != oplog.ModuleGit || row.Trigger != oplog.TriggerUser || row.Status != oplog.StatusOK {
			t.Fatalf("branchCreate row = %+v", row)
		}
		var reads, writes int
		for _, st := range row.Steps {
			if st.ReadOnly {
				reads++
			} else {
				writes++
			}
		}
		if reads == 0 || writes != 1 || row.Command == nil || strings.Contains(*row.Command, "rev-parse") {
			t.Fatalf("steps reads=%d writes=%d command=%v", reads, writes, row.Command)
		}
		app.Contract(t, "space-ops", "record#write", row, flowharness.Mask("id", "startedAt", "durationMs"), flowharness.Replace(repo.Dir, "<repo>"))
	})

	t.Run("redacted", func(t *testing.T) {
		var res gitsession.RemoteOpResult
		gs.MustRequest("remote.run", gitrpc.RemoteRunParams{RepoID: id, RemoteOpParams: gitsession.RemoteOpParams{Kind: "fetch", Remote: "https://u:tok3n@127.0.0.1:1/r.git"}}, &res)
		row := foreground(recent(t, app))[0]
		blob := ""
		if row.Command != nil {
			blob += *row.Command
		}
		for _, st := range row.Steps {
			blob += st.Argv
		}
		if row.Error != nil {
			blob += *row.Error
		}
		if strings.Contains(blob, "tok3n") || !strings.Contains(blob, "***") {
			t.Fatalf("credentials in op row: %s", blob)
		}
		app.Contract(t, "space-ops", "record#redacted", row, flowharness.Mask("id", "startedAt", "durationMs", "error", "steps"), flowharness.Replace(repo.Dir, "<repo>"))
	})

	t.Run("restarted", func(t *testing.T) {
		if _, err := app.DB().Exec(`INSERT INTO op_log (id, started_ms, category, kind, status, module, trigger_, source, subject, repo_root, repo_name, task_id, parent_id, steps_json) VALUES ('stale', CAST(strftime('%s','now') AS INTEGER) * 1000 - 600000, 'git', 'push', 'running', 'git', 'user', '', '', '/x', 'x', '', '', '[]')`); err != nil {
			t.Fatal(err)
		}
		before := kinds(foreground(recent(t, app)))
		app.Restart()
		rows := foreground(recent(t, app))
		if got := kinds(rows); !slices.Equal(got[:len(before)], before) {
			t.Fatalf("kinds after restart = %v, want prefix %v", got, before)
		}
		last := rows[len(rows)-1]
		if last.ID != "stale" || last.Status != oplog.StatusError || last.Error == nil {
			t.Fatalf("interrupted row = %+v, want reconciled to error", last)
		}
		app.Contract(t, "space-ops", "record#restarted", last, flowharness.Mask("startedAt"))
	})
}

func persisted(t *testing.T, app *flowharness.App, where string) int {
	t.Helper()
	q := "SELECT COUNT(*) FROM op_log WHERE background = 1"
	var n int
	if err := app.DB().QueryRow(q).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}
