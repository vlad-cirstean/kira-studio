package ade

import (
	"context"
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
	if _, err := e.board.SetTaskStage(ctx, id, "review"); err == nil {
		t.Fatal("stage moved while a run is live")
	}
	if err := e.board.StopRun(ctx, e.runs(id)["one/api"].ID); err != nil {
		t.Fatal(err)
	}
	e.waitRun(id, "one/api", model.AdeRunStuck)

	for _, want := range []string{"review", "build", "done", "build"} {
		task, err := e.board.SetTaskStage(ctx, id, want)
		if err != nil || task.StageID != want {
			t.Fatalf("SetTaskStage(%q) = %+v, %v", want, task.StageID, err)
		}
	}
	if len(e.runs(id)) != 1 {
		t.Fatal("moving stages deleted runs")
	}
	if _, err := e.board.SetTaskStage(ctx, id, "nope"); err == nil {
		t.Fatal("unknown stage accepted")
	}
}
