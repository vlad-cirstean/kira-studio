// Package mcpserver is the kira-memory MCP server: store_memory, search_memories and
// memory_history tools plus the `remember` prompt, over a memory.Service.
package mcpserver

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"runtime/debug"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/kirathecat/kira-studio/internal/llmprompts"
	"github.com/kirathecat/kira-studio/internal/memory"
)

const serverVersion = "1"

type storeInput struct {
	Items          []memory.Item          `json:"items"`
	Author         string                 `json:"author"`
	Clarifications []memory.Clarification `json:"clarifications,omitempty"`
}

type searchInput struct {
	Query          string `json:"query"`
	IncludeHistory bool   `json:"includeHistory,omitempty"`
	Limit          int    `json:"limit,omitempty"`
}

type searchOutput struct {
	Memories []memory.Memory `json:"memories"`
	// Semantic is the semantic-search state: off, notInstalled, unavailable, indexing or ready.
	Semantic string `json:"semantic"`
}

type historyInput struct {
	ID string `json:"id"`
}

// Options tune a server instance.
type Options struct {
	// ImportRef puts the server in import mode: every stored memory is attributed to the agent with
	// source "import" and this import file id, whatever author the caller sends.
	ImportRef string
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
		InputSchema: llmprompts.InputSchema[storeInput](src, llmprompts.MemoryToolStoreMemory.ID(), map[string]any{
			"items": llmprompts.MaxVars{Max: memory.MaxItems},
		}),
		Annotations: &mcp.ToolAnnotations{DestructiveHint: &f, IdempotentHint: false},
	}, recovering("store_memory", func(ctx context.Context, req *mcp.CallToolRequest, in storeInput) (*mcp.CallToolResult, memory.StoreResult, error) {
		return storeMemory(ctx, svc, opts, req, in)
	}))
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "search_memories",
		Description: llmprompts.MemoryToolSearchMemories.Text(src, llmprompts.NoVars{}),
		InputSchema: llmprompts.InputSchema[searchInput](src, llmprompts.MemoryToolSearchMemories.ID(), map[string]any{
			"limit": llmprompts.LimitVars{Default: memory.DefaultSearchLimit, Max: memory.MaxSearchLimit},
		}),
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true},
	}, recovering("search_memories", func(ctx context.Context, _ *mcp.CallToolRequest, in searchInput) (*mcp.CallToolResult, searchOutput, error) {
		ms, err := svc.Search(ctx, memory.SearchArgs{Query: in.Query, IncludeHistory: in.IncludeHistory, Limit: in.Limit})
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

func storeMemory(ctx context.Context, svc *memory.Service, opts Options, req *mcp.CallToolRequest, in storeInput) (*mcp.CallToolResult, memory.StoreResult, error) {
	sr := memory.StoreRequest{Items: in.Items, Clarifications: in.Clarifications, Author: in.Author, Source: memory.SourceMCP}
	if opts.ImportRef != "" {
		sr.Author, sr.Source, sr.SourceRef = memory.AuthorAgent, memory.SourceImport, opts.ImportRef
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
	res, err := svc.Store(ctx, sr)
	if err != nil {
		return nil, memory.StoreResult{}, err
	}
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: renderStore(opts.Prompts, res)}}}, res, nil
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
			fmt.Fprintf(&b, "Added: %s (id %s)\n", o.Fact, o.ID)
		case memory.ActionUpdate:
			fmt.Fprintf(&b, "Updated to v%d: %s (id %s; previous %s kept as history)\n", o.Version, o.Fact, o.ID, o.PreviousID)
		case memory.ActionNoop:
			fmt.Fprintf(&b, "Already known: %s (id %s)\n", o.Fact, o.ID)
		default:
			fmt.Fprintf(&b, "Failed: %s: %s\n", o.Fact, o.Error)
		}
	}
	return b.String()
}

func renderMemories(ms []memory.Memory) string {
	if len(ms) == 0 {
		return "No memories found."
	}
	var b strings.Builder
	for _, m := range ms {
		flag := ""
		if m.Historical {
			flag = " [historical]"
		}
		if m.Match == "semantic" {
			flag += " [semantic]"
		}
		fmt.Fprintf(&b, "- %s%s (v%d, %s, id %s)\n  reason: %s\n", m.Fact, flag, m.Version, m.Author, m.ID, m.Reason)
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
