package usageflow_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/claudeusage"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness/fakeagent"
	"github.com/kirathecat/kira-studio/internal/flowtest"
)

func TestStatusLineFeed(t *testing.T) {
	app := newApp(t)
	mark := app.Events.Mark()
	doc, _, env := launch(t, app, "tab-1", "")
	fiveReset, sevenReset := in(2*time.Hour), in(72*time.Hour)
	out := runStatusLine(t, doc, env, payload(23.5, fiveReset, 41.2, sevenReset))
	if out != "" {
		t.Fatalf("wrapper printed %q with no user statusline, want nothing", out)
	}
	snap := waitState(t, app, func(s claudeusage.Snapshot) bool { return s.State == claudeusage.StateOK })
	if snap.Source != claudeusage.SourceSession || snap.FiveHour == nil || snap.SevenDay == nil {
		t.Fatalf("snapshot = %+v, want session source and both windows", snap)
	}
	if snap.FiveHour.UsedPercent != 23.5 || snap.FiveHour.ResetsAt != fiveReset*1000 {
		t.Fatalf("five_hour = %+v, want 23.5%% resetting at %d ms", snap.FiveHour, fiveReset*1000)
	}
	if snap.SevenDay.UsedPercent != 41.2 || snap.SevenDay.ResetsAt != sevenReset*1000 {
		t.Fatalf("seven_day = %+v", snap.SevenDay)
	}
	app.Events.WaitAfter(t, mark, bridge.ChannelClaudeUsage, func(flowtest.Event) bool { return true }, waitFor)
}

func TestUserStatusLinePreserved(t *testing.T) {
	app := newApp(t)
	userFile := filepath.Join(app.Home, ".claude", "settings.json")
	userBody := `{"statusLine":{"type":"command","command":"printf USER","padding":2}}`
	writeFile(t, userFile, userBody)
	proj := filepath.Join(app.Work, "proj")
	localFile := filepath.Join(proj, ".claude", "settings.local.json")
	localBody := `{"statusLine":{"type":"command","command":"printf PROJECT"}}`
	writeFile(t, localFile, localBody)

	doc, _, env := launch(t, app, "tab-user", "")
	if got := runStatusLine(t, doc, env, payload(1, in(time.Hour), 2, in(time.Hour))); got != "USER" {
		t.Fatalf("wrapper output = %q, want the user's own statusline", got)
	}
	sl, _ := doc["statusLine"].(map[string]any)
	if sl["padding"] != float64(2) {
		t.Fatalf("statusLine = %v, want the user's padding kept", sl)
	}

	doc, _, env = launch(t, app, "tab-proj", proj)
	if got := runStatusLine(t, doc, env, payload(1, in(time.Hour), 2, in(time.Hour))); got != "PROJECT" {
		t.Fatalf("wrapper output = %q, want the project-local statusline to win", got)
	}

	for path, want := range map[string]string{userFile: userBody, localFile: localBody} {
		got, err := os.ReadFile(path)
		if err != nil || string(got) != want {
			t.Fatalf("%s = %q (%v), want it untouched", path, got, err)
		}
	}
}

func TestStatusLineThrottle(t *testing.T) {
	app := newApp(t)
	doc, _, env := launch(t, app, "tab-1", "")
	reset := in(time.Hour)
	runStatusLine(t, doc, env, payload(10, reset, 20, reset))
	waitState(t, app, func(s claudeusage.Snapshot) bool { return s.State == claudeusage.StateOK })
	runStatusLine(t, doc, env, payload(55, reset, 60, reset))
	time.Sleep(700 * time.Millisecond)
	if snap := usage(t, app); snap.FiveHour.UsedPercent != 10 {
		t.Fatalf("five_hour = %v after a second payload inside 30 s, want the first (10)", snap.FiveHour.UsedPercent)
	}
}

func TestUsageOffNoInjection(t *testing.T) {
	app := newApp(t)
	setUsage(t, app, false)
	command, env := app.W.AgentHooks.ComposeLaunch("tab-1", "", "claude")
	if len(env) == 0 || !strings.Contains(command, app.W.AgentHooks.Status().SettingsPath) {
		t.Fatalf("command = %q, want the plain hooks file", command)
	}
	raw, err := os.ReadFile(app.W.AgentHooks.Status().SettingsPath)
	if err != nil || strings.Contains(string(raw), "statusLine") {
		t.Fatalf("hooks file has a statusLine (%v): %s", err, raw)
	}
	if snap := usage(t, app); snap.State != claudeusage.StateOff {
		t.Fatalf("state = %q, want off", snap.State)
	}
}

func TestExpiredWindowDropped(t *testing.T) {
	app := newApp(t)
	doc, _, env := launch(t, app, "tab-1", "")
	runStatusLine(t, doc, env, payload(30, in(time.Hour), 90, in(-time.Minute)))
	snap := waitState(t, app, func(s claudeusage.Snapshot) bool { return s.State == claudeusage.StateOK })
	if snap.FiveHour == nil || snap.SevenDay != nil {
		t.Fatalf("snapshot = %+v, want only the five_hour window", snap)
	}
}

func TestSnapshotSurvivesRestart(t *testing.T) {
	app := newApp(t)
	doc, _, env := launch(t, app, "tab-1", "")
	runStatusLine(t, doc, env, payload(23.5, in(time.Hour), 41.2, in(48*time.Hour)))
	before := waitState(t, app, func(s claudeusage.Snapshot) bool { return s.State == claudeusage.StateOK })
	app.Restart()
	after := usage(t, app)
	if after.State != claudeusage.StateOK || after.FiveHour == nil || *after.FiveHour != *before.FiveHour {
		t.Fatalf("after restart = %+v, want %+v", after, before)
	}
	raw, err := os.ReadFile(filepath.Join(app.SpaceHome, "claude-usage.json"))
	if err != nil || strings.Contains(string(raw), "rate_limits") {
		t.Fatalf("persisted file = %q (%v), want numbers only", raw, err)
	}
	if st, _ := os.Stat(filepath.Join(app.SpaceHome, "claude-usage.json")); st.Mode().Perm() != 0o600 {
		t.Fatalf("mode = %v, want 0600", st.Mode().Perm())
	}
}

func TestRunStreamFeed(t *testing.T) {
	app := newApp(t)
	resetFive, resetSeven := in(time.Hour), in(48*time.Hour)
	stream := filepath.Join(app.Root, "stream.jsonl")
	writeFile(t, stream, `{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","unifiedWindows":{"five_hour":{"utilization":0.24,"resetsAt":`+
		itoa(resetFive)+`},"seven_day":{"utilization":0.47,"resetsAt":`+itoa(resetSeven)+`}}}}`+"\n")
	app.Scenario(fakeagent.Scenario{Claude: map[string][]fakeagent.Action{"*": {{Name: "done", Emit: stream}}}})
	task, repo := adeTask(t, app)
	startRun(t, app, task, repo.ID)
	snap := waitState(t, app, func(s claudeusage.Snapshot) bool { return s.State == claudeusage.StateOK })
	if snap.Source != claudeusage.SourceRun || snap.FiveHour.UsedPercent != 24 || snap.SevenDay.UsedPercent != 47 {
		t.Fatalf("snapshot = %+v, want the run's 24%% and 47%%", snap)
	}
	if snap.FiveHour.ResetsAt != resetFive*1000 {
		t.Fatalf("five_hour reset = %d, want %d", snap.FiveHour.ResetsAt, resetFive*1000)
	}
}
