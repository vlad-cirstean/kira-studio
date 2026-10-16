package memoryflow_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/internal/flowtest/fakeagent"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/internal/memory"
	"github.com/kirathecat/kira-studio/internal/memory/importer"
	"github.com/kirathecat/kira-studio/internal/testx"
	"github.com/kirathecat/kira-studio/packages/theme/src/i18n"
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

func distillArgs(id, text string) bridge.MemoryDistillArgs {
	return bridge.MemoryDistillArgs{RequestID: id, Text: text}
}

// wantCode fails unless err is an ipcerr.Error with the code and, when set, the exact message.
func wantCode(t *testing.T, err error, code ipcerr.Code, message string) {
	t.Helper()
	var ie *ipcerr.Error
	if !errors.As(err, &ie) || ie.Code != string(code) {
		t.Fatalf("err = %v, want code %s", err, code)
	}
	if message != "" && ie.Message != message {
		t.Fatalf("message = %q, want %q", ie.Message, message)
	}
}

func TestBridgeDistill(t *testing.T) {
	app := flowharness.New(t)
	app.Scenario(fakeagent.Scenario{Prompts: []fakeagent.PromptRule{
		{System: distillSystem, Emit: distillAnswer(t, 0.01, "Worker keeps port 8000 open.", "Queue never retries.")},
	}})
	mark := app.Events.Mark()

	text := "## Worker\n\nThe worker keeps port 8000 open and the queue never retries."
	res, err := app.W.MemoryDistill.Distill(ctx, distillArgs("req-1", text))
	if err != nil {
		t.Fatal(err)
	}
	joined := "Worker keeps port 8000 open.\nQueue never retries."
	if got := strings.Join(res.Lines, "\n"); got != joined || res.Chunks != 1 || res.CostUSD != 0.01 {
		t.Fatalf("result = %+v", res)
	}
	if res.InChars != utf8.RuneCountInString(text) || res.OutChars != utf8.RuneCountInString(joined) ||
		res.InTokens != importer.EstimateTokens(text) || res.OutTokens != importer.EstimateTokens(joined) {
		t.Fatalf("sizes = %+v", res)
	}
	app.Contract(t, "memory-distill", "MemoryDistillService.Distill#done", res)

	progress := app.Events.Since(mark, bridge.ChannelMemoryDistill)
	if len(progress) != 2 {
		t.Fatalf("%d progress events, want 2", len(progress))
	}
	for i, ev := range progress {
		p, ok := ev.Data.(bridge.MemoryDistillProgress)
		if !ok || p.RequestID != "req-1" || p.Done != i || p.Total != 1 {
			t.Fatalf("progress[%d] = %#v", i, ev.Data)
		}
	}
	app.Contract(t, "memory-distill", "kira:memory:distill#progress", progress[1].Data)

	// Read-only: nothing stored, no change event.
	if recent, err := app.W.Memory.Recent(ctx); err != nil || len(recent) != 0 {
		t.Fatalf("Recent = %+v, %v, want nothing stored", recent, err)
	}
	if ev := app.Events.Since(mark, bridge.ChannelMemoryChanged); len(ev) != 0 {
		t.Fatalf("distill emitted %d memory changed events, want none", len(ev))
	}

	// A picked file of two chunks: lines come back in source order.
	path := filepath.Join(t.TempDir(), "notes.md")
	if err := os.WriteFile(path, []byte(sections(2, 6000)), 0o600); err != nil {
		t.Fatal(err)
	}
	app.Dialogs.AnswerFile(path)
	choice, err := app.W.MemoryDistill.Choose()
	if err != nil || choice.Canceled || choice.Path != path {
		t.Fatalf("Choose = %+v, %v", choice, err)
	}
	if choice, err = app.W.MemoryDistill.Choose(); err != nil || !choice.Canceled || choice.Path != "" {
		t.Fatalf("cancelled Choose = %+v, %v", choice, err)
	}
	res, err = app.W.MemoryDistill.Distill(ctx, bridge.MemoryDistillArgs{RequestID: "req-2", Path: path})
	if err != nil {
		t.Fatal(err)
	}
	want := "Worker keeps port 8000 open.\nQueue never retries.\nWorker keeps port 8000 open.\nQueue never retries."
	if strings.Join(res.Lines, "\n") != want || res.Chunks != 2 {
		t.Fatalf("two-chunk result = %+v", res)
	}

	limits := app.W.MemoryDistill.Limits()
	if limits.MaxChars != 120_000 || limits.MaxParts != 16 || limits.SpendCapUSD != 2.0 || limits.StoreMaxLines != memory.MaxItems {
		t.Fatalf("limits = %+v", limits)
	}
	app.Contract(t, "memory-distill", "MemoryDistillService.Limits", limits)

	calls := len(distillFiles(t, app))
	_, err = app.W.MemoryDistill.Distill(ctx, distillArgs("req-3", strings.Repeat("a", 120_001)))
	wantCode(t, err, ipcerr.CodeBadRequest, i18n.T("backend.space.memory.distill.tooLong.body", map[string]string{"count": "120001", "max": "120000"}))
	for name, args := range map[string]bridge.MemoryDistillArgs{
		"neither":       {RequestID: "r"},
		"both":          {RequestID: "r", Text: "x", Path: path},
		"relative path": {RequestID: "r", Path: "notes.md"},
		"no request id": {Text: "x"},
		"long id":       {RequestID: strings.Repeat("r", 65), Text: "x"},
	} {
		if _, err := app.W.MemoryDistill.Distill(ctx, args); err == nil {
			t.Errorf("%s accepted", name)
		} else {
			wantCode(t, err, ipcerr.CodeContract, "")
		}
	}
	if n := len(distillFiles(t, app)); n != calls {
		t.Errorf("rejected input still ran %d claude calls", n-calls)
	}
}

func TestBridgeDistillCancel(t *testing.T) {
	app := flowharness.New(t)
	hold := filepath.Join(t.TempDir(), "release")
	app.Scenario(fakeagent.Scenario{Prompts: []fakeagent.PromptRule{
		{System: distillSystem, WaitFile: hold, Emit: distillAnswer(t, 0.01, "Line.")},
	}})
	path := filepath.Join(t.TempDir(), "big.md")
	if err := os.WriteFile(path, []byte(sections(8, 6000)), 0o600); err != nil {
		t.Fatal(err)
	}

	runCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		_, err := app.W.MemoryDistill.Distill(runCtx, bridge.MemoryDistillArgs{RequestID: "held", Path: path})
		done <- err
	}()
	testx.WaitUntil(t, waitFor, func() bool { return len(distillFiles(t, app)) > 0 })

	// One distill at a time, app-wide.
	_, err := app.W.MemoryDistill.Distill(ctx, distillArgs("second", "Always run the tests."))
	wantCode(t, err, ipcerr.CodeConflict, i18n.T("backend.space.memory.distill.busy.body", nil))

	cancel()
	select {
	case err := <-done:
		wantCode(t, err, ipcerr.CodeCancelled, i18n.T("backend.space.memory.distill.cancelled.body", nil))
	case <-time.After(waitFor):
		t.Fatal("cancel did not end the call")
	}
	// No part starts after the cancel.
	started := len(distillFiles(t, app))
	time.Sleep(300 * time.Millisecond)
	if n := len(distillFiles(t, app)); n != started {
		t.Fatalf("%d claude calls after cancel, want %d", n, started)
	}

	// The lock is free again.
	if err := os.WriteFile(hold, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := app.W.MemoryDistill.Distill(ctx, distillArgs("after", "Always run the tests.")); err != nil {
		t.Fatalf("call after cancel: %v", err)
	}
}

func TestBridgeDistillSpendCap(t *testing.T) {
	app := flowharness.New(t)
	app.Scenario(fakeagent.Scenario{Prompts: []fakeagent.PromptRule{{System: distillSystem, Emit: distillAnswer(t, 2.50, "Line.")}}})
	path := filepath.Join(t.TempDir(), "big.md")
	if err := os.WriteFile(path, []byte(sections(8, 6000)), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := app.W.MemoryDistill.Distill(ctx, bridge.MemoryDistillArgs{RequestID: "cap", Path: path})
	var ie *ipcerr.Error
	if !errors.As(err, &ie) || ie.Code != string(ipcerr.CodeBadRequest) ||
		!strings.Contains(ie.Message, "spend cap") || !strings.Contains(ie.Message, "$2.00 allowed") {
		t.Fatalf("err = %v, want the spend cap message", err)
	}
	if n := len(distillFiles(t, app)); n < 3 || n >= 8 {
		t.Fatalf("%d claude calls, want 3 to 7 (the cap stops new chunks)", n)
	}
}

func TestBridgeDistillToImport(t *testing.T) {
	app := flowharness.New(t)
	lines := []string{"Worker keeps port 8000 open.", "Queue never retries."}
	job, err := app.W.MemoryDistill.ToImport(bridge.MemoryDistillImportArgs{Lines: lines, Source: "notes.md:3-9"})
	if err != nil {
		t.Fatal(err)
	}
	files, err := filepath.Glob(filepath.Join(app.MemoryHome, "distilled", "distilled-*.md"))
	if err != nil || len(files) != 1 {
		t.Fatalf("distilled files = %v, %v", files, err)
	}
	raw, err := os.ReadFile(files[0])
	if err != nil {
		t.Fatal(err)
	}
	if want := "# Distilled from notes.md:3-9\n\n- Worker keeps port 8000 open.\n- Queue never retries.\n"; string(raw) != want {
		t.Fatalf("document = %q, want %q", raw, want)
	}
	if info, err := os.Stat(files[0]); err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("file mode = %v, %v", info, err)
	}
	if job.Channel != "ui" {
		t.Fatalf("job channel = %q, want ui", job.Channel)
	}
	detail := waitJob(t, app, job.ID, importer.JobAwaiting)
	if detail.Job.Estimate.Files != 1 {
		t.Fatalf("estimate = %+v, want 1 file", detail.Job.Estimate)
	}
	app.Contract(t, "memory-distill", "MemoryDistillService.ToImport#job", detail.Job, importMask)

	// Pasted text has no source.
	if _, err := app.W.MemoryDistill.ToImport(bridge.MemoryDistillImportArgs{Lines: lines}); err != nil {
		t.Fatal(err)
	}
	files, _ = filepath.Glob(filepath.Join(app.MemoryHome, "distilled", "distilled-*.md"))
	var untitled int
	for _, f := range files {
		if b, _ := os.ReadFile(f); strings.HasPrefix(string(b), "# Distilled text\n") {
			untitled++
		}
	}
	if untitled != 1 {
		t.Fatalf("%d documents with the text heading, want 1", untitled)
	}

	for name, in := range map[string][]string{"no lines": nil, "empty line": {"ok", " "}, "line break": {"a\nb"}, "too many": make([]string, 641)} {
		if _, err := app.W.MemoryDistill.ToImport(bridge.MemoryDistillImportArgs{Lines: in}); err == nil {
			t.Errorf("%s accepted", name)
		} else {
			wantCode(t, err, ipcerr.CodeContract, "")
		}
	}
}
