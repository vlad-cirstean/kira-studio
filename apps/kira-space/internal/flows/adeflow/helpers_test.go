package adeflow_test

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness/fakeagent"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/internal/testx"
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

func board(t *testing.T, app *flowharness.App) adewire.Board {
	t.Helper()
	b, err := app.W.AdeTask.Board(ctx)
	if err != nil {
		t.Fatalf("Board: %v", err)
	}
	return b
}

func repoState(b adewire.Board, repoID string) (adewire.RepoState, bool) {
	for _, r := range b.Repos {
		if r.CodeRepoID == repoID {
			return r, true
		}
	}
	return adewire.RepoState{}, false
}

func branchOf(t *testing.T, b adewire.Board, taskID, repoID string) adewire.Branch {
	t.Helper()
	for _, br := range b.Branches {
		if br.TaskID == taskID && br.CodeRepoID == repoID {
			return br
		}
	}
	t.Fatalf("board has no branch of task %s in repo %s", taskID, repoID)
	return adewire.Branch{}
}

func taskOf(t *testing.T, b adewire.Board, taskID string) adewire.Task {
	t.Helper()
	for _, tk := range b.Tasks {
		if tk.ID == taskID {
			return tk
		}
	}
	t.Fatalf("board has no task %s", taskID)
	return adewire.Task{}
}

func createTask(t *testing.T, app *flowharness.App, title, workflow string, repoIDs ...string) adewire.Task {
	t.Helper()
	task, err := app.W.AdeTask.CreateTask(ctx, adewire.CreateTaskArgs{Title: title, CodeRepoIDs: repoIDs, WorkflowID: workflow})
	if err != nil {
		t.Fatalf("CreateTask: %v", err)
	}
	return task
}

func saveWorkflow(t *testing.T, app *flowharness.App, id, yaml string) {
	t.Helper()
	entry, err := app.W.AdeTask.SaveWorkflowYaml(ctx, adewire.SaveWorkflowYamlArgs{FileName: id + ".yaml", Yaml: yaml})
	if err != nil {
		t.Fatalf("SaveWorkflowYaml: %v", err)
	}
	if entry.Error != nil {
		t.Fatalf("workflow %s invalid: %+v", id, entry.Error)
	}
}

func flowYAML(id, stages string) string { return "id: " + id + "\nname: Flow\nstages:\n" + stages }

func agentStage(id, steps string) string {
	return "  - id: " + id + "\n    name: " + id + "\n    kind: agent\n    status: In progress\n    steps:\n" + steps
}

func agentStep(id, extra string) string {
	return "      - id: " + id + "\n        name: " + id + "\n        runs_on: each repo\n        timeout: 1m\n        prompt: work on {branch} in {repo}\n" + extra
}

// latestRun returns the newest run of the task's step on the repo's branch, from the board.
func latestRun(t *testing.T, app *flowharness.App, taskID, stepID string) (adewire.Run, bool) {
	t.Helper()
	b := board(t, app)
	var best adewire.Run
	found := false
	for _, r := range taskOf(t, b, taskID).Runs {
		if r.StepID == stepID && (!found || r.Attempt >= best.Attempt) {
			best, found = r, true
		}
	}
	return best, found
}

func waitRun(t *testing.T, app *flowharness.App, taskID, stepID string, states ...string) adewire.Run {
	t.Helper()
	var got adewire.Run
	testx.WaitUntil(t, waitFor, func() bool {
		r, ok := latestRun(t, app, taskID, stepID)
		got = r
		if !ok {
			return false
		}
		for _, s := range states {
			if r.State == s {
				return true
			}
		}
		return false
	})
	return got
}

// gitOut runs git in dir with the harness environment and returns trimmed stdout.
func gitOut(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s in %s: %v\n%s", strings.Join(args, " "), dir, err, out)
	}
	return strings.TrimSpace(string(out))
}

// commitIn writes name and commits it in dir with the real git.
func commitIn(t *testing.T, dir, name string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(name+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitOut(t, dir, "add", "-A")
	gitOut(t, dir, "commit", "-q", "-m", "add "+name)
}
