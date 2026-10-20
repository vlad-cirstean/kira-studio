package memoryflow_test

import (
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/internal/flowtest/fakeagent"
)

// wantModel fails unless every claude call recorded after skip carries --model want, and at least one exists.
func wantModel(t *testing.T, app *flowharness.App, skip int, want string) int {
	t.Helper()
	calls := recordedArgs(t, app)
	if len(calls) <= skip {
		t.Fatalf("no claude call after the first %d", skip)
	}
	for i, argv := range calls[skip:] {
		if !strings.Contains(argv, "--model\n"+want+"\n") {
			t.Fatalf("call %d argv = %q, want --model %s", skip+i, argv, want)
		}
	}
	return len(calls)
}

// TestMemoryClaudeModel: memory.claudeModel picks the model of every memory claude call, in the
// app and in a running memory-mcp process, from the next call on.
// Contract memory-settings. UI half: settings-memory.spec.ts "memory model saves memory.claudeModel
// with the dialog".
func TestMemoryClaudeModel(t *testing.T) {
	app := flowharness.New(t)
	app.Scenario(fakeagent.Scenario{Prompts: []fakeagent.PromptRule{extractRule(t, 0.01), mergeRule(t, 0.02)}})
	text := "## Worker\n\nThe worker keeps port 8000 open and the queue never retries."

	settings, err := app.W.Settings.GetAll()
	if err != nil {
		t.Fatal(err)
	}
	if settings.Memory.ClaudeModel != "sonnet" {
		t.Fatalf("default model = %q, want sonnet", settings.Memory.ClaudeModel)
	}
	app.Contract(t, "memory-settings", "SettingsService.GetAll#memory", settings.Memory)

	if _, err := app.W.MemoryDistill.Distill(ctx, distillArgs("model-1", text)); err != nil {
		t.Fatal(err)
	}
	seen := wantModel(t, app, 0, "sonnet")

	opus := "opus"
	patch := model.SettingsPatch{Memory: &model.MemoryPatch{ClaudeModel: &opus}}
	app.Contract(t, "memory-settings", "SettingsService.Set#memory-model", patch)
	if _, err := app.W.Settings.Set(bridge.SettingsSetArgs{Patch: patch}); err != nil {
		t.Fatal(err)
	}
	if _, err := app.W.MemoryDistill.Distill(ctx, distillArgs("model-2", text)); err != nil {
		t.Fatal(err)
	}
	seen = wantModel(t, app, seen, "opus")

	// The memory-mcp process reads the leaf per call.
	sess := memorySession(t, app)
	callMCP(t, sess, "ingest_files", map[string]any{"distill": true, "text": text})
	wantModel(t, app, seen, "opus")

	bad := "gpt"
	if _, err := app.W.Settings.Set(bridge.SettingsSetArgs{Patch: model.SettingsPatch{Memory: &model.MemoryPatch{ClaudeModel: &bad}}}); err == nil {
		t.Fatal("an unknown model alias was accepted")
	}
}
