// Package dbmcp is the local DB MCP server (docs/v1.7/plans/M1-db-mcp-server-core.md): a protocol
// front end that lists this app's own connections, browses their metadata and runs a query —
// through the existing adapter layer (internal/adapterhost, internal/tree, internal/connections),
// never a parallel path. Transport is go-sdk/mcp over a loopback-only Streamable HTTP listener
// (DefaultPort 8766), with mcpauth minting and verifying its own bearer token and its own token
// file, independent of the rest of the app beyond KIRA_HOME itself.
//
// There is no headless binary: the DB server needs the app's own live adapters, keychain-backed
// secrets and op-log/throttle/cancel machinery (§3.1), none of which a second process could reach
// without duplicating them. It runs when Kira Studio runs, embedded only (internal/bridge/dbmcp.go).
//
// This package imports nothing from internal/bridge (internal/layering_test.go enforces it).
package dbmcp

import (
	"context"
	"fmt"
	"log/slog"
	"runtime/debug"
	"sync"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapterhost"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/config"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/mask"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/mcpauth"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/tree"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// DefaultPort is the port this instance tries first (§3.2); a second instance on one machine
// (there is at most one per KIRA_HOME in practice) falls back to an OS-assigned ephemeral one
// automatically (http.go).
const DefaultPort = 8766

// TokenProvider resolves this instance's own 7-day-rotating token — no repo-id slug to key on: one
// DB MCP instance exists per app process per KIRA_HOME, with no second identity to key several
// apart by (§2.2).
type TokenProvider func() (rec mcpauth.Record, plain string, minted bool, err error)

// ConnectionsReader is dbmcp's own consumer-declared interface (A11) over *connections.Service —
// only the three methods list_connections/access.go/run_query actually need.
type ConnectionsReader interface {
	List() ([]model.ConnectionSummary, error)
	StateOf(connectionID string) model.ConnectionState
	Connect(connectionID string) (model.ConnectionState, error)
}

// MetadataReader is dbmcp's own consumer-declared interface over *tree.Service — list_children/
// describe_table/describe_schema's own backend.
type MetadataReader interface {
	Children(connectionID, path string, refresh bool) (tree.ChildrenResult, error)
	Describe(connectionID, path string, refresh bool, tabID *string) (tree.DescribeResult, error)
	SchemaColumns(connectionID, path string, refresh bool) (tree.SchemaColumnsResult, error)
}

// QueryRunner is dbmcp's own consumer-declared interface over *adapterhost.Router's Execute and
// ClassifyStatement seams — run_query's only path into the adapter layer, the same one the
// console's own run() uses.
type QueryRunner interface {
	Execute(ctx context.Context, req adapterhost.ExecuteRequestWire) (adapterhost.ExecuteResponse, error)
	// ClassifyStatement answers what one statement would do (M2's permission gate) — an adapter
	// error (or one that does not implement adapters.StatementClassifier) yields ClassUnknown, never
	// a fatal error the caller must special-case.
	ClassifyStatement(ctx context.Context, connectionID, statement string) (adapters.OpClass, error)
}

// MaskRules is dbmcp's own consumer-declared interface over *maskrules.Service (M5 §4.6). A nil
// Config.MaskRules is a construction error, not a default (New rejects it, the same way it rejects
// a nil Approvals): a silently-nil masker would mean every query returns unmasked data with
// nothing surfacing, exactly the failure mode ExplainThreshold's own comment above guards against
// for a different field.
type MaskRules interface {
	// MaskSetFor is run_query's render path's own seam (§4.2/§4.3) — the folded, per-column-name
	// rule map plus the connection's Masker.
	MaskSetFor(connectionID string) (mask.Set, error)
	// List is list_connections' own seam (§4.5) — the raw per-rule rows (table_name included,
	// unlike MaskSetFor's already-folded map) needed to report "table.column: kind" per rule.
	List(connectionID string) ([]model.MaskRule, error)
}

// Config is everything New needs. Zero-value Home takes the documented default; every other field
// is required.
type Config struct {
	// Home overrides KIRA_HOME (a debugging seam) — empty means config.KiraHome().
	Home string
	// Token resolves this instance's own auth record — required.
	Token TokenProvider
	// Conns/Tree/Query are the three backend seams (§3.3) — *connections.Service, *tree.Service and
	// *adapterhost.Router satisfy these structurally once Router.Execute exists.
	Conns ConnectionsReader
	Tree  MetadataReader
	Query QueryRunner
	// Approvals is the prompt-mode broker (M2 §5) — required, constructed once in main.go and
	// outliving Server start/stop so the event subscription wired at boot stays valid across a
	// server restart.
	Approvals *ApprovalBroker
	// MaskRules resolves a connection's own masking rules and correlation key (M5 §4.6) — required.
	MaskRules MaskRules
	// ExplainThreshold is the expensive-query row threshold (advanced.expensiveQueryRows) — read
	// fresh on every call, never cached: a stale threshold silently mis-flags every query after the
	// user changes it. A plain func rather than an interface, gitsession.Registry.Settings's own
	// seam, so this package keeps its existing backends and adds no new service dependency.
	// Required — a silently-defaulted threshold would make every heavy-query verdict wrong in a
	// way nothing surfaces.
	ExplainThreshold func() int
	// Logger receives every operational log line. A nil Logger falls back to slog.Default().
	Logger *slog.Logger
}

// Server is the DB MCP server's one embedded instance — no index to build, so it needs no
// readiness gate, sync lock or watcher (§3.3): New binds and returns, Close shuts the listener
// down.
type Server struct {
	cfg Config
	log *slog.Logger

	// tokenMu guards token/tokenPlain/tokenMinted: Regenerate (bridge.DbMcpService's own
	// restart-recovery action) mutates these on a live, already-serving instance, concurrently with
	// tokenVerifier reading them on every in-flight request (http.go).
	tokenMu     sync.RWMutex
	token       mcpauth.Record
	tokenPlain  string
	tokenMinted bool

	mcp *mcp.Server

	httpState // http.go's own fields (listener, *http.Server)

	closeOnce sync.Once
}

// serverVersion mirrors the app's own declared version — no ldflags plumbing invented for this
// phase alone.
const serverVersion = "0.0.0"

// instructions is §4's own one paragraph: the steer that decides whether any of this pays off.
const instructions = "These tools read and query the databases configured in this Kira Studio app. Only connections the user has explicitly exposed are visible; start with `list_connections`. Walk structure with `list_children`, passing back a `path` it returned — levels differ per engine, so do not assume a database or schema level exists. `describe_schema` gets every relation's columns in one call and is cheaper than one `describe_table` per table. `run_query` runs one statement through the same path the app's own SQL console uses, against the connection's own permissions; results are capped and say so when truncated. Every query appears in the user's Operations panel. Each `list_connections` entry's `permissions` object names its read/write/DDL mode (deny, allow or prompt) and its `description`, when set, says what the connection is for — read both before calling `run_query`. Plan an expensive-looking query with `explain_query` before running it, and expect `run_query` to plan it anyway on connections whose owner turned auto-explain on. A connection with masked columns lists them in `list_connections`' own `maskedColumns` field, as \"table.column: kind\" — a masked cell's value is redacted (never the real value), and a trailing `#TAG` is an opaque correlation token, never a literal part of the value: equal values always share a tag, but the tag is short enough that two distinct values can rarely share one too, so treat a tag match as a strong hint toward equality, not proof of it."

// New resolves cfg, mints or loads this instance's own token, builds the five-tool mcp.Server, and
// binds the HTTP listener (§3.2's default-then-fallback port selection) — but does not yet accept
// connections; call Serve for that.
func New(cfg Config) (*Server, error) {
	if cfg.Home == "" {
		cfg.Home = config.KiraHome()
	}
	log := cfg.Logger
	if log == nil {
		log = slog.Default()
	}
	if cfg.Token == nil {
		return nil, fmt.Errorf("dbmcp: Config.Token is required")
	}
	if cfg.Conns == nil || cfg.Tree == nil || cfg.Query == nil {
		return nil, fmt.Errorf("dbmcp: Config.Conns, Config.Tree and Config.Query are required")
	}
	if cfg.Approvals == nil {
		return nil, fmt.Errorf("dbmcp: Config.Approvals is required")
	}
	if cfg.MaskRules == nil {
		return nil, fmt.Errorf("dbmcp: Config.MaskRules is required")
	}
	if cfg.ExplainThreshold == nil {
		return nil, fmt.Errorf("dbmcp: Config.ExplainThreshold is required")
	}

	tokenRec, tokenPlain, tokenMinted, err := cfg.Token()
	if err != nil {
		return nil, fmt.Errorf("dbmcp: resolve token: %w", err)
	}

	s := &Server{
		cfg:         cfg,
		log:         log,
		token:       tokenRec,
		tokenPlain:  tokenPlain,
		tokenMinted: tokenMinted,
	}
	s.mcp = s.buildMCPServer()

	if err := s.bindHTTP(); err != nil {
		return nil, err
	}
	return s, nil
}

// buildMCPServer constructs the five-tool mcp.Server (§4) — pure registration, no I/O of its own;
// every handler closes over s and calls into s.cfg.Conns/Tree/Query through access.go's gates.
func (s *Server) buildMCPServer() *mcp.Server {
	srv := mcp.NewServer(&mcp.Implementation{
		Name:    "kira-db",
		Title:   "Kira Studio databases",
		Version: serverVersion,
	}, &mcp.ServerOptions{Instructions: instructions})

	mcp.AddTool(srv, &mcp.Tool{
		Name:        "list_connections",
		Description: "List every database connection this app has exposed to MCP, with its kind, read-only flag, live status and (once connected) capabilities.",
	}, withPanicRecovery(s, "list_connections", s.listConnections))
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "list_children",
		Description: "List one container's own children — databases, schemas, tables, keys, topics, buckets, whatever this connection's own engine has at that level. Omit path for the connection's top level.",
	}, withPanicRecovery(s, "list_children", s.listChildren))
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "describe_table",
		Description: "Describe one table, view or collection's own columns, primary key, foreign keys, indexes and row estimate.",
	}, withPanicRecovery(s, "describe_table", s.describeTable))
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "describe_schema",
		Description: "Describe every table and view's columns in one database or schema in a single call — cheaper than one describe_table call per table.",
	}, withPanicRecovery(s, "describe_schema", s.describeSchema))
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "run_query",
		Description: "Run one statement (not a script — one statement per call) against a connection, through the same path the app's own SQL console uses. Connects the connection if it is not already connected. Results are capped by maxRows; the query itself still runs in full. Each connection's read/write/DDL permission is checked first: a denied class is refused, and a class set to prompt waits for the user to approve it, which can take up to two minutes. On a connection whose owner turned auto-explain on, an explainable SELECT/WITH is planned first — a plan estimated over the connection owner's expensive-query threshold pauses the query for approval the same way a prompt-mode permission does.",
	}, withPanicRecovery(s, "run_query", s.runQuery))
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "explain_query",
		Description: "Plan one SELECT or WITH statement without running it, and return the normalized plan: the node tree, each node's estimated rows and native cost, and the structural issues this app detects (full scans, unused indexes, filesorts). Not available on mongodb, redis, kafka, s3 or sqs. Metric order within a node is not contractual; pass includeRaw for the server's own text.",
	}, withPanicRecovery(s, "explain_query", s.explainQuery))

	return srv
}

// withPanicRecovery wraps every MCP tool handler mcp.AddTool registers (F7): go-sdk v1.8.0 runs
// each request in its own goroutine with no recover() anywhere in the module, so an unguarded nil
// deref or index panic in any handler — render.go scanning client SQL, queryplan parsing server
// EXPLAIN output, a mask transform, a tree.Service call — kills the whole desktop app, including
// every open editor and terminal, from an authenticated local client. Generic over the handler's
// own args type so every tool shares one wrapper rather than six hand-duplicated ones; every
// handler here returns `any` as its result type (tools.go), so that half is fixed. The recovered
// message never repeats the panic value: on a masked connection it could carry a row's own data
// (mirrors maskedToolError's posture) — only the stack goes to the log.
func withPanicRecovery[In any](s *Server, name string, h func(context.Context, *mcp.CallToolRequest, In) (*mcp.CallToolResult, any, error)) func(context.Context, *mcp.CallToolRequest, In) (*mcp.CallToolResult, any, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, in In) (res *mcp.CallToolResult, out any, err error) {
		defer func() {
			if r := recover(); r != nil {
				s.log.Error("dbmcp: tool handler panicked", "tool", name, "panic", fmt.Sprintf("%v", r), "stack", string(debug.Stack()))
				res, out, err = errResult("internal error handling this tool call")
			}
		}()
		return h(ctx, req, in)
	}
}

// Token returns the plaintext token (empty unless this construction — or a subsequent SetToken —
// actually minted a fresh one; a hash cannot be reversed) and whether one is currently held.
func (s *Server) Token() (plain string, minted bool) {
	s.tokenMu.RLock()
	defer s.tokenMu.RUnlock()
	return s.tokenPlain, s.tokenMinted
}

// TokenExpiry returns the currently-held record's own expiry instant (zero for a record that has
// not yet been stamped — see mcpauth.LoadOrMintTTL).
func (s *Server) TokenExpiry() time.Time {
	s.tokenMu.RLock()
	defer s.tokenMu.RUnlock()
	return s.token.ExpiresAt
}

// SetToken replaces this instance's own live auth record — bridge.DbMcpService's Regenerate
// action, safe to call while requests are in flight: the very next request is checked against the
// new record, never a stale in-memory copy.
func (s *Server) SetToken(rec mcpauth.Record, plain string) {
	s.tokenMu.Lock()
	defer s.tokenMu.Unlock()
	s.token = rec
	s.tokenPlain = plain
	s.tokenMinted = true
}

// Close shuts the HTTP listener down. Idempotent.
func (s *Server) Close() error {
	var err error
	s.closeOnce.Do(func() {
		err = s.closeHTTP()
	})
	return err
}
