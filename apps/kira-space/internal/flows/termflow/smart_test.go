package termflow_test

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/internal/claudeheadless"
	"github.com/kirathecat/kira-studio/internal/flowtest/fakeagent"
	"github.com/kirathecat/kira-studio/internal/scriptruns"
	"github.com/kirathecat/kira-studio/internal/scripts"
	"github.com/kirathecat/kira-studio/internal/testx"
)

func TestSmartScriptSpace(t *testing.T) {
	app := flowharness.New(t)
	app.Scenario(fakeagent.Scenario{Claude: map[string][]fakeagent.Action{"*": {{
		Name: "done", MCP: []fakeagent.MCPCall{{Server: "fake", Tool: "echo", Args: map[string]any{"text": "hi"}}},
	}}}})
	if err := os.WriteFile(filepath.Join(app.Home, ".claude.json"),
		[]byte(fmt.Sprintf(`{"mcpServers":{"fake":{"command":%q}}}`, filepath.Join(app.BinDir, "fake-mcp"))), 0o644); err != nil {
		t.Fatal(err)
	}

	servers, err := app.W.ScriptRuns.McpServers()
	if err != nil || len(servers) != 1 || servers[0].Name != "fake" {
		t.Fatalf("McpServers = %+v, %v", servers, err)
	}
	tools, err := app.W.ScriptRuns.McpTools(scriptruns.McpToolsArgs{Server: "fake"})
	if err != nil || len(tools) != 2 {
		t.Fatalf("McpTools = %+v, %v", tools, err)
	}

	rec, err := app.W.CustomScripts.Create(bridge.CustomScriptsCreateArgs{Fields: scripts.CustomScriptFields{
		Name: "ask", Kind: scripts.KindSmart, Command: "Say hi about {topic}", Color: "blue",
		Params: []scripts.Param{{Name: "topic", Type: scripts.ParamText}},
		Smart:  &scripts.Smart{MCP: []scripts.MCPChoice{{Server: "fake", Tools: []string{"echo"}}}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	args := scriptruns.RunArgs{ScriptID: rec.ID, Params: map[string][]string{"topic": {"cats"}}}
	pv, err := app.W.ScriptRuns.Preview(args)
	if err != nil {
		t.Fatal(err)
	}
	// Contract smart: tests/ui/automations-smart.spec.ts "contract: a smart script ..." reads the same fixture.
	app.Contract(t, "smart", "CustomScriptsService.Create", rec)
	app.Contract(t, "smart", "ScriptRunsService.Preview", pv, flowharness.Mask("hash"))
	app.Contract(t, "smart", "args:ScriptRunsService.Start", scriptruns.StartArgs{RunArgs: args, Hash: pv.Hash}, flowharness.Mask("hash"))
	if got := strings.Join(pv.Allowed, " "); strings.Contains(got, "mcp__kira-space") || !strings.Contains(got, "mcp__fake__echo") {
		t.Fatalf("allowed = %q, want the fake tool and no Space tools without a task", got)
	}
	started, err := app.W.ScriptRuns.Start(scriptruns.StartArgs{RunArgs: args, Hash: pv.Hash})
	if err != nil {
		t.Fatal(err)
	}
	var run scriptruns.Run
	testx.WaitUntil(t, waitFor, func() bool {
		run, _ = app.W.ScriptRuns.Get(scriptruns.IDArgs{ID: started.RunID})
		return run.State == "done"
	})
	app.Contract(t, "smart", "ScriptRunsService.Get#done", run, flowharness.Mask("createdAt", "startedAt", "finishedAt", "hash", "costUsd"))
	if o := run.Outcome; o == nil || !o.Reported || o.Source != "agent" {
		t.Fatalf("outcome = %+v", o)
	}
	if want := scripts.PlainText(pv.Prompt) + "\n\n" + claudeheadless.ScriptReportSuffix; run.Prompt != want {
		t.Fatalf("prompt = %q, want %q", run.Prompt, want)
	}
	page, err := app.W.ScriptRuns.ReadLog(scriptruns.ReadLogArgs{ID: started.RunID})
	if err != nil {
		t.Fatal(err)
	}
	app.Contract(t, "smart", "ScriptRunsService.ReadLog", page)
	if raw, _ := json.Marshal(page); len(page.Chunks) == 0 {
		t.Fatalf("ReadLog empty: %s", raw)
	}
}
