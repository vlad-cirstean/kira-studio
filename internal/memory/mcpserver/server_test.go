package mcpserver

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/kirathecat/kira-studio/internal/memory"
	"github.com/kirathecat/kira-studio/internal/memory/importer"
	"github.com/kirathecat/kira-studio/internal/memory/memfmt"
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
	call("store_memory", map[string]any{"items": []map[string]any{{"fact": "the cache is redis", "reason": "ops runbook", "origin": "agent", "scope": "personal"}}}, &stored)
	if stored.Status != "stored" || len(stored.Outcomes) != 1 || stored.Outcomes[0].Action != "add" {
		t.Fatalf("stored = %+v", stored)
	}
	var found struct{ Memories []memory.Memory }
	call("search_memories", map[string]any{"query": "cach"}, &found)
	if len(found.Memories) != 1 || found.Memories[0].Historical || found.Memories[0].Origin != "agent" {
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
		map[string]any{"items": []map[string]any{{"fact": "the queue is nats", "reason": "Stated in docs/ops.md", "origin": "user", "scope": "company"}}}, &imported)
	if len(imported.Outcomes) != 1 {
		t.Fatalf("imported = %+v", imported)
	}
	var ih memory.History
	call("memory_history", map[string]any{"id": imported.Outcomes[0].ID}, &ih)
	if ev := ih.Events[0]; ev.Source != memory.SourceImport || ev.Origin != memory.OriginExternal || ev.SourceRef == nil || *ev.SourceRef != "file-1" {
		t.Fatalf("import event = %+v", ev)
	}

	if ih.Memories[0].Scope != memory.ScopePersonal || ih.Memories[0].SessionID != nil {
		t.Fatalf("import mode keeps caller scope or session: %+v", ih.Memories[0])
	}

	// Session and project default from the server; memory_context reads the session group.
	var scoped memory.StoreResult
	sess := connect(Options{SessionID: "sess-1", Project: "github.com/acme/billing"})
	callOn(sess, "store_memory", map[string]any{"items": []map[string]any{
		{"fact": "billing retries twice", "reason": "runbook", "origin": "external", "sourceTag": "Slack", "scope": "project"},
		{"fact": "billing owns invoices", "reason": "org chart", "origin": "user", "scope": "project"},
	}}, &scoped)
	if len(scoped.Outcomes) != 2 {
		t.Fatalf("scoped = %+v", scoped)
	}
	var cx memory.Context
	callOn(sess, "memory_context", map[string]any{"id": scoped.Outcomes[0].LineageID}, &cx)
	m := cx.Memory
	if m.Origin != memory.OriginExternal || m.SourceTag == nil || *m.SourceTag != "slack" || m.Project == nil ||
		*m.Project != "github.com/acme/billing" || m.SessionID == nil || *m.SessionID != "sess-1" {
		t.Fatalf("memory = %+v", m)
	}
	kinds := map[string]memory.GroupContext{}
	for _, g := range cx.Groups {
		kinds[g.Kind] = g
	}
	if g := kinds[memory.GroupSession]; g.Key != "sess-1" || len(g.Facts) != 1 || g.Facts[0].LineageID != scoped.Outcomes[1].LineageID {
		t.Fatalf("session group = %+v", g)
	}
	if res, err := sess.CallTool(ctx, &mcp.CallToolParams{Name: "store_memory", Arguments: map[string]any{"items": []map[string]any{
		{"fact": "x", "reason": "y", "origin": "bogus", "scope": "project"}}}}); err == nil && !res.IsError {
		t.Fatal("origin outside the enum accepted")
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

func TestAsCommentPersistsNothingAndTextIsGrepFirst(t *testing.T) {
	store := memory.NewStore(filepath.Join(t.TempDir(), "memory.db"))
	defer store.Close()
	svc := memory.NewService(store, acceptRunner{}, memory.ServiceOptions{})
	ctx := context.Background()
	ct, st := mcp.NewInMemoryTransports()
	if _, err := Build(svc, Options{}).Connect(ctx, st, nil); err != nil {
		t.Fatal(err)
	}
	cs, err := mcp.NewClient(&mcp.Implementation{Name: "t", Version: "1"}, nil).Connect(ctx, ct, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer cs.Close()
	item := map[string]any{"fact": "the cache is redis", "reason": "ops runbook", "origin": "agent", "scope": "personal"}

	res, err := cs.CallTool(ctx, &mcp.CallToolParams{Name: "store_memory", Arguments: map[string]any{"items": []map[string]any{item}, "asComment": "internal/billing/api.go"}})
	if err != nil || res.IsError {
		t.Fatalf("err=%v res=%+v", err, res)
	}
	var out storeOutput
	b, _ := json.Marshal(res.StructuredContent)
	_ = json.Unmarshal(b, &out)
	blocks, ps := memfmt.ParseComments("x.go", []byte(out.Comment))
	if out.Status != "prepared" || len(ps) != 0 || len(blocks) != 1 || len(blocks[0].Facts) != 1 {
		t.Fatalf("out=%+v problems=%v", out, ps)
	}
	if text := res.Content[0].(*mcp.TextContent).Text; !strings.HasSuffix(text, "\n\n"+out.Comment) || !strings.HasPrefix(text, "Nothing was stored.") {
		t.Errorf("text = %q", text)
	}
	if rows, _ := svc.Recent(ctx, 10); len(rows) != 0 {
		t.Fatalf("asComment stored %d rows", len(rows))
	}

	for name, args := range map[string]map[string]any{
		"doc file":    {"items": []map[string]any{item}, "asComment": "notes.md"},
		"unsupported": {"items": []map[string]any{item}, "asComment": "data.bin"},
		"groups":      {"items": []map[string]any{item}, "asComment": "go", "groups": []map[string]any{{"kind": "task", "key": "X-1"}}},
	} {
		if r, err := cs.CallTool(ctx, &mcp.CallToolParams{Name: "store_memory", Arguments: args}); err == nil && !r.IsError {
			t.Errorf("%s accepted", name)
		}
	}

	if _, err := cs.CallTool(ctx, &mcp.CallToolParams{Name: "store_memory", Arguments: map[string]any{"items": []map[string]any{item}}}); err != nil {
		t.Fatal(err)
	}
	res, err = cs.CallTool(ctx, &mcp.CallToolParams{Name: "search_memories", Arguments: map[string]any{"query": "cache"}})
	if err != nil {
		t.Fatal(err)
	}
	var lines []string
	for _, l := range strings.Split(res.Content[0].(*mcp.TextContent).Text, "\n") {
		if l != "" {
			lines = append(lines, l)
		}
	}
	if len(lines) != 3 || !regexp.MustCompile(`^`+memfmt.FactID+` \S`).MatchString(lines[0]) || !regexp.MustCompile(`^  \S`).MatchString(lines[1]) ||
		!regexp.MustCompile(`^  v\d+ origin=`).MatchString(lines[2]) {
		t.Errorf("want '<id> <fact>', an indented reason and an indented meta line, got %q", lines)
	}
}

func TestSearchFiltersProjectDefaultAndScoreMeta(t *testing.T) {
	store := memory.NewStore(filepath.Join(t.TempDir(), "memory.db"))
	defer store.Close()
	svc := memory.NewService(store, acceptRunner{}, memory.ServiceOptions{})
	ctx := context.Background()
	const proj = "github.com/acme/billing"
	ct, st := mcp.NewInMemoryTransports()
	if _, err := Build(svc, Options{Project: proj}).Connect(ctx, st, nil); err != nil {
		t.Fatal(err)
	}
	cs, err := mcp.NewClient(&mcp.Implementation{Name: "t", Version: "1"}, nil).Connect(ctx, ct, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer cs.Close()
	if _, err := cs.CallTool(ctx, &mcp.CallToolParams{Name: "store_memory", Arguments: map[string]any{"items": []map[string]any{
		{"fact": "invoices go out monthly", "reason": "finance", "origin": "user", "scope": "project"},
		{"fact": "invoices need a vat number", "reason": "law", "origin": "agent", "scope": "company"},
	}}}); err != nil {
		t.Fatal(err)
	}
	search := func(args map[string]any) (string, error) {
		res, err := cs.CallTool(ctx, &mcp.CallToolParams{Name: "search_memories", Arguments: args})
		if err != nil {
			return "", err
		}
		if res.IsError {
			return "", errors.New(res.Content[0].(*mcp.TextContent).Text)
		}
		return res.Content[0].(*mcp.TextContent).Text, nil
	}

	text, err := search(map[string]any{"query": "invoices"})
	if err != nil || strings.Index(text, "invoices go out") > strings.Index(text, "invoices need") ||
		!strings.Contains(text, " score=") || !strings.Contains(text, " kw=") || !strings.Contains(text, "scope=project:1.15") {
		t.Fatalf("server project boosts its own facts: %q, %v", text, err)
	}
	if text, err = search(map[string]any{"query": "invoices", "project": ""}); err != nil || strings.Contains(text, "scope=project:") {
		t.Fatalf("explicit empty project boosts nothing: %q, %v", text, err)
	}
	if text, err = search(map[string]any{"query": "invoices", "scopes": []string{"company"}, "origins": []string{"agent"}}); err != nil ||
		strings.Contains(text, "invoices go out") || !strings.Contains(text, "invoices need") {
		t.Fatalf("filters: %q, %v", text, err)
	}
	if _, err = search(map[string]any{"query": "invoices", "scopes": []string{"bogus"}}); err == nil {
		t.Fatal("scope outside the enum accepted")
	}
}

type fakeIngest struct{ got importer.CreateArgs }

func (f *fakeIngest) Create(a importer.CreateArgs) (importer.Job, error) {
	f.got = a
	return importer.Job{ID: "job-1", State: importer.JobScanning}, nil
}

func (f *fakeIngest) JobWithFacts(string) (importer.JobDetail, error) {
	return importer.JobDetail{Job: importer.Job{ID: "job-1", State: importer.JobDone}, Files: []importer.File{
		{RelPath: "slack.json", State: importer.FileDone, Kind: importer.KindJSON, GroupID: "kg_0123456789ab", Added: 2},
	}}, nil
}

func TestIngestToolsOverMCP(t *testing.T) {
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
	text := func(r *mcp.CallToolResult) string { return r.Content[0].(*mcp.TextContent).Text }
	has := func(cs *mcp.ClientSession) bool {
		tools, err := cs.ListTools(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		for _, tl := range tools.Tools {
			if tl.Name == "ingest_files" {
				return true
			}
		}
		return false
	}
	if has(connect(Options{})) {
		t.Fatal("ingest tools offered without a control")
	}

	fi := &fakeIngest{}
	cs := connect(Options{Ingest: fi, SessionID: "sess-1"})
	dir := t.TempDir()
	res, err := cs.CallTool(ctx, &mcp.CallToolParams{Name: "ingest_files", Arguments: map[string]any{
		"paths": []string{dir}, "origin": "external", "sourceTag": "Slack", "scope": "company", "writeDoc": true,
		"groups": []map[string]any{{"kind": "thread", "key": "https://x/t/1"}},
	}})
	if err != nil || res.IsError {
		t.Fatalf("err=%v res=%+v", err, res)
	}
	g := fi.got
	if g.Channel != importer.ChannelMCP || !g.AutoStart || !g.WriteDoc || g.Provenance.SourceTag != "slack" || g.Provenance.Session != "sess-1" ||
		len(g.Groups) != 1 || !strings.HasPrefix(text(res), "job job-1 scanning\nIngestion runs in the background.") {
		t.Fatalf("got=%+v text=%q", g, text(res))
	}

	for name, args := range map[string]map[string]any{
		"relative path": {"paths": []string{"docs"}, "origin": "user", "scope": "company"},
		"missing path":  {"paths": []string{filepath.Join(dir, "nope")}, "origin": "user", "scope": "company"},
		"document kind": {"paths": []string{dir}, "origin": "user", "scope": "company", "groups": []map[string]any{{"kind": "document", "key": "x"}}},
	} {
		if r, err := cs.CallTool(ctx, &mcp.CallToolParams{Name: "ingest_files", Arguments: args}); err == nil && !r.IsError {
			t.Errorf("%s accepted", name)
		}
	}

	res, err = cs.CallTool(ctx, &mcp.CallToolParams{Name: "ingest_status", Arguments: map[string]any{"id": "job-1"}})
	if err != nil || res.IsError {
		t.Fatalf("err=%v res=%+v", err, res)
	}
	lines := strings.Split(strings.TrimSpace(text(res)), "\n")
	if len(lines) != 2 || !strings.HasPrefix(lines[0], "job job-1 done files 0/0") ||
		lines[1] != "slack.json done json group kg_0123456789ab added 2 updated 0 noop 0 verified 0 dropped 0 unresolved 0" {
		t.Errorf("status = %q", lines)
	}
}

type fakeDistill struct{ got importer.DistillRequest }

func (f *fakeDistill) Distill(_ context.Context, r importer.DistillRequest) (importer.DistillResult, error) {
	f.got = r
	return importer.DistillResult{Lines: []string{"a", "b"}}, nil
}

func TestDistillToolOffer(t *testing.T) {
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
	offered := func(cs *mcp.ClientSession) *mcp.Tool {
		tools, err := cs.ListTools(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		for _, tl := range tools.Tools {
			if tl.Name == "distill" {
				return tl
			}
		}
		return nil
	}
	if offered(connect(Options{})) != nil || offered(connect(Options{ImportRef: "f"})) != nil {
		t.Fatal("distill offered without a distiller")
	}
	fd := &fakeDistill{}
	cs := connect(Options{Distill: fd})
	tl := offered(cs)
	if tl == nil || tl.Annotations == nil || !tl.Annotations.ReadOnlyHint {
		t.Fatalf("distill tool = %+v", tl)
	}
	res, err := cs.CallTool(ctx, &mcp.CallToolParams{Name: "distill", Arguments: map[string]any{"path": "/x/a.md", "mode": "instructions"}})
	if err != nil || res.IsError {
		t.Fatalf("err=%v res=%+v", err, res)
	}
	if got := res.Content[0].(*mcp.TextContent).Text; got != "a\nb" || fd.got.Path != "/x/a.md" || fd.got.Mode != "instructions" {
		t.Errorf("text=%q req=%+v", got, fd.got)
	}
	if r, err := cs.CallTool(ctx, &mcp.CallToolParams{Name: "distill", Arguments: map[string]any{"path": "/x/a.md", "mode": "nope"}}); err == nil && !r.IsError {
		t.Error("bad mode accepted")
	}
}
