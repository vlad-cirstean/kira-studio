package ade

import (
	"context"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
)

func TestRunEngine_SetTaskStageMovesBothWaysAndGuardsLiveRuns(t *testing.T) {
	e := newEngine(t, map[string][]string{"*": {"sleep"}})
	e.repo("api")
	e.workflow(flowYAML(agentStage("build", agentStep("one", "")) + userStage))
	ctx := context.Background()
	id := e.task("api")

	e.start(id)
	e.waitRun(id, "one/api", model.AdeRunRunning)
	if _, err := e.board.SetTaskStage(ctx, id, "review", ""); err == nil {
		t.Fatal("stage moved while a run is live")
	}
	if err := e.board.StopRun(ctx, e.runs(id)["one/api"].ID); err != nil {
		t.Fatal(err)
	}
	e.waitRun(id, "one/api", model.AdeRunStuck)

	for _, want := range []string{"review", "build", "done", "build"} {
		task, err := e.board.SetTaskStage(ctx, id, want, "")
		if err != nil || task.StageID != want {
			t.Fatalf("SetTaskStage(%q) = %+v, %v", want, task.StageID, err)
		}
	}
	if len(e.runs(id)) != 1 {
		t.Fatal("moving stages deleted runs")
	}
	if _, err := e.board.SetTaskStage(ctx, id, "nope", ""); err == nil {
		t.Fatal("unknown stage accepted")
	}
}

func TestRunEngine_StartedTaskKeepsItsWorkflowAfterAnEdit(t *testing.T) {
	e := newEngine(t, map[string][]string{"*": {"done"}})
	e.repo("api")
	e.workflow(flowYAML(agentStage("build", agentStep("one", "")) + userStage))
	ctx := context.Background()
	started := e.task("api")
	idle := e.task("api")

	e.start(started)
	e.waitRun(started, "one/api", model.AdeRunDone)

	qa := "  - id: qa\n    name: QA\n    kind: user\n    status: In review\n"
	e.workflow(flowYAML(agentStage("build", agentStep("one", "")) + qa + userStage))

	board, err := e.board.Board(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var startedWire, idleWire *adewire.Task
	for i := range board.Tasks {
		switch board.Tasks[i].ID {
		case started:
			startedWire = &board.Tasks[i]
		case idle:
			idleWire = &board.Tasks[i]
		}
	}
	if startedWire == nil || startedWire.Workflow == nil || !startedWire.WorkflowOutdated || len(startedWire.Workflow.Stages) != 2 {
		t.Fatalf("started task = %+v, want its 2-stage snapshot flagged outdated", startedWire)
	}
	if idleWire.Workflow != nil || idleWire.WorkflowOutdated {
		t.Fatalf("idle task = %+v, want no snapshot and no flag", idleWire)
	}

	if _, err := e.board.SetTaskStage(ctx, started, "qa", ""); err == nil {
		t.Fatal("started task moved to a stage only the edited file has")
	}
	task, err := e.board.StageDone(ctx, started)
	if err != nil || task.StageID != "review" {
		t.Fatalf("StageDone = %+v, %v; want review from the snapshot, not qa", task.StageID, err)
	}

	task, err = e.board.SetTaskStage(ctx, idle, "qa", "")
	if err != nil || task.StageID != "qa" {
		t.Fatalf("idle SetTaskStage = %+v, %v; want qa from the live file", task.StageID, err)
	}
	if task.Workflow == nil || len(task.Workflow.Stages) != 3 || task.WorkflowOutdated {
		t.Fatalf("a first stage move snapshots the live file: %+v", task.Workflow)
	}
}
