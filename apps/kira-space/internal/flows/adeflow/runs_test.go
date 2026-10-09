package adeflow_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/internal/flowtest/fakeagent"
	"github.com/kirathecat/kira-studio/internal/testx"
)

// runFixture is an app with one imported clone "api", a saved workflow and one task on it.
type runFixture struct {
	app    *flowharness.App
	repo   *flowharness.Repo
	bare   *flowharness.Bare
	repoID string
	taskID string
}

func newRunFixture(t *testing.T, actions []fakeagent.Action, stages string) *runFixture {
	t.Helper()
	app := flowharness.New(t)
	claude(app, map[string][]fakeagent.Action{"*": actions})
	repo, bare := cloneWithMain(app, filepath.Join(app.Work, "api"))
	rec := importRepo(t, app, repo.Dir)
	saveWorkflow(t, app, "flow", flowYAML("flow", stages))
	task := createTask(t, app, "Fix login", "flow", rec.ID)
	return &runFixture{app: app, repo: repo, bare: bare, repoID: rec.ID, taskID: task.ID}
}

func (f *runFixture) start(t *testing.T, branch string) []string {
	t.Helper()
	br := branchOf(t, board(t, f.app), f.taskID, f.repoID)
	res, err := f.app.W.AdeTask.StartRun(ctx, adewire.StartRunArgs{TaskID: f.taskID, BranchNames: map[string]string{br.ID: branch}})
	if err != nil {
		t.Fatalf("StartRun: %v", err)
	}
	return res.RunIDs
}

func TestRunLifecycle(t *testing.T) {
	t.Run("approval, logs and stage done", func(t *testing.T) {
		f := newRunFixture(t, []fakeagent.Action{{Name: "done"}},
			agentStage("build", agentStep("one", "        allowed_tools: [\"Bash(git *)\"]\n")+agentStep("two", "        before: approval\n"))+userStage)
		app := f.app
		setPrepare(t, app, f.repoID, "echo prepared")
		if _, err := app.W.AdeTask.StageDone(ctx, adewire.TaskArgs{TaskID: f.taskID}); err == nil {
			t.Fatal("StageDone accepted before the stage ran")
		}
		mark := app.Events.Mark()
		if ids := f.start(t, "feat/api-work"); len(ids) != 1 {
			t.Fatalf("StartRun run ids = %v, want one", ids)
		}
		if _, err := app.W.AdeTask.StartRun(ctx, adewire.StartRunArgs{TaskID: f.taskID}); err == nil {
			t.Fatal("second StartRun accepted")
		}
		one := waitRun(t, app, f.taskID, "one", "done")
		if one.Summary != "summary-done" {
			t.Fatalf("run = %+v, want the finish_step summary", one)
		}
		if _, queued := latestRun(t, app, f.taskID, "two"); queued {
			t.Fatal("approval step started without Approve")
		}

		br := branchOf(t, board(t, app), f.taskID, f.repoID)
		if got := gitOut(t, br.Worktree, "rev-parse", "--abbrev-ref", "HEAD"); got != "feat/api-work" {
			t.Fatalf("setup ran in a worktree on %q, want feat/api-work", got)
		}
		args := fakeFile(t, app, "api-1.args")
		for _, want := range []string{"--output-format\nstream-json", "--mcp-config", "Bash(git *)"} {
			if !strings.Contains(args, want) {
				t.Fatalf("claude argv lacks %q:\n%s", want, args)
			}
		}
		if strings.Contains(args, "Bearer") {
			t.Fatal("bearer token on argv")
		}
		if cwd := fakeFile(t, app, "api-1.cwd"); cwd != br.Worktree {
			t.Fatalf("claude ran in %q, want the task worktree %q", cwd, br.Worktree)
		}
		if prompt := fakeFile(t, app, "api-1.prompt"); !strings.Contains(prompt, "work on feat/api-work in api") {
			t.Fatalf("prompt = %q", prompt)
		}
		if out := logText(t, app, "run", one.ID); !strings.Contains(out, "Bash git status") || !strings.Contains(out, "result: success") {
			t.Fatalf("run log = %q", out)
		}
		if out := logText(t, app, "setup", br.ID); !strings.Contains(out, "prepared") {
			t.Fatalf("setup log = %q", out)
		}
		sessions, err := app.W.AdeTask.Sessions(ctx)
		if err != nil || len(sessions.Sessions) != 1 || sessions.Sessions[0].Mode != "headless" || sessions.Sessions[0].State != "stopped" {
			t.Fatalf("sessions = %+v, %v, want one stopped headless session", sessions, err)
		}
		app.Events.WaitAfter(t, mark, adewire.ChannelRuns, nil, waitFor)
		app.Events.WaitAfter(t, mark, adewire.ChannelLog, nil, waitFor)

		step := func(id string) adewire.StepArgs {
			return adewire.StepArgs{TaskID: f.taskID, StageID: "build", StepID: id}
		}
		if err := app.W.AdeTask.Approve(ctx, step("one")); err == nil {
			t.Fatal("Approve accepted for a step that is not waiting")
		}
		if err := app.W.AdeTask.Approve(ctx, step("two")); err != nil {
			t.Fatal(err)
		}
		waitRun(t, app, f.taskID, "two", "done")

		task, err := app.W.AdeTask.StageDone(ctx, adewire.TaskArgs{TaskID: f.taskID})
		if err != nil || task.StageID != "review" {
			t.Fatalf("StageDone = %+v, %v, want stage review", task, err)
		}
		if task, err = app.W.AdeTask.StageDone(ctx, adewire.TaskArgs{TaskID: f.taskID}); err != nil || task.StageID != "done" {
			t.Fatalf("StageDone after the last stage = %+v, %v, want done", task, err)
		}
	})

	t.Run("failed run retries", func(t *testing.T) {
		f := newRunFixture(t, []fakeagent.Action{{Name: "fail"}, {Name: "done"}}, agentStage("build", agentStep("first", "")))
		f.start(t, "feat/api-work")
		failed := waitRun(t, f.app, f.taskID, "first", "failed")
		if failed.Attempt != 1 {
			t.Fatalf("first attempt = %+v", failed)
		}
		if err := f.app.W.AdeTask.RetryRun(ctx, adewire.RunArgs{RunID: failed.ID}); err != nil {
			t.Fatal(err)
		}
		ok := waitRun(t, f.app, f.taskID, "first", "done")
		if ok.Attempt != 2 || ok.ID == failed.ID {
			t.Fatalf("retried run = %+v, want attempt 2 as a new run", ok)
		}
		if err := f.app.W.AdeTask.RetryRun(ctx, adewire.RunArgs{RunID: ok.ID}); err == nil {
			t.Fatal("RetryRun accepted a done run")
		}
	})

	t.Run("stop a running agent", func(t *testing.T) {
		flag := filepath.Join(t.TempDir(), "release")
		f := newRunFixture(t, []fakeagent.Action{{Name: "done", WaitFile: flag}}, agentStage("build", agentStep("first", "")))
		f.start(t, "feat/api-work")
		running := waitRun(t, f.app, f.taskID, "first", "running")
		if err := f.app.W.AdeTask.StopRun(ctx, adewire.RunArgs{RunID: running.ID}); err != nil {
			t.Fatal(err)
		}
		stopped := waitRun(t, f.app, f.taskID, "first", "stuck")
		if !strings.Contains(stopped.Note, "stopped") {
			t.Fatalf("stopped run = %+v, want a stopped note", stopped)
		}
		if err := f.app.W.AdeTask.StopRun(ctx, adewire.RunArgs{RunID: running.ID}); err == nil {
			t.Fatal("StopRun accepted a run that already ended")
		}
		if _, err := os.Stat(flag); err == nil {
			t.Fatal("test flag file appeared on its own")
		}
	})

	t.Run("failed setup blocks the run until retried", func(t *testing.T) {
		f := newRunFixture(t, []fakeagent.Action{{Name: "done"}}, agentStage("build", agentStep("first", "")))
		setPrepare(t, f.app, f.repoID, "exit 3")
		f.start(t, "feat/api-work")
		br := branchOf(t, board(t, f.app), f.taskID, f.repoID)
		testx.WaitUntil(t, waitFor, func() bool {
			s := branchOf(t, board(t, f.app), f.taskID, f.repoID).Setup
			return s != nil && s.State == "failed"
		})
		if r, _ := latestRun(t, f.app, f.taskID, "first"); r.State != "pending" {
			t.Fatalf("run behind a failed setup = %+v, want pending", r)
		}
		if !strings.Contains(logText(t, f.app, "setup", br.ID), "exited with status 3") {
			t.Fatal("setup log does not name the failure")
		}
		setPrepare(t, f.app, f.repoID, "echo fixed")
		if err := f.app.W.AdeTask.RetrySetup(ctx, adewire.BranchArgs{BranchID: br.ID}); err != nil {
			t.Fatal(err)
		}
		waitRun(t, f.app, f.taskID, "first", "done")
		if err := f.app.W.AdeTask.RetrySetup(ctx, adewire.BranchArgs{BranchID: br.ID}); err == nil {
			t.Fatal("RetrySetup accepted a setup that is ready")
		}
	})
}
