package ade

import (
	"context"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
)

func TestNextRunnable(t *testing.T) {
	wf := func(skips ...bool) adewire.Workflow {
		var w adewire.Workflow
		for i, s := range skips {
			w.Stages = append(w.Stages, adewire.Stage{ID: string(rune('a' + i)), Skip: s})
		}
		return w
	}
	cases := []struct {
		name       string
		wf         adewire.Workflow
		from       int
		want       string
		wantExists bool
	}{
		{"skip at start", wf(true, false, false), -1, "b", true},
		{"skip in middle", wf(false, true, false), 0, "c", true},
		{"consecutive", wf(false, true, true, false), 0, "d", true},
		{"skip at end", wf(false, true), 0, "", false},
		{"last stage", wf(false, false), 1, "", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, ok := nextRunnable(c.wf, c.from)
			if ok != c.wantExists || got.ID != c.want {
				t.Fatalf("nextRunnable = %q, %v; want %q, %v", got.ID, ok, c.want, c.wantExists)
			}
		})
	}
}

func TestSkippedStages_engine(t *testing.T) {
	e := newEngine(t, map[string][]string{"*": {"done"}})
	e.repo("api")
	user := func(id string, skip bool) string {
		s := "  - id: " + id + "\n    name: " + id + "\n    kind: user\n    status: In review\n"
		if skip {
			s += "    skip: true\n"
		}
		return s
	}
	e.workflow(flowYAML(user("a", true) + user("b", false) + user("c", false) + user("d", true)))
	ctx := context.Background()
	created, err := e.board.CreateTask(ctx, adewire.CreateTaskArgs{Title: "T", CodeRepoIDs: []string{"api"}, WorkflowID: "flow"})
	if err != nil || created.StageID != "b" {
		t.Fatalf("start stage = %q, %v; want b", created.StageID, err)
	}
	id := created.ID
	if _, err := e.board.SetTaskStage(ctx, id, "d", ""); err == nil {
		t.Fatal("SetTaskStage accepted a skipped stage")
	}
	if task, err := e.board.StageDone(ctx, id); err != nil || task.StageID != "c" {
		t.Fatalf("after b = %q, %v; want c", task.StageID, err)
	}
	if task, err := e.board.StageDone(ctx, id); err != nil || task.StageID != "done" {
		t.Fatalf("past skipped last = %q, %v; want done", task.StageID, err)
	}
}
