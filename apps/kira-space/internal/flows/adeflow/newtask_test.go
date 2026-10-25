package adeflow_test

import (
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
)

func TestNewTaskLandsTodayWithoutRepos(t *testing.T) {
	app := flowharness.New(t)
	today := "2026-10-26"
	task, err := app.W.AdeTask.CreateTask(ctx, adewire.CreateTaskArgs{Title: "Plan it", Day: &today})
	if err != nil {
		t.Fatalf("CreateTask without repos: %v", err)
	}
	b := board(t, app)
	if got := b.Plan.Day[task.ID]; got != today {
		t.Fatalf("plan day = %q, want %q", got, today)
	}
	for _, br := range b.Branches {
		if br.TaskID == task.ID {
			t.Fatalf("repoless task has branch %+v", br)
		}
	}

	later, err := app.W.AdeTask.CreateTask(ctx, adewire.CreateTaskArgs{Title: "Someday"})
	if err != nil {
		t.Fatal(err)
	}
	if day, ok := board(t, app).Plan.Day[later.ID]; ok {
		t.Fatalf("task without Day has plan day %q, want Later", day)
	}

	bad := "2026-13-40"
	if _, err := app.W.AdeTask.CreateTask(ctx, adewire.CreateTaskArgs{Title: "Bad", Day: &bad}); err == nil {
		t.Fatal("invalid day accepted")
	}

	repo, _ := cloneWithMain(app, t.TempDir()+"/api")
	rec := importRepo(t, app, repo.Dir)
	if _, err := app.W.AdeTask.AddTaskRepo(ctx, adewire.AddTaskRepoArgs{TaskID: task.ID, CodeRepoID: rec.ID}); err != nil {
		t.Fatalf("AddTaskRepo: %v", err)
	}
	branchOf(t, board(t, app), task.ID, rec.ID)
}
