package adeflow_test

import (
	"path/filepath"
	"slices"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
)

func backlogTexts(t *testing.T, app *flowharness.App) []string {
	t.Helper()
	res, err := app.W.AdeTask.Backlog(ctx)
	if err != nil {
		t.Fatal(err)
	}
	out := make([]string, len(res.Items))
	for i, it := range res.Items {
		out[i] = it.Text
	}
	return out
}

func TestBacklogPromote(t *testing.T) {
	app := flowharness.New(t)
	svc := app.W.AdeTask
	items := map[string]adewire.BacklogItem{}
	for _, text := range []string{"one", "two", "three", "four"} {
		it, err := svc.AddBacklogItem(ctx, adewire.AddBacklogItemArgs{Text: text})
		if err != nil {
			t.Fatal(err)
		}
		items[text] = it
	}
	want := func(step string, order ...string) {
		t.Helper()
		if got := backlogTexts(t, app); !slices.Equal(got, order) {
			t.Fatalf("%s: backlog = %v, want %v", step, got, order)
		}
	}
	want("add puts the newest on top", "four", "three", "two", "one")

	move := func(text string, to int) {
		t.Helper()
		if err := svc.MoveBacklogItem(ctx, adewire.MoveBacklogItemArgs{ID: items[text].ID, ToIndex: to}); err != nil {
			t.Fatal(err)
		}
	}
	move("one", 0)
	want("move to the top", "one", "four", "three", "two")
	move("one", 3)
	want("move to the last slot", "four", "three", "two", "one")
	move("two", 99)
	want("move past the end clamps", "four", "three", "one", "two")
	move("four", 2)
	want("move down the middle", "three", "one", "four", "two")

	newText := "uno"
	if _, err := svc.UpdateBacklogItem(ctx, adewire.UpdateBacklogItemArgs{ID: items["one"].ID, Patch: adewire.BacklogPatch{Text: &newText}}); err != nil {
		t.Fatal(err)
	}
	want("update keeps the slot", "three", "uno", "four", "two")
	if err := svc.DeleteBacklogItem(ctx, adewire.BacklogItemArgs{ID: items["three"].ID}); err != nil {
		t.Fatal(err)
	}
	want("delete closes the gap", "uno", "four", "two")
	if err := svc.MoveBacklogItem(ctx, adewire.MoveBacklogItemArgs{ID: items["three"].ID, ToIndex: 0}); err == nil {
		t.Fatal("moving a deleted item succeeded")
	}

	task, err := svc.PromoteBacklogItem(ctx, adewire.BacklogItemArgs{ID: items["four"].ID})
	if err != nil {
		t.Fatal(err)
	}
	want("promote removes the item", "uno", "two")
	if got := taskOf(t, board(t, app), task.ID); got.Title != "four" || got.Kind != "task" {
		t.Fatalf("promoted task = %+v, want a task titled four", got)
	}
	if _, err := svc.PromoteBacklogItem(ctx, adewire.BacklogItemArgs{ID: items["four"].ID}); err == nil {
		t.Fatal("promoting the same item twice succeeded")
	}
}

func TestWorkflowsYaml(t *testing.T) {
	app := flowharness.New(t)
	svc := app.W.AdeTask

	fresh, err := svc.NewWorkflow(ctx, adewire.NewWorkflowArgs{Name: "Release flow"})
	if err != nil {
		t.Fatal(err)
	}
	if fresh.FileName != "release-flow.yaml" || fresh.Workflow == nil || len(fresh.Workflow.Stages) != 1 {
		t.Fatalf("NewWorkflow = %+v, want release-flow.yaml with one stage", fresh)
	}

	broken := "id: broken\nname: Broken\nstages:\n  - id: build\n    name: Build\n    kind: nonsense\n    status: In progress\n"
	val, err := svc.ValidateWorkflowYaml(ctx, adewire.ValidateWorkflowYamlArgs{Yaml: broken})
	if err != nil {
		t.Fatal(err)
	}
	if val.Error == nil || val.Error.Line != 6 || val.Workflow != nil {
		t.Fatalf("validation = %+v, want an error on line 6", val)
	}
	saved, err := svc.SaveWorkflowYaml(ctx, adewire.SaveWorkflowYamlArgs{FileName: "broken.yaml", Yaml: broken})
	if err != nil {
		t.Fatal(err)
	}
	if saved.Error == nil || saved.Workflow != nil {
		t.Fatalf("saving invalid yaml = %+v, want the file kept with its error", saved)
	}

	two := flowYAML("two-stage", agentStage("build", agentStep("one", ""))+"  - id: review\n    name: Review\n    kind: user\n    status: In review\n")
	saveWorkflow(t, app, "two-stage", two)

	imported, err := svc.ImportWorkflow(ctx, adewire.ImportWorkflowArgs{Path: mustAbs(t, filepath.Join("testdata", "imported.yaml"))})
	if err != nil {
		t.Fatal(err)
	}
	if imported.FileName != "imported.yaml" || imported.Workflow == nil || len(imported.Workflow.Stages) != 2 {
		t.Fatalf("ImportWorkflow = %+v", imported)
	}
	if _, err := svc.ImportWorkflow(ctx, adewire.ImportWorkflowArgs{Path: mustAbs(t, filepath.Join("testdata", "imported.yaml"))}); err == nil {
		t.Fatal("importing the same workflow twice succeeded")
	}

	list, err := svc.Workflows(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, e := range list.Workflows {
		names = append(names, e.FileName)
	}
	if !slices.Equal(names, []string{"broken.yaml", "imported.yaml", "release-flow.yaml", "two-stage.yaml"}) {
		t.Fatalf("workflows = %v", names)
	}

	repo := app.NewRepo("proj")
	repo.Commit("base", map[string]string{"a.txt": "a\n"})
	rec := importRepo(t, app, repo.Dir)
	task := createTask(t, app, "switch", "release-flow", rec.ID)
	if task.WorkflowID != "release-flow" || task.StageID != "work" {
		t.Fatalf("task = %+v, want release-flow at stage work", task)
	}
	switched, err := svc.SetTaskWorkflow(ctx, adewire.SetTaskWorkflowArgs{TaskID: task.ID, WorkflowID: "two-stage"})
	if err != nil {
		t.Fatal(err)
	}
	if switched.WorkflowID != "two-stage" || switched.StageID != "build" || switched.CurrentStage == nil || switched.CurrentStage.Kind != "agent" {
		t.Fatalf("switched task = %+v, want two-stage at its agent stage build", switched)
	}
	list, _ = svc.Workflows(ctx)
	used := map[string]int{}
	for _, e := range list.Workflows {
		used[e.FileName] = e.UsedBy
	}
	if used["two-stage.yaml"] != 1 || used["release-flow.yaml"] != 0 {
		t.Fatalf("workflow usage = %v, want two-stage 1 and release-flow 0", used)
	}
	cleared, err := svc.SetTaskWorkflow(ctx, adewire.SetTaskWorkflowArgs{TaskID: task.ID, WorkflowID: ""})
	if err != nil || cleared.WorkflowID != "" || cleared.StageID != "" {
		t.Fatalf("cleared task = %+v, %v", cleared, err)
	}
	if _, err := svc.SetTaskWorkflow(ctx, adewire.SetTaskWorkflowArgs{TaskID: task.ID, WorkflowID: "missing"}); err == nil {
		t.Fatal("unknown workflow accepted")
	}
}
