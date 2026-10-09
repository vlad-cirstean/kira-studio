package appflow_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/internal/appevent"
	"github.com/kirathecat/kira-studio/internal/flowtest/fakeagent"
	"github.com/kirathecat/kira-studio/internal/testx"
)

const agentFlow = `id: flow
name: Flow
stages:
  - id: build
    name: build
    kind: agent
    status: In progress
    steps:
      - id: one
        name: one
        runs_on: each repo
        timeout: 1m
        prompt: work on {branch} in {repo}
`

func TestKeepAwakeManualAndAgents(t *testing.T) {
	app := flowharness.New(t)
	hold := filepath.Join(t.TempDir(), "hold")
	claude(app, map[string][]fakeagent.Action{"*": {{WaitFile: hold}}})
	repo, _ := cloneWithMain(app, filepath.Join(app.Work, "api"))
	rec := importRepo(t, app, repo.Dir)

	mark := app.Events.Mark()
	if st := app.W.KeepAwake.SetManual(bridge.KeepAwakeSetManualArgs{Enabled: true}); !st.Manual || !st.Supported {
		t.Fatalf("SetManual(true) = %+v", st)
	}
	if !app.KeepAwake.Held() || !app.W.KeepAwake.Status().Manual {
		t.Fatal("manual toggle on does not hold the assertion")
	}
	app.Events.WaitAfter(t, mark, appevent.ChannelKeepAwake, nil, waitFor)
	if st := app.W.KeepAwake.SetManual(bridge.KeepAwakeSetManualArgs{Enabled: false}); st.Manual {
		t.Fatalf("SetManual(false) = %+v", st)
	}
	if app.KeepAwake.Held() {
		t.Fatal("manual toggle off leaves the assertion held")
	}

	// A running headless session counts only while the setting is on.
	entry, err := app.W.AdeTask.SaveWorkflowYaml(ctx, adewire.SaveWorkflowYamlArgs{FileName: "flow.yaml", Yaml: agentFlow})
	if err != nil || entry.Error != nil {
		t.Fatalf("SaveWorkflowYaml: %v %+v", err, entry.Error)
	}
	task, err := app.W.AdeTask.CreateTask(ctx, adewire.CreateTaskArgs{Title: "Fix login", CodeRepoIDs: []string{rec.ID}, WorkflowID: "flow"})
	if err != nil {
		t.Fatal(err)
	}
	b, err := app.W.AdeTask.Board(ctx)
	if err != nil {
		t.Fatal(err)
	}
	names := map[string]string{}
	for _, br := range b.Branches {
		if br.TaskID == task.ID {
			names[br.ID] = "feat/api-work"
		}
	}
	if _, err := app.W.AdeTask.StartRun(ctx, adewire.StartRunArgs{TaskID: task.ID, BranchNames: names}); err != nil {
		t.Fatal(err)
	}
	testx.WaitUntil(t, waitFor, func() bool {
		raw, _ := os.ReadFile(filepath.Join(app.FakeDir, "api-1.args"))
		return len(raw) > 0
	})
	if app.KeepAwake.Held() {
		t.Fatal("a running agent holds the assertion with the setting off")
	}

	setAgentKeepAwake(t, app, true)
	testx.WaitUntil(t, waitFor, app.KeepAwake.Held)
	if st := app.W.KeepAwake.Status(); st.Manual {
		t.Fatalf("status = %+v, want the manual reason off while the agent reason holds", st)
	}
	// The manual reason keeps the assertion after the agent ends.
	app.W.KeepAwake.SetManual(bridge.KeepAwakeSetManualArgs{Enabled: true})

	if err := os.WriteFile(hold, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	testx.WaitUntil(t, waitFor, func() bool {
		b, _ := app.W.AdeTask.Board(ctx)
		for _, tk := range b.Tasks {
			for _, r := range tk.Runs {
				if r.State == "running" {
					return false
				}
			}
		}
		return true
	})
	if !app.KeepAwake.Held() {
		t.Fatal("assertion released with the manual reason still on")
	}
	app.W.KeepAwake.SetManual(bridge.KeepAwakeSetManualArgs{Enabled: false})
	testx.WaitUntil(t, waitFor, func() bool { return !app.KeepAwake.Held() })
}
