package adeflow_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness/fakeagent"
	"github.com/kirathecat/kira-studio/internal/shell"
	"github.com/kirathecat/kira-studio/internal/terminal"
	"github.com/kirathecat/kira-studio/internal/testx"
)

const sessionWindow = "w-main"

// openLaunch does what the renderer does with a Launch: open the agent terminal it describes.
func openLaunch(t *testing.T, app *flowharness.App, l adewire.Launch) {
	t.Helper()
	_, err := app.W.Terminal.Open(terminal.OpenArgs{
		TerminalID: l.TerminalID, Cwd: l.Cwd, Cols: 100, Rows: 30, WindowKey: sessionWindow,
		Command: l.Command, LaunchKind: terminal.LaunchKindClaudeCode,
	})
	if err != nil {
		t.Fatalf("Terminal.Open %s: %v", l.Command, err)
	}
}

func sessionByID(t *testing.T, app *flowharness.App, id string) adewire.Session {
	t.Helper()
	res, err := app.W.AdeTask.Sessions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range res.Sessions {
		if s.ID == id {
			return s
		}
	}
	t.Fatalf("no session %s in %+v", id, res.Sessions)
	return adewire.Session{}
}

// A stopped state waits out the tracker's 30s grace window after the spawn.
func waitSession(t *testing.T, app *flowharness.App, id, state string) adewire.Session {
	t.Helper()
	var got adewire.Session
	wait := waitFor
	if state == "stopped" {
		wait = 50 * time.Second
	}
	testx.WaitUntil(t, wait, func() bool {
		res, _ := app.W.AdeTask.Sessions(ctx)
		for _, s := range res.Sessions {
			if s.ID == id {
				got = s
				return s.State == state
			}
		}
		return false
	})
	return got
}

func TestInteractiveSessions(t *testing.T) {
	dir := t.TempDir()
	flag := func(n string) string { return filepath.Join(dir, n) }
	app := flowharness.New(t)
	// Call 1 is the headless run; calls 2 to 4 are interactive Claude Code processes held open by a flag file.
	claude(app, map[string][]fakeagent.Action{"*": {
		{Name: "done"}, {WaitFile: flag("takeover")}, {WaitFile: flag("stage")}, {Name: "sleep"},
	}})
	repo, _ := cloneWithMain(app, filepath.Join(app.Work, "api"))
	rec := importRepo(t, app, repo.Dir)
	saveWorkflow(t, app, "flow", flowYAML("flow", agentStage("build", agentStep("one", ""))+
		"  - id: work\n    name: Work\n    kind: user\n    status: In progress\n    session: true\n"))
	task := createTask(t, app, "Fix login", "flow", rec.ID)
	br := branchOf(t, board(t, app), task.ID, rec.ID)
	if _, err := app.W.AdeTask.StartRun(ctx, adewire.StartRunArgs{TaskID: task.ID, BranchNames: map[string]string{br.ID: "feat/api-work"}}); err != nil {
		t.Fatal(err)
	}
	run := waitRun(t, app, task.ID, "one", "done")
	headless := run.SessionID
	if headless == "" || sessionByID(t, app, headless).Mode != "headless" {
		t.Fatalf("run %+v has no headless session", run)
	}
	br = branchOf(t, board(t, app), task.ID, rec.ID)
	app.WindowMgr.OpenWindow(shell.WindowRecord{Key: sessionWindow})

	// Take over the finished run: its conversation resumes in the same worktree.
	launch, err := app.W.AdeTask.TakeOver(ctx, adewire.TakeOverArgs{SessionID: headless})
	if err != nil {
		t.Fatal(err)
	}
	if launch.Cwd != br.Worktree || !strings.Contains(launch.Command, "--resume") {
		t.Fatalf("take over launch = %+v, want a resume in %s", launch, br.Worktree)
	}
	openLaunch(t, app, launch)
	tui := waitSession(t, app, launch.SessionID, "running")
	if tui.Mode != "tui" || tui.TaskID != task.ID || tui.TerminalID != launch.TerminalID {
		t.Fatalf("taken-over session = %+v", tui)
	}
	if _, err := app.W.AdeTask.TakeOver(ctx, adewire.TakeOverArgs{SessionID: headless}); err == nil {
		t.Fatal("second TakeOver of an open conversation succeeded")
	}
	if err := os.WriteFile(flag("takeover"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	waitSession(t, app, tui.ID, "stopped")

	// The user stage opens its own session; Send reaches the agent's terminal, FocusSession its window.
	if _, err := app.W.AdeTask.StageDone(ctx, adewire.TaskArgs{TaskID: task.ID}); err != nil {
		t.Fatal(err)
	}
	stage, err := app.W.AdeTask.LaunchStage(ctx, adewire.LaunchStageArgs{TaskID: task.ID})
	if err != nil {
		t.Fatal(err)
	}
	if stage.Cwd != br.Worktree {
		t.Fatalf("stage launch cwd = %q, want the task worktree %q", stage.Cwd, br.Worktree)
	}
	openLaunch(t, app, stage)
	waitSession(t, app, stage.SessionID, "running")
	if _, err := app.W.AdeTask.LaunchStage(ctx, adewire.LaunchStageArgs{TaskID: task.ID}); err == nil {
		t.Fatal("second LaunchStage while one session runs succeeded")
	}
	if err := app.W.AdeTask.Send(ctx, adewire.SendArgs{SessionID: stage.SessionID, Message: "hello from the board"}); err != nil {
		t.Fatal(err)
	}
	testx.WaitUntil(t, waitFor, func() bool {
		raw, _ := os.ReadFile(filepath.Join(app.FakeDir, "api-3.prompt"))
		return strings.Contains(string(raw), "hello from the board")
	})
	if err := app.W.AdeTask.Send(ctx, adewire.SendArgs{SessionID: headless, Message: "x"}); err == nil {
		t.Fatal("Send to a headless session succeeded")
	}
	mark := app.Events.Mark()
	focused, err := app.W.AdeTask.FocusSession(ctx, adewire.FocusSessionArgs{SessionID: stage.SessionID})
	if err != nil || !focused {
		t.Fatalf("FocusSession = %v, %v, want the window brought forward", focused, err)
	}
	if got := app.WindowMgr.Focused; len(got) == 0 || got[len(got)-1] != sessionWindow {
		t.Fatalf("window manager focused %v, want %s", got, sessionWindow)
	}
	ev := app.Events.WaitAfter(t, mark, adewire.ChannelOpenSession, nil, waitFor)
	var open adewire.OpenSessionEvent
	ev.Decode(t, &open)
	if ev.Window != sessionWindow || open.SessionID != stage.SessionID || open.TaskID != task.ID {
		t.Fatalf("open-session event = %+v to %q", open, ev.Window)
	}
	if err := os.WriteFile(flag("stage"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	waitSession(t, app, stage.SessionID, "stopped")
	if focused, err := app.W.AdeTask.FocusSession(ctx, adewire.FocusSessionArgs{SessionID: stage.SessionID}); err != nil || focused {
		t.Fatalf("FocusSession on a stopped session = %v, %v, want false", focused, err)
	}

	// A branch session on the worktree.
	started, err := app.W.AdeTask.StartBranch(ctx, adewire.StartBranchArgs{BranchID: br.ID})
	if err != nil {
		t.Fatal(err)
	}
	if started.Cwd != br.Worktree {
		t.Fatalf("branch launch cwd = %q, want %q", started.Cwd, br.Worktree)
	}
	openLaunch(t, app, started)
	waitSession(t, app, started.SessionID, "running")
	if _, err := app.W.AdeTask.StartBranch(ctx, adewire.StartBranchArgs{BranchID: br.ID}); err == nil {
		t.Fatal("second StartBranch while one session runs succeeded")
	}
}
