package memoryflow_test

import (
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/internal/llmprompts"
	"github.com/kirathecat/kira-studio/internal/memory/importer"
)

const (
	gateMarker   = "EDITED-GATE-MARKER"
	gateOverride = gateMarker + ` keeps at most {{.MaxKeywords}} keywords. {{template "memory.dataHygiene"}} {{template "memory.factStyle"}}`
	styleMarker  = "EDITED-STYLE-MARKER keep every word."
)

func overrideGate(t *testing.T, app *flowharness.App) {
	t.Helper()
	override(t, app, llmprompts.MemoryGateSystem.ID(), gateOverride)
}

func override(t *testing.T, app *flowharness.App, id llmprompts.ID, text string) {
	t.Helper()
	l, err := app.W.LlmPromptsSvc.List()
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range l.Prompts {
		if p.ID == id {
			if _, err := app.W.LlmPromptsSvc.Save(llmprompts.SaveArgs{Changes: []llmprompts.Change{{ID: p.ID, Text: text, BaseHash: p.Hash}}}); err != nil {
				t.Fatalf("Save: %v", err)
			}
			return
		}
	}
	t.Fatalf("%s not listed", id)
}

// An edited fact-style fragment reaches the gate system text the next store call sends.
func TestStoreUsesEditedFactStyle(t *testing.T) {
	app := flowharness.New(t)
	gate(t, app, "gate-accept.json")
	override(t, app, llmprompts.MemoryFactStyle.ID(), styleMarker)
	if _, err := app.W.Memory.Store(ctx, twoItemsArgs()); err != nil {
		t.Fatal(err)
	}
	args := recordedArgs(t, app)
	if len(args) == 0 || !strings.Contains(args[0], styleMarker) {
		t.Fatalf("gate call args = %q, want the edited fact style in the system prompt", args)
	}
}

// An edited gate prompt reaches the next in-app gate call.
func TestStoreUsesEditedGatePrompt(t *testing.T) {
	app := flowharness.New(t)
	gate(t, app, "gate-accept.json")
	overrideGate(t, app)
	if _, err := app.W.Memory.Store(ctx, twoItemsArgs()); err != nil {
		t.Fatal(err)
	}
	args := recordedArgs(t, app)
	if len(args) == 0 || !strings.Contains(args[0], gateMarker+" keeps at most 10 keywords.") {
		t.Fatalf("gate call args = %q, want the edited system prompt", args)
	}
}

// The same edit reaches the gate behind the memory-mcp subprocess the finalize agent stores through.
func TestImportGateUsesEditedPrompt(t *testing.T) {
	app := importAppGate(t, gateMarker)
	overrideGate(t, app)
	job := createJob(t, app, importDir(t))
	if err := app.W.MemoryImport.Start(bridge.MemoryImportStartArgs{ID: job.Job.ID}); err != nil {
		t.Fatal(err)
	}
	done := waitJob(t, app, job.Job.ID, importer.JobDone)
	if done.Job.Totals.Added != 4 || done.Job.Totals.FailedFiles != 0 {
		t.Fatalf("finished job = %+v, want four memories through the edited gate", done.Job)
	}
}
