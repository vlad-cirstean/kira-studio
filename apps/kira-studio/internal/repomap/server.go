// Package repomap is the repo-map MCP server (docs/v1.5/plans/C3-mcp-repo-map-server.md): a
// protocol front end over C2's codegraph.Graph, served over MCP's Streamable HTTP transport (§0
// D1's correction) to however many clients call in concurrently — never stdio, which ties one
// process to one client by construction. One Server value is one repository, resolved once at
// construction (§9: multi-repository support is deliberately out of scope); a caller working
// across several repositories constructs several Servers, each its own port and its own token
// (§0 D1/D8).
//
// This package imports nothing from internal/bridge (internal/layering_test.go enforces it): both
// the headless binary (cmd/kira-repo-map) and the embedded instance (internal/bridge/repomap.go,
// started from within the running Kira Studio app) construct a Server the same way.
package repomap

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codegraph"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codeindex"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/config"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/mcpauth"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// readyTimeout bounds every tool call's own wait on the readiness gate (§4.2) — never an empty
// result while the index is still building, and never a hang past this bound either. A var, not a
// const (gitclient/runner.go's own gracefulStopDelay precedent): a test lowers it so proving the
// timeout path doesn't cost 25s of real wall-clock time.
var readyTimeout = 25 * time.Second

// DefaultPort is the port every instance tries first (§5); a second instance on one machine falls
// back to an OS-assigned ephemeral one automatically (http.go).
const DefaultPort = 8765

// TokenProvider resolves repoID's own D8 token once repository identity is known — called exactly
// once, from New, after resolveRepo but before the listener binds. The two real callers differ in
// exactly this decision: the headless binary and an app-boot-with-the-leaf-already-true start
// (mcpauth.LoadOrMint — load an existing token rather than invalidate it) versus an explicit
// enable-the-toggle click (mcpauth.Mint, always fresh, then persist) — §0 D8's own lifecycle split,
// deliberately left to the caller rather than a bool flag New would otherwise have to interpret.
type TokenProvider func(repoID string) (rec mcpauth.Record, plain string, minted bool, err error)

// Config is everything New needs to resolve a repository, index it and serve it. Zero-value fields
// take the documented default.
type Config struct {
	// Repo is --repo (headless) or unset (embedded, §3.2): the directory identity is resolved
	// from. Empty means the process's own cwd.
	Repo string
	// Home overrides KIRA_HOME (a debugging seam, §5's own escape hatch) — empty means
	// config.KiraHome().
	Home string
	// Token resolves this instance's own auth record — required.
	Token TokenProvider
	// Logger receives every operational log line, stderr-bound by convention (§8). A nil Logger
	// falls back to slog.Default().
	Logger *slog.Logger
}

// Server is one repository's own repo-map MCP server: the resolved identity, C1/C2's index and
// graph over it, the six-tool mcp.Server, and the HTTP listener in front of it (http.go).
type Server struct {
	repoID string
	root   string

	// tokenMu guards token/tokenPlain/tokenMinted: Regenerate (bridge.RepoMapService's own restart-
	// recovery action, §0 D8) mutates these on a live, already-serving instance, concurrently with
	// tokenVerifier reading them on every in-flight request (http.go).
	tokenMu     sync.RWMutex
	token       mcpauth.Record
	tokenPlain  string
	tokenMinted bool
	log         *slog.Logger

	store *codeindex.Store
	idx   *codeindex.Index
	graph *codegraph.Graph
	mcp   *mcp.Server

	watcher *codeindex.Watcher

	// lockMu guards lock — written by runInitialSync's own background goroutine, read and cleared
	// by Close, which can run concurrently with it (an app-driven Close racing a still-in-flight
	// initial sync is a real sequence, not just a test artifact: SetEnabled(false) or app shutdown
	// can land at any point).
	lockMu sync.Mutex
	lock   *codeindex.SyncLock

	ready     chan struct{}
	readyOnce sync.Once

	httpState // http.go's own fields (listener, *http.Server) — split out for that file's own cohesion

	closeOnce sync.Once
	cancel    context.CancelFunc
}

// New resolves cfg's repository, opens the shared codeindex.Store, starts an initial Sync (behind
// the per-repository flock, §5) and the watcher in the background, builds the six-tool mcp.Server,
// and binds the HTTP listener (§5's default-then-fallback port selection) — but does not yet accept
// connections; call Serve to do that. Returns as soon as the listener is bound, deliberately: an
// MCP client's own initialize must answer in milliseconds, and Sync commonly takes far longer than
// that on a cold cache (§4.2).
func New(ctx context.Context, cfg Config) (*Server, error) {
	home := cfg.Home
	if home == "" {
		home = config.KiraHome()
	}

	store := codeindex.OpenStoreAt(home)
	resolved, err := resolveRepo(ctx, store, cfg.Repo)
	if err != nil {
		_ = store.Close()
		return nil, err
	}
	return newServer(ctx, cfg, home, store, resolved)
}

// newServer is New's own construction half, split out so a test can supply an already-known
// resolvedRepo (a seeded codeindex.Store's own repo_id/root, §11.3) instead of a real git
// repository — the conformance smoke test's own shape.
func newServer(ctx context.Context, cfg Config, home string, store *codeindex.Store, resolved resolvedRepo) (*Server, error) {
	log := cfg.Logger
	if log == nil {
		log = slog.Default()
	}

	if cfg.Token == nil {
		_ = store.Close()
		return nil, fmt.Errorf("repomap: Config.Token is required")
	}
	tokenRec, tokenPlain, tokenMinted, err := cfg.Token(resolved.repoID)
	if err != nil {
		_ = store.Close()
		return nil, fmt.Errorf("repomap: resolve token: %w", err)
	}

	idx := codeindex.Open(store, resolved.runner, resolved.gitPath, resolved.repoID, resolved.root)
	graph := codegraph.New(store, resolved.repoID)

	runCtx, cancel := context.WithCancel(context.Background())

	s := &Server{
		repoID:      resolved.repoID,
		root:        resolved.root,
		token:       tokenRec,
		tokenPlain:  tokenPlain,
		tokenMinted: tokenMinted,
		log:         log,
		store:       store,
		idx:         idx,
		graph:       graph,
		ready:       make(chan struct{}),
		cancel:      cancel,
	}

	s.mcp = s.buildMCPServer()

	if err := s.bindHTTP(); err != nil {
		cancel()
		idx.Close()
		_ = store.Close()
		return nil, err
	}

	go s.runInitialSync(runCtx, home)

	watcher, err := idx.Watch()
	if err != nil {
		// A watcher failure is not fatal to serving what has already synced — logged, not returned
		// (mirrors §4.2's "a bind failure is logged, never fatal" posture applied to the watcher
		// instead of the listener).
		log.Warn("repo-map watcher", "scope", "repomap", "repo", resolved.repoID, "err", err)
	}
	s.watcher = watcher

	return s, nil
}

// serverVersion mirrors the app's own declared version (build/config.yml) — no ldflags plumbing
// invented for this phase alone (§6).
const serverVersion = "0.0.0"

// instructions is §6.0's own one paragraph: the steer that decides whether any of this pays off.
const instructions = "These tools answer navigation questions from a pre-built index; prefer them to opening a file to find a definition. Positions are 1-based lines; a column, where given, is a 1-based byte column. Each hit is followed by its own line of source, indented, read from the file at that position and truncated at 512 bytes with a trailing `…`; `[stale]` marks a file changed since it was indexed, `[no source: …]` a line that could not be read. Pass `omitSource` to drop them. Results are name-resolved, not type-resolved, and each carries its own confidence and the rule that produced it."

// buildMCPServer constructs the six-tool mcp.Server (§6) — pure registration, no I/O of its own;
// every handler closes over s and calls into s.graph/s.store through the readiness gate.
func (s *Server) buildMCPServer() *mcp.Server {
	srv := mcp.NewServer(&mcp.Implementation{
		Name:    "kira-repo-map",
		Title:   "Kira Studio repository map",
		Version: serverVersion,
	}, &mcp.ServerOptions{Instructions: instructions})

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "find_definition",
		Description: "Find where a symbol is defined. Give file+line(+column), file+symbol, or symbol alone. Each hit includes its own source line.",
	}, s.findDefinition)
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "find_references",
		Description: "Find occurrences of a symbol across the repository. Give file+line(+column), file+symbol, or symbol alone. Each hit includes its own source line.",
	}, s.findReferences)
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "find_implementations",
		Description: "Find concrete implementations of an interface/trait/base type. Language-dependent: empty for Go by design (interfaces are structural, not derivable from the index).",
	}, s.findImplementations)
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "search_symbols",
		Description: "Search indexed symbols by name (prefix match by default).",
	}, s.searchSymbols)
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "search_files",
		Description: "Search indexed file paths by substring. Not a fuzzy finder.",
	}, s.searchFiles)
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "outline_file",
		Description: "A file's definition tree (functions, methods, classes, ...) without reading its bytes — the cheapest way to see what a file contains.",
	}, s.outlineFile)

	return srv
}

// runInitialSync runs behind the per-repository flock (§5, now internal/codeindex.AcquireSyncLock
// — C6 S1/D11 moved it there so codeworkspace's own index lifecycle shares the identical
// discipline), then closes the readiness gate exactly once regardless of outcome — a Sync error
// still opens the gate (a tool call then gets whatever codegraph can answer from an empty or
// partial index, which is honest; it does not hang forever).
func (s *Server) runInitialSync(ctx context.Context, home string) {
	lock, acquired, err := codeindex.AcquireSyncLock(home, s.repoID, codeindex.DefaultSyncLockTimeout)
	if err != nil {
		s.log.Warn("repo-map sync lock", "scope", "repomap", "repo", s.repoID, "err", err)
	}
	s.lockMu.Lock()
	s.lock = lock
	s.lockMu.Unlock()
	if !acquired {
		s.log.Debug("repo-map sync lock: proceeding without it (timeout or unsupported platform)", "scope", "repomap", "repo", s.repoID)
	}

	stats, err := s.idx.Sync(ctx)
	if lock != nil {
		lock.Release()
		s.lockMu.Lock()
		s.lock = nil
		s.lockMu.Unlock()
	}
	if err != nil {
		s.log.Error("repo-map initial sync", "scope", "repomap", "repo", s.repoID, "err", err)
	} else {
		s.log.Info("repo-map initial sync complete", "scope", "repomap", "repo", s.repoID,
			"filesParsed", stats.FilesParsed, "filesSkipped", stats.FilesSkipped, "filesDeleted", stats.FilesDeleted)
	}
	s.readyOnce.Do(func() { close(s.ready) })
}

// waitReady blocks until the initial Sync has completed or readyTimeout elapses, whichever first —
// §4.2's own bound, checked by every tool handler before it touches the graph.
func (s *Server) waitReady(ctx context.Context) error {
	select {
	case <-s.ready:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(readyTimeout):
		return fmt.Errorf("repo-map index for %s is still building (initial sync running past %s) — retry shortly", s.root, readyTimeout)
	}
}

// RepoID returns the repository identity this Server was constructed for.
func (s *Server) RepoID() string { return s.repoID }

// Root returns the repository's worktree root.
func (s *Server) Root() string { return s.root }

// Token returns the plaintext token (empty unless this construction — or a subsequent SetToken —
// actually minted a fresh one; a hash cannot be reversed, §0 D8) and whether one is currently held.
func (s *Server) Token() (plain string, minted bool) {
	s.tokenMu.RLock()
	defer s.tokenMu.RUnlock()
	return s.tokenPlain, s.tokenMinted
}

// SetToken replaces this instance's own live auth record — bridge.RepoMapService's Regenerate
// action (§0 D8's restart-recovery path), safe to call while requests are in flight: the very next
// request to arrive is checked against the new record, never a stale in-memory copy.
func (s *Server) SetToken(rec mcpauth.Record, plain string) {
	s.tokenMu.Lock()
	defer s.tokenMu.Unlock()
	s.token = rec
	s.tokenPlain = plain
	s.tokenMinted = true
}

// Close stops the HTTP listener, the watcher, the index and the store, releasing the sync lock if
// still held. Idempotent.
func (s *Server) Close() error {
	var err error
	s.closeOnce.Do(func() {
		s.cancel()
		err = s.closeHTTP()
		if s.watcher != nil {
			_ = s.watcher.Close()
		}
		s.lockMu.Lock()
		lock := s.lock
		s.lock = nil
		s.lockMu.Unlock()
		if lock != nil {
			lock.Release()
		}
		s.idx.Close()
		_ = s.store.Close()
	})
	return err
}
