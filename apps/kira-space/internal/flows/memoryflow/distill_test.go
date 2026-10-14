package memoryflow_test

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/internal/flowtest/fakeagent"
)

const distillSystem = "distill text into terse atomic lines"

// distillAnswer writes a canned distill result that reports cost USD.
func distillAnswer(t *testing.T, cost float64, lines ...string) string {
	t.Helper()
	out := []map[string]string{}
	for _, l := range lines {
		out = append(out, map[string]string{"text": l, "unresolved": ""})
	}
	raw, err := json.Marshal(map[string]any{"type": "result", "subtype": "success", "is_error": false,
		"total_cost_usd": cost, "structured_output": map[string]any{"lines": out}})
	if err != nil {
		t.Fatal(err)
	}
	p := filepath.Join(t.TempDir(), "distill.json")
	if err := os.WriteFile(p, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

// sections returns n Markdown sections of about size characters each; above the chunk minimum fill, so each becomes one chunk.
func sections(n, size int) string {
	var b strings.Builder
	for i := range n {
		fmt.Fprintf(&b, "## Section %d\n\n", i+1)
		for b.Len() < (i+1)*size {
			fmt.Fprintf(&b, "Paragraph of section %d says the worker keeps port %d open.\n\n", i+1, 8000+i)
		}
	}
	return b.String()
}

func distillFiles(t *testing.T, app *flowharness.App) []string {
	t.Helper()
	files, err := filepath.Glob(filepath.Join(app.FakeDir, "*.args"))
	if err != nil {
		t.Fatal(err)
	}
	return files
}

func TestMcpDistill(t *testing.T) {
	app := flowharness.New(t)
	app.Scenario(fakeagent.Scenario{Prompts: []fakeagent.PromptRule{
		{System: distillSystem, Emit: distillAnswer(t, 0.01, "Worker keeps port 8000 open.", "Queue never retries.")},
	}})
	cs := memoryMCP(t, app)
	mark := app.Events.Mark()

	res := callMCP(t, cs, "distill", map[string]any{"text": "## Worker\n\nThe worker keeps port 8000 open and the queue never retries."})
	if got := res.Content[0].(*mcp.TextContent).Text; got != "Worker keeps port 8000 open.\nQueue never retries." {
		t.Fatalf("text = %q", got)
	}
	if out := structuredAs[struct{ Lines []string }](t, res); len(out.Lines) != 2 || out.Lines[1] != "Queue never retries." {
		t.Fatalf("structured = %+v", out)
	}
	if n := len(distillFiles(t, app)); n != 1 {
		t.Fatalf("%d claude calls, want 1", n)
	}

	// A path of two chunks: lines come back in source order across both calls.
	path := filepath.Join(t.TempDir(), "notes.md")
	if err := os.WriteFile(path, []byte(sections(2, 6000)), 0o600); err != nil {
		t.Fatal(err)
	}
	res = callMCP(t, cs, "distill", map[string]any{"path": path})
	want := "Worker keeps port 8000 open.\nQueue never retries.\nWorker keeps port 8000 open.\nQueue never retries."
	if got := res.Content[0].(*mcp.TextContent).Text; got != want {
		t.Fatalf("two-chunk text = %q", got)
	}
	if n := len(distillFiles(t, app)); n != 3 {
		t.Fatalf("%d claude calls, want 3", n)
	}

	// Mode instructions reaches the prompt; facts mode does not carry it.
	callMCP(t, cs, "distill", map[string]any{"text": "Always run the tests.", "mode": "instructions"})
	var withMode, without int
	for _, f := range distillFiles(t, app) {
		raw, _ := os.ReadFile(f)
		if strings.Contains(string(raw), "The text is instructions.") {
			withMode++
		} else {
			without++
		}
	}
	if withMode != 1 || without != 3 {
		t.Fatalf("instructions prompts = %d, facts prompts = %d, want 1 and 3", withMode, without)
	}

	// Read-only: nothing stored, no change event.
	if recent, err := app.W.Memory.Recent(ctx); err != nil || len(recent) != 0 {
		t.Fatalf("Recent = %+v, %v, want nothing stored", recent, err)
	}
	if ev := app.Events.Since(mark, bridge.ChannelMemoryChanged); len(ev) != 0 {
		t.Fatalf("distill emitted %d memory changed events, want none", len(ev))
	}

	callsBefore := len(distillFiles(t, app))
	for name, args := range map[string]map[string]any{
		"neither":       {},
		"both":          {"text": "x", "path": path},
		"relative path": {"path": "notes.md"},
		"missing file":  {"path": filepath.Join(t.TempDir(), "nope.md")},
		"over limit":    {"text": strings.Repeat("a", 120_001)},
	} {
		if r, err := cs.CallTool(ctx, &mcp.CallToolParams{Name: "distill", Arguments: args}); err == nil && !r.IsError {
			t.Errorf("%s accepted", name)
		}
	}
	if n := len(distillFiles(t, app)); n != callsBefore {
		t.Errorf("rejected input still ran %d claude calls", n-callsBefore)
	}
}

func TestMcpDistillSpendCap(t *testing.T) {
	app := flowharness.New(t)
	app.Scenario(fakeagent.Scenario{Prompts: []fakeagent.PromptRule{{System: distillSystem, Emit: distillAnswer(t, 2.50, "Line.")}}})
	cs := memoryMCP(t, app)
	path := filepath.Join(t.TempDir(), "big.md")
	if err := os.WriteFile(path, []byte(sections(8, 6000)), 0o600); err != nil {
		t.Fatal(err)
	}
	r, err := cs.CallTool(ctx, &mcp.CallToolParams{Name: "distill", Arguments: map[string]any{"path": path}})
	if err != nil || !r.IsError || !strings.Contains(r.Content[0].(*mcp.TextContent).Text, "spend cap") {
		t.Fatalf("err=%v res=%+v, want a spend cap tool error", err, r)
	}
	if n := len(distillFiles(t, app)); n < 3 || n >= 8 {
		t.Fatalf("%d claude calls, want 3 to 7 (the cap stops new chunks)", n)
	}
}
