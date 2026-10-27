package adeflow_test

import (
	"fmt"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/internal/flowtest/fakeagent"
	"github.com/kirathecat/kira-studio/internal/testx"
)

const statusFlow = "  - id: check\n    name: Check\n    kind: manual\n    status: in-review\n    session: true\n" +
	"  - id: later\n    name: Later\n    kind: manual\n    status: in-progress\n    session: true\n"

func TestTaskStatuses(t *testing.T) {
	f := newRunFixture(t, []fakeagent.Action{{Name: "done"}}, agentStep("implement", "")+statusFlow)
	app := f.app
	state := func(id string) (string, string) {
		tk := taskOf(t, board(t, app), id)
		return tk.StatusID, tk.StatusBy
	}
	expect := func(id, status, by string) {
		t.Helper()
		if s, b := state(id); s != status || b != by {
			t.Fatalf("task %s status = %s/%s, want %s/%s", id, s, b, status, by)
		}
	}
	move := func(id, status string) (adewire.Task, error) {
		return app.W.AdeTask.UpdateTask(ctx, adewire.UpdateTaskArgs{TaskID: id, Patch: adewire.TaskPatch{StatusID: &status}})
	}
	step := func(id, stepID string) {
		t.Helper()
		if _, err := app.W.AdeTask.SetTaskStep(ctx, adewire.SetTaskStepArgs{TaskID: id, StepID: stepID}); err != nil {
			t.Fatalf("SetTaskStep %s: %v", stepID, err)
		}
	}

	b := board(t, app)
	if len(b.Statuses) != 4 || b.Statuses[0].ID != "todo" || b.Statuses[3].ID != "done" {
		t.Fatalf("default statuses = %+v", b.Statuses)
	}
	expect(f.taskID, "todo", "auto")

	// Contract ade-task-statuses: tests/ui/ade-v2-task-status.spec.ts reads these.
	args := adewire.UpdateTaskArgs{TaskID: f.taskID, Patch: adewire.TaskPatch{StatusID: ptr("in-review")}}
	app.Contract(t, "ade-task-statuses", "args:AdeTaskService.UpdateTask", args)
	moved, err := app.W.AdeTask.UpdateTask(ctx, args)
	if err != nil {
		t.Fatal(err)
	}
	if moved.StatusID != "in-review" || moved.StatusBy != "user" {
		t.Fatalf("moved = %s/%s, want in-review/user", moved.StatusID, moved.StatusBy)
	}
	app.Contract(t, "ade-task-statuses", "AdeTaskService.UpdateTask#moved", moved, taskMask)
	if _, err := move(f.taskID, "todo"); err != nil {
		t.Fatal(err)
	}
	expect(f.taskID, "todo", "user")
	if _, err := move(f.taskID, "nope"); err == nil {
		t.Fatal("unknown status id accepted")
	}

	step(f.taskID, "check")
	expect(f.taskID, "in-review", "auto")
	if _, err := move(f.taskID, "todo"); err != nil {
		t.Fatal(err)
	}
	expect(f.taskID, "todo", "user")
	expect(f.taskID, "todo", "user") // sticks across a board read
	step(f.taskID, "done")
	expect(f.taskID, "done", "auto")

	step(f.taskID, "implement")
	expect(f.taskID, "todo", "auto") // first step, nothing run: not started
	f.start(t, "feat/api-status")
	waitRun(t, app, f.taskID, "implement", "done")
	testx.WaitUntil(t, waitFor, func() bool { s, _ := state(f.taskID); return s == "in-review" })
	expect(f.taskID, "in-review", "auto")

	other := createTask(t, app, "Other", "flow", f.repoID)
	if _, err := move(other.ID, "in-progress"); err != nil {
		t.Fatal(err)
	}

	set := func(mut func([]adewire.TaskStatusDef) []adewire.TaskStatusDef, reassign map[string]string) (adewire.SaveStatusesResult, error) {
		cur := append([]adewire.TaskStatusDef(nil), board(t, app).Statuses...)
		return app.W.AdeTask.SaveStatuses(ctx, adewire.SaveStatusesArgs{Statuses: mut(cur), Reassign: reassign})
	}
	save := adewire.SaveStatusesArgs{
		Statuses: []adewire.TaskStatusDef{
			{ID: "todo", Name: "To do", Tone: "grey", Category: "todo"},
			{ID: "qa", Name: "QA", Tone: "purple", Category: "active"},
			{ID: "in-review", Name: "Code review", Tone: "blue", Category: "review"},
			{ID: "done", Name: "Done", Tone: "green", Category: "done"},
		},
		Reassign: map[string]string{"in-progress": "qa"},
	}
	// A new status has an empty id on the wire.
	save.Statuses[1].ID = ""
	app.Contract(t, "ade-task-statuses", "args:AdeTaskService.SaveStatuses", save)
	saved, err := app.W.AdeTask.SaveStatuses(ctx, save)
	if err != nil {
		t.Fatal(err)
	}
	if len(saved.Statuses) != 4 || saved.Statuses[1].ID != "qa" || saved.Statuses[2].Name != "Code review" {
		t.Fatalf("saved = %+v", saved.Statuses)
	}
	app.Contract(t, "ade-task-statuses", "AdeTaskService.SaveStatuses#saved", saved)
	expect(f.taskID, "in-review", "auto")
	expect(other.ID, "qa", "user")

	step(f.taskID, "later")
	expect(f.taskID, "qa", "auto")

	refuse := func(name string, mut func([]adewire.TaskStatusDef) []adewire.TaskStatusDef) {
		t.Helper()
		if _, err := set(mut, nil); err == nil {
			t.Fatalf("%s accepted", name)
		}
	}
	refuse("removing the last done status", func(s []adewire.TaskStatusDef) []adewire.TaskStatusDef { return s[:3] })
	refuse("duplicate name", func(s []adewire.TaskStatusDef) []adewire.TaskStatusDef {
		s[1].Name = "to do"
		return s
	})
	refuse("21 statuses", func(s []adewire.TaskStatusDef) []adewire.TaskStatusDef {
		for i := 0; i < 17; i++ {
			s = append(s, adewire.TaskStatusDef{Name: fmt.Sprintf("Extra %d", i), Tone: "grey", Category: "active"})
		}
		return s
	})
}

func ptr[T any](v T) *T { return &v }
