package sqlite

import (
	"context"
	"database/sql"
	"sync"

	"github.com/kirathecat/kira-studio/shell/internal/adapters"
	"github.com/kirathecat/kira-studio/shell/internal/page"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

func init() {
	adapters.Register("sqlite", func(deps adapters.Deps) (adapters.Adapter, error) {
		return &Adapter{deps: deps}, nil
	})
}

// Adapter is index.ts's SqliteAdapter — P35 D17/D18: stands alone, no "family" pattern (that
// exists in mysqlfamily/ because two engines share one wire protocol and one driver, P34 D7).
// SQLite shares neither with anything.
type Adapter struct {
	deps adapters.Deps

	db       *sql.DB
	file     string
	readOnly bool

	mu          sync.Mutex
	runningByOp map[string]context.CancelFunc

	// inFlight mirrors postgres's and mysqlfamily's own field of the same name: it counts
	// runOnConn's own background goroutines that are still touching a *sql.Conn after RunWithAbortRace
	// has already returned to its caller (a local op abort must not itself kill the query — B8's
	// own point is the opposite direction of B6/B14, but the underlying race is identical: closing
	// a connection while a goroutine is still using it is a data race regardless of which adapter).
	inFlight sync.WaitGroup
}

func (a *Adapter) Kind() string        { return "sqlite" }
func (a *Adapter) Caps() adapters.Caps { return caps }

// Connect is index.ts's connect.
func (a *Adapter) Connect(_ context.Context, cfg model.ResolvedConnectionConfig, op *adapters.OpCtx) (adapters.ConnectInfo, error) {
	path, err := resolveFilePath(cfg)
	if err != nil {
		return adapters.ConnectInfo{}, err
	}
	if err := assertFileExists(path); err != nil {
		return adapters.ConnectInfo{}, err
	}

	db, err := sql.Open("sqlite", buildDSN(path, cfg.ReadOnly))
	if err != nil {
		return adapters.ConnectInfo{}, mapError(err)
	}
	db.SetMaxOpenConns(1)

	// P13 D1: assigned before anything is opened, not after the probe succeeds — the handle must
	// be reachable by Disconnect from the instant sql.Open's own lazy dial could happen.
	a.db = db
	a.file = path
	a.readOnly = cfg.ReadOnly

	conn, err := db.Conn(context.Background())
	if err != nil {
		_ = a.Disconnect(context.Background())
		return adapters.ConnectInfo{}, mapError(err)
	}
	defer conn.Close()

	// The file-format check is lazy, not eager (opening a garbage file succeeds silently and only
	// fails on first real statement) — this probe is what makes a bad-format file surface as
	// E_CONNECT during connect(), not later on the first tree expansion.
	var version string
	found := false
	err = runRows(context.Background(), conn, "SELECT sqlite_version() AS version", nil, op, false, func(r *sql.Rows) error {
		found = true
		return r.Scan(&version)
	})
	if err != nil {
		_ = a.Disconnect(context.Background())
		return adapters.ConnectInfo{}, err
	}
	if !found {
		_ = a.Disconnect(context.Background())
		return adapters.ConnectInfo{}, adapters.New(adapters.CodeConnect, "connect probe returned no rows", nil)
	}

	// D6: read-only pragma reads for the connection tooltip — never written by this adapter.
	var journalMode string
	_ = runRows(context.Background(), conn, "PRAGMA journal_mode", nil, op, false, func(r *sql.Rows) error {
		return r.Scan(&journalMode)
	})
	var pageSize int
	_ = runRows(context.Background(), conn, "PRAGMA page_size", nil, op, false, func(r *sql.Rows) error {
		return r.Scan(&pageSize)
	})

	details := map[string]string{"file": path, "journalMode": journalMode}
	if pageSize > 0 {
		details["pageSize"] = itoaPositive(pageSize)
	}
	return adapters.ConnectInfo{ServerVersion: "SQLite " + version, Details: details}, nil
}

func itoaPositive(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}

// Disconnect is index.ts's disconnect.
func (a *Adapter) Disconnect(context.Context) error {
	// Every runOnConn background goroutine still touching a connection must actually stop before
	// the *sql.DB is closed (see inFlight's own doc comment).
	a.inFlight.Wait()
	if a.db != nil {
		if err := a.db.Close(); err != nil {
			a.deps.Log("warn", "sqlite disconnect: "+err.Error())
		}
	}
	a.db = nil
	a.file = ""
	a.mu.Lock()
	a.runningByOp = nil
	a.mu.Unlock()
	return nil
}

// runOnConn is the cancellation design B8/P58 D8 exists for: every statement runs on a context the
// adapter owns, derived from Background rather than from the op's own ctx. adapterhost.Host.CancelOp
// cancels the op context first (unblocking the caller immediately) and then calls Cancel(opID) —
// and only that second step may reach the statement, or "cancelled" would mean "we stopped
// waiting", not "the server actually stopped". modernc.org/sqlite's own interruptOnDone semantics
// turn cancelling driverCtx into a real sqlite3_interrupt on this op's own dedicated *sql.Conn, so
// it can only ever reach the statement it was aimed at (P58 D8's third part: a conn per op, not a
// shared pinned one — mysqlfamily's and postgres's own dedicated connection is pinned per adapter
// instance instead, since their cancellation goes through a side connection, not sqlite3_interrupt).
func runOnConn[T any](ctx context.Context, a *Adapter, opID string, fn func(context.Context, *sql.Conn) (T, error)) (T, error) {
	var zero T
	if a.db == nil {
		return zero, adapters.New(adapters.CodeConnect, "adapter is not connected", nil)
	}
	conn, err := a.db.Conn(ctx)
	if err != nil {
		return zero, mapError(err)
	}

	driverCtx, cancel := context.WithCancel(context.Background())
	a.mu.Lock()
	if a.runningByOp == nil {
		a.runningByOp = make(map[string]context.CancelFunc)
	}
	a.runningByOp[opID] = cancel
	a.mu.Unlock()
	a.inFlight.Add(1)

	return adapters.RunWithAbortRace(ctx, func() {
		// release: called exactly once, whenever fn actually settles — not merely when ctx fires
		// (RunWithAbortRace's own contract) — so the connection is never closed out from under a
		// goroutine that is still using it, even when the caller's own ctx won the race.
		cancel()
		a.mu.Lock()
		delete(a.runningByOp, opID)
		a.mu.Unlock()
		_ = conn.Close()
		a.inFlight.Done()
	}, func(context.Context) (T, error) {
		return fn(driverCtx, conn)
	})
}

// Cancel is index.ts's cancel — B8's second half. caps.Cancel is true because this actually
// interrupts a running statement, a change from the TypeScript adapter, whose node:sqlite had no
// sqlite3_interrupt at all (P58 D8).
func (a *Adapter) Cancel(_ context.Context, opID string) (bool, error) {
	a.mu.Lock()
	cancel, ok := a.runningByOp[opID]
	delete(a.runningByOp, opID)
	a.mu.Unlock()
	if !ok {
		return false, nil
	}
	cancel()
	return true, nil
}

// Children is index.ts's children.
func (a *Adapter) Children(ctx context.Context, path model.NodePath, op *adapters.OpCtx) (adapters.TreeChildren, error) {
	return runOnConn(ctx, a, op.OpID, func(driverCtx context.Context, conn *sql.Conn) (adapters.TreeChildren, error) {
		segments := path.Segments
		exec := execFor(driverCtx, conn, op)

		if len(segments) == 0 {
			nodes, err := listDatabases(exec)
			if err != nil {
				return adapters.TreeChildren{}, err
			}
			return adapters.TreeChildren{Nodes: nodes}, nil
		}

		databaseSegment := segments[0]
		if databaseSegment.Kind != "database" {
			return adapters.TreeChildren{}, adapters.New(adapters.CodeNotFound, "unexpected root path segment kind: "+databaseSegment.Kind, nil)
		}
		if len(segments) == 1 {
			nodes, err := listTablesAndViews(exec, databaseSegment.Name)
			if err != nil {
				return adapters.TreeChildren{}, err
			}
			return adapters.TreeChildren{Nodes: nodes}, nil
		}

		objectSegment := segments[1]
		if len(segments) == 2 {
			// Rule 5 (Adapter doc comment): every relation is a leaf (P19 D5) — its columns live
			// in the definition view, not the tree.
			if objectSegment.Kind == "table" || objectSegment.Kind == "view" {
				return adapters.TreeChildren{Nodes: []model.TreeNode{}}, nil
			}
			return adapters.TreeChildren{}, adapters.New(adapters.CodeNotFound, "unexpected object kind: "+objectSegment.Kind, nil)
		}

		return adapters.TreeChildren{}, adapters.New(adapters.CodeNotFound, "unrecognized path depth", nil)
	})
}

func requireTwoSegmentPath(segments []model.PathSegment, opName string) (databaseSegment, objectSegment model.PathSegment, err error) {
	if len(segments) != 2 || segments[0].Kind != "database" || (segments[1].Kind != "table" && segments[1].Kind != "view") {
		return model.PathSegment{}, model.PathSegment{},
			adapters.New(adapters.CodeNotFound, opName+" requires a database/table path, got depth "+itoaPositive(len(segments)), nil)
	}
	return segments[0], segments[1], nil
}

// Describe is index.ts's describe.
func (a *Adapter) Describe(ctx context.Context, path model.NodePath, op *adapters.OpCtx) (model.ObjectMeta, error) {
	databaseSegment, objectSegment, err := requireTwoSegmentPath(path.Segments, "describe")
	if err != nil {
		return model.ObjectMeta{}, err
	}
	return runOnConn(ctx, a, op.OpID, func(driverCtx context.Context, conn *sql.Conn) (model.ObjectMeta, error) {
		exec := execFor(driverCtx, conn, op)
		target, err := getReadTarget(exec, databaseSegment.Name, objectSegment.Name)
		if err != nil {
			return model.ObjectMeta{}, err
		}
		indexes, err := listIndexes(exec, objectSegment.Name)
		if err != nil {
			return model.ObjectMeta{}, err
		}
		foreignKeys, err := listForeignKeys(exec, databaseSegment.Name, objectSegment.Name)
		if err != nil {
			return model.ObjectMeta{}, err
		}
		allTables, err := listAllTableNames(exec, databaseSegment.Name)
		if err != nil {
			return model.ObjectMeta{}, err
		}
		referencedBy, err := listReferencedBy(exec, databaseSegment.Name, objectSegment.Name, allTables)
		if err != nil {
			return model.ObjectMeta{}, err
		}
		var rowEstimate *int
		if objectSegment.Kind == "table" {
			rowEstimate, err = getRowEstimateFor(exec, objectSegment.Name)
			if err != nil {
				return model.ObjectMeta{}, err
			}
		}

		return model.ObjectMeta{
			Path: model.EncodePath(path.Segments), Kind: objectSegment.Kind, Name: objectSegment.Name,
			QualifiedName: databaseSegment.Name + "." + objectSegment.Name, Columns: target.Columns,
			PrimaryKey: target.PrimaryKey, ForeignKeys: foreignKeys, ReferencedBy: referencedBy,
			Indexes: indexes, RowEstimate: rowEstimate, Comment: nil, // SQLite has no column/table comment concept
		}, nil
	})
}

// Definition is index.ts's definition.
func (a *Adapter) Definition(ctx context.Context, path model.NodePath, op *adapters.OpCtx) (model.ObjectDefinition, error) {
	databaseSegment, objectSegment, err := requireTwoSegmentPath(path.Segments, "definition")
	if err != nil {
		return model.ObjectDefinition{}, err
	}
	return runOnConn(ctx, a, op.OpID, func(driverCtx context.Context, conn *sql.Conn) (model.ObjectDefinition, error) {
		exec := execFor(driverCtx, conn, op)
		return buildDefinition(exec, path.Segments, databaseSegment.Name, objectSegment.Kind, objectSegment.Name)
	})
}

// Read is index.ts's read.
func (a *Adapter) Read(ctx context.Context, req adapters.ReadRequest, op *adapters.OpCtx) (page.Page, error) {
	databaseSegment, objectSegment, err := requireTwoSegmentPath(req.Path.Segments, "read")
	if err != nil {
		return nil, err
	}
	return runOnConn(ctx, a, op.OpID, func(driverCtx context.Context, conn *sql.Conn) (page.Page, error) {
		exec := execFor(driverCtx, conn, op)
		target, err := getReadTarget(exec, databaseSegment.Name, objectSegment.Name)
		if err != nil {
			return nil, err
		}
		result, err := readPage(driverCtx, conn, op, target, readReq{
			Projection: req.Projection, Filter: req.Filter, Sort: req.Sort,
			PageSize: req.PageSize, Cursor: req.Cursor,
		})
		if err != nil {
			return nil, err
		}
		return result, nil
	})
}

// Count is index.ts's count.
func (a *Adapter) Count(ctx context.Context, req adapters.CountRequest, op *adapters.OpCtx) (adapters.CountResult, error) {
	databaseSegment, objectSegment, err := requireTwoSegmentPath(req.Path.Segments, "count")
	if err != nil {
		return adapters.CountResult{}, err
	}
	return runOnConn(ctx, a, op.OpID, func(driverCtx context.Context, conn *sql.Conn) (adapters.CountResult, error) {
		target := QualifiedName{Database: databaseSegment.Name, Table: objectSegment.Name}
		return countRows(driverCtx, conn, op, target, req.Filter)
	})
}

// Preview is index.ts's preview.
func (a *Adapter) Preview(plan model.MutationPlan) ([]string, error) {
	return preview(plan)
}

// Mutate is index.ts's mutate.
func (a *Adapter) Mutate(ctx context.Context, plan model.MutationPlan, op *adapters.OpCtx) (model.MutationResult, error) {
	return runOnConn(ctx, a, op.OpID, func(driverCtx context.Context, conn *sql.Conn) (model.MutationResult, error) {
		return mutate(driverCtx, conn, op, a.readOnly, plan)
	})
}

// Execute is index.ts's execute.
func (a *Adapter) Execute(ctx context.Context, req model.ConsoleRequest, op *adapters.OpCtx) ([]page.Page, error) {
	return runOnConn(ctx, a, op.OpID, func(driverCtx context.Context, conn *sql.Conn) ([]page.Page, error) {
		return execute(driverCtx, conn, op, req.Statements)
	})
}

// DownloadObject is index.ts's downloadObject — caps.FileTransfer is false, so no UI ever offers
// Download for sqlite; never reached.
func (a *Adapter) DownloadObject(context.Context, model.ObjectDownloadRequest, *adapters.OpCtx) (model.ObjectTransferResult, error) {
	return model.ObjectTransferResult{}, adapters.Unsupported("sqlite", "file transfer")
}
