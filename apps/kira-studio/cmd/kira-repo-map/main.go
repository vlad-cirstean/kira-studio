// Command kira-repo-map is the headless repo-map MCP server (docs/v1.5/plans/
// C3-mcp-repo-map-server.md §3.1): `bun run mcp:repo-map` builds and execs this binary, one
// independent instance per invocation, unmanaged by any Kira Studio setting (§0 D1/D7). Prints its
// own ready-to-copy Claude Code registration command to stdout on a successful bind (§3.1) — stdout
// carries no protocol bytes under the Streamable HTTP transport, unlike the stdio design this
// phase's plan originally (and mistakenly) started from.
package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/config"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/mcpauth"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/repomap"
)

// version is a fixed string, not ldflags-injected (§6/§8's own "no ldflags plumbing invented for
// this phase" call).
const version = "0.0.0"

func main() {
	os.Exit(run())
}

func run() int {
	repoFlag := flag.String("repo", "", "repository to serve (default: current working directory)")
	versionFlag := flag.Bool("version", false, "print version and exit")
	flag.Parse()

	if *versionFlag {
		fmt.Println(version)
		return 0
	}

	log := newLogger()

	home := config.KiraHome()

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	srv, err := repomap.New(ctx, repomap.Config{
		Repo: *repoFlag,
		Home: home,
		Token: func(repoID string) (mcpauth.Record, string, bool, error) {
			plain, rec, minted, err := mcpauth.LoadOrMint(mcpauth.Path(home, mcpauth.Slug(repoID)))
			return rec, plain, minted, err
		},
		Logger: log,
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, "kira-repo-map:", err)
		return 1
	}
	defer srv.Close()

	fmt.Printf("Repo map MCP server listening on %s\n", srv.URL())
	if plain, minted := srv.Token(); minted {
		fmt.Println("Register with:")
		fmt.Printf("  claude mcp add --transport http --scope user kira-repo-map %s --header \"Authorization: Bearer %s\"\n", srv.URL(), plain)
	} else {
		fmt.Println("Using this repository's existing token (unchanged since it was last minted).")
		fmt.Println("If it is not already registered with Claude Code, delete this repository's mcp-repo-map-*-token.json under KIRA_HOME and restart to mint a fresh one.")
	}

	go func() {
		<-ctx.Done()
		_ = srv.Close()
	}()

	if err := srv.Serve(); err != nil {
		fmt.Fprintln(os.Stderr, "kira-repo-map:", err)
		return 1
	}
	return 0
}

// newLogger builds the stderr slog.Logger §8 calls for: level from KIRA_REPO_MAP_LOG, "error" by
// default (a stdio server's stderr — now merely a log stream rather than a protocol channel, but
// still quiet by default per that same posture).
func newLogger() *slog.Logger {
	level := slog.LevelError
	switch os.Getenv("KIRA_REPO_MAP_LOG") {
	case "debug":
		level = slog.LevelDebug
	case "info":
		level = slog.LevelInfo
	case "warn":
		level = slog.LevelWarn
	case "error", "":
		level = slog.LevelError
	}
	return slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: level}))
}
