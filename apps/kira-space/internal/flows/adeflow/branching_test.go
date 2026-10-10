package adeflow_test

import (
	"strconv"
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/internal/flowtest/fakeagent"
	"github.com/kirathecat/kira-studio/internal/testx"
)

// reviewResults are the results of a review step: approved moves on, changes loops back to impl.
func reviewResults(max int) string {
	m := ""
	if max > 0 {
		m = "            max: " + strconv.Itoa(max) + "\n"
	}
	return "        results:\n" +
		"          - id: approved\n            ok: true\n" +
		"          - id: changes\n            ok: false\n            next: impl\n" + m
}

func acts(names ...string) []fakeagent.Action {
	out := make([]fakeagent.Action, len(names))
	for i, n := range names {
		out[i] = fakeagent.Action{Name: n}
	}
	return out
}

func stepRuns(t *testing.T, f *runFixture, stepID string) []adewire.Run {
	t.Helper()
	var out []adewire.Run
	for _, r := range taskOf(t, board(t, f.app), f.taskID).Runs {
		if r.StepID == stepID {
			out = append(out, r)
		}
	}
	return out
}

var runMask = flowharness.Mask("startedAt", "finishedAt", "sessionId", "exitCode", "createdAt")

func resultOf(r adewire.Run) (result, route string) {
	if r.Outcome == nil {
		return "", ""
	}
	return r.Outcome.Result, r.Outcome.Route
}

func TestBranching(t *testing.T) {
	t.Run("a review loops back to implement until it approves", func(t *testing.T) {
		f := newRunFixture(t, acts("done", "result:changes", "done", "result:changes", "done", "result:approved"),
			agentStage("build", agentStep("impl", "")+agentStep("review", reviewResults(0)))+userStage)
		f.start(t, "feat/api-work")
		final := waitRun(t, f.app, f.taskID, "review", "done")
		if res, route := resultOf(final); res != "approved" || route != "next" {
			t.Fatalf("final review = %+v, want result approved routed next", final)
		}
		var sentBack int
		for _, r := range stepRuns(t, f, "review") {
			res, route := resultOf(r)
			if r.State == "back" && res == "changes" && route == "back:impl" {
				sentBack++
			}
		}
		if sentBack != 2 {
			t.Fatalf("review runs = %+v, want 2 sent back with result changes", stepRuns(t, f, "review"))
		}
		if impl := stepRuns(t, f, "impl"); len(impl) != 3 {
			t.Fatalf("impl runs = %d, want 3 (first plus two fix rounds)", len(impl))
		}
		task, err := f.app.W.AdeTask.StageDone(ctx, adewire.TaskArgs{TaskID: f.taskID})
		if err != nil || task.StageID != "review" {
			t.Fatalf("StageDone = %+v, %v, want the stage complete and the task in review", task, err)
		}
	})

	t.Run("a fix round counts against its result's loop budget", func(t *testing.T) {
		f := newRunFixture(t, acts("done", "result:changes", "done", "result:approved"),
			agentStage("build", agentStep("impl", "")+agentStep("review", reviewResults(2))))
		f.start(t, "feat/api-work")
		final := waitRun(t, f.app, f.taskID, "review", "done")
		if res, _ := resultOf(final); res != "approved" {
			t.Fatalf("final review = %+v, want approved", final)
		}
		impl := stepRuns(t, f, "impl")
		if len(impl) != 2 || impl[1].State != "done" || impl[1].Loops != 1 || impl[1].Note != "" || impl[1].Outcome.Reason != "" {
			t.Fatalf("impl runs = %+v, want a done second run on loop 1 without a note", impl)
		}
		back := stepRuns(t, f, "review")[0]
		if back.State != "back" || !strings.Contains(back.Note, "(1 of 2)") {
			t.Fatalf("first review = %+v, want back with a (1 of 2) note", back)
		}
		list, err := f.app.W.AdeTask.Workflows(ctx)
		if err != nil {
			t.Fatal(err)
		}
		f.app.Contract(t, "ade-branching", "AdeTaskService.Workflows", list, flowharness.Mask("mtime"))
		f.app.Contract(t, "ade-branching", "AdeTaskService.Run#impl-rerun", impl[1], runMask)
		f.app.Contract(t, "ade-branching", "AdeTaskService.Run#review-back", back, runMask)
	})

	t.Run("a spent loop budget stops the stage", func(t *testing.T) {
		f := newRunFixture(t, acts("done", "result:changes", "done", "result:changes", "done", "result:changes"),
			agentStage("build", agentStep("impl", "")+agentStep("review", reviewResults(2))))
		f.start(t, "feat/api-work")
		var last adewire.Run
		testx.WaitUntil(t, waitFor, func() bool {
			runs := stepRuns(t, f, "review")
			if len(runs) == 0 {
				return false
			}
			last = runs[len(runs)-1]
			return last.State == "failed"
		})
		res, route := resultOf(last)
		if res != "changes" || route != "stop" || !strings.Contains(last.Note, "sent back 2 times") {
			t.Fatalf("last review = %+v, want failed with result changes, route stop and the spent note", last)
		}
		f.app.Contract(t, "ade-branching", "AdeTaskService.Run#review-spent", last, runMask)
	})

	t.Run("a forward route skips the steps between", func(t *testing.T) {
		skip := "        results:\n          - id: quick\n            ok: true\n            next: finish\n          - id: normal\n            ok: true\n"
		f := newRunFixture(t, acts("result:quick", "done"),
			agentStage("build", agentStep("start", skip)+agentStep("middle", "")+agentStep("finish", "")))
		f.start(t, "feat/api-work")
		waitRun(t, f.app, f.taskID, "finish", "done")
		if runs := stepRuns(t, f, "middle"); len(runs) != 0 {
			t.Fatalf("middle ran: %+v, want it skipped", runs)
		}
		first := stepRuns(t, f, "start")[0]
		if res, route := resultOf(first); res != "quick" || route != "finish" {
			t.Fatalf("start = %+v, want result quick routed to finish", first)
		}
	})

	t.Run("an end route completes the stage", func(t *testing.T) {
		end := "        results:\n          - id: trivial\n            ok: true\n            next: end\n          - id: normal\n            ok: true\n"
		f := newRunFixture(t, acts("result:trivial"),
			agentStage("build", agentStep("triage", end)+agentStep("later", ""))+userStage)
		f.start(t, "feat/api-work")
		waitRun(t, f.app, f.taskID, "triage", "done")
		testx.WaitUntil(t, waitFor, func() bool {
			return taskOf(t, board(t, f.app), f.taskID).CurrentStage != nil
		})
		if runs := stepRuns(t, f, "later"); len(runs) != 0 {
			t.Fatalf("later ran after an end route: %+v", runs)
		}
		task, err := f.app.W.AdeTask.StageDone(ctx, adewire.TaskArgs{TaskID: f.taskID})
		if err != nil || task.StageID != "review" {
			t.Fatalf("StageDone = %+v, %v, want the stage complete", task, err)
		}
	})

	t.Run("legacy retry and back rules behave as before", func(t *testing.T) {
		f := newRunFixture(t, acts("failed", "done"), agentStage("build", agentStep("first", "        on_failure: retry 1\n")))
		f.start(t, "feat/api-work")
		ok := waitRun(t, f.app, f.taskID, "first", "done")
		if ok.Attempt != 2 {
			t.Fatalf("first = %+v, want the second attempt done", ok)
		}
		if runs := stepRuns(t, f, "first"); len(runs) != 2 || runs[0].State != "back" {
			t.Fatalf("first runs = %+v, want a retried first attempt", runs)
		}

		g := newRunFixture(t, acts("done", "failed", "done", "done"),
			agentStage("build", agentStep("impl", "")+agentStep("tests", "        on_failure: back:impl\n")))
		g.start(t, "feat/api-work")
		waitRun(t, g.app, g.taskID, "tests", "done")
		if runs := stepRuns(t, g, "impl"); len(runs) != 2 {
			t.Fatalf("impl runs = %d, want 2 (back:impl sent it back once)", len(runs))
		}
	})

	t.Run("saved results round trip through the bound methods", func(t *testing.T) {
		f := newRunFixture(t, acts("done"), agentStage("build", agentStep("impl", "")+agentStep("review", "")))
		list, err := f.app.W.AdeTask.Workflows(ctx)
		if err != nil {
			t.Fatal(err)
		}
		var entry adewire.WorkflowEntry
		for _, e := range list.Workflows {
			if e.FileName == "flow.yaml" {
				entry = e
			}
		}
		wf := *entry.Workflow
		review := &wf.Stages[0].Steps[1]
		review.Results = []adewire.StepResult{
			{ID: "approved", OK: true, Next: "next"},
			{ID: "changes", Description: "Needs work.", Next: "impl", Max: 2},
		}
		args := adewire.SaveWorkflowArgs{FileName: "flow.yaml", Workflow: wf}
		saved, err := f.app.W.AdeTask.SaveWorkflow(ctx, args)
		if err != nil || saved.Error != nil {
			t.Fatalf("SaveWorkflow = %+v, %v", saved, err)
		}
		y, err := f.app.W.AdeTask.WorkflowYaml(ctx, adewire.FileNameArgs{FileName: "flow.yaml"})
		if err != nil {
			t.Fatal(err)
		}
		for _, want := range []string{"results:", "id: changes", "next: impl", "max: 2", "description: Needs work."} {
			if !strings.Contains(y.Yaml, want) {
				t.Fatalf("saved yaml lacks %q:\n%s", want, y.Yaml)
			}
		}
		f.app.Contract(t, "ade-workflow-results", "args:AdeTaskService.SaveWorkflow", args)
		f.app.Contract(t, "ade-workflow-results", "AdeTaskService.SaveWorkflow", saved)
		got := saved.Workflow.Stages[0].Steps[1].Results
		if len(got) != 2 || got[1].ID != "changes" || got[1].Max != 2 || got[1].Next != "impl" {
			t.Fatalf("saved results = %+v", got)
		}
	})
}
