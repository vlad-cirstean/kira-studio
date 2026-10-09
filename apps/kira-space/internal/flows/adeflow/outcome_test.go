package adeflow_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/internal/flowtest/fakeagent"
	"github.com/kirathecat/kira-studio/internal/testx"
)

func scriptStage(id, command string) string {
	return "  - id: " + id + "\n    name: " + id + "\n    kind: script\n    status: In progress\n    runs_on: each repo\n    timeout: 1m\n    command: " + command + "\n"
}

func TestRunOutcomes(t *testing.T) {
	t.Run("agent reports done", func(t *testing.T) {
		f := newRunFixture(t, []fakeagent.Action{{Name: "done"}}, agentStage("build", agentStep("one", "")))
		f.start(t, "feat/api-done")
		r := waitRun(t, f.app, f.taskID, "one", "done")
		if o := r.Outcome; o == nil || o.Status != "done" || o.Source != "agent" || !o.Reported {
			t.Fatalf("outcome = %+v, want done/agent/reported", o)
		}
	})

	t.Run("agent ends without a report", func(t *testing.T) {
		zero := 0
		f := newRunFixture(t, []fakeagent.Action{{Exit: &zero}}, agentStage("build", agentStep("one", "")))
		f.start(t, "feat/api-silent")
		r := waitRun(t, f.app, f.taskID, "one", "stuck", "failed")
		if o := r.Outcome; o == nil || o.Status != "failed" || o.Reported || o.Reason != "no report: Claude ended without calling finish_step" {
			t.Fatalf("outcome = %+v, want the no-report reason", o)
		}
	})

	t.Run("script exits non-zero", func(t *testing.T) {
		f := newRunFixture(t, nil, scriptStage("check", "'echo oops >&2; exit 2'"))
		f.start(t, "feat/api-script")
		r := waitRun(t, f.app, f.taskID, "check", "stuck", "failed")
		o := r.Outcome
		if o == nil || o.Source != "exit" || o.Reason != "exited with status 2" || o.ExitCode == nil || *o.ExitCode != 2 || !strings.Contains(o.LastError, "oops") {
			t.Fatalf("outcome = %+v, want exit 2 with stderr as the last error", o)
		}
	})

	t.Run("stop cancels", func(t *testing.T) {
		flag := filepath.Join(t.TempDir(), "release")
		f := newRunFixture(t, []fakeagent.Action{{Name: "done", WaitFile: flag}}, agentStage("build", agentStep("one", "")))
		f.start(t, "feat/api-stop")
		running := waitRun(t, f.app, f.taskID, "one", "running")
		if err := f.app.W.AdeTask.StopRun(ctx, adewire.RunArgs{RunID: running.ID}); err != nil {
			t.Fatal(err)
		}
		r := waitRun(t, f.app, f.taskID, "one", "stuck")
		if o := r.Outcome; o == nil || o.Status != "cancelled" || o.Source != "user" || o.Reason != "stopped by you" {
			t.Fatalf("outcome = %+v, want cancelled by the user", o)
		}
	})

	t.Run("restart interrupts", func(t *testing.T) {
		hold := filepath.Join(t.TempDir(), "hold")
		f := newRunFixture(t, []fakeagent.Action{{WaitFile: hold}}, agentStage("build", agentStep("one", "")))
		f.start(t, "feat/api-restart-outcome")
		waitRun(t, f.app, f.taskID, "one", "running")
		testx.WaitUntil(t, waitFor, func() bool { _, err := os.Stat(filepath.Join(f.app.FakeDir, "api-1.args")); return err == nil })
		f.app.Restart()
		if err := os.WriteFile(hold, nil, 0o644); err != nil {
			t.Fatal(err)
		}
		r, _ := latestRun(t, f.app, f.taskID, "one")
		if o := r.Outcome; o == nil || o.Status != "failed" || o.Source != "restart" || !strings.Contains(o.Reason, "Kira Space") {
			t.Fatalf("run after restart = %+v, want failed by restart", r)
		}
	})
}
