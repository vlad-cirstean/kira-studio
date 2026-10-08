package mcpserver

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/kirathecat/kira-studio/internal/memory"
	"github.com/kirathecat/kira-studio/internal/testx"
)

func TestMain(m *testing.M) { os.Exit(testx.RunWithTempHomes(m)) }

type acceptRunner struct{}

func (acceptRunner) Run(_ context.Context, c memory.Call) (json.RawMessage, error) {
	var rec struct{ Facts []struct{ Index int } }
	if json.Unmarshal([]byte(c.Input), &rec) == nil && len(rec.Facts) > 0 {
		ds := []map[string]any{}
		for _, f := range rec.Facts {
			ds = append(ds, map[string]any{"index": f.Index, "action": "add", "target": "", "fact": "", "reason": "", "why": "new"})
		}
		return json.Marshal(map[string]any{"decisions": ds})
	}
	var in struct {
		Items []struct {
			Index        int
			Fact, Reason string
		}
	}
	if err := json.Unmarshal([]byte(c.Input), &in); err != nil || len(in.Items) == 0 {
		return nil, memory.ErrClaudeOutput
	}
	items := []map[string]any{}
	for _, it := range in.Items {
		items = append(items, map[string]any{"index": it.Index, "verdict": "accept", "questions": []string{},
			"facts": []map[string]any{{"fact": it.Fact, "reason": it.Reason, "keywords": []string{"kw"}}}})
	}
	return json.Marshal(map[string]any{"items": items})
}

func TestStoreSearchHistoryOverMCP(t *testing.T) {
	store := memory.NewStore(filepath.Join(t.TempDir(), "memory.db"))
	defer store.Close()
	svc := memory.NewService(store, acceptRunner{}, memory.ServiceOptions{})
	ctx := context.Background()
	connect := func(opts Options) *mcp.ClientSession {
		t.Helper()
		ct, st := mcp.NewInMemoryTransports()
		if _, err := Build(svc, opts).Connect(ctx, st, nil); err != nil {
			t.Fatal(err)
		}
		cs, err := mcp.NewClient(&mcp.Implementation{Name: "t", Version: "1"}, nil).Connect(ctx, ct, nil)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = cs.Close() })
		return cs
	}
	cs := connect(Options{})
	callOn := func(cs *mcp.ClientSession, name string, args map[string]any, out any) {
		t.Helper()
		res, err := cs.CallTool(ctx, &mcp.CallToolParams{Name: name, Arguments: args})
		if err != nil || res.IsError {
			t.Fatalf("%s: err=%v res=%+v %v", name, err, res, res.Content[0])
		}
		b, _ := json.Marshal(res.StructuredContent)
		if err := json.Unmarshal(b, out); err != nil {
			t.Fatal(err)
		}
	}
	call := func(name string, args map[string]any, out any) { t.Helper(); callOn(cs, name, args, out) }

	var stored memory.StoreResult
	call("store_memory", map[string]any{"author": "agent", "items": []map[string]any{{"fact": "the cache is redis", "reason": "ops runbook"}}}, &stored)
	if stored.Status != "stored" || len(stored.Outcomes) != 1 || stored.Outcomes[0].Action != "add" {
		t.Fatalf("stored = %+v", stored)
	}
	var found struct{ Memories []memory.Memory }
	call("search_memories", map[string]any{"query": "cach"}, &found)
	if len(found.Memories) != 1 || found.Memories[0].Historical || found.Memories[0].Author != "agent" {
		t.Fatalf("found = %+v", found)
	}
	var hist memory.History
	call("memory_history", map[string]any{"id": found.Memories[0].ID}, &hist)
	if len(hist.Memories) != 1 || len(hist.Events) != 1 {
		t.Fatalf("history = %+v", hist)
	}

	// Import mode forces attribution: the agent cannot claim to be the user.
	var imported memory.StoreResult
	callOn(connect(Options{ImportRef: "file-1"}), "store_memory",
		map[string]any{"author": "user", "items": []map[string]any{{"fact": "the queue is nats", "reason": "Stated in docs/ops.md"}}}, &imported)
	if len(imported.Outcomes) != 1 {
		t.Fatalf("imported = %+v", imported)
	}
	var ih memory.History
	call("memory_history", map[string]any{"id": imported.Outcomes[0].ID}, &ih)
	if ev := ih.Events[0]; ev.Source != memory.SourceImport || ev.Author != memory.AuthorAgent || ev.SourceRef == nil || *ev.SourceRef != "file-1" {
		t.Fatalf("import event = %+v", ev)
	}

	prompts, err := cs.ListPrompts(ctx, nil)
	if err != nil || len(prompts.Prompts) != 1 || prompts.Prompts[0].Name != "remember" {
		t.Fatalf("prompts = %+v err=%v", prompts, err)
	}
	got, err := cs.GetPrompt(ctx, &mcp.GetPromptParams{Name: "remember", Arguments: map[string]string{"text": "we use tabs"}})
	if err != nil || !strings.Contains(got.Messages[0].Content.(*mcp.TextContent).Text, "we use tabs") {
		t.Fatalf("prompt = %+v err=%v", got, err)
	}
}
