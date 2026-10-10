package memoryflow_test

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/internal/flowtest/fakeagent"
	"github.com/kirathecat/kira-studio/internal/mcpinstall"
	"github.com/kirathecat/kira-studio/internal/memory"
)

var ctx = context.Background()

const waitFor = 20 * time.Second

func gate(t *testing.T, app *flowharness.App, file string, actions ...fakeagent.Action) {
	t.Helper()
	abs, err := filepath.Abs(filepath.Join("testdata", file))
	if err != nil {
		t.Fatal(err)
	}
	if len(actions) == 0 {
		actions = []fakeagent.Action{{Emit: abs}}
	}
	app.Scenario(fakeagent.Scenario{Claude: map[string][]fakeagent.Action{"*": actions}})
}

var twoItems = []memory.Item{
	{Fact: "billing runs postgres", Reason: "migration notes"},
	{Fact: "staging deploys at 09:00", Reason: "release calendar"},
}

func TestStoreThroughGate(t *testing.T) {
	app := flowharness.New(t)
	gate(t, app, "gate-accept.json")
	mark := app.Events.Mark()
	res, err := app.W.Memory.Store(ctx, bridge.MemoryStoreArgs{Items: twoItems})
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != "stored" || len(res.Outcomes) != 2 || res.Outcomes[0].Action != "add" || res.Outcomes[1].Action != "add" {
		t.Fatalf("Store = %+v, want two adds", res)
	}
	app.Contract(t, "memory", "args:MemoryService.Store#free-text", bridge.MemoryStoreArgs{Items: twoItems})
	app.Contract(t, "memory", "MemoryService.Store#stored", res)
	app.Events.WaitAfter(t, mark, bridge.ChannelMemoryChanged, nil, waitFor)

	recent, err := app.W.Memory.Recent(ctx)
	if err != nil || len(recent) != 2 {
		t.Fatalf("Recent = %d memories, %v, want 2", len(recent), err)
	}
	app.Contract(t, "memory", "MemoryService.Recent#gated", recent, flowharness.Mask("createdAt"))
	for _, m := range recent {
		if m.Author != memory.AuthorUser || m.Version != 1 || len(m.Keywords) < 3 {
			t.Fatalf("stored memory = %+v, want a user-authored v1 with the gate's keywords", m)
		}
	}
	hits, err := app.W.Memory.Search(ctx, bridge.MemorySearchArgs{Query: "postgresql"})
	if err != nil || len(hits) != 1 || hits[0].Fact != "The billing service uses PostgreSQL 16." {
		t.Fatalf("Search postgresql = %+v, %v, want the billing fact via its gate keyword", hits, err)
	}
	app.Contract(t, "memory", "MemoryService.Search#postgresql", hits, flowharness.Mask("createdAt"))
	hist, err := app.W.Memory.History(ctx, bridge.MemoryIDArgs{ID: hits[0].ID})
	if err != nil || len(hist.Memories) != 1 || len(hist.Events) != 1 {
		t.Fatalf("History = %+v, %v, want one version and its store event", hist, err)
	}
	if ev := hist.Events[0]; ev.Action != "add" || ev.Source != memory.SourceUI || ev.Author != memory.AuthorUser || ev.MemoryID != hits[0].ID {
		t.Fatalf("store event = %+v", ev)
	}
}

func TestGateRejectsOrFails(t *testing.T) {
	app := flowharness.New(t)
	empty := func(why string) {
		t.Helper()
		if recent, err := app.W.Memory.Recent(ctx); err != nil || len(recent) != 0 {
			t.Fatalf("after %s the store holds %+v, %v, want nothing", why, recent, err)
		}
	}

	gate(t, app, "gate-reject.json")
	res, err := app.W.Memory.Store(ctx, bridge.MemoryStoreArgs{Items: twoItems})
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != "challenged" || len(res.Challenges) != 2 || len(res.Challenges[0].Questions) != 1 || len(res.Outcomes) != 0 {
		t.Fatalf("rejecting gate result = %+v, want two challenges with questions and no outcome", res)
	}
	app.Contract(t, "memory", "MemoryService.Store#challenged", res)
	empty("a challenge")

	gate(t, app, "gate-malformed.json")
	if _, err := app.W.Memory.Store(ctx, bridge.MemoryStoreArgs{Items: twoItems}); err == nil ||
		!strings.Contains(err.Error(), memory.ErrClaudeOutput.Error()) {
		t.Fatalf("malformed gate output error = %v, want %q", err, memory.ErrClaudeOutput)
	}
	empty("malformed gate output")

	gate(t, app, "", fakeagent.Action{Name: "fail"})
	if _, err := app.W.Memory.Store(ctx, bridge.MemoryStoreArgs{Items: twoItems}); err == nil || !strings.Contains(err.Error(), "Claude Code failed") {
		t.Fatalf("failing claude error = %v, want a Claude Code failure", err)
	}
	empty("a failing claude")

	gate(t, app, "gate-accept.json")
	if res, err := app.W.Memory.Store(ctx, bridge.MemoryStoreArgs{Items: twoItems}); err != nil || res.Status != "stored" {
		t.Fatalf("Store after the failures = %+v, %v, want stored", res, err)
	}
}

func TestSemanticNotInstalled(t *testing.T) {
	t.Setenv("KIRA_ORT_LIB", "")
	app := flowharness.New(t)
	gate(t, app, "gate-accept.json")
	if _, err := app.W.Memory.Store(ctx, bridge.MemoryStoreArgs{Items: twoItems}); err != nil {
		t.Fatal(err)
	}
	st, err := app.W.Memory.SemanticStatus(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if st.State != memory.SemanticNotInstalled {
		t.Fatalf("semantic status = %+v, want notInstalled: no model on disk, no ONNX runtime", st)
	}
	app.Contract(t, "memory-settings", "MemoryService.SemanticStatus#not-installed", st)
	hits, err := app.W.Memory.Search(ctx, bridge.MemorySearchArgs{Query: "staging"})
	if err != nil || len(hits) != 1 || hits[0].Match == "semantic" {
		t.Fatalf("keyword search = %+v, %v, want the staging fact by keyword", hits, err)
	}
	app.W.Memory.RetrySemantic()
	after, err := app.W.Memory.SemanticStatus(ctx)
	if err != nil || after.State != st.State {
		t.Fatalf("status after RetrySemantic = %+v, %v, want %q again", after, err, st.State)
	}
	if again, err := app.W.Memory.Search(ctx, bridge.MemorySearchArgs{Query: "staging"}); err != nil || len(again) != 1 {
		t.Fatalf("search after retry = %+v, %v", again, err)
	}
}

func TestConnectClaudeCode(t *testing.T) {
	app := flowharness.New(t)
	gate(t, app, "", fakeagent.Action{})
	before := app.W.Memory.McpStatus()
	exe := flowharness.Replace(before.Executable, "<bin>/kira-space")
	app.Contract(t, "memory-settings", "MemoryService.McpStatus", before, exe)
	if !before.ClaudeAvailable || !filepath.IsAbs(before.Executable) || !strings.Contains(before.Command, "memory-mcp") {
		t.Fatalf("McpStatus = %+v, want claude found and an absolute executable", before)
	}
	res := app.W.Memory.InstallClaudeCode(ctx)
	if res.Outcome != mcpinstall.OutcomeInstalled {
		t.Fatalf("InstallClaudeCode = %+v, want installed", res)
	}
	app.Contract(t, "memory-settings", "MemoryService.InstallClaudeCode", res, exe)
	argv := recordedArgs(t, app)
	if len(argv) != 2 {
		t.Fatalf("claude ran %d times, want the remove and add-json pair: %q", len(argv), argv)
	}
	if want := "mcp\nremove\n--scope\nuser\nkira-memory"; argv[0] != want {
		t.Fatalf("first call = %q, want %q", argv[0], want)
	}
	add := strings.Split(argv[1], "\n")
	if len(add) != 6 || strings.Join(add[:5], " ") != "mcp add-json --scope user kira-memory" {
		t.Fatalf("second call = %q, want add-json for kira-memory", argv[1])
	}
	var server struct {
		Type    string   `json:"type"`
		Command string   `json:"command"`
		Args    []string `json:"args"`
	}
	if err := json.Unmarshal([]byte(add[5]), &server); err != nil {
		t.Fatal(err)
	}
	if server.Type != "stdio" || server.Command != before.Executable || !filepath.IsAbs(server.Command) || !slices.Equal(server.Args, []string{"memory-mcp"}) {
		t.Fatalf("registered server = %+v, want stdio %s memory-mcp", server, before.Executable)
	}
	if after := app.W.Memory.McpStatus(); after.Command != before.Command {
		t.Fatalf("status after = %+v, want the same command as before", after)
	}
}

// recordedArgs returns the fake claude's argv files in call order.
func recordedArgs(t *testing.T, app *flowharness.App) []string {
	t.Helper()
	files, err := filepath.Glob(filepath.Join(app.FakeDir, "*.args"))
	if err != nil {
		t.Fatal(err)
	}
	sort.Slice(files, func(i, j int) bool { return callNumber(files[i]) < callNumber(files[j]) })
	var out []string
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, string(raw))
	}
	return out
}

func callNumber(path string) int {
	base := strings.TrimSuffix(filepath.Base(path), ".args")
	n, _ := strconv.Atoi(base[strings.LastIndex(base, "-")+1:])
	return n
}
