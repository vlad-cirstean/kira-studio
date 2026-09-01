// Package adapters is the Go analogue of src/engine/adapters/: the Adapter contract every engine
// implements, the Caps declaration the UI reads instead of a kind check, the closed error-code set
// the renderer branches on, and the two dialect-agnostic SQL helpers four adapters share.
//
// Rules that hold for every adapter, present and future:
//
//  1. An adapter imports nothing from github.com/wailsapp/wails, nothing from internal/bridge and
//     nothing from internal/shell. It is a plain Go package — this is what makes the per-engine
//     tests able to drive it directly and what keeps the adapter layer shell-agnostic.
//     (adapter.ts's rule 1 said "imports nothing from electron", against the shell of its day.)
//  2. Every method that talks to the server takes a context.Context and honours cancellation. A
//     method that ignores ctx.Done() is a bug even if the underlying driver "is fast".
//  3. op.SetCommand() is called before the statement is issued, not after it returns — an op that
//     is cancelled mid-flight must still show what it was running.
//  4. Errors are *adapters.Error with a code from the closed set and the server's own message
//     verbatim in Message. Wrapping starts and ends there.
//  5. Children() returns an empty slice for a leaf, never an error.
//  6. An adapter is single-connection. One instance <-> one connections row. live.go owns the map.
//  7. Read() and Count() obey the same identifier rule as the catalog code, via quoteIdent. Every
//     identifier they emit came out of a catalog query in the same op.
//  8. A page is built with internal/page's builders. There is one codec.
package adapters

import (
	"context"
	"sync"

	"github.com/kirathecat/kira-studio/shell/internal/page"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

// Adapter is the Go analogue of adapter.ts's Adapter interface, method for method.
type Adapter interface {
	Kind() string
	Caps() Caps

	Connect(ctx context.Context, cfg model.ResolvedConnectionConfig, op *OpCtx) (ConnectInfo, error)
	Disconnect(ctx context.Context) error

	// Children returns one lazy tree level. path.Segments is empty for the connection root.
	Children(ctx context.Context, path model.NodePath, op *OpCtx) (TreeChildren, error)

	// Describe returns columns, PK, FK, inbound FK, and indexes for one object. Feeds the L1 cache.
	Describe(ctx context.Context, path model.NodePath, op *OpCtx) (model.ObjectMeta, error)

	// Definition returns the object's definition: executable statements for a SQL engine, a JSON
	// document for Mongo. Gated by Caps().Definition.
	Definition(ctx context.Context, path model.NodePath, op *OpCtx) (model.ObjectDefinition, error)

	// Cancel forwards a cancel for an in-flight op to the server. Reports false when the op was
	// unknown or the server refused; never an error for "already finished". An adapter with
	// Caps().Cancel == false reports false unconditionally.
	Cancel(ctx context.Context, opID string) (bool, error)

	// Read returns one page of rows. Shape depends on Caps().DefaultPageKind.
	Read(ctx context.Context, req ReadRequest, op *OpCtx) (page.Page, error)

	// Count returns a row count. Exact is false when the adapter can only estimate
	// (Caps().ExactCount == false).
	Count(ctx context.Context, req CountRequest, op *OpCtx) (CountResult, error)

	// Preview never executes and never touches the network (P5 D6). It returns an error rather
	// than panicking, so a malformed plan is a failed op and not a recovered panic (P58 D16).
	// Gated by Caps().Writable.
	Preview(plan model.MutationPlan) ([]string, error)

	// Mutate commits a pending-change set: fresh catalog validation in this same op (mirrors
	// resolveProjection's discipline), delete/update/insert in that order, one transaction, one
	// op-log row. Returns E_UNSUPPORTED if the connection is read-only. Gated by Caps().Writable.
	Mutate(ctx context.Context, plan model.MutationPlan, op *OpCtx) (model.MutationResult, error)

	// Execute runs every statement in req.Statements in order over one connection, one op-log row
	// for the whole batch (op.SetCommand called once). All-or-nothing — a mid-batch failure fails
	// the whole call; there is no partial-results-with-per-statement-error shape. One Page per
	// statement, in order. Gated by Caps().SQL.
	Execute(ctx context.Context, req model.ConsoleRequest, op *OpCtx) ([]page.Page, error)

	// DownloadObject streams one object's bytes into req.DestPath. A read — never blocked by the
	// connection's read-only flag. Gated by Caps().FileTransfer; every adapter with that flag
	// false returns E_UNSUPPORTED. Honours ctx mid-stream and leaves no file behind on
	// cancellation or failure.
	DownloadObject(ctx context.Context, req model.ObjectDownloadRequest, op *OpCtx) (model.ObjectTransferResult, error)
}

// Deps is the Go analogue of adapter.ts's AdapterDeps.
type Deps struct {
	Log func(level, message string) // "info" | "warn" | "error"
}

// ConnectInfo is the Go analogue of adapter.ts's ConnectInfo.
type ConnectInfo struct {
	ServerVersion string            `json:"serverVersion"`
	Details       map[string]string `json:"details,omitempty"`
}

// ReadRequest is the Go analogue of adapter.ts's ReadRequest.
type ReadRequest struct {
	Path       model.NodePath
	Projection []string // nil = every column
	Filter     *string
	Sort       *model.SortSpec
	PageSize   int // already validated <= page.MaxPageSize at the dispatcher boundary
	Cursor     model.PageCursor
}

// CountRequest is the Go analogue of adapter.ts's CountRequest.
type CountRequest struct {
	Path   model.NodePath
	Filter *string
}

// CountResult is the Go analogue of adapter.ts's count() return shape.
type CountResult struct {
	Value int64
	Exact bool
}

// TreeChildren carries P43 iter2 D21's optional truncation flag: Truncated is true only when the
// adapter hit its own round budget with more still to come. A pointer, not a bool, so the eight
// adapters that cannot truncate say nothing rather than saying false eight times.
type TreeChildren struct {
	Nodes     []model.TreeNode
	Truncated *bool
}

// Progress is the Go analogue of adapter.ts's Progress.
type Progress struct {
	Message string
	Done    *int
	Total   *int
}

// OpCtx is the op-scoped half of scheduler/ops.ts's RunOpCtx. Cancellation is not here — that is
// the context.Context every Adapter method already takes. The mutex is not decorative: a driver
// callback may call SetCommand from a goroutine other than the one running the op (postgres's
// console batch does).
type OpCtx struct {
	OpID       string
	OnProgress func(Progress)

	mu      sync.Mutex
	command string
	rows    *int
}

// NewOpCtx constructs an OpCtx for opID.
func NewOpCtx(opID string) *OpCtx {
	return &OpCtx{OpID: opID}
}

// SetCommand records the exact statement about to run (Adapter rule 3).
func (c *OpCtx) SetCommand(text string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.command = text
}

// SetRows records the number of rows an operation touched, for the op-log.
func (c *OpCtx) SetRows(n int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.rows = &n
}

// Command returns the most recently set command text.
func (c *OpCtx) Command() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.command
}

// Rows returns the most recently set row count, or nil if none was ever set.
func (c *OpCtx) Rows() *int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.rows
}
