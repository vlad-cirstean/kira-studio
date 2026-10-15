package adeflow_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/internal/flowtest/fakeagent"
	"github.com/kirathecat/kira-studio/internal/testx"
)

// P288 return limit. Contract ade-return-limit: tests/ui/ade-v2-return-limit.spec.ts reads these.

const rlScenario = "ade-return-limit"

// testStep fails back to impl; maxReturns <= 0 leaves max_returns unset (the default).
func testStep(maxReturns string) string {
	extra := "    results:\n" +
		"      - id: passed\n        ok: true\n" +
		"      - id: failed\n        ok: false\n        next: impl\n"
	if maxReturns != "" {
		extra += "    max_returns: " + maxReturns + "\n"
	}
	return agentStep("test", extra)
}

func returnsOf(runs []adewire.Run) []int {
	out := make([]int, len(runs))
	for i, r := range runs {
		out[i] = r.Returns
	}
	return out
}

func waitBacks(t *testing.T, f *runFixture, stepID string, n int) []adewire.Run {
	t.Helper()
	var runs []adewire.Run
	testx.WaitUntil(t, waitFor, func() bool {
		runs = stepRuns(t, f, stepID)
		backs := 0
		for _, r := range runs {
			if r.State == "back" {
				backs++
			}
		}
		return backs >= n
	})
	return runs
}

func TestReturnLimit(t *testing.T) {
	t.Run("a step stops at its limit with the catalog message", func(t *testing.T) {
		f := newRunFixture(t, acts("done", "result:failed", "done", "result:failed", "done", "result:failed"),
			agentStep("impl", "")+testStep("2")+manualStep)
		f.start(t, "feat/api-limit")
		stopped := waitRun(t, f.app, f.taskID, "test", "failed")
		runs := stepRuns(t, f, "test")
		if len(runs) != 3 || runs[0].State != "back" || runs[1].State != "back" {
			t.Fatalf("test runs = %+v, want back, back, failed", runs)
		}
		if got := returnsOf(runs); got[0] != 1 || got[1] != 2 || got[2] != 2 {
			t.Fatalf("returns = %v, want [1 2 2]", got)
		}
		if !strings.Contains(runs[0].Note, "(1 of 2)") || !strings.Contains(runs[1].Note, "(2 of 2)") {
			t.Fatalf("notes = %q, %q, want (1 of 2) and (2 of 2)", runs[0].Note, runs[1].Note)
		}
		const want = "Stopped: test reached its limit of 2 returns."
		if _, route := resultOf(stopped); route != "stop" || stopped.Note != want || stopped.Outcome.Reason != want {
			t.Fatalf("stopped run = %+v, want route stop and the message %q", stopped, want)
		}
		f.app.Contract(t, rlScenario, "AdeTaskService.Run#back", runs[0], runMask)
		f.app.Contract(t, rlScenario, "AdeTaskService.Run#stopped", stopped, runMask)
	})

	t.Run("the counter survives a restart and a resume", func(t *testing.T) {
		hold := filepath.Join(t.TempDir(), "hold")
		f := newRunFixture(t, []fakeagent.Action{
			{Name: "done"}, {Name: "result:failed"}, {WaitFile: hold}, {Name: "done"},
			{Name: "result:failed"}, {Name: "done"}, {Name: "result:failed"},
		}, agentStep("impl", "")+testStep("2")+manualStep)
		f.start(t, "feat/api-limit-resume")
		waitBacks(t, f, "test", 1)
		testx.WaitUntil(t, waitFor, func() bool { _, err := os.Stat(filepath.Join(f.app.FakeDir, "api-3.args")); return err == nil })
		f.app.Restart()
		stuck := waitRun(t, f.app, f.taskID, "impl", "stuck")
		if !stuck.Resumable {
			t.Fatalf("impl after restart = %+v, want resumable", stuck)
		}
		if err := f.app.W.AdeTask.ResumeRun(ctx, adewire.RunArgs{RunID: stuck.ID}); err != nil {
			t.Fatalf("ResumeRun: %v", err)
		}
		runs := waitBacks(t, f, "test", 2)
		if got := returnsOf(runs); got[len(got)-1] != 2 || !strings.Contains(runs[len(runs)-1].Note, "(2 of 2)") {
			t.Fatalf("test runs after resume = %+v, want the second return counted (2 of 2)", runs)
		}
		stopped := waitRun(t, f.app, f.taskID, "test", "failed")
		if stopped.Note != "Stopped: test reached its limit of 2 returns." {
			t.Fatalf("stopped = %+v, want the limit message after the third failure", stopped)
		}
	})

	t.Run("a step without max_returns stops after 3", func(t *testing.T) {
		f := newRunFixture(t, acts("done", "result:failed", "done", "result:failed", "done", "result:failed", "done", "result:failed"),
			agentStep("impl", "")+testStep("")+manualStep)
		f.start(t, "feat/api-limit-default")
		stopped := waitRun(t, f.app, f.taskID, "test", "failed")
		if stopped.Note != "Stopped: test reached its limit of 3 returns." {
			t.Fatalf("stopped = %+v, want the default limit 3 in the message", stopped)
		}
	})

	t.Run("a review step has no limit by default", func(t *testing.T) {
		const review = "  - id: review\n    name: review\n    kind: review\n    runs_on: each repo\n    timeout: 1m\n" +
			"    review:\n      send_to: implementer\n" +
			"    results:\n" +
			"      - id: approved\n        ok: true\n" +
			"      - id: rework\n        ok: false\n        next: implement\n"
		script := []fakeagent.Action{{Name: "done", Sh: rvImplement}}
		for range 4 {
			script = append(script, fakeagent.Action{Name: "done"})
		}
		f := &reviewFx{runFixture: newRunFixture(t, script, agentStep("implement", "")+review+manualStep)}
		f.toReview(t, "feat/api-limit-review")
		for round := 1; round <= 4; round++ {
			if err := f.finish("rework", "again"); err != nil {
				t.Fatalf("FinishReview rework %d: %v", round, err)
			}
			testx.WaitUntil(t, waitFor, func() bool {
				r, _ := latestRun(t, f.app, f.taskID, "review")
				return r.State == "review" && r.Attempt > round
			})
		}
		runs := stepRuns(t, f.runFixture, "review")
		last := runs[len(runs)-1]
		backs := 0
		for _, r := range runs {
			if r.State == "back" {
				backs++
			}
		}
		if backs != 4 || last.State != "review" || last.Returns != 4 {
			t.Fatalf("review runs = %+v, want 4 back and a waiting review with returns 4", runs)
		}
		f.app.Contract(t, rlScenario, "AdeTaskService.Run#review", last, rvMask)
	})

	t.Run("max_returns round trips through the bound methods", func(t *testing.T) {
		const review = "  - id: gate\n    name: Gate\n    kind: review\n    runs_on: each repo\n    timeout: 1m\n    review:\n      send_to: new\n"
		f := newRunFixture(t, acts("done"), agentStep("impl", "")+review)
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
		steps := wf.Steps
		if steps[0].MaxReturns != 3 || steps[1].MaxReturns != 0 {
			t.Fatalf("defaults = %d (agent), %d (review), want 3 and 0", steps[0].MaxReturns, steps[1].MaxReturns)
		}
		wf.Steps[0].MaxReturns = 5
		args := adewire.SaveWorkflowArgs{FileName: "flow.yaml", Workflow: wf, BaseHash: entry.Hash}
		saved, err := f.app.W.AdeTask.SaveWorkflow(ctx, args)
		if err != nil || saved.Error != nil {
			t.Fatalf("SaveWorkflow = %+v, %v", saved, err)
		}
		y, err := f.app.W.AdeTask.WorkflowYaml(ctx, adewire.FileNameArgs{FileName: "flow.yaml"})
		if err != nil {
			t.Fatal(err)
		}
		if strings.Count(y.Yaml, "max_returns: 5") != 1 || strings.Contains(y.Yaml, "max_returns: 0") {
			t.Fatalf("saved yaml:\n%s\nwant max_returns: 5 on the agent step and none on the review step", y.Yaml)
		}
		f.app.Contract(t, rlScenario, "args:AdeTaskService.SaveWorkflow", args, flowharness.Mask("baseHash"))
		f.app.Contract(t, rlScenario, "AdeTaskService.SaveWorkflow#workflow", saved, flowharness.Mask("hash"))
	})
}
