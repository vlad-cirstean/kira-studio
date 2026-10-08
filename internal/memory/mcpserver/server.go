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

	"github.com/kirathecat/kira-studio/internal/memory"
)

const serverVersion = "1"

const instructions = `Long-term memory for the user and their agents.

Store a memory when the user states a durable fact, or when you learn one worth keeping across sessions, with the reason it is true. Call store_memory with one item per fact; set author to "user" when the user said it and "agent" when you concluded it. Never store secrets.

store_memory challenges an item that is ambiguous, has no real reason or does not make sense. A challenge stores nothing: ask the user the returned questions, or fix the item yourself, then call store_memory again with the revised items and the answers in "clarifications".

search_memories is recall-oriented: it matches words and meaning, and returns loosely related results, best first. Read them and discard what is unrelated. A memory marked historical was replaced by a newer version; pass includeHistory to see old versions. memory_history returns every version of one memory with why it changed.`

type storeInput struct {
	Items          []memory.Item          `json:"items" jsonschema:"facts to store, 1 to 20; each with its reason"`
	Author         string                 `json:"author" jsonschema:"user when the user stated the facts, agent when the agent concluded them"`
	Clarifications []memory.Clarification `json:"clarifications,omitempty" jsonschema:"question and answer pairs resolving an earlier challenge"`
}

type searchInput struct {
	Query          string `json:"query" jsonschema:"free text; matched by words (prefixes, word forms) and by meaning"`
	IncludeHistory bool   `json:"includeHistory,omitempty" jsonschema:"also return superseded versions, flagged historical"`
	Limit          int    `json:"limit,omitempty" jsonschema:"maximum results, default 25, maximum 100"`
}

type searchOutput struct {
	Memories []memory.Memory `json:"memories"`
	// Semantic is the semantic-search state: off, notInstalled, unavailable, indexing or ready.
	Semantic string `json:"semantic"`
}

type historyInput struct {
	ID string `json:"id" jsonschema:"id of any version of the memory"`
}

// Build registers the tools and the prompt. Pure registration: no I/O.
func Build(svc *memory.Service) *mcp.Server {
	srv := mcp.NewServer(&mcp.Implementation{Name: "kira-memory", Title: "Kira memory", Version: serverVersion},
		&mcp.ServerOptions{Instructions: instructions})

	f := false
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "store_memory",
		Description: "Store one or more facts, each with its reason. Every item is checked first: an ambiguous or unreasoned item is challenged with questions and nothing in the request is stored. A fact about something already stored updates it; the old version stays as history.",
		Annotations: &mcp.ToolAnnotations{DestructiveHint: &f, IdempotentHint: false},
	}, recovering("store_memory", func(ctx context.Context, req *mcp.CallToolRequest, in storeInput) (*mcp.CallToolResult, memory.StoreResult, error) {
		return storeMemory(ctx, svc, req, in)
	}))
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "search_memories",
		Description: "Search stored memories by keyword and by meaning. Recall-oriented: returns loosely related results, best first. Superseded versions are included only with includeHistory and are flagged historical.",
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
		text := renderMemories(ms) + semanticNote(st)
		return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: text}}}, searchOutput{Memories: ms, Semantic: st.State}, nil
	}))
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "memory_history",
		Description: "Return every version of one memory, oldest first, each flagged historical when replaced, with the events that explain each change.",
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
		Description: "Store the durable facts from some text or from this conversation in long-term memory.",
		Arguments:   []*mcp.PromptArgument{{Name: "text", Description: "What to remember; defaults to the recent conversation"}},
	}, func(_ context.Context, r *mcp.GetPromptRequest) (*mcp.GetPromptResult, error) {
		return &mcp.GetPromptResult{Messages: []*mcp.PromptMessage{{
			Role:    "user",
			Content: &mcp.TextContent{Text: rememberText(r.Params.Arguments["text"])},
		}}}, nil
	})
	return srv
}

func rememberText(text string) string {
	source := "the recent conversation"
	if strings.TrimSpace(text) != "" {
		source = "the text below"
	}
	out := "Extract the durable facts from " + source + ", each with the reason it is true, and store them with the store_memory tool (author \"user\" for what the user stated, \"agent\" for what you concluded). " +
		"If store_memory returns questions, ask the user those questions, then call it again with the revised items and the answers as clarifications. Report what was stored."
	if strings.TrimSpace(text) != "" {
		out += "\n\n" + text
	}
	return out
}

func storeMemory(ctx context.Context, svc *memory.Service, req *mcp.CallToolRequest, in storeInput) (*mcp.CallToolResult, memory.StoreResult, error) {
	sr := memory.StoreRequest{Items: in.Items, Clarifications: in.Clarifications, Author: in.Author, Source: memory.SourceMCP}
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
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: renderStore(res)}}}, res, nil
}

func renderStore(res memory.StoreResult) string {
	var b strings.Builder
	if res.Status == "challenged" {
		b.WriteString("Nothing was stored. Ask the user these, or fix the items, then call store_memory again with clarifications:\n")
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
func semanticNote(st memory.SemanticStatus) string {
	switch st.State {
	case memory.SemanticNotInstalled:
		return "\nNote: semantic search is not installed. Results are keyword matches only. Enable it in Kira Space, Memory, Download model.\n"
	case memory.SemanticUnavailable:
		return fmt.Sprintf("\nNote: semantic search is unavailable: %s. Results are keyword matches only.\n", st.Message)
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
				slog.Error("memory: tool panicked", "tool", name, "panic", fmt.Sprintf("%v", r), "stack", string(debug.Stack()))
				res, err = nil, errors.New("internal error handling this tool call")
			}
		}()
		return h(ctx, req, in)
	}
}

// RunStdio serves the MCP protocol on stdin/stdout until the client disconnects or ctx ends.
// Nothing else in the process may write stdout.
func RunStdio(ctx context.Context, svc *memory.Service) error {
	return Build(svc).Run(ctx, &mcp.StdioTransport{})
}
