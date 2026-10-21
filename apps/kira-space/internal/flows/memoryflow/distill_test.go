package memoryflow_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
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

const mergeSystem = "merge the facts extracted from one input"

// costAnswer writes a canned result that reports cost USD.
func costAnswer(t *testing.T, cost float64, structured any) string {
	t.Helper()
	raw, err := json.Marshal(map[string]any{"type": "result", "subtype": "success", "is_error": false,
		"total_cost_usd": cost, "structured_output": structured})
	if err != nil {
		t.Fatal(err)
	}
	p := filepath.Join(t.TempDir(), "answer.json")
	if err := os.WriteFile(p, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

// evidence is a phrase every sections() part contains, so no extracted fact is questionable.
const evidence = "the worker keeps port"

// extractRule answers every extract call with the same two facts at cost USD.
func extractRule(t *testing.T, cost float64) fakeagent.PromptRule {
	t.Helper()
	return fakeagent.PromptRule{System: extractSystem, Emit: costAnswer(t, cost, map[string]any{"facts": []map[string]string{
		{"fact": "Worker keeps port 8000 open.", "evidence": evidence, "section": "", "unresolved": ""},
		{"fact": "Queue never retries.", "evidence": evidence, "section": "", "unresolved": ""},
	}})}
}

var mergedLines = []importer.Line{
	{Text: "Worker keeps port 8000 open.", Kind: memory.KindFact},
	{Text: "Never retry the queue, because duplicates corrupt totals.", Kind: memory.KindRule},
}

// mergeRule answers the merge call with mergedLines and one unresolved fact.
func mergeRule(t *testing.T, cost float64) fakeagent.PromptRule {
	t.Helper()
	return fakeagent.PromptRule{System: mergeSystem, Emit: costAnswer(t, cost, map[string]any{
		"lines":      mergedLines,
		"unresolved": []map[string]any{{"fact": "It restarts.", "questions": []string{"Which service restarts?"}}},
		"dropped":    []map[string]string{},
	})}
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

// callsWith counts the claude calls whose system prompt holds marker.
func callsWith(t *testing.T, app *flowharness.App, marker string) int {
	t.Helper()
	n := 0
	for _, f := range distillFiles(t, app) {
		if raw, _ := os.ReadFile(f); strings.Contains(string(raw), marker) {
			n++
		}
	}
	return n
}

// mergePrompt is the input of the latest merge call.
func mergePrompt(t *testing.T, app *flowharness.App) string {
	t.Helper()
	var latest string
	var at time.Time
	for _, f := range distillFiles(t, app) {
		raw, _ := os.ReadFile(f)
		info, err := os.Stat(f)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(raw), mergeSystem) && !info.ModTime().Before(at) {
			latest, at = f, info.ModTime()
		}
	}
	if latest == "" {
		t.Fatal("no merge call")
	}
	prompt, err := os.ReadFile(strings.TrimSuffix(latest, ".args") + ".prompt")
	if err != nil {
		t.Fatal(err)
	}
	return string(prompt)
}

func TestMcpIngestDistill(t *testing.T) {
	app := flowharness.New(t)
	app.Scenario(fakeagent.Scenario{Prompts: []fakeagent.PromptRule{extractRule(t, 0.01), mergeRule(t, 0.02)}})
	cs := memoryMCP(t, app)
	mark := app.Events.Mark()

	tools, err := cs.ListTools(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, tl := range tools.Tools {
		if tl.Name == "distill" {
			t.Fatal("the distill tool is gone: ingest_files distill true replaces it")
		}
		if tl.Name == "ingest_files" {
			var sch struct{ Required []string }
			raw, _ := json.Marshal(tl.InputSchema)
			if err := json.Unmarshal(raw, &sch); err != nil {
				t.Fatal(err)
			}
			for _, r := range []string{"paths", "origin", "scope"} {
				if slices.Contains(sch.Required, r) {
					t.Errorf("ingest_files schema requires %q, want none", r)
				}
			}
		}
	}

	res := callMCP(t, cs, "ingest_files", map[string]any{"distill": true,
		"text": "## Worker\n\nThe worker keeps port 8000 open and the queue never retries."})
	want := "Worker keeps port 8000 open.\nNever retry the queue, because duplicates corrupt totals.\n\nunresolved: It restarts. | Which service restarts?"
	if got := res.Content[0].(*mcp.TextContent).Text; got != want {
		t.Fatalf("text = %q, want %q", got, want)
	}
	out := structuredAs[struct {
		Lines      []importer.Line
		Unresolved []importer.UnresolvedFact
		CostUSD    float64
		JobID      string
	}](t, res)
	if !slices.Equal(out.Lines, mergedLines) || len(out.Unresolved) != 1 || out.Unresolved[0].Fact != "It restarts." ||
		out.CostUSD < 0.029 || out.CostUSD > 0.031 || out.JobID != "" {
		t.Fatalf("structured = %+v", out)
	}
	if n := len(distillFiles(t, app)); n != 2 {
		t.Fatalf("%d claude calls, want an extract and a merge", n)
	}

	// A file of two parts: both parts are extracted, then one merge sees every fact, duplicates included.
	path := filepath.Join(t.TempDir(), "notes.md")
	if err := os.WriteFile(path, []byte(sections(2, 6000)), 0o600); err != nil {
		t.Fatal(err)
	}
	callMCP(t, cs, "ingest_files", map[string]any{"distill": true, "paths": []string{path}})
	if got, want := callsWith(t, app, extractSystem), 3; got != want {
		t.Fatalf("%d extract calls, want %d", got, want)
	}
	if got := callsWith(t, app, mergeSystem); got != 2 {
		t.Fatalf("%d merge calls, want 2", got)
	}
	if p := mergePrompt(t, app); !strings.Contains(p, `"id":"1.1"`) || !strings.Contains(p, `"id":"2.2"`) || strings.Contains(p, "reason") {
		t.Fatalf("merge input = %s, want the facts of both parts and no reason", p)
	}

	// Nothing stored, no job, no change event.
	if recent, err := app.W.Memory.Recent(ctx); err != nil || len(recent) != 0 {
		t.Fatalf("Recent = %+v, %v, want nothing stored", recent, err)
	}
	if jobs, err := app.W.MemoryImport.Jobs(); err != nil || len(jobs) != 0 {
		t.Fatalf("Jobs = %+v, %v, want none", jobs, err)
	}
	if ev := app.Events.Since(mark, bridge.ChannelMemoryChanged); len(ev) != 0 {
		t.Fatalf("distill emitted %d memory changed events, want none", len(ev))
	}

	callsBefore := len(distillFiles(t, app))
	dir := t.TempDir()
	for name, args := range map[string]map[string]any{
		"neither":           {"distill": true},
		"text and path":     {"distill": true, "text": "x", "paths": []string{path}},
		"two paths":         {"distill": true, "paths": []string{path, path}},
		"folder":            {"distill": true, "paths": []string{dir}},
		"relative path":     {"distill": true, "paths": []string{"notes.md"}},
		"missing file":      {"distill": true, "paths": []string{filepath.Join(dir, "nope.md")}},
		"over limit":        {"distill": true, "text": strings.Repeat("a", 120_001)},
		"with origin":       {"distill": true, "text": "x", "origin": "user"},
		"with scope":        {"distill": true, "text": "x", "scope": "personal"},
		"with groups":       {"distill": true, "text": "x", "groups": []map[string]any{{"kind": "task", "key": "T-1"}}},
		"with writeDoc":     {"distill": true, "text": "x", "writeDoc": true},
		"text without flag": {"text": "x", "origin": "user", "scope": "personal"},
		"store no origin":   {"paths": []string{path}, "scope": "personal"},
	} {
		if r, err := cs.CallTool(ctx, &mcp.CallToolParams{Name: "ingest_files", Arguments: args}); err == nil && !r.IsError {
			t.Errorf("%s accepted", name)
		}
	}
	if n := len(distillFiles(t, app)); n != callsBefore {
		t.Errorf("rejected input still ran %d claude calls", n-callsBefore)
	}
}

// TestMcpIngestDistillCrossChecks: a doubtful fact goes through the cross-check and an unsupported
// one never reaches the merge.
func TestMcpIngestDistillCrossChecks(t *testing.T) {
	app := flowharness.New(t)
	app.Scenario(fakeagent.Scenario{Prompts: []fakeagent.PromptRule{
		{System: extractSystem, Emit: costAnswer(t, 0.01, map[string]any{"facts": []map[string]string{
			{"fact": "Worker keeps port 8000 open.", "evidence": evidence, "section": "", "unresolved": ""},
			{"fact": "Pagers rotate every Monday.", "evidence": "a quote the text never contains", "section": "", "unresolved": ""},
		}})},
		{System: verifySystem, Emit: costAnswer(t, 0.01, map[string]any{"verdicts": []map[string]string{
			{"id": "1.2", "verdict": "unsupported", "fact": "", "evidence": "", "why": "No pager rotation in the text."},
		}})},
		mergeRule(t, 0.02),
	}})
	cs := memoryMCP(t, app)
	callMCP(t, cs, "ingest_files", map[string]any{"distill": true, "text": "## Worker\n\nThe worker keeps port 8000 open."})
	if n := callsWith(t, app, verifySystem); n != 1 {
		t.Fatalf("%d cross-check calls, want 1", n)
	}
	if p := mergePrompt(t, app); !strings.Contains(p, `"id":"1.1"`) || strings.Contains(p, "Pagers rotate") {
		t.Fatalf("merge input = %s, want only the supported fact", p)
	}
}

func TestMcpIngestDistillSpendCap(t *testing.T) {
	app := flowharness.New(t)
	app.Scenario(fakeagent.Scenario{Prompts: []fakeagent.PromptRule{extractRule(t, 2.50), mergeRule(t, 0.02)}})
	cs := memoryMCP(t, app)
	path := filepath.Join(t.TempDir(), "big.md")
	if err := os.WriteFile(path, []byte(sections(8, 6000)), 0o600); err != nil {
		t.Fatal(err)
	}
	r, err := cs.CallTool(ctx, &mcp.CallToolParams{Name: "ingest_files", Arguments: map[string]any{"distill": true, "paths": []string{path}}})
	if err != nil || !r.IsError || !strings.Contains(r.Content[0].(*mcp.TextContent).Text, "spend cap") {
		t.Fatalf("err=%v res=%+v, want a spend cap tool error", err, r)
	}
	if n := len(distillFiles(t, app)); n < 3 || n >= 8 {
		t.Fatalf("%d claude calls, want 3 to 7 (the cap stops new parts)", n)
	}
	if callsWith(t, app, mergeSystem) != 0 {
		t.Fatal("the merge ran past the spend cap")
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
	app.Scenario(fakeagent.Scenario{Prompts: []fakeagent.PromptRule{extractRule(t, 0.01), mergeRule(t, 0.02)}})
	mark := app.Events.Mark()

	text := "## Worker\n\nThe worker keeps port 8000 open and the queue never retries."
	res, err := app.W.MemoryDistill.Distill(ctx, distillArgs("req-1", text))
	if err != nil {
		t.Fatal(err)
	}
	joined := mergedLines[0].Text + "\n" + mergedLines[1].Text
	if !slices.Equal(res.Lines, mergedLines) || res.Chunks != 1 || res.CostUSD < 0.029 || res.CostUSD > 0.031 ||
		len(res.Unresolved) != 1 || res.Unresolved[0].Questions[0] != "Which service restarts?" ||
		res.Mode != "facts" || res.Rewrite != nil {
		t.Fatalf("result = %+v", res)
	}
	if res.InChars != utf8.RuneCountInString(text) || res.OutChars != utf8.RuneCountInString(joined) ||
		res.InTokens != importer.EstimateTokens(text) || res.OutTokens != importer.EstimateTokens(joined) {
		t.Fatalf("sizes = %+v", res)
	}
	app.Contract(t, "memory-distill", "MemoryDistillService.Distill#done", res)

	progress := app.Events.Since(mark, bridge.ChannelMemoryDistill)
	steps := []struct {
		stage string
		done  int
	}{{"extract", 0}, {"extract", 1}, {"merge", 0}, {"merge", 1}}
	if len(progress) != len(steps) {
		t.Fatalf("%d progress events, want %d", len(progress), len(steps))
	}
	for i, ev := range progress {
		p, ok := ev.Data.(bridge.MemoryDistillProgress)
		if !ok || p.RequestID != "req-1" || p.Stage != steps[i].stage || p.Done != steps[i].done || p.Total != 1 {
			t.Fatalf("progress[%d] = %#v", i, ev.Data)
		}
	}
	app.Contract(t, "memory-distill", "kira:memory:distill#progress", progress[3].Data)

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
	if !slices.Equal(res.Lines, mergedLines) || res.Chunks != 2 {
		t.Fatalf("two-chunk result = %+v", res)
	}
	if p := mergePrompt(t, app); !strings.Contains(p, `"id":"1.1"`) || !strings.Contains(p, `"id":"2.2"`) {
		t.Fatalf("merge input = %s, want the facts of both parts", p)
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
	held := extractRule(t, 0.01)
	held.WaitFile = hold
	app.Scenario(fakeagent.Scenario{Prompts: []fakeagent.PromptRule{held, mergeRule(t, 0.02)}})
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
	if _, err := app.W.MemoryDistill.Distill(ctx, distillArgs("after", "The worker keeps port 8000 open.")); err != nil {
		t.Fatalf("call after cancel: %v", err)
	}
}

func TestBridgeDistillSpendCap(t *testing.T) {
	app := flowharness.New(t)
	app.Scenario(fakeagent.Scenario{Prompts: []fakeagent.PromptRule{extractRule(t, 2.50), mergeRule(t, 0.02)}})
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
	if callsWith(t, app, mergeSystem) != 0 {
		t.Fatal("the merge ran past the spend cap")
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
