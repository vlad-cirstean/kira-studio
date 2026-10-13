// Package mcpserver is the kira-memory MCP server: store_memory, search_memories, memory_history
// and memory_context tools plus the `remember` prompt, over a memory.Service.
package mcpserver

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"runtime/debug"
	"strings"

	"github.com/google/jsonschema-go/jsonschema"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/kirathecat/kira-studio/internal/llmprompts"
	"github.com/kirathecat/kira-studio/internal/memory"
	"github.com/kirathecat/kira-studio/internal/memory/memfmt"
)

const serverVersion = "1"

type storeInput struct {
	Items          []memory.Item          `json:"items"`
	Clarifications []memory.Clarification `json:"clarifications,omitempty"`
	Session        string                 `json:"session,omitempty"`
	Groups         []memory.GroupRef      `json:"groups,omitempty"`
	// AsComment is the path or extension of the file a comment goes in; set means store nothing.
	AsComment string `json:"asComment,omitempty"`
}

// storeOutput is store_memory's structured result: the stored outcomes, or with asComment the
// prepared facts and their comment.
type storeOutput struct {
	Status     string                 `json:"status"` // "stored" | "challenged" | "prepared"
	Challenges []memory.ItemChallenge `json:"challenges"`
	Outcomes   []memory.FactOutcome   `json:"outcomes"`
	Comment    string                 `json:"comment,omitempty"`
	Prepared   []memory.PreparedFact  `json:"prepared,omitempty"`
}

type searchInput struct {
	Query          string   `json:"query"`
	IncludeHistory bool     `json:"includeHistory,omitempty"`
	Limit          int      `json:"limit,omitempty"`
	Scopes         []string `json:"scopes,omitempty"`
	Origins        []string `json:"origins,omitempty"`
	// Project is the project key whose facts rank first. Absent uses the server's project; "" boosts none.
	Project *string `json:"project,omitempty"`
}

type searchOutput struct {
	Memories []memory.Memory `json:"memories"`
	// Semantic is the semantic-search state: off, notInstalled, unavailable, indexing or ready.
	Semantic string `json:"semantic"`
}

type historyInput struct {
	ID string `json:"id"`
}

type contextInput struct {
	ID    string `json:"id"`
	Limit int    `json:"limit,omitempty"`
}

// Options tune a server instance.
type Options struct {
	// ImportRef puts the server in import mode: every stored memory takes the provenance, groups and
	// session of the import job that owns this file id, source "import", and joins the file's document
	// group, whatever the caller sends. An external job never challenges.
	ImportRef string
	// SessionID is the Claude Code session of this server; a store call without a session argument
	// uses it. Empty stores no session.
	SessionID string
	// Project is the project key of the server's working directory; an item of scope project without
	// a project uses it. Empty means undetected.
	Project string
	// Ingest, when set, adds the ingest_files and ingest_status tools. Import mode leaves it nil.
	Ingest Ingestor
	// Prompts resolves the texts the server shows; nil means the registry defaults. Instructions,
	// tool and argument descriptions are read once here, so an edit reaches the next session.
	Prompts llmprompts.Source
}

// Build registers the tools and the prompt. Pure registration: no I/O.
func Build(svc *memory.Service, opts Options) *mcp.Server {
	if opts.Prompts == nil {
		opts.Prompts = llmprompts.Defaults()
	}
	src := opts.Prompts
	srv := mcp.NewServer(&mcp.Implementation{Name: "kira-memory", Title: "Kira memory", Version: serverVersion},
		&mcp.ServerOptions{Instructions: llmprompts.MemoryMcpInstructions.Text(src, llmprompts.NoVars{})})

	f := false
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "store_memory",
		Description: llmprompts.MemoryToolStoreMemory.Text(src, llmprompts.NoVars{}),
		InputSchema: storeSchema(src),
		Annotations: &mcp.ToolAnnotations{DestructiveHint: &f, IdempotentHint: false},
	}, recovering("store_memory", func(ctx context.Context, req *mcp.CallToolRequest, in storeInput) (*mcp.CallToolResult, storeOutput, error) {
		return storeMemory(ctx, svc, opts, req, in)
	}))
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "search_memories",
		Description: llmprompts.MemoryToolSearchMemories.Text(src, llmprompts.NoVars{}),
		InputSchema: searchSchema(src),
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true},
	}, recovering("search_memories", func(ctx context.Context, _ *mcp.CallToolRequest, in searchInput) (*mcp.CallToolResult, searchOutput, error) {
		project := opts.Project
		if in.Project != nil {
			project = *in.Project
		}
		ms, err := svc.Search(ctx, memory.SearchArgs{Query: in.Query, IncludeHistory: in.IncludeHistory, Limit: in.Limit,
			Scopes: in.Scopes, Origins: in.Origins, Project: project})
		if err != nil {
			return nil, searchOutput{}, err
		}
		st, err := svc.SemanticStatus(ctx)
		if err != nil {
			st = memory.SemanticStatus{State: memory.SemanticUnavailable, Message: err.Error()}
		}
		text := renderMemories(ms) + semanticNote(src, st)
		return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: text}}}, searchOutput{Memories: ms, Semantic: st.State}, nil
	}))
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "memory_history",
		Description: llmprompts.MemoryToolMemoryHistory.Text(src, llmprompts.NoVars{}),
		InputSchema: llmprompts.InputSchema[historyInput](src, llmprompts.MemoryToolMemoryHistory.ID(), nil),
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true},
	}, recovering("memory_history", func(ctx context.Context, _ *mcp.CallToolRequest, in historyInput) (*mcp.CallToolResult, memory.History, error) {
		h, err := svc.History(ctx, in.ID)
		if err != nil {
			return nil, memory.History{}, err
		}
		return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: renderMemories(h.Memories)}}}, h, nil
	}))

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "memory_context",
		Description: llmprompts.MemoryToolMemoryContext.Text(src, llmprompts.NoVars{}),
		InputSchema: llmprompts.InputSchema[contextInput](src, llmprompts.MemoryToolMemoryContext.ID(), map[string]any{
			"limit": llmprompts.LimitVars{Default: memory.DefaultContextLimit, Max: memory.MaxContextLimit},
		}),
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true},
	}, recovering("memory_context", func(ctx context.Context, _ *mcp.CallToolRequest, in contextInput) (*mcp.CallToolResult, memory.Context, error) {
		c, err := svc.Context(ctx, in.ID, in.Limit)
		if err != nil {
			return nil, memory.Context{}, err
		}
		return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: renderContext(c)}}}, c, nil
	}))

	if opts.Ingest != nil {
		addIngestTools(srv, opts)
	}

	srv.AddPrompt(&mcp.Prompt{
		Name:        "remember",
		Title:       "Remember",
		Description: llmprompts.MemoryRememberDescription.Text(src, llmprompts.NoVars{}),
		Arguments: []*mcp.PromptArgument{{Name: "text", Description: llmprompts.Render(src,
			llmprompts.ID(string(llmprompts.MemoryRememberDescription.ID())+".arg.text"), llmprompts.NoVars{})}},
	}, func(_ context.Context, r *mcp.GetPromptRequest) (*mcp.GetPromptResult, error) {
		return &mcp.GetPromptResult{Messages: []*mcp.PromptMessage{{
			Role:    "user",
			Content: &mcp.TextContent{Text: rememberText(src, r.Params.Arguments["text"])},
		}}}, nil
	})
	return srv
}

func rememberText(src llmprompts.Source, text string) string {
	if strings.TrimSpace(text) == "" {
		text = ""
	}
	return llmprompts.MemoryRememberMessage.Text(src, llmprompts.RememberVars{Text: text})
}

// storeSchema is store_memory's input schema with the closed value sets of origin, scope and group
// kind as enums.
func storeSchema(src llmprompts.Source) *jsonschema.Schema {
	sch := llmprompts.InputSchema[storeInput](src, llmprompts.MemoryToolStoreMemory.ID(), map[string]any{
		"items": llmprompts.MaxVars{Max: memory.MaxItems},
	})
	enum := func(prop *jsonschema.Schema, values ...string) {
		for _, v := range values {
			prop.Enum = append(prop.Enum, v)
		}
	}
	item := sch.Properties["items"].Items.Properties
	enum(item["origin"], memory.OriginUser, memory.OriginAgent, memory.OriginExternal)
	enum(item["scope"], memory.ScopeCompany, memory.ScopeProject, memory.ScopePersonal)
	enum(sch.Properties["groups"].Items.Properties["kind"], memory.GroupTask, memory.GroupDocument, memory.GroupThread)
	return sch
}

// searchSchema is search_memories' input schema with scopes and origins limited to their closed sets.
func searchSchema(src llmprompts.Source) *jsonschema.Schema {
	sch := llmprompts.InputSchema[searchInput](src, llmprompts.MemoryToolSearchMemories.ID(), map[string]any{
		"limit": llmprompts.LimitVars{Default: memory.DefaultSearchLimit, Max: memory.MaxSearchLimit},
	})
	enum := func(prop *jsonschema.Schema, values ...string) {
		for _, v := range values {
			prop.Items.Enum = append(prop.Items.Enum, v)
		}
	}
	enum(sch.Properties["scopes"], memory.ScopeCompany, memory.ScopeProject, memory.ScopePersonal)
	enum(sch.Properties["origins"], memory.OriginUser, memory.OriginAgent, memory.OriginExternal)
	return sch
}

// requestFor builds the service request of one store call: server defaults for session and
// project, or the fixed provenance and document group of import mode.
func requestFor(ctx context.Context, svc *memory.Service, opts Options, in storeInput) (memory.StoreRequest, error) {
	sr := memory.StoreRequest{Clarifications: in.Clarifications, Session: in.Session, Groups: in.Groups, Source: memory.SourceMCP}
	if sr.Session == "" {
		sr.Session = opts.SessionID
	}
	sr.Items = make([]memory.Item, len(in.Items))
	for i, it := range in.Items {
		if it.Scope == memory.ScopeProject && it.Project == "" {
			it.Project = opts.Project
		}
		sr.Items[i] = it
	}
	if opts.ImportRef == "" {
		return sr, nil
	}
	ip, err := svc.ImportProvenance(ctx, opts.ImportRef)
	switch {
	case err == nil:
	case errors.Is(err, memory.ErrNotFound):
		ip = memory.ImportProvenance{Origin: memory.OriginExternal, SourceTag: "doc", Scope: memory.ScopePersonal}
	default:
		return memory.StoreRequest{}, err
	}
	sr.Source, sr.SourceRef, sr.Session = memory.SourceImport, opts.ImportRef, ip.Session
	sr.NoChallenge = ip.Origin == memory.OriginExternal
	for i := range sr.Items {
		sr.Items[i].Origin, sr.Items[i].SourceTag = ip.Origin, ip.SourceTag
		sr.Items[i].Scope, sr.Items[i].Project = ip.Scope, ip.Project
	}
	doc := memory.GroupRef{Kind: memory.GroupDocument, Key: opts.ImportRef}
	if ip.Path != "" {
		doc.Key, doc.Title = ip.Path, ip.RelPath
	}
	sr.Groups = append([]memory.GroupRef{doc}, ip.Groups...)
	return sr, nil
}

func storeMemory(ctx context.Context, svc *memory.Service, opts Options, req *mcp.CallToolRequest, in storeInput) (*mcp.CallToolResult, storeOutput, error) {
	marker, err := commentMarker(opts, in)
	if err != nil {
		return nil, storeOutput{}, err
	}
	sr, err := requestFor(ctx, svc, opts, in)
	if err != nil {
		return nil, storeOutput{}, err
	}
	if token := req.Params.GetProgressToken(); token != nil && req.Session != nil {
		step := 0.0
		sr.Progress = func(stage string) {
			step++
			_ = req.Session.NotifyProgress(ctx, &mcp.ProgressNotificationParams{
				ProgressToken: token, Message: stage, Progress: step, Total: 3,
			})
		}
	}
	if marker != nil {
		return prepareMemory(ctx, svc, opts, sr, *marker)
	}
	res, err := svc.Store(ctx, sr)
	if err != nil {
		return nil, storeOutput{}, err
	}
	out := storeOutput{Status: res.Status, Challenges: res.Challenges, Outcomes: res.Outcomes}
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: renderStore(opts.Prompts, res)}}}, out, nil
}

// commentMarker resolves asComment to a comment syntax; nil when the call stores normally.
func commentMarker(opts Options, in storeInput) (*memfmt.Marker, error) {
	if in.AsComment == "" {
		return nil, nil
	}
	bad := func(format string, a ...any) error {
		return fmt.Errorf("%w: %s", memory.ErrInvalid, fmt.Sprintf(format, a...))
	}
	switch {
	case opts.ImportRef != "":
		return nil, bad("asComment is not available in import mode")
	case len(in.Groups) > 0:
		return nil, bad("asComment stores nothing, so groups are not allowed")
	case memfmt.IsDocPath(in.AsComment):
		return nil, bad("asComment writes code comments, not %s docs", in.AsComment)
	}
	markers, ok := memfmt.MarkersFor(in.AsComment)
	if !ok {
		return nil, bad("asComment %q has no known comment syntax; supported: %s", in.AsComment, strings.Join(memfmt.Supported(), ", "))
	}
	return &markers[0], nil
}

func prepareMemory(ctx context.Context, svc *memory.Service, opts Options, sr memory.StoreRequest, m memfmt.Marker) (*mcp.CallToolResult, storeOutput, error) {
	res, err := svc.Prepare(ctx, sr, m)
	if err != nil {
		return nil, storeOutput{}, err
	}
	out := storeOutput{Status: res.Status, Challenges: res.Challenges, Outcomes: []memory.FactOutcome{}, Comment: res.Comment, Prepared: res.Facts}
	text := llmprompts.MemoryStorePrepared.Text(opts.Prompts, llmprompts.NoVars{}) + "\n\n" + res.Comment
	if res.Status == "challenged" {
		text = renderStore(opts.Prompts, memory.StoreResult{Status: res.Status, Challenges: res.Challenges})
	}
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: text}}}, out, nil
}

func renderStore(src llmprompts.Source, res memory.StoreResult) string {
	var b strings.Builder
	if res.Status == "challenged" {
		b.WriteString(llmprompts.MemoryStoreChallenged.Text(src, llmprompts.NoVars{}) + "\n")
		n := 0
		for _, c := range res.Challenges {
			for _, q := range c.Questions {
				n++
				fmt.Fprintf(&b, "%d. (item %d: %s) %s\n", n, c.Index, c.Fact, q)
			}
		}
		return b.String()
	}
	for _, o := range res.Outcomes {
		switch o.Action {
		case memory.ActionAdd:
			fmt.Fprintf(&b, "Added %s v%d: %s\n", o.LineageID, o.Version, o.Fact)
		case memory.ActionUpdate:
			fmt.Fprintf(&b, "Updated %s to v%d: %s (previous version kept as history)\n", o.LineageID, o.Version, o.Fact)
		case memory.ActionNoop:
			fmt.Fprintf(&b, "Already known %s v%d: %s\n", o.LineageID, o.Version, o.Fact)
		default:
			fmt.Fprintf(&b, "Failed: %s: %s\n", o.Fact, o.Error)
		}
	}
	for _, c := range res.Challenges {
		fmt.Fprintf(&b, "Not stored (nobody can answer): %s: %s\n", c.Fact, strings.Join(c.Questions, " "))
	}
	return b.String()
}

// oneLine folds whitespace runs to one space so a field stays on its own line.
func oneLine(s string) string { return strings.Join(strings.Fields(s), " ") }

func renderMemories(ms []memory.Memory) string {
	if len(ms) == 0 {
		return "No memories found."
	}
	var b strings.Builder
	for _, m := range ms {
		writeMemory(&b, m)
	}
	return b.String()
}

// writeMemory prints the grep-first grammar shared with the comment and doc formats, plus a meta
// line with the per-result provenance: "<id> fact: ...", "<id> reason: ...", "<id> meta: ...".
func writeMemory(b *strings.Builder, m memory.Memory) {
	meta := []string{fmt.Sprintf("v%d", m.Version), "origin=" + m.Origin}
	if m.SourceTag != nil {
		meta = append(meta, "source="+*m.SourceTag)
	}
	meta = append(meta, "scope="+m.Scope)
	if m.Project != nil {
		meta = append(meta, "project="+*m.Project)
	}
	if m.Match != "" {
		meta = append(meta, "match="+m.Match)
	}
	meta = append(meta, scoreMeta(m)...)
	if m.Historical {
		meta = append(meta, "historical")
	}
	if m.ContextCount > 0 {
		meta = append(meta, fmt.Sprintf("ctx=%d", m.ContextCount))
	}
	fmt.Fprintf(b, "%s fact: %s\n%s reason: %s\n%s meta: %s\n\n", m.LineageID, oneLine(m.Fact), m.LineageID, oneLine(m.Reason), m.LineageID, strings.Join(meta, " "))
}

// scoreMeta prints a search result's score parts: total and per-source scores, then the boosts that
// are not neutral. Neutral 1.00 parts are left out to save tokens.
func scoreMeta(m memory.Memory) []string {
	sc := m.Score
	if sc == nil {
		return nil
	}
	out := []string{fmt.Sprintf("score=%.2f", sc.Total), fmt.Sprintf("kw=%.2f", sc.Keyword), fmt.Sprintf("sem=%.2f", sc.Semantic)}
	boost := func(key string, v float64, label string) {
		if x := fmt.Sprintf("%.2f", v); x != "1.00" {
			out = append(out, key+"="+label+x)
		}
	}
	boost("grade", sc.Grade, "")
	boost("scope", sc.Scope, sc.Boost+":")
	boost("recent", sc.Recency, "")
	boost("hist", sc.History, "")
	boost("group", sc.Group, "")
	return out
}

// renderContext lists the fact, then one block per group with the group's other facts.
func renderContext(c memory.Context) string {
	var b strings.Builder
	writeMemory(&b, c.Memory)
	if len(c.Groups) == 0 {
		b.WriteString("This fact belongs to no group.\n")
	}
	for _, g := range c.Groups {
		fmt.Fprintf(&b, "group %s %s %s", g.ID, g.Kind, oneLine(g.Key))
		if g.Title != "" {
			fmt.Fprintf(&b, " (%s)", oneLine(g.Title))
		}
		if g.Total > len(g.Facts) {
			fmt.Fprintf(&b, " [%d of %d other facts]", len(g.Facts), g.Total)
		}
		b.WriteString("\n\n")
		for _, m := range g.Facts {
			writeMemory(&b, m)
		}
	}
	return b.String()
}

// semanticNote tells the agent when results are keyword-only, so it can say so instead of
// trusting an empty list. Off, indexing and ready add nothing.
func semanticNote(src llmprompts.Source, st memory.SemanticStatus) string {
	switch st.State {
	case memory.SemanticNotInstalled:
		return "\n" + llmprompts.MemorySemanticNotInstalled.Text(src, llmprompts.NoVars{}) + "\n"
	case memory.SemanticUnavailable:
		return "\n" + llmprompts.MemorySemanticUnavailable.Text(src, llmprompts.CauseVars{Cause: st.Message}) + "\n"
	}
	return ""
}

// recovering turns a handler panic into a tool error: go-sdk runs each request in its own
// goroutine with no recover, so an unguarded panic would end the whole server. Typed errors
// reach the client verbatim.
func recovering[In, Out any](name string, h func(context.Context, *mcp.CallToolRequest, In) (*mcp.CallToolResult, Out, error)) mcp.ToolHandlerFor[In, Out] {
	return func(ctx context.Context, req *mcp.CallToolRequest, in In) (res *mcp.CallToolResult, out Out, err error) {
		defer func() {
			if r := recover(); r != nil {
				slog.Error("memory: tool panicked", "scope", "memory", "tool", name, "panic", fmt.Sprintf("%v", r), "stack", string(debug.Stack()))
				res, err = nil, errors.New("internal error handling this tool call")
			}
		}()
		return h(ctx, req, in)
	}
}

// RunStdio serves the MCP protocol on stdin/stdout until the client disconnects or ctx ends.
// Nothing else in the process may write stdout.
func RunStdio(ctx context.Context, svc *memory.Service, opts Options) error {
	return Build(svc, opts).Run(ctx, &mcp.StdioTransport{})
}
