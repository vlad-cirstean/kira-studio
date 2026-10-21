package memoryflow_test

import (
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/internal/flowtest/fakeagent"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/internal/memory/importer"
	"github.com/kirathecat/kira-studio/packages/theme/src/i18n"
)

const (
	rewriteSystem = "clean one short text"

	rewriteIn   = "\t// Retry caps at 30 s (P900), because the upstream bans clients; see `retryQueue.maxDelaySeconds`."
	rewriteOut  = "\t// Retry caps at 30 s, because the upstream bans clients; see `retryQueue.maxDelaySeconds`."
	rewriteCost = 0.01
)

var tagDropped = []map[string]string{{"text": "(P900)", "why": "tag"}}

// rewriteRule answers every rewrite call with text and the dropped spans.
func rewriteRule(t *testing.T, text string, dropped []map[string]string) fakeagent.PromptRule {
	t.Helper()
	return rewriteRuleReason(t, text, dropped, "Dropped the phase tag.")
}

func rewriteRuleReason(t *testing.T, text string, dropped []map[string]string, reason string) fakeagent.PromptRule {
	t.Helper()
	if dropped == nil {
		dropped = []map[string]string{}
	}
	return fakeagent.PromptRule{System: rewriteSystem, Emit: costAnswer(t, rewriteCost, map[string]any{
		"text": text, "dropped": dropped, "reason": reason,
	})}
}

type rewriteOutput struct {
	Mode    string
	Rewrite importer.RewriteResult
	CostUSD float64
	Lines   []importer.Line
}

// rewriteVia runs ingest_files with distill and mode rewrite on a fresh app answering with rules.
func rewriteVia(t *testing.T, input string, rules ...fakeagent.PromptRule) (*flowharness.App, *mcp.CallToolResult, rewriteOutput) {
	t.Helper()
	app := flowharness.New(t)
	app.Scenario(fakeagent.Scenario{Prompts: rules})
	cs := memoryMCP(t, app)
	args := map[string]any{"distill": true, "mode": "rewrite", "text": input}
	res := callMCP(t, cs, "ingest_files", args)
	return app, res, structuredAs[rewriteOutput](t, res)
}

func TestMcpIngestDistillRewrite(t *testing.T) {
	app, res, out := rewriteVia(t, rewriteIn, rewriteRule(t, rewriteOut, tagDropped))
	want := rewriteOut + "\n\ndropped: (P900) | tag"
	if got := res.Content[0].(*mcp.TextContent).Text; got != want {
		t.Fatalf("text = %q, want %q", got, want)
	}
	if out.Mode != "rewrite" || !out.Rewrite.Changed || out.Rewrite.Text != rewriteOut || out.Rewrite.Gate != "" ||
		len(out.Rewrite.Dropped) != 1 || len(out.Lines) != 0 || out.CostUSD < 0.009 || out.CostUSD > 0.011 {
		t.Fatalf("structured = %+v", out)
	}
	if n := len(distillFiles(t, app)); n != 1 {
		t.Fatalf("%d claude calls, want one rewrite and no extract, verify or merge", n)
	}

	// A clean text still gets the one call; the model returns it verbatim.
	const clean = "Already clean."
	app, res, out = rewriteVia(t, rewriteOut, rewriteRuleReason(t, rewriteOut, nil, clean))
	if got := res.Content[0].(*mcp.TextContent).Text; !strings.HasSuffix(got, "\n\nunchanged") {
		t.Fatalf("text = %q, want it to end with unchanged", got)
	}
	if out.Rewrite.Changed || out.Rewrite.Gate != "" || out.Rewrite.Text != rewriteOut || len(out.Rewrite.Dropped) != 0 ||
		out.Rewrite.Reason != clean || out.CostUSD < 0.009 || out.CostUSD > 0.011 {
		t.Fatalf("clean = %+v", out)
	}
	if n := len(distillFiles(t, app)); n != 1 {
		t.Fatalf("%d claude calls, want 1", n)
	}
}

// Each gate rejects its draft and keeps the input.
func TestMcpIngestDistillRewriteGates(t *testing.T) {
	var wide []string
	for _, p := range []string{"Retry caps at 30 s (P900) because the upstream", "bans faster clients and sends 429 after", "ten requests per second in a window"} {
		wide = append(wide, "\t// "+p)
	}
	for _, tc := range []struct {
		name, gate, in, draft string
	}{
		{"indent", "indent", rewriteIn, strings.TrimPrefix(rewriteOut, "\t")},
		{"tokens", "tokens", rewriteIn, "\t// Retry caps at 30 s, because the upstream bans clients."},
		{"grew", "grew", rewriteIn, rewriteIn + " Extra words."},
		{"width", "width", strings.Join(wide, "\n"), "\t// " + strings.Join([]string{"Retry caps at 30 s because the upstream", "bans faster clients and sends 429 after", "ten requests per second in a window"}, " ")},
		{"form", "form", "/**\n * Retry caps at 30 s (P900), because the upstream bans faster clients.\n */",
			"/*\n * Retry caps at 30 s, because the upstream bans faster clients.\n */"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dropped := tagDropped
			if tc.gate == "tokens" {
				dropped = nil
			}
			app, res, out := rewriteVia(t, tc.in, rewriteRule(t, tc.draft, dropped))
			if r := out.Rewrite; r.Changed || r.Gate != tc.gate || r.Text != tc.in || r.Draft != tc.draft {
				t.Fatalf("rewrite = %+v, want gate %s with the input kept", r, tc.gate)
			}
			if got := res.Content[0].(*mcp.TextContent).Text; got != tc.in+"\n\nkept: "+tc.gate {
				t.Fatalf("text = %q", got)
			}
			if n := len(distillFiles(t, app)); n != 1 {
				t.Fatalf("%d claude calls, want 1", n)
			}
		})
	}

	t.Run("equal length passes grew", func(t *testing.T) {
		_, _, out := rewriteVia(t, "// Retry caps at 30 s because x, simply.", rewriteRule(t, "// Retry caps at 30 s because x, y.", nil))
		if !out.Rewrite.Changed || out.Rewrite.Gate != "" {
			t.Fatalf("rewrite = %+v, want accepted", out.Rewrite)
		}
	})
}

// Prose is accepted only as the input minus listed hedges: no reflow, no other word gone, no width rule.
func TestMcpIngestDistillRewriteProse(t *testing.T) {
	long := "The package is published on PyPI and it really only needs Python 3.9 or newer and has no compiled dependencies, so it works on Alpine images too."
	_, _, out := rewriteVia(t, long, rewriteRule(t, strings.Replace(long, "really ", "", 1), nil))
	if !out.Rewrite.Changed || out.Rewrite.Gate != "" {
		t.Fatalf("hedge removal = %+v, want accepted", out.Rewrite)
	}
	note := "Changed: the page size is now 50 (was 25), actually."
	_, _, out = rewriteVia(t, note, rewriteRule(t, "Changed: the page size is now 50.", nil))
	if out.Rewrite.Changed || out.Rewrite.Gate != "form" {
		t.Fatalf("dropped content = %+v, want gate form", out.Rewrite)
	}
}

func TestMcpIngestDistillRewriteOutput(t *testing.T) {
	unusable := fakeagent.PromptRule{System: rewriteSystem, Emit: costAnswer(t, rewriteCost, nil)}
	app, _, out := rewriteVia(t, rewriteIn, unusable)
	if r := out.Rewrite; r.Changed || r.Gate != "output" || r.Text != rewriteIn {
		t.Fatalf("rewrite = %+v, want gate output", r)
	}
	if n := callsWith(t, app, rewriteSystem); n != 2 {
		t.Fatalf("%d rewrite calls, want one retry", n)
	}
	if out.CostUSD < 0.019 || out.CostUSD > 0.021 {
		t.Fatalf("cost = %v, want both calls", out.CostUSD)
	}
}

func TestMcpIngestDistillRewriteRefusals(t *testing.T) {
	app := flowharness.New(t)
	app.Scenario(fakeagent.Scenario{Prompts: []fakeagent.PromptRule{rewriteRule(t, rewriteOut, nil)}})
	cs := memoryMCP(t, app)
	path := t.TempDir() + "/notes.md"
	for name, args := range map[string]map[string]any{
		"rewrite with paths":      {"distill": true, "mode": "rewrite", "paths": []string{path}},
		"context without rewrite": {"distill": true, "text": "x", "context": "code"},
		"unknown mode":            {"distill": true, "text": "x", "mode": "shrink"},
		"check is unknown":        {"distill": true, "mode": "rewrite", "text": "x", "check": true},
		"too long":                {"distill": true, "mode": "rewrite", "text": strings.Repeat("a", 2001)},
		"mode without distill":    {"mode": "rewrite", "text": "x"},
	} {
		if r, err := cs.CallTool(ctx, &mcp.CallToolParams{Name: "ingest_files", Arguments: args}); err == nil && !r.IsError {
			t.Errorf("%s accepted", name)
		}
	}
	if n := len(distillFiles(t, app)); n != 0 {
		t.Errorf("refused input still ran %d claude calls", n)
	}
}

func TestBridgeDistillRewrite(t *testing.T) {
	app := flowharness.New(t)
	app.Scenario(fakeagent.Scenario{Prompts: []fakeagent.PromptRule{rewriteRule(t, rewriteOut, tagDropped)}})
	mark := app.Events.Mark()

	res, err := app.W.MemoryDistill.Distill(ctx, bridge.MemoryDistillArgs{RequestID: "rw-1", Text: rewriteIn, Mode: "rewrite"})
	if err != nil {
		t.Fatal(err)
	}
	if res.Mode != "rewrite" || res.Rewrite == nil || !res.Rewrite.Changed || res.Rewrite.Text != rewriteOut ||
		res.Chunks != 0 || len(res.Lines) != 0 || len(res.Unresolved) != 0 {
		t.Fatalf("result = %+v", res)
	}
	if res.InChars != len([]rune(rewriteIn)) || res.OutChars != len([]rune(rewriteOut)) {
		t.Fatalf("sizes = %+v", res)
	}
	app.Contract(t, "memory-distill", "MemoryDistillService.Distill#rewrite", res)

	progress := app.Events.Since(mark, bridge.ChannelMemoryDistill)
	if len(progress) != 2 {
		t.Fatalf("%d progress events, want 2", len(progress))
	}
	for i, ev := range progress {
		p, ok := ev.Data.(bridge.MemoryDistillProgress)
		if !ok || p.RequestID != "rw-1" || p.Stage != "rewrite" || p.Done != i || p.Total != 1 {
			t.Fatalf("progress[%d] = %#v", i, ev.Data)
		}
	}

	// A clean text still gets one call and comes back unchanged.
	before := len(distillFiles(t, app))
	app.Scenario(fakeagent.Scenario{Prompts: []fakeagent.PromptRule{rewriteRuleReason(t, rewriteOut, nil, "Already clean.")}})
	res, err = app.W.MemoryDistill.Distill(ctx, bridge.MemoryDistillArgs{RequestID: "rw-2", Text: rewriteOut, Mode: "rewrite"})
	if err != nil {
		t.Fatal(err)
	}
	if r := res.Rewrite; r == nil || r.Changed || r.Gate != "" || r.Text != rewriteOut || res.CostUSD < 0.009 || res.CostUSD > 0.011 {
		t.Fatalf("unchanged = %+v", res)
	}
	if n := len(distillFiles(t, app)); n != before+1 {
		t.Fatalf("%d claude calls, want 1 more", n-before)
	}
	app.Contract(t, "memory-distill", "MemoryDistillService.Distill#rewriteUnchanged", res)

	// A longer draft is kept as the original.
	app.Scenario(fakeagent.Scenario{Prompts: []fakeagent.PromptRule{rewriteRule(t, rewriteIn+" Extra words.", nil)}})
	res, err = app.W.MemoryDistill.Distill(ctx, bridge.MemoryDistillArgs{RequestID: "rw-3", Text: rewriteIn, Mode: "rewrite"})
	if err != nil {
		t.Fatal(err)
	}
	if r := res.Rewrite; r == nil || r.Changed || r.Gate != "grew" || r.Text != rewriteIn {
		t.Fatalf("kept = %+v", res)
	}
	app.Contract(t, "memory-distill", "MemoryDistillService.Distill#rewriteKept", res)

	limits := app.W.MemoryDistill.Limits()
	if limits.RewriteMaxChars != 2000 {
		t.Fatalf("limits = %+v", limits)
	}
	app.Contract(t, "memory-distill", "MemoryDistillService.Limits", limits)

	calls := len(distillFiles(t, app))
	_, err = app.W.MemoryDistill.Distill(ctx, bridge.MemoryDistillArgs{RequestID: "rw-4", Text: strings.Repeat("a", 2001), Mode: "rewrite"})
	wantCode(t, err, ipcerr.CodeBadRequest, i18n.T("backend.space.memory.distill.tooLong.body", map[string]string{"count": "2001", "max": "2000"}))
	for name, args := range map[string]bridge.MemoryDistillArgs{
		"unknown mode":      {RequestID: "r", Text: "x", Mode: "shrink"},
		"rewrite with path": {RequestID: "r", Path: "/abs/notes.md", Mode: "rewrite"},
	} {
		if _, err := app.W.MemoryDistill.Distill(ctx, args); err == nil {
			t.Errorf("%s accepted", name)
		} else {
			wantCode(t, err, ipcerr.CodeContract, "")
		}
	}
	if n := len(distillFiles(t, app)); n != calls {
		t.Errorf("refused input still ran %d claude calls", n-calls)
	}
}
