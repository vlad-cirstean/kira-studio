package notifyflow_test

import (
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/agentnotify"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness/fakeagent"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/internal/testx"
)

// agentTab imports a repo "proj" and opens a Claude Code tab in it.
func agentTab(t *testing.T, app *flowharness.App, id string) (cwd string) {
	t.Helper()
	repo := app.NewRepo("proj")
	repo.Commit("base", map[string]string{"a.txt": "a\n"})
	importRepo(t, app, repo.Dir)
	openAgent(t, app, id, repo.Dir)
	return repo.Dir
}

func TestStopNotifies(t *testing.T) {
	app, sink := newApp(t)
	cwd := agentTab(t, app, "tab-1")
	stop(t, app, "tab-1", cwd, "Done.\nI fixed the login bug.")
	n := sink.only(t)
	if n.Kind != agentnotify.KindFinished || !strings.Contains(n.Title, "proj") {
		t.Fatalf("note = %+v, want finished naming proj", n)
	}
	if n.Body != "Done. I fixed the login bug." || n.TerminalID != "tab-1" || n.WindowKey != window {
		t.Fatalf("note = %+v, want the reply on one line and the terminal and window ids", n)
	}
}

func TestNeedsInputNotifies(t *testing.T) {
	app, sink := newApp(t)
	cwd := agentTab(t, app, "tab-1")
	hook(t, app, "tab-1", `{"hook_event_name":"Notification","notification_type":"permission_prompt","cwd":`+quote(cwd)+`,"message":"Claude needs your permission to use Bash"}`)
	n := sink.only(t)
	if n.Kind != agentnotify.KindNeedsInput || n.Body != "Claude needs your permission to use Bash" {
		t.Fatalf("note = %+v, want needs-input with the message", n)
	}
}

func TestIgnoredNotifications(t *testing.T) {
	app, sink := newApp(t)
	cwd := agentTab(t, app, "tab-1")
	for _, typ := range []string{"idle_prompt", "auth_success"} {
		hook(t, app, "tab-1", `{"hook_event_name":"Notification","notification_type":"`+typ+`","cwd":`+quote(cwd)+`,"message":"x"}`)
	}
	sink.none(t)
}

func TestWakeArmedStopSilent(t *testing.T) {
	app, sink := newApp(t)
	setCooldown(t, time.Millisecond)
	cwd := agentTab(t, app, "tab-1")
	hook(t, app, "tab-1", `{"hook_event_name":"PreToolUse","tool_name":"Monitor","tool_use_id":"u"}`)
	stop(t, app, "tab-1", cwd, "waiting")
	sink.none(t)
	event(t, app, "tab-1", "UserPromptSubmit")
	stop(t, app, "tab-1", cwd, "now done")
	if n := sink.only(t); n.Kind != agentnotify.KindFinished {
		t.Fatalf("note = %+v, want finished", n)
	}
}

func TestFocusedTabSuppresses(t *testing.T) {
	app, sink := newApp(t)
	setCooldown(t, time.Millisecond)
	cwd := agentTab(t, app, "tab-1")

	focus(t, app, bridge.ReportFocusArgs{Focused: true, Module: "terminal", ActiveTerminalID: "tab-1"})
	stop(t, app, "tab-1", cwd, "a")
	sink.none(t)

	focus(t, app, bridge.ReportFocusArgs{Focused: true, Module: "terminal", ActiveTerminalID: "tab-2"})
	stop(t, app, "tab-1", cwd, "b")
	if len(sink.all()) != 1 {
		t.Fatalf("notes = %+v, want one while another tab is active", sink.all())
	}

	time.Sleep(5 * time.Millisecond)
	focus(t, app, bridge.ReportFocusArgs{Focused: false, Module: "terminal", ActiveTerminalID: "tab-1"})
	stop(t, app, "tab-1", cwd, "c")
	if len(sink.all()) != 2 {
		t.Fatalf("notes = %+v, want a second one while the window is blurred", sink.all())
	}
}

func TestCooldown(t *testing.T) {
	app, sink := newApp(t)
	setCooldown(t, 300*time.Millisecond)
	cwd := agentTab(t, app, "tab-1")
	stop(t, app, "tab-1", cwd, "one")
	stop(t, app, "tab-1", cwd, "two")
	if len(sink.all()) != 1 {
		t.Fatalf("notes = %+v, want one inside the cooldown", sink.all())
	}
	time.Sleep(400 * time.Millisecond)
	stop(t, app, "tab-1", cwd, "three")
	if len(sink.all()) != 2 {
		t.Fatalf("notes = %+v, want two after the cooldown", sink.all())
	}
}

func TestPrefsToggles(t *testing.T) {
	app, sink := newApp(t)
	setCooldown(t, time.Millisecond)
	cwd := agentTab(t, app, "tab-1")
	needs := `{"hook_event_name":"Notification","notification_type":"elicitation_dialog","message":"pick one"}`
	pause := func() { time.Sleep(5 * time.Millisecond) }

	setNotify(t, app, model.ClaudeCodePatch{NotifyOnFinished: off()})
	stop(t, app, "tab-1", cwd, "x")
	sink.none(t)
	hook(t, app, "tab-1", needs)
	if n := sink.only(t); n.Kind != agentnotify.KindNeedsInput {
		t.Fatalf("note = %+v, want needs-input while finished is off", n)
	}

	on := true
	setNotify(t, app, model.ClaudeCodePatch{NotifyOnFinished: &on, NotifyOnNeedsInput: off()})
	pause()
	hook(t, app, "tab-1", needs)
	if len(sink.all()) != 1 {
		t.Fatalf("notes = %+v, want no new needs-input note", sink.all())
	}

	setNotify(t, app, model.ClaudeCodePatch{NotifyIncludeMessage: off()})
	stop(t, app, "tab-1", cwd, "secret reply")
	if got := sink.all(); len(got) != 2 || strings.Contains(got[1].Body, "secret") || got[1].Body == "" {
		t.Fatalf("notes = %+v, want the fixed body without the reply", got)
	}

	setNotify(t, app, model.ClaudeCodePatch{NotifyEnabled: off()})
	pause()
	stop(t, app, "tab-1", cwd, "x")
	hook(t, app, "tab-1", needs)
	if len(sink.all()) != 2 {
		t.Fatalf("notes = %+v, want nothing while the master switch is off", sink.all())
	}

	app.Restart()
	sink2 := &recSink{}
	app.W.AgentNotify.SetSink(sink2)
	cwd = agentTab2(t, app, "tab-2")
	stop(t, app, "tab-2", cwd, "x")
	sink2.none(t)
}

// agentTab2 opens a tab in an already-imported "proj" after a restart.
func agentTab2(t *testing.T, app *flowharness.App, id string) string {
	t.Helper()
	cwd := app.Work + "/proj"
	openAgent(t, app, id, cwd)
	return cwd
}

func TestAdeStageSessionNote(t *testing.T) {
	app, sink := newApp(t, flowharness.WithTrackerGrace(time.Second))
	claude(app, map[string][]fakeagent.Action{"*": {{Name: "done"}, {Name: "sleep"}}})
	setCooldown(t, time.Millisecond)
	task, rec := adeTask(t, app)
	startRun(t, app, task, rec.ID)
	waitRunDone(t, app, task.ID)
	if _, err := app.W.AdeTask.StageDone(ctx, adewire.TaskArgs{TaskID: task.ID}); err != nil {
		t.Fatal(err)
	}
	launch, err := app.W.AdeTask.LaunchStage(ctx, adewire.LaunchStageArgs{TaskID: task.ID})
	if err != nil {
		t.Fatal(err)
	}
	openAgent2(t, app, launch)
	testx.WaitUntil(t, waitFor, func() bool { _, ok := app.W.Tracker.RecordOf(launch.TerminalID); return ok })

	stop(t, app, launch.TerminalID, launch.Cwd, "stage done")
	finished := sink.ofKind(agentnotify.KindFinished)
	if len(finished) != 1 {
		t.Fatalf("finished notes = %+v, want one", finished)
	}
	n := finished[0]
	if !strings.Contains(n.Title, "Fix login") || n.RecordID != launch.SessionID {
		t.Fatalf("note = %+v, want the task title and session record %s", n, launch.SessionID)
	}
}

func TestRunEndedNotifies(t *testing.T) {
	app, sink := newApp(t)
	claude(app, map[string][]fakeagent.Action{"*": {{Name: "done"}}})
	task, rec := adeTask(t, app)
	startRun(t, app, task, rec.ID)
	waitRunDone(t, app, task.ID)
	testx.WaitUntil(t, waitFor, func() bool { return len(sink.all()) > 0 })
	n := sink.only(t)
	if n.Kind != agentnotify.KindRunEnded || !strings.Contains(n.Title, "ADE run done") || !strings.Contains(n.Title, "Fix login") || n.TaskID != task.ID {
		t.Fatalf("note = %+v, want a run-ended note for the task", n)
	}

	app.Restart()
	sink2 := &recSink{}
	app.W.AgentNotify.SetSink(sink2)
	time.Sleep(time.Second)
	sink2.none(t)
}

func TestClickRevealsTerminal(t *testing.T) {
	app, sink := newApp(t)
	// The fake claude must outlive the click: once it exits, the terminal leaves the registry.
	claude(app, map[string][]fakeagent.Action{"*": {{WaitFile: filepath.Join(app.Root, "never")}}})
	cwd := agentTab(t, app, "tab-1")
	stop(t, app, "tab-1", cwd, "x")
	n := sink.only(t)
	mark := app.Events.Mark()
	app.W.AgentNotify.Click(map[string]any{"terminalId": n.TerminalID, "windowKey": n.WindowKey, "kind": string(n.Kind)})

	if got := app.WindowMgr.Focused; len(got) != 1 || got[0] != window {
		t.Fatalf("focused windows = %v, want [%s]", got, window)
	}
	evs := app.Events.Since(mark, bridge.ChannelAgentRevealTerminal)
	if len(evs) != 1 || evs[0].Window != window {
		t.Fatalf("reveal events = %+v, want one addressed to %s", evs, window)
	}
	var payload struct{ TerminalID string }
	evs[0].Decode(t, &payload)
	if payload.TerminalID != "tab-1" {
		t.Fatalf("reveal payload = %+v", payload)
	}
}

func TestClickRevealsAdeSession(t *testing.T) {
	app, sink := newApp(t, flowharness.WithTrackerGrace(time.Second))
	claude(app, map[string][]fakeagent.Action{"*": {{Name: "done"}, {Name: "sleep"}}})
	setCooldown(t, time.Millisecond)
	task, rec := adeTask(t, app)
	startRun(t, app, task, rec.ID)
	waitRunDone(t, app, task.ID)
	if _, err := app.W.AdeTask.StageDone(ctx, adewire.TaskArgs{TaskID: task.ID}); err != nil {
		t.Fatal(err)
	}
	launch, err := app.W.AdeTask.LaunchStage(ctx, adewire.LaunchStageArgs{TaskID: task.ID})
	if err != nil {
		t.Fatal(err)
	}
	openAgent2(t, app, launch)
	testx.WaitUntil(t, waitFor, func() bool { _, ok := app.W.Tracker.RecordOf(launch.TerminalID); return ok })
	stop(t, app, launch.TerminalID, launch.Cwd, "x")
	finished := sink.ofKind(agentnotify.KindFinished)
	if len(finished) != 1 {
		t.Fatalf("finished notes = %+v, want one", finished)
	}
	n := finished[0]

	mark := app.Events.Mark()
	app.W.AgentNotify.Click(map[string]any{"terminalId": n.TerminalID, "windowKey": n.WindowKey, "recordId": n.RecordID})
	evs := app.Events.Since(mark, adewire.ChannelOpenSession)
	if len(evs) != 1 || evs[0].Window != window {
		t.Fatalf("open-session events = %+v, want one addressed to %s", evs, window)
	}
}

func TestSendTest(t *testing.T) {
	app, sink := newApp(t)
	cwd := agentTab(t, app, "tab-1")
	_ = cwd
	focus(t, app, bridge.ReportFocusArgs{Focused: true, Module: "terminal", ActiveTerminalID: "tab-1"})
	if err := app.W.AgentNotifySvc.SendTest(); err != nil {
		t.Fatal(err)
	}
	if n := sink.only(t); n.Kind != agentnotify.KindTest {
		t.Fatalf("note = %+v, want a test note", n)
	}
	setNotify(t, app, model.ClaudeCodePatch{NotifyEnabled: off()})
	if err := app.W.AgentNotifySvc.SendTest(); err != nil {
		t.Fatal(err)
	}
	if len(sink.all()) != 1 {
		t.Fatalf("notes = %+v, want no test note while the master switch is off", sink.all())
	}
}
