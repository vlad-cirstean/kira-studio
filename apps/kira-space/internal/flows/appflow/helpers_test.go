package appflow_test

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/internal/flowtest/fakeagent"
)

var ctx = context.Background()

const waitFor = 20 * time.Second

func claude(app *flowharness.App, byRepo map[string][]fakeagent.Action) {
	app.Scenario(fakeagent.Scenario{Claude: byRepo})
}

func importRepo(t *testing.T, app *flowharness.App, dir string) model.CodeRepo {
	t.Helper()
	rec, err := app.W.CodeWorkspace.ImportRepo(ctx, bridge.CodeWorkspaceImportArgs{Path: dir})
	if err != nil {
		t.Fatalf("ImportRepo %s: %v", dir, err)
	}
	return rec
}

// cloneWithMain returns a clone at dir of a fresh bare remote holding one commit on main.
func cloneWithMain(app *flowharness.App, dir string) (*flowharness.Repo, *flowharness.Bare) {
	name := filepath.Base(dir)
	bare := app.NewBare(name + "-remote")
	seed := app.NewRepo(name + "-seed")
	seed.Commit("base", map[string]string{"base.txt": "base\n"})
	bare.PushFrom(seed)
	return bare.Clone(dir), bare
}

func setSettings(t *testing.T, app *flowharness.App, patch model.SettingsPatch) {
	t.Helper()
	if _, err := app.W.Settings.Set(bridge.SettingsSetArgs{Patch: patch}); err != nil {
		t.Fatalf("Settings.Set: %v", err)
	}
}

func setGitPath(t *testing.T, app *flowharness.App, path string) {
	t.Helper()
	setSettings(t, app, model.SettingsPatch{Git: &model.GitPatch{GitPath: &path}})
}

func setAgentKeepAwake(t *testing.T, app *flowharness.App, on bool) {
	t.Helper()
	setSettings(t, app, model.SettingsPatch{ClaudeCode: &model.ClaudeCodePatch{KeepAwakeWithAgents: &on}})
}

func realGit(t *testing.T) string {
	t.Helper()
	p, err := exec.LookPath("git")
	if err != nil {
		t.Fatal(err)
	}
	abs, err := filepath.Abs(p)
	if err != nil {
		t.Fatal(err)
	}
	return abs
}

func createTask(t *testing.T, app *flowharness.App, title string, repoIDs ...string) adewire.Task {
	t.Helper()
	task, err := app.W.AdeTask.CreateTask(ctx, adewire.CreateTaskArgs{Title: title, CodeRepoIDs: repoIDs})
	if err != nil {
		t.Fatalf("CreateTask: %v", err)
	}
	return task
}

func writeExecutable(t *testing.T, path, body string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}
}
