package termflow_test

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/internal/scriptruns"
	"github.com/kirathecat/kira-studio/internal/scripts"
	"github.com/kirathecat/kira-studio/internal/terminal"
	"github.com/kirathecat/kira-studio/internal/testx"
)

func newScript(t *testing.T, app *flowharness.App, f scripts.CustomScriptFields) scripts.CustomScript {
	t.Helper()
	if f.Name == "" {
		f.Name = "job"
	}
	if f.Color == "" {
		f.Color = "blue"
	}
	rec, err := app.W.CustomScripts.Create(bridge.CustomScriptsCreateArgs{Fields: f})
	if err != nil {
		t.Fatal(err)
	}
	return rec
}

func openScript(t *testing.T, app *flowharness.App, window, id, scriptID string) {
	t.Helper()
	if _, err := app.W.Terminal.Open(terminal.OpenArgs{
		TerminalID: id, WindowKey: window, Cols: 80, Rows: 24, LaunchKind: terminal.LaunchKindScript, ScriptID: scriptID,
	}); err != nil {
		t.Fatal(err)
	}
}

func runOf(t *testing.T, app *flowharness.App, terminalID string) scriptruns.Run {
	t.Helper()
	runs, err := app.W.ScriptRuns.List(scriptruns.ListArgs{})
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range runs {
		if r.TerminalID == terminalID {
			return r
		}
	}
	t.Fatalf("no run for terminal %q in %+v", terminalID, runs)
	return scriptruns.Run{}
}

func waitRun(t *testing.T, app *flowharness.App, terminalID, state string) scriptruns.Run {
	t.Helper()
	var r scriptruns.Run
	testx.WaitUntil(t, waitFor, func() bool {
		runs, _ := app.W.ScriptRuns.List(scriptruns.ListArgs{})
		for _, x := range runs {
			if x.TerminalID == terminalID && x.State == state {
				r = x
				return true
			}
		}
		return false
	})
	return r
}

func TestScriptRunLifecycle(t *testing.T) {
	app := flowharness.New(t)
	rec := newScript(t, app, scripts.CustomScriptFields{Command: "echo started; read x; echo done"})
	mark := app.Events.Mark()
	openScript(t, app, window, "ok", rec.ID)

	running := waitRun(t, app, "ok", "running")
	app.Events.WaitAfter(t, mark, bridge.ChannelScriptRunsChanged, nil, waitFor)
	got, err := app.W.ScriptRuns.Get(scriptruns.IDArgs{ID: running.ID})
	if err != nil || got.State != "running" || got.Outcome != nil || got.Command != rec.Command || got.ScriptName != "job" {
		t.Fatalf("mid-run Get = %+v, %v", got, err)
	}
	if want := filepath.Join(app.SpaceHome, "automations", rec.ID); got.Cwd != want {
		t.Fatalf("cwd = %q, want %q", got.Cwd, want)
	}

	testx.WaitUntil(t, waitFor, func() bool { return hasLine(output(app, "ok"), "started") })
	if err := app.W.Terminal.Write(terminal.WriteArgs{TerminalID: "ok", Data: base64.StdEncoding.EncodeToString([]byte("\n"))}); err != nil {
		t.Fatal(err)
	}
	done := waitRun(t, app, "ok", "done")
	// Contract automations: tests/ui/automations-runs.spec.ts "contract: a script run ends ..." reads the same fixture.
	app.Contract(t, "automations", "CustomScriptsService.Create#done", rec)
	app.Contract(t, "automations", "ScriptRunsService.Get#done", done, flowharness.Mask("createdAt", "startedAt", "finishedAt"))
	if done.Outcome == nil || done.Outcome.Status != "done" || done.Outcome.ExitCode == nil || *done.Outcome.ExitCode != 0 || done.FinishedAt == nil {
		t.Fatalf("finished run = %+v", done)
	}
	if _, err := app.W.ScriptRuns.Get(scriptruns.IDArgs{ID: "missing"}); err == nil {
		t.Fatal("Get of an unknown run succeeded")
	}
}

func TestScriptRunNonZeroExit(t *testing.T) {
	app := flowharness.New(t)
	rec := newScript(t, app, scripts.CustomScriptFields{Command: "echo boom >&2; exit 3"})
	openScript(t, app, window, "bad", rec.ID)
	r := waitRun(t, app, "bad", "failed")
	app.Contract(t, "automations", "CustomScriptsService.Create#failed", rec)
	app.Contract(t, "automations", "ScriptRunsService.Get#failed", r, flowharness.Mask("createdAt", "startedAt", "finishedAt"))
	if r.Outcome.Reason != "exited with status 3" || r.Outcome.Source != "exit" || *r.Outcome.ExitCode != 3 {
		t.Fatalf("outcome = %+v, want exit 3", r.Outcome)
	}
}

func TestScriptRunStopAndClose(t *testing.T) {
	app := flowharness.New(t)
	rec := newScript(t, app, scripts.CustomScriptFields{Command: "sleep 60"})

	openScript(t, app, window, "a", rec.ID)
	waitRun(t, app, "a", "running")
	if err := app.W.Terminal.Close(terminal.CloseArgs{TerminalID: "a"}); err != nil {
		t.Fatal(err)
	}
	if r := waitRun(t, app, "a", "cancelled"); r.Outcome.Reason != "stopped by you" || r.Outcome.Source != "user" {
		t.Fatalf("Close outcome = %+v", r.Outcome)
	}

	openScript(t, app, window, "b", rec.ID)
	r := waitRun(t, app, "b", "running")
	if err := app.W.ScriptRuns.Stop(scriptruns.IDArgs{ID: r.ID}); err != nil {
		t.Fatal(err)
	}
	if r := waitRun(t, app, "b", "cancelled"); r.Outcome.Reason != "stopped by you" {
		t.Fatalf("Stop outcome = %+v", r.Outcome)
	} else {
		app.Contract(t, "automations", "CustomScriptsService.Create#cancelled", rec)
		app.Contract(t, "automations", "ScriptRunsService.Get#cancelled", r, flowharness.Mask("createdAt", "startedAt", "finishedAt"))
	}
	if err := app.W.ScriptRuns.Stop(scriptruns.IDArgs{ID: r.ID}); err != nil {
		t.Fatalf("Stop of a finished run = %v, want a no-op", err)
	}
	if err := app.W.ScriptRuns.Stop(scriptruns.IDArgs{ID: "missing"}); err == nil {
		t.Fatal("Stop of an unknown run succeeded")
	}
}

func TestScriptRunWindowClose(t *testing.T) {
	app := flowharness.New(t)
	rec := newScript(t, app, scripts.CustomScriptFields{Command: "sleep 60"})
	openScript(t, app, "w2", "w", rec.ID)
	waitRun(t, app, "w", "running")
	app.W.TermRegistry.CloseWindow("w2")
	if r := waitRun(t, app, "w", "cancelled"); r.Outcome.Reason != "its window closed while it ran" {
		t.Fatalf("window close outcome = %+v", r.Outcome)
	}
}

func TestScriptRunQuitAndRestart(t *testing.T) {
	app := flowharness.New(t)
	rec := newScript(t, app, scripts.CustomScriptFields{Command: "sleep 60"})
	openScript(t, app, window, "q", rec.ID)
	waitRun(t, app, "q", "running")

	// A row the previous process left running with nothing to end it, as after a crash.
	if _, err := app.DB().Exec(`INSERT INTO script_runs (id, script_id, script_name, trigger_kind, state, terminal_id, created_at)
		VALUES ('stale', ?, 'job', 'terminal', 'running', 'gone', 1)`, rec.ID); err != nil {
		t.Fatal(err)
	}

	app.Restart()
	for _, c := range []struct{ id, terminal string }{{"", "q"}, {"stale", "gone"}} {
		runs, err := app.W.ScriptRuns.List(scriptruns.ListArgs{})
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for _, r := range runs {
			if r.TerminalID != c.terminal {
				continue
			}
			found = true
			if r.State != "failed" || r.Outcome == nil || r.Outcome.Source != "restart" || !strings.Contains(r.Outcome.Reason, "Kira Space") {
				t.Fatalf("run %q after restart = %+v, want failed by restart naming the app", c.terminal, r)
			}
		}
		if !found {
			t.Fatalf("run for terminal %q missing after restart", c.terminal)
		}
	}
}

func TestScriptFolders(t *testing.T) {
	app := flowharness.New(t)
	runs := app.W.ScriptRuns

	base, err := runs.ResolveDir(scriptruns.ResolveDirArgs{})
	if err != nil || base.Base != app.SpaceHome || base.Mode != scripts.DirModeKira {
		t.Fatalf("ResolveDir of an unsaved script = %+v, %v", base, err)
	}

	kira := newScript(t, app, scripts.CustomScriptFields{Command: "pwd"})
	d, err := runs.ResolveDir(scriptruns.ResolveDirArgs{ScriptID: kira.ID})
	if want := filepath.Join(app.SpaceHome, "automations", kira.ID); err != nil || d.Path != want || d.Blocker != "" {
		t.Fatalf("kira dir = %+v, %v, want %s", d, err, want)
	}
	openScript(t, app, window, "k", kira.ID)
	waitRun(t, app, "k", "done")
	if info, err := os.Stat(d.Path); err != nil || !info.IsDir() || info.Mode().Perm() != 0o700 {
		t.Fatalf("automations folder = %v, %v, want a 0700 directory", info, err)
	}

	missing := filepath.Join(t.TempDir(), "gone")
	fixed := newScript(t, app, scripts.CustomScriptFields{Command: "pwd", DirMode: scripts.DirModeFixed, WorkingDir: missing})
	d, err = runs.ResolveDir(scriptruns.ResolveDirArgs{ScriptID: fixed.ID})
	if err != nil || d.Blocker != missing+" does not exist" {
		t.Fatalf("fixed dir = %+v, %v, want a does-not-exist blocker", d, err)
	}
	// Contract script-folders: tests/ui automations-scripts "Choose folder…" reads the fixed record.
	app.Contract(t, "script-folders", "CustomScriptsService.Create#fixed", fixed, flowharness.Replace(filepath.Dir(missing), "<tmp>"))

	// A symlink where the folder belongs is refused, not followed.
	target := t.TempDir()
	link := newScript(t, app, scripts.CustomScriptFields{Command: "pwd"})
	if err := os.Symlink(target, filepath.Join(app.SpaceHome, "automations", link.ID)); err != nil {
		t.Fatal(err)
	}
	if _, err := app.W.Terminal.Open(terminal.OpenArgs{
		TerminalID: "sym", WindowKey: window, Cols: 80, Rows: 24, LaunchKind: terminal.LaunchKindScript, ScriptID: link.ID,
	}); err == nil || !strings.Contains(err.Error(), "is not a real folder") {
		t.Fatalf("Open into a symlinked folder = %v, want a not-a-real-folder refusal", err)
	}
	if r := runOf(t, app, "sym"); r.State != "failed" || r.Outcome == nil || r.Outcome.Source != "start" {
		t.Fatalf("blocked run = %+v, want failed at start", r)
	}

	// A legacy home row still runs in $HOME; choosing it for a new script is refused.
	legacy := newScript(t, app, scripts.CustomScriptFields{Command: "pwd"})
	if _, err := app.DB().Exec(`UPDATE custom_scripts SET dir_mode = 'home' WHERE id = ?`, legacy.ID); err != nil {
		t.Fatal(err)
	}
	d, err = runs.ResolveDir(scriptruns.ResolveDirArgs{ScriptID: legacy.ID})
	if err != nil || d.Mode != scripts.DirModeHome || d.Path != app.Home {
		t.Fatalf("legacy dir = %+v, %v, want the home folder", d, err)
	}
	// tests/ui automations-runs "a legacy home script offers the automations folder" reads this.
	app.Contract(t, "script-folders", "ScriptRunsService.ResolveDir#legacy", d)
	if _, err := app.W.CustomScripts.Create(bridge.CustomScriptsCreateArgs{Fields: scripts.CustomScriptFields{
		Name: "h", Command: "pwd", Color: "blue", DirMode: scripts.DirModeHome,
	}}); err == nil {
		t.Fatal("Create with the retired home folder succeeded")
	}
	if _, err := runs.ResolveDir(scriptruns.ResolveDirArgs{ScriptID: "missing"}); err == nil {
		t.Fatal("ResolveDir of an unknown script succeeded")
	}
}

func TestScriptLaunchIgnoresForgedCommand(t *testing.T) {
	app := flowharness.New(t)
	rec := newScript(t, app, scripts.CustomScriptFields{Command: "echo stored-command"})
	if _, err := app.W.Terminal.Open(terminal.OpenArgs{
		TerminalID: "f", WindowKey: window, Cwd: t.TempDir(), Cols: 80, Rows: 24, Command: "echo forged",
		LaunchKind: terminal.LaunchKindScript, ScriptID: rec.ID,
	}); err != nil {
		t.Fatal(err)
	}
	testx.WaitUntil(t, waitFor, func() bool { return hasLine(output(app, "f"), "stored-command") })
	if hasLine(output(app, "f"), "forged") {
		t.Fatalf("output ran the forged command: %q", output(app, "f"))
	}
	if r := runOf(t, app, "f"); r.Command != rec.Command {
		t.Fatalf("run command = %q, want the stored one", r.Command)
	}
	if _, err := app.W.Terminal.Open(terminal.OpenArgs{
		TerminalID: "nope", WindowKey: window, Cols: 80, Rows: 24, LaunchKind: terminal.LaunchKindScript, ScriptID: "missing",
	}); err == nil {
		t.Fatal("Open with an unknown script id succeeded")
	}
}

func TestScriptRunRetentionAndRemove(t *testing.T) {
	app := flowharness.New(t)
	rec := newScript(t, app, scripts.CustomScriptFields{Command: "true"})
	for i := 0; i < 510; i++ {
		if _, err := app.DB().Exec(`INSERT INTO script_runs (id, script_id, script_name, trigger_kind, state, terminal_id, created_at, finished_at)
			VALUES (?, ?, 'old', 'terminal', 'done', '', ?, ?)`, fmt.Sprintf("old-%d", i), rec.ID, i+1, i+1); err != nil {
			t.Fatal(err)
		}
	}
	openScript(t, app, window, "r", rec.ID)
	waitRun(t, app, "r", "done")
	var n int
	testx.WaitUntil(t, waitFor, func() bool {
		if err := app.DB().QueryRow(`SELECT COUNT(*) FROM script_runs`).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n == 500
	})
	runs, err := app.W.ScriptRuns.List(scriptruns.ListArgs{Limit: 10})
	if err != nil || len(runs) != 10 || runs[0].TerminalID != "r" {
		t.Fatalf("List(10) = %d runs (newest %q), %v", len(runs), runs[0].TerminalID, err)
	}

	folder := filepath.Join(app.SpaceHome, "automations", rec.ID)
	if _, err := os.Stat(folder); err != nil {
		t.Fatalf("automations folder missing before Remove: %v", err)
	}
	if err := app.W.CustomScripts.Remove(bridge.CustomScriptsRemoveArgs{ID: rec.ID}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(folder); !os.IsNotExist(err) {
		t.Fatalf("automations folder after Remove: %v, want it gone", err)
	}
}
