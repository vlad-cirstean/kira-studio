package adeflow_test

import (
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
)

func TestReviewPlanDay(t *testing.T) {
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
	if res.Task.Kind != "review" {
		t.Fatalf("kind = %q, want review", res.Task.Kind)
	}
	plan := board(t, app).Plan
	if _, ok := plan.Day[id]; ok {
		t.Fatalf("new review has day %q, want none", plan.Day[id])
	}

	day := "2026-10-12"
	if err := app.W.AdeTask.SetPlan(ctx, adewire.SetPlanArgs{Order: plan.Order, Days: map[string]*string{id: &day}}); err != nil {
		t.Fatal(err)
	}
	if got := board(t, app).Plan.Day[id]; got != day {
		t.Fatalf("day = %q, want %q", got, day)
	}

	if err := app.W.AdeTask.SetPlan(ctx, adewire.SetPlanArgs{Order: plan.Order, Days: map[string]*string{id: nil}}); err != nil {
		t.Fatal(err)
	}
	if got, ok := board(t, app).Plan.Day[id]; ok {
		t.Fatalf("day = %q after clearing, want none", got)
	}
}
