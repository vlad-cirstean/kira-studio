package adeflow_test

import (
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/internal/flowtest/fakeagent"
)

func TestRunWithoutClaudeOnPath(t *testing.T) {
	t.Setenv("SHELL", "")
	app := flowharness.New(t, flowharness.WithoutClaude())
	repo, _ := cloneWithMain(app, t.TempDir()+"/api")
	rec := importRepo(t, app, repo.Dir)
	saveWorkflow(t, app, "flow", flowYAML("flow", agentStage("build", agentStep("one", ""))))
	task := createTask(t, app, "Fix login", "flow", rec.ID)
	br := branchOf(t, board(t, app), task.ID, rec.ID)
	_, err := app.W.AdeTask.StartRun(ctx, adewire.StartRunArgs{TaskID: task.ID, BranchNames: map[string]string{br.ID: "feat/api-nocl"}})
	var run adewire.Run
	if err == nil {
		run = waitRun(t, app, task.ID, "one", "failed")
		app.Contract(t, "ade-run-errors", "AdeTaskService.Run#no-claude", run, runMask, flowharness.Mask("lastError"))
	}
	text := ""
	if err != nil {
		text = err.Error()
	} else {
		text = run.Note + "\n" + run.Summary + "\n" + logText(t, app, "run", run.ID)
	}
	if !strings.Contains(strings.ToLower(text), "claude") {
		t.Fatalf("user-visible failure %q, want it to name claude", text)
	}
}

func TestRunClaudeExitsNonZero(t *testing.T) {
	f := newRunFixture(t, []fakeagent.Action{{Name: "fail"}, {Name: "done"}}, agentStage("build", agentStep("one", "")))
	f.start(t, "feat/api-fail")
	failed := waitRun(t, f.app, f.taskID, "one", "failed")
	if strings.TrimSpace(failed.Note+failed.Summary) == "" {
		t.Fatalf("failed run has no user-visible reason: %+v", failed)
	}
	if err := f.app.W.AdeTask.RetryRun(ctx, adewire.RunArgs{RunID: failed.ID}); err != nil {
		t.Fatal(err)
	}
	waitRun(t, f.app, f.taskID, "one", "done")
}

func TestWorkflowYamlInvalidThenFixed(t *testing.T) {
	app := flowharness.New(t)
	bad := "id: flow\nname: Flow\nstages:\n  - id: build\n    name: build\n    kind: nonsense\n"
	val, err := app.W.AdeTask.ValidateWorkflowYaml(ctx, adewire.ValidateWorkflowYamlArgs{Yaml: bad})
	if err != nil || val.Error == nil || val.Error.Message == "" {
		t.Fatalf("ValidateWorkflowYaml(bad) = %+v, %v, want a message", val, err)
	}
	entry, err := app.W.AdeTask.SaveWorkflowYaml(ctx, adewire.SaveWorkflowYamlArgs{FileName: "flow.yaml", Yaml: bad})
	if err != nil || entry.Error == nil {
		t.Fatalf("saving invalid yaml = %+v, %v, want it stored with its error", entry, err)
	}
	repo, _ := cloneWithMain(app, t.TempDir()+"/api")
	rec := importRepo(t, app, repo.Dir)
	if _, err := app.W.AdeTask.CreateTask(ctx, adewire.CreateTaskArgs{Title: "Fix login", CodeRepoIDs: []string{rec.ID}, WorkflowID: "flow"}); err == nil {
		t.Fatal("a task was created on an invalid workflow")
	}
	saveWorkflow(t, app, "flow", flowYAML("flow", agentStage("build", agentStep("one", ""))))
	if _, err := app.W.AdeTask.CreateTask(ctx, adewire.CreateTaskArgs{Title: "Fix login", CodeRepoIDs: []string{rec.ID}, WorkflowID: "flow"}); err != nil {
		t.Fatalf("task on the fixed workflow: %v", err)
	}
	app.Scenario(fakeagent.Scenario{})
}
