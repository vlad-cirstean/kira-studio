package adeflow_test

import (
	"path/filepath"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/oplog"
	"github.com/kirathecat/kira-studio/internal/flowtest/fakeagent"
	"github.com/kirathecat/kira-studio/internal/testx"
)

// Backend half of the ADE rows of the Operations panel; UI half: tests/ui/operations.spec.ts.
// Contract space-ops-ade.

const opsScenario = "space-ops-ade"

var opMask = flowharness.Mask("id", "startedAt", "durationMs", "parentId", "taskId", "steps")

func opsNow(t *testing.T, app *flowharness.App) []oplog.Record {
	t.Helper()
	rows, err := app.W.Ops.Recent(bridge.OpsRecentArgs{Limit: 500})
	if err != nil {
		t.Fatal(err)
	}
	return rows
}

func findOp(rows []oplog.Record, category, kind string) (oplog.Record, bool) {
	for _, r := range rows {
		if r.Category == category && r.Kind == kind {
			return r, true
		}
	}
	return oplog.Record{}, false
}

func noAppModule(t *testing.T, rows []oplog.Record) {
	t.Helper()
	for _, r := range rows {
		if r.Module == oplog.ModuleApp {
			t.Errorf("row %s %s has module app", r.Category, r.Kind)
		}
	}
}

func TestOpsAde(t *testing.T) {
	t.Run("run", func(t *testing.T) {
		f := newRunFixture(t, []fakeagent.Action{{Name: "done"}}, agentStep("one", ""))
		f.start(t, "feat/api-work")
		waitRun(t, f.app, f.taskID, "one", "done")
		testx.WaitUntil(t, waitFor, func() bool {
			r, ok := findOp(opsNow(t, f.app), oplog.CategorySession, "run")
			return ok && r.Status == oplog.StatusOK
		})
		rows := opsNow(t, f.app)
		wt, ok := findOp(rows, oplog.CategoryGit, "worktreeAdd")
		if !ok || wt.Module != oplog.ModuleADE || wt.Trigger != oplog.TriggerUser || wt.Status != oplog.StatusOK || wt.Background {
			t.Fatalf("worktreeAdd = %+v, want a foreground ade user row", wt)
		}
		run, _ := findOp(rows, oplog.CategorySession, "run")
		if run.Module != oplog.ModuleADE || run.Subject != "Fix login" || run.Source == "" {
			t.Fatalf("run op = %+v", run)
		}
		noAppModule(t, rows)
		f.app.Contract(t, opsScenario, "record#run", run, opMask, flowharness.Replace(f.repo.Dir, "<repo>"))
	})

	t.Run("cancel a running agent", func(t *testing.T) {
		flag := filepath.Join(t.TempDir(), "release")
		f := newRunFixture(t, []fakeagent.Action{{Name: "done", WaitFile: flag}}, agentStep("first", ""))
		f.start(t, "feat/api-work")
		var running oplog.Record
		testx.WaitUntil(t, waitFor, func() bool {
			r, ok := findOp(opsNow(t, f.app), oplog.CategorySession, "run")
			running = r
			return ok && r.Status == oplog.StatusRunning
		})
		if !running.Cancellable {
			t.Fatalf("running session op %+v is not cancellable", running)
		}
		f.app.Contract(t, opsScenario, "record#running", running, opMask)
		if err := f.app.W.Ops.Cancel(bridge.OpsCancelArgs{OpID: running.ID}); err != nil {
			t.Fatal(err)
		}
		waitRun(t, f.app, f.taskID, "first", "stuck")
		testx.WaitUntil(t, waitFor, func() bool {
			r, _ := findOp(opsNow(t, f.app), oplog.CategorySession, "run")
			return r.Status == oplog.StatusCancelled
		})
	})

	t.Run("mcp request_branches", func(t *testing.T) {
		f := newBRFixture(t, []fakeagent.Action{{MCP: []fakeagent.MCPCall{requestCall("api")}, Name: "done"}}, onceStepYML, false)
		f.startRun(t)
		req := f.waitRequest(t)
		if _, err := f.app.W.AdeTask.ApproveBranchRequest(adewire.ApproveBranchRequestArgs{ID: req.ID, CodeRepoIDs: []string{f.api}}); err != nil {
			t.Fatal(err)
		}
		waitRun(t, f.app, f.task.ID, "one", "done")
		var call oplog.Record
		testx.WaitUntil(t, waitFor, func() bool {
			r, ok := findOp(opsNow(t, f.app), oplog.CategoryMCP, "request_branches")
			call = r
			return ok && r.Status == oplog.StatusOK
		})
		if call.Module != oplog.ModuleADE || call.Trigger != oplog.TriggerMCP || call.Source != "MCP request_branches" || call.Command == nil {
			t.Fatalf("mcp op = %+v", call)
		}
		var child bool
		for _, r := range opsNow(t, f.app) {
			if r.Category == oplog.CategoryGit && r.ParentID == call.ID {
				child = true
			}
		}
		if !child {
			t.Error("no git op is a child of the MCP call")
		}
		f.app.Contract(t, opsScenario, "record#mcp", call, opMask)
		noAppModule(t, opsNow(t, f.app))
	})
}
