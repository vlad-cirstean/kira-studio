// Package memorycli is the `memory-mcp` subcommand body: the stdio MCP server over the shared
// memory.db, run by Claude Code per session.
package memorycli

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/google/uuid"

	"github.com/kirathecat/kira-studio/internal/llmprompts"
	"github.com/kirathecat/kira-studio/internal/memory"
	"github.com/kirathecat/kira-studio/internal/memory/embed"
	"github.com/kirathecat/kira-studio/internal/memory/mcpserver"
)

// Run returns the process exit code. promptsPath is the app's llm-prompts.json: the gate, reconcile
// and server texts it overrides apply here too. Diagnostics go to stderr: stdout is the protocol.
func Run(args []string, promptsPath string) int {
	fs := flag.NewFlagSet("memory-mcp", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	importRef := fs.String("import-ref", "", "attribute every stored memory to this bulk-import file id")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	if *importRef != "" {
		if _, err := uuid.Parse(*importRef); err != nil {
			fmt.Fprintln(os.Stderr, "kira-memory: --import-ref must be a UUID")
			return 2
		}
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, nil)))
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	store := memory.OpenDefault()
	defer store.Close()
	embedder := embed.NewClient(embed.ClientOptions{Spec: embed.Default, Home: memory.Home()})
	var prompts llmprompts.Source = llmprompts.Defaults()
	if promptsPath != "" {
		prompts = llmprompts.NewStore(promptsPath)
	}
	svc := memory.NewService(store, memory.NewCLIRunner(), memory.ServiceOptions{Embedder: embedder, Prompts: prompts})
	defer svc.Close()
	if err := mcpserver.RunStdio(ctx, svc, mcpserver.Options{ImportRef: *importRef, Prompts: prompts}); err != nil && ctx.Err() == nil {
		fmt.Fprintln(os.Stderr, "kira-memory:", err)
		return 1
	}
	return 0
}
