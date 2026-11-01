package claude

import (
	"strings"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/internal/terminal"
)

const stageBlockYAML = "    settings:\n      claude:\n        auto_compact_window: 200000\n"

// TestAdeHeadlessRunStageSettings runs a step with a stage setting through the real claude -p: the
// run passes only if the CLI accepts --autocompact.
func TestAdeHeadlessRunStageSettings(t *testing.T) {
	f := newAdeFixture(t, nil)
	f.saveWorkflow(t, "flow", agentStepYAML+stageBlockYAML+manualStepYAML)
	run := f.startRun(t, f.createTask(t, "flow"), "feat/real-claude")
	log := f.runLog(t, run.ID)
	if run.State != "done" {
		t.Fatalf("run = %+v, want done; log:\n%s", run, tail(log, 1500))
	}
	f.requireCostUnder(t)
}

// TestAdeManualSessionStageSettings opens a manual step's TUI with a stage setting: the command
// carries --autocompact and the real claude starts a session with it.
func TestAdeManualSessionStageSettings(t *testing.T) {
	f := newAdeFixture(t, nil)
	f.saveWorkflow(t, "flow", strings.TrimSuffix(manualStepYAML, "\n")+"\n"+stageBlockYAML)
	task := f.createTask(t, "flow")
	launch, err := f.W.AdeTask.LaunchStep(ctx, adewire.LaunchStepArgs{TaskID: task.ID})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(launch.Command, " '--autocompact' '200000'") {
		t.Fatalf("command = %s, want --autocompact 200000", launch.Command)
	}
	f.seedClaudeJSON(t, f.repo.Dir, launch.Cwd)
	mark := f.Events.Mark()
	if _, err := f.W.Terminal.Open(terminal.OpenArgs{
		TerminalID: launch.TerminalID, WindowKey: window, Cwd: launch.Cwd, Cols: 120, Rows: 40,
		Command: launch.Command, LaunchKind: terminal.LaunchKindAgent,
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = f.W.Terminal.Close(terminal.CloseArgs{TerminalID: launch.TerminalID}) })
	f.waitAgentEvent(t, mark, launch.TerminalID, "SessionStart", 60*time.Second)
}
