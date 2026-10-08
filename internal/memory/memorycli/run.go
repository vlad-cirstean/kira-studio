// Package memorycli is the `memory-mcp` subcommand body: the stdio MCP server over the shared
// memory.db, run by Claude Code per session.
package memorycli

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/kirathecat/kira-studio/internal/memory"
	"github.com/kirathecat/kira-studio/internal/memory/embed"
	"github.com/kirathecat/kira-studio/internal/memory/mcpserver"
)

// Run returns the process exit code. Diagnostics go to stderr: stdout is the protocol.
func Run(_ []string) int {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, nil)))
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	store := memory.OpenDefault()
	defer store.Close()
	embedder := embed.NewClient(embed.ClientOptions{Spec: embed.Default, Home: memory.Home()})
	svc := memory.NewService(store, memory.NewCLIRunner(), memory.ServiceOptions{Embedder: embedder})
	defer svc.Close()
	if err := mcpserver.RunStdio(ctx, svc); err != nil && ctx.Err() == nil {
		fmt.Fprintln(os.Stderr, "kira-memory:", err)
		return 1
	}
	return 0
}
