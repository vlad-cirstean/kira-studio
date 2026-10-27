package adeflow_test

import (
	"os"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
)

func TestReviewConvert(t *testing.T) {
	app := flowharness.New(t)
	repo := app.NewRepo("api")
	repo.Commit("base", map[string]string{"a.txt": "base\n"})
	repo.Git("checkout", "-q", "-b", "sara/topic", "main")
	repo.Commit("topic", map[string]string{"b.txt": "topic\n"})
	repo.Checkout("main")
	repo.Git("config", "user.email", "me@example.com")
	rec := importRepo(t, app, repo.Dir)

	res, err := app.W.AdeTask.AddExistingBranch(ctx, adewire.AddExistingBranchArgs{CodeRepoID: rec.ID, Name: "sara/topic"})
	if err != nil {
		t.Fatal(err)
	}
	id := res.Task.ID
	br := branchOf(t, board(t, app), id, rec.ID)
	if res.Task.Kind != "review" || res.Task.Owner == "" || br.Kind != "review" || br.Worktree != "" {
		t.Fatalf("before: task %q owner %q, branch %q worktree %q", res.Task.Kind, res.Task.Owner, br.Kind, br.Worktree)
	}

	update := func(kind string) (adewire.Task, error) {
		return app.W.AdeTask.UpdateTask(ctx, adewire.UpdateTaskArgs{TaskID: id, Patch: adewire.TaskPatch{Kind: &kind}})
	}
	if _, err := update("parked"); err == nil {
		t.Fatal("review -> parked succeeded, want refusal")
	}
	if got := taskOf(t, board(t, app), id); got.Kind != "review" {
		t.Fatalf("kind = %q after refused patch, want review", got.Kind)
	}

	// Contract ade-review-convert: tests/ui/ade-v2-task-menu.spec.ts "contract: ..." reads these.
	task := "task"
	args := adewire.UpdateTaskArgs{TaskID: id, Patch: adewire.TaskPatch{Kind: &task}}
	app.Contract(t, "ade-review-convert", "args:AdeTaskService.UpdateTask", args)
	got, err := app.W.AdeTask.UpdateTask(ctx, args)
	if err != nil {
		t.Fatal(err)
	}
	if got.Kind != "task" || got.Owner != "" {
		t.Fatalf("converted: kind %q owner %q, want task and none", got.Kind, got.Owner)
	}
	app.Contract(t, "ade-review-convert", "AdeTaskService.UpdateTask#converted", got, flowharness.Mask("id", "createdAt", "branchIds"))

	deadline := time.Now().Add(10 * time.Second)
	for {
		br = branchOf(t, board(t, app), id, rec.ID)
		if br.Worktree != "" || time.Now().After(deadline) {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if br.Kind != "mine" {
		t.Fatalf("branch kind = %q, want mine", br.Kind)
	}
	if fi, err := os.Stat(br.Worktree); err != nil || !fi.IsDir() {
		t.Fatalf("worktree %q: %v", br.Worktree, err)
	}
	app.Contract(t, "ade-review-convert", "AdeTaskService.Branch#converted", struct {
		Kind string `json:"kind"`
	}{br.Kind})

	if _, err := update("review"); err == nil {
		t.Fatal("task -> review succeeded, want refusal")
	}
}
