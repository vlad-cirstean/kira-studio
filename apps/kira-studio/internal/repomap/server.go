// Package repomap is the repo-map MCP server (docs/v1.5/plans/C3-mcp-repo-map-server.md): a
// protocol front end over C2's codegraph.Graph, served over MCP's Streamable HTTP transport (§0
// D1's correction) to however many clients call in concurrently — never stdio, which ties one
// process to one client by construction. One Server value is one listener, one token and N attached
// repositories (docs/v1.6/plans/P67d-repo-map-settings-toggle.md §2's D1: multi-repository support
// was C3's own declared out-of-scope, closed by that phase) — every navigation tool takes an
// optional `repo` argument (attach.go's pick) naming which attached repository to query.
//
// This package imports nothing from internal/bridge (internal/layering_test.go enforces it): both
// the headless binary (cmd/kira-repo-map) and the embedded instance (internal/bridge/repomap.go,
// started from within the running Kira Studio app) construct a Server the same way, then Attach
// whichever repositories they mean to serve.
package repomap

import (
	"log/slog"
	"runtime"
	"sync"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codeindex"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/config"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/mcpauth"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// initialSyncSemCapacity sizes initialSyncSem proportionate to the machine (P69 review, finding
// 1c) rather than a hardcoded 1: each Sync's own worker pool already caps parse concurrency at
// min(NumCPU, 4) (codeindex/sync.go's syncWorkers), so allowing roughly NumCPU/4 concurrent Syncs
// bounds total concurrent parse workers to roughly NumCPU overall instead of either serializing
// every repository's index one after another (capacity 1) or letting N repositories multiply the
// per-Sync cap by N with no bound at all.
func initialSyncSemCapacity() int {
	if n := runtime.NumCPU() / 4; n > 1 {
		return n
	}
	return 1
}

// readyTimeout bounds every tool call's own wait on an instance's readiness gate (instance.go) —
// never an empty result while the index is still building, and never a hang past this bound either.
// A var, not a const (gitclient/runner.go's own gracefulStopDelay precedent): a test lowers it so
// proving the timeout path doesn't cost 25s of real wall-clock time.
var readyTimeout = 25 * time.Second

// DefaultPort is the port every Server tries first (http.go); a second instance on one machine
// falls back to an OS-assigned ephemeral one automatically.
const DefaultPort = 8765

// Config is everything New needs to open the shared store, build the tool set and bind the
// listener. Zero-value fields take the documented default. New no longer resolves a repository —
// that is Attach/AttachDir's own job (P67d §3.2), called any number of times after New returns.
type Config struct {
	// Home overrides KIRA_HOME (a debugging seam) — empty means config.KiraHome().
	Home string
	// Token/TokenPlain seed this Server's own auth record — both may be zero/empty: the verifier is
	// fail-closed until SetToken is called (mirrors a Server constructed before any repository is
	// attached). TokenPlain is "" when no plaintext is held (a loaded, not minted, record) —
	// Token()'s own `minted` return is derived from this at construction, exactly as it is after a
	// later SetToken.
	Token      mcpauth.Record
	TokenPlain string
	// Logger receives every operational log line, stderr-bound by convention. A nil Logger falls
	// back to slog.Default().
	Logger *slog.Logger
}

// Server is the repo-map MCP server's own transport: one bearer token, one HTTP listener, the
// eight-tool mcp.Server, and the registry of every currently-attached repository (instance.go,
// attach.go). Token policy is entirely the caller's (bridge.RepoMapService, cmd/kira-repo-map's own
// main) — New never mints or loads one itself.
type Server struct {
	home string
	log  *slog.Logger

	store *codeindex.Store // one per Server, shared by every attached instance — never one per repo

	// tokenMu guards token/tokenPlain/tokenMinted: Regenerate (bridge.RepoMapService's own restart-
	// recovery action) mutates these on a live, already-serving instance, concurrently with
	// tokenVerifier reading them on every in-flight request (http.go).
	tokenMu     sync.RWMutex
	token       mcpauth.Record
	tokenPlain  string
	tokenMinted bool

	// reposMu guards repos/order — attach.go's own Attach/Detach/Rekey/Repos/pick.
	reposMu sync.RWMutex
	repos   map[string]*repoInstance
	order   []string // attach order, for a stable list_repos/Repos()

	// initialSyncSem bounds how many repositories' own full Sync — an initial Sync
	// (attach.go's Attach, runInitialSync) or a watcher-triggered rescan Sync (codeindex/watch.go's
	// own fire) — run at once, process-wide (P68 review, performance finding 3a; P69 review,
	// finding 1d: a rescan Sync is the identical multi-second full pass an initial Sync is, so it
	// is gated by this same semaphore too, not exempt from it). codeindex/sync.go's own
	// syncWorkers() already caps ONE Sync's own parse concurrency at min(NumCPU, 4); this bounds
	// how many Syncs can be doing that at once. Capacity is proportionate to the machine
	// (max(1, NumCPU/4)) rather than a hardcoded 1 (P69 review, finding 1c) — a hardcoded 1 pinned
	// multi-repo cold boot to 25% of a 16-core machine while fully serializing every repository's
	// index one after another. The semaphore wraps only the actual Sync call, never the
	// cross-process flock wait ahead of it (instance.go's runInitialSync) — P69 review finding 1a:
	// a repository doing zero CPU work while just waiting on another process's lock must never
	// hold this slot idle for however long that wait takes.
	initialSyncSem chan struct{}

	// detachWG counts Detach's own asynchronous drain goroutines (attach.go) — Close joins them.
	detachWG sync.WaitGroup

	mcp *mcp.Server

	httpState // http.go's own fields (listener, *http.Server) — split out for that file's own cohesion

	closeOnce sync.Once
}

// New opens the shared codeindex.Store, builds the eight-tool mcp.Server, and binds the HTTP
// listener (default-then-fallback port selection, http.go) — but does not yet accept connections;
// call Serve to do that, and Attach/AttachDir to make any repository actually servable. Returns as
// soon as the listener is bound, deliberately: an MCP client's own initialize must answer in
// milliseconds, well before any repository's own initial Sync could finish on a cold cache.
func New(cfg Config) (*Server, error) {
	home := cfg.Home
	if home == "" {
		home = config.KiraHome()
	}
	log := cfg.Logger
	if log == nil {
		log = slog.Default()
	}

	store := codeindex.OpenStoreAt(home)

	s := &Server{
		home:           home,
		log:            log,
		store:          store,
		token:          cfg.Token,
		tokenPlain:     cfg.TokenPlain,
		tokenMinted:    cfg.TokenPlain != "",
		repos:          make(map[string]*repoInstance),
		initialSyncSem: make(chan struct{}, initialSyncSemCapacity()),
	}

	s.mcp = s.buildMCPServer()

	if err := s.bindHTTP(); err != nil {
		_ = store.Close()
		return nil, err
	}

	return s, nil
}

// serverVersion mirrors the app's own declared version (build/config.yml) — no ldflags plumbing
// invented for this phase alone.
const serverVersion = "0.0.0"

// instructions is the one steer that decides whether any of this pays off.
const instructions = "These tools answer navigation questions from a pre-built index; prefer them to opening a file to find a definition. Several repositories may be attached — pass `repo` to name one; call list_repos first if you're unsure which are available, or when the only-one-attached default might resolve the wrong one. Positions are 1-based lines; a column, where given, is a 1-based byte column. Each hit is followed by its own line of source, indented, read from the file at that position and truncated at 512 bytes with a trailing `…`; `[stale]` marks a file changed since it was indexed, `[no source: …]` a line that could not be read. Pass `omitSource` to drop them. Results are name-resolved, not type-resolved, and each carries its own confidence and the rule that produced it."

// buildMCPServer constructs the eight-tool mcp.Server — pure registration, no I/O of its own; every
// handler resolves an attached repository via pick (attach.go) before touching its graph/store.
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
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "read_symbol",
		Description: "Read a symbol's own declaration source — its exact extent from the index, not a guessed window. Prefer it to opening the file when you need one function, type or component.",
	}, s.readSymbol)
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "list_repos",
		Description: "List the repositories this server can query, with the name to pass as `repo`.",
	}, s.listRepos)

	return srv
}

// Token returns the plaintext token (empty unless this construction — or a subsequent SetToken —
// actually holds one; a hash cannot be reversed) and whether one is currently held.
func (s *Server) Token() (plain string, minted bool) {
	s.tokenMu.RLock()
	defer s.tokenMu.RUnlock()
	return s.tokenPlain, s.tokenMinted
}

// TokenExpiry returns the currently-held record's own expiry instant (zero for a pre-M1 record
// that has not yet been stamped by a load — see mcpauth.LoadOrMintTTL).
func (s *Server) TokenExpiry() time.Time {
	s.tokenMu.RLock()
	defer s.tokenMu.RUnlock()
	return s.token.ExpiresAt
}

// SetToken replaces this Server's own live auth record — bridge.RepoMapService's Regenerate
// action (§0 D8's restart-recovery path), safe to call while requests are in flight: the very next
// request to arrive is checked against the new record, never a stale in-memory copy.
func (s *Server) SetToken(rec mcpauth.Record, plain string) {
	s.tokenMu.Lock()
	defer s.tokenMu.Unlock()
	s.token = rec
	s.tokenPlain = plain
	s.tokenMinted = true
}

// Close stops the HTTP listener, then drains and closes every attached instance, then the shared
// store. Idempotent.
func (s *Server) Close() error {
	var err error
	s.closeOnce.Do(func() {
		err = s.closeHTTP()

		s.reposMu.Lock()
		insts := make([]*repoInstance, 0, len(s.order))
		for _, k := range s.order {
			insts = append(insts, s.repos[k])
		}
		s.repos = make(map[string]*repoInstance)
		s.order = nil
		s.reposMu.Unlock()

		for _, inst := range insts {
			close(inst.done)
			inst.inflight.Wait()
			inst.close()
		}

		s.detachWG.Wait()

		_ = s.store.Close()
	})
	return err
}
