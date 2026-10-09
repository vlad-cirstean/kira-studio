package claudeflow_test

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness/fakeagent"
	"github.com/kirathecat/kira-studio/internal/terminal"
)

func TestClaudeSettingsUntouched(t *testing.T) {
	app := flowharness.New(t)
	repo := app.NewRepo("proj")
	repo.Commit("base", map[string]string{"a.txt": "a\n"})
	claude(app, map[string][]fakeagent.Action{"*": {{}}})
	seedClaudeConfig(t, app.Home, repo.Dir)
	before := snapshot(t, app.Home, repo.Dir)

	check := func(t *testing.T, flow string) {
		t.Helper()
		if d := diff(before, snapshot(t, app.Home, repo.Dir)); len(d) > 0 {
			t.Fatalf("%s changed Claude Code config: %s", flow, strings.Join(d, "; "))
		}
	}
	hooksFile := func(t *testing.T, argv []string) {
		t.Helper()
		settings := flagValues(argv, "--settings")
		if len(settings) != 1 || !filepath.IsAbs(settings[0]) || strings.HasPrefix(settings[0], app.Home) {
			t.Fatalf("agent launch --settings = %q, want one absolute path outside the user's home", settings)
		}
	}

	t.Run("terminal_agent_session", func(t *testing.T) {
		argv := agentArgv(t, app, func() { openAgent(t, app, "agent-1", repo.Dir) })
		hooksFile(t, argv)
		check(t, "terminal_agent_session")
	})

	t.Run("ade_session_start", func(t *testing.T) {
		rec := importRepo(t, app, repo.Dir)
		saveWorkflow(t, app, "flow", "id: flow\nname: Flow\nstages:\n  - id: work\n    name: Work\n    kind: user\n    status: In progress\n    session: true\n")
		task, err := app.W.AdeTask.CreateTask(ctx, adewire.CreateTaskArgs{Title: "Fix login", CodeRepoIDs: []string{rec.ID}, WorkflowID: "flow"})
		if err != nil {
			t.Fatal(err)
		}
		launch, err := app.W.AdeTask.LaunchStage(ctx, adewire.LaunchStageArgs{TaskID: task.ID})
		if err != nil {
			t.Fatal(err)
		}
		argv := agentArgv(t, app, func() {
			if _, err := app.W.Terminal.Open(terminal.OpenArgs{
				TerminalID: launch.TerminalID, WindowKey: window, Cwd: launch.Cwd, Cols: 100, Rows: 30,
				Command: launch.Command, LaunchKind: terminal.LaunchKindClaudeCode,
			}); err != nil {
				t.Fatal(err)
			}
		})
		hooksFile(t, argv)
		check(t, "ade_session_start")
	})

	app.Restart()
	check(t, "app restart")
}
