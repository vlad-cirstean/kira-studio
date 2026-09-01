package postgres

import (
	"context"
	"sync"

	"github.com/jackc/pgx/v5"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/page"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

func init() {
	adapters.Register("postgres", func(deps adapters.Deps) (adapters.Adapter, error) {
		return &Adapter{deps: deps}, nil
	})
}

// Adapter is index.ts's PostgresAdapter.
type Adapter struct {
	deps adapters.Deps

	connSet         *ConnSet
	cfg             *model.ResolvedConnectionConfig
	primaryDatabase string
	readOnly        bool

	mu          sync.Mutex
	runningByOp map[string]RunningQuery

	// inFlight counts query.go/console.go's own adapters.RunWithAbortRace background goroutines
	// that are still touching a *pgx.Conn. RunWithAbortRace can return to its caller (on ctx.Done())
	// well before the goroutine it spawned actually stops using the connection — by design, so a
	// local op abort does not itself kill the query (query.ts:77-80). Disconnect must not close a
	// connection out from under one of these goroutines: pgx's own *Conn is not safe for concurrent
	// use, and closing one mid-Query is a real, race-detector-confirmed data race, not a theoretical
	// one (found running go test ./... -race for P58b M6.1).
	inFlight sync.WaitGroup
}

func (a *Adapter) Kind() string        { return "postgres" }
func (a *Adapter) Caps() adapters.Caps { return caps }

// Connect is index.ts's connect.
func (a *Adapter) Connect(ctx context.Context, cfg model.ResolvedConnectionConfig, op *adapters.OpCtx) (adapters.ConnectInfo, error) {
	connSet := NewConnSet(cfg, a.deps.Log)
	// P13 D1: assigned before anything is opened, not after the probe succeeds — the handle must
	// be reachable by Disconnect from the instant connSet.Primary() could have opened a socket, or
	// a probe failure (or a dropped session mid-probe) leaks it (F1).
	a.connSet = connSet
	a.cfg = &cfg

	conn, release, err := connSet.Primary(ctx)
	if err != nil {
		_ = a.Disconnect(context.Background())
		return adapters.ConnectInfo{}, err
	}
	defer release()

	var serverVersion, database, encoding string
	found := false
	execErr := execFor(conn, op, a.trackerFor(op.OpID))(ctx,
		`SELECT version() AS version, current_database() AS database,
		        current_setting('server_encoding') AS encoding`, nil,
		func(rows pgx.Rows) error {
			found = true
			return rows.Scan(&serverVersion, &database, &encoding)
		})
	if execErr != nil {
		_ = a.Disconnect(context.Background())
		return adapters.ConnectInfo{}, execErr
	}
	if !found {
		_ = a.Disconnect(context.Background())
		return adapters.ConnectInfo{}, adapters.New(adapters.CodeConnect, "connect probe returned no rows", nil)
	}

	a.primaryDatabase = database
	a.readOnly = cfg.ReadOnly

	return adapters.ConnectInfo{
		ServerVersion: serverVersion,
		Details:       map[string]string{"database": database, "encoding": encoding},
	}, nil
}

// Disconnect is index.ts's disconnect.
func (a *Adapter) Disconnect(ctx context.Context) error {
	// Every RunWithAbortRace goroutine still touching a connection must actually stop before that
	// connection is closed (see inFlight's own doc comment). A caller that wants Disconnect to
	// return promptly on a stuck query calls Cancel first — matching CancelOp's own two-step design,
	// which already assumes the explicit cancel is what makes the server-side work actually end.
	a.inFlight.Wait()
	if a.connSet != nil {
		a.connSet.CloseAll(ctx)
	}
	a.connSet = nil
	a.primaryDatabase = ""
	a.mu.Lock()
	a.runningByOp = nil
	a.mu.Unlock()
	return nil
}

// requireClient returns database's connection together with a release func that must be called
// exactly once — it holds the per-connection lock ConnSet.Acquire's own doc comment describes for
// as long as the caller keeps conn (P2 R2).
func (a *Adapter) requireClient(ctx context.Context, database string) (*pgx.Conn, func(), error) {
	connSet, err := adapters.RequireConnected(a.connSet)
	if err != nil {
		return nil, nil, err
	}
	return connSet.Acquire(ctx, database)
}

// Children is index.ts's children.
func (a *Adapter) Children(ctx context.Context, path model.NodePath, op *adapters.OpCtx) (adapters.TreeChildren, error) {
	segments := path.Segments

	if len(segments) == 0 {
		conn, release, err := a.requireClient(ctx, "")
		if err != nil {
			return adapters.TreeChildren{}, err
		}
		defer release()
		nodes, err := listDatabases(ctx, execFor(conn, op, a.trackerFor(op.OpID)), a.primaryDatabase)
		if err != nil {
			return adapters.TreeChildren{}, err
		}
		return adapters.TreeChildren{Nodes: nodes}, nil
	}

	databaseSegment := segments[0]
	if databaseSegment.Kind != "database" {
		return adapters.TreeChildren{}, adapters.New(adapters.CodeNotFound, "unexpected root path segment kind: "+databaseSegment.Kind, nil)
	}
	conn, release, err := a.requireClient(ctx, databaseSegment.Name)
	if err != nil {
		return adapters.TreeChildren{}, err
	}
	defer release()
	exec := execFor(conn, op, a.trackerFor(op.OpID))

	if len(segments) == 1 {
		nodes, err := listSchemas(ctx, exec, databaseSegment.Name)
		if err != nil {
			return adapters.TreeChildren{}, err
		}
		return adapters.TreeChildren{Nodes: nodes}, nil
	}

	schemaSegment := segments[1]
	if schemaSegment.Kind != "schema" {
		return adapters.TreeChildren{}, adapters.New(adapters.CodeNotFound, "unexpected path segment kind at depth 1: "+schemaSegment.Kind, nil)
	}

	if len(segments) == 2 {
		nodes, err := listRelationsAndFunctions(ctx, exec, databaseSegment.Name, schemaSegment.Name)
		if err != nil {
			return adapters.TreeChildren{}, err
		}
		return adapters.TreeChildren{Nodes: nodes}, nil
	}

	objectSegment := segments[2]
	if len(segments) == 3 {
		// Rule 5 (Adapter doc comment): Children returns [] for a leaf, never an error. P19 D5:
		// table/view/matview are leaves too now — their columns moved into the definition view,
		// and catalog.go's own hasChildren:false for relations is what keeps the tree from ever
		// showing a twisty here in the first place.
		switch objectSegment.Kind {
		case "sequence", "function", "table", "view", "matview":
			return adapters.TreeChildren{Nodes: []model.TreeNode{}}, nil
		}
		return adapters.TreeChildren{}, adapters.New(adapters.CodeNotFound, "unexpected object kind: "+objectSegment.Kind, nil)
	}

	return adapters.TreeChildren{}, adapters.New(adapters.CodeNotFound, "unrecognized path depth", nil)
}

func requireThreeSegmentObjectPath(segments []model.PathSegment, opName string) (databaseSegment, schemaSegment, objectSegment model.PathSegment, err error) {
	if len(segments) != 3 || segments[0].Kind != "database" || segments[1].Kind != "schema" {
		return model.PathSegment{}, model.PathSegment{}, model.PathSegment{},
			adapters.New(adapters.CodeNotFound, opName+" requires a database/schema/table path, got depth "+itoaPositive(len(segments)), nil)
	}
	return segments[0], segments[1], segments[2], nil
}

// Describe is index.ts's describe.
func (a *Adapter) Describe(ctx context.Context, path model.NodePath, op *adapters.OpCtx) (model.ObjectMeta, error) {
	databaseSegment, schemaSegment, objectSegment, err := requireThreeSegmentObjectPath(path.Segments, "describe")
	if err != nil {
		return model.ObjectMeta{}, err
	}

	conn, release, err := a.requireClient(ctx, databaseSegment.Name)
	if err != nil {
		return model.ObjectMeta{}, err
	}
	defer release()
	exec := execFor(conn, op, a.trackerFor(op.OpID))

	info, err := getRelationInfo(ctx, exec, schemaSegment.Name, objectSegment.Name)
	if err != nil {
		return model.ObjectMeta{}, err
	}
	// Sequential, not concurrent: exec routes every one of these through the same single
	// connection (D14 — one Conn per connection/database, never a pool), and pgx does not support
	// concurrent queries on one connection.
	rawColumns, err := listColumns(ctx, exec, schemaSegment.Name, objectSegment.Name)
	if err != nil {
		return model.ObjectMeta{}, err
	}
	indexes, err := listIndexes(ctx, exec, info.OID)
	if err != nil {
		return model.ObjectMeta{}, err
	}
	foreignKeys, err := listForeignKeys(ctx, exec, info.OID, databaseSegment.Name)
	if err != nil {
		return model.ObjectMeta{}, err
	}
	referencedBy, err := listReferencedBy(ctx, exec, info.OID, databaseSegment.Name)
	if err != nil {
		return model.ObjectMeta{}, err
	}
	primaryKey := adapters.PrimaryKeyFromIndexes(indexes)
	pkColumns := make(map[string]struct{}, len(primaryKey))
	for _, c := range primaryKey {
		pkColumns[c] = struct{}{}
	}
	columns := make([]model.ColumnMeta, len(rawColumns))
	for i, c := range rawColumns {
		_, isPK := pkColumns[c.Name]
		c.IsPrimaryKey = isPK
		columns[i] = c
	}

	return model.ObjectMeta{
		Path: model.EncodePath(path.Segments), Kind: objectSegment.Kind, Name: objectSegment.Name,
		QualifiedName: schemaSegment.Name + "." + objectSegment.Name, Columns: columns,
		PrimaryKey: primaryKey, ForeignKeys: foreignKeys, ReferencedBy: referencedBy,
		Indexes: indexes, RowEstimate: intPtrFrom(info.RowEstimate), Comment: info.Comment,
	}, nil
}

func intPtrFrom(v *int64) *int {
	if v == nil {
		return nil
	}
	n := int(*v)
	return &n
}

var definitionSupportedKinds = map[string]bool{"table": true, "view": true, "matview": true}

// Definition is index.ts's definition.
func (a *Adapter) Definition(ctx context.Context, path model.NodePath, op *adapters.OpCtx) (model.ObjectDefinition, error) {
	databaseSegment, schemaSegment, objectSegment, err := requireThreeSegmentObjectPath(path.Segments, "definition")
	if err != nil {
		return model.ObjectDefinition{}, err
	}
	if !definitionSupportedKinds[objectSegment.Kind] {
		return model.ObjectDefinition{}, adapters.Unsupported("postgres", "definition for "+objectSegment.Kind)
	}

	conn, release, err := a.requireClient(ctx, databaseSegment.Name)
	if err != nil {
		return model.ObjectDefinition{}, err
	}
	defer release()
	exec := execFor(conn, op, a.trackerFor(op.OpID))
	return buildDefinition(ctx, exec, path.Segments, schemaSegment.Name, objectSegment.Kind, objectSegment.Name)
}

func requireThreeSegmentDataPath(segments []model.PathSegment, opName string) (databaseSegment, schemaSegment, objectSegment model.PathSegment, err error) {
	if len(segments) != 3 || segments[0].Kind != "database" || segments[1].Kind != "schema" ||
		(segments[2].Kind != "table" && segments[2].Kind != "view" && segments[2].Kind != "matview") {
		return model.PathSegment{}, model.PathSegment{}, model.PathSegment{},
			adapters.New(adapters.CodeNotFound, opName+" requires a database/schema/table path, got: "+model.EncodePath(segments), nil)
	}
	return segments[0], segments[1], segments[2], nil
}

// Read is index.ts's read.
func (a *Adapter) Read(ctx context.Context, req adapters.ReadRequest, op *adapters.OpCtx) (page.Page, error) {
	databaseSegment, schemaSegment, objectSegment, err := requireThreeSegmentDataPath(req.Path.Segments, "read")
	if err != nil {
		return nil, err
	}
	conn, release, err := a.requireClient(ctx, databaseSegment.Name)
	if err != nil {
		return nil, err
	}
	defer release()
	target, err := getReadTarget(ctx, execFor(conn, op, a.trackerFor(op.OpID)), schemaSegment.Name, objectSegment.Name)
	if err != nil {
		return nil, err
	}
	result, err := readPage(ctx, conn, op, a.trackerFor(op.OpID), target, readReq{
		Projection: req.Projection, Filter: req.Filter, Sort: req.Sort, PageSize: req.PageSize, Cursor: req.Cursor,
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

// Count is index.ts's count. P13 D13: count() never reads columns/PK/indexes/oid off the target,
// so it resolves only the qualified name — not the three catalog queries getReadTarget costs.
func (a *Adapter) Count(ctx context.Context, req adapters.CountRequest, op *adapters.OpCtx) (adapters.CountResult, error) {
	databaseSegment, schemaSegment, objectSegment, err := requireThreeSegmentDataPath(req.Path.Segments, "count")
	if err != nil {
		return adapters.CountResult{}, err
	}
	conn, release, err := a.requireClient(ctx, databaseSegment.Name)
	if err != nil {
		return adapters.CountResult{}, err
	}
	defer release()
	target := QualifiedName{Schema: schemaSegment.Name, Relation: objectSegment.Name}
	return countRows(ctx, conn, op, a.trackerFor(op.OpID), target, req.Filter)
}

// Preview is index.ts's preview.
func (a *Adapter) Preview(plan model.MutationPlan) ([]string, error) {
	return preview(plan)
}

// Mutate is index.ts's mutate.
func (a *Adapter) Mutate(ctx context.Context, plan model.MutationPlan, op *adapters.OpCtx) (model.MutationResult, error) {
	if len(plan.Path.Segments) == 0 || plan.Path.Segments[0].Kind != "database" {
		return model.MutationResult{}, adapters.New(adapters.CodeNotFound, "unexpected root path segment kind", nil)
	}
	conn, release, err := a.requireClient(ctx, plan.Path.Segments[0].Name)
	if err != nil {
		return model.MutationResult{}, err
	}
	defer release()
	return mutate(ctx, conn, op, a.trackerFor(op.OpID), a.readOnly, plan)
}

// Execute is index.ts's execute.
func (a *Adapter) Execute(ctx context.Context, req model.ConsoleRequest, op *adapters.OpCtx) ([]page.Page, error) {
	database := ""
	if len(req.Path.Segments) > 0 && req.Path.Segments[0].Kind == "database" {
		database = req.Path.Segments[0].Name
	}
	conn, release, err := a.requireClient(ctx, database)
	if err != nil {
		return nil, err
	}
	defer release()
	return execute(ctx, conn, op, a.trackerFor(op.OpID), a.readOnly, req.Statements)
}

// DownloadObject is index.ts's downloadObject — caps.FileTransfer is false, so no UI ever offers
// Download for postgres; never reached.
func (a *Adapter) DownloadObject(ctx context.Context, req model.ObjectDownloadRequest, op *adapters.OpCtx) (model.ObjectTransferResult, error) {
	return model.ObjectTransferResult{}, adapters.Unsupported("postgres", "file transfer")
}

// Cancel is index.ts's cancel.
func (a *Adapter) Cancel(ctx context.Context, opID string) (bool, error) {
	a.mu.Lock()
	running, ok := a.runningByOp[opID]
	delete(a.runningByOp, opID)
	cfg := a.cfg
	a.mu.Unlock()
	if !ok || cfg == nil {
		return false, nil
	}

	connConfig, err := buildConfig(*cfg, "", a.deps.Log)
	if err != nil {
		a.deps.Log("warn", "postgres cancel("+opID+") failed: "+err.Error())
		return false, nil
	}
	side, err := pgx.ConnectConfig(ctx, connConfig)
	if err != nil {
		a.deps.Log("warn", "postgres cancel("+opID+") failed: "+err.Error())
		return false, nil
	}
	defer side.Close(context.Background())

	var cancelled bool
	if err := side.QueryRow(ctx, "SELECT pg_cancel_backend($1)", running.BackendPID).Scan(&cancelled); err != nil {
		a.deps.Log("warn", "postgres cancel("+opID+") failed: "+err.Error())
		return false, nil
	}
	return cancelled, nil
}

// trackerFor is index.ts's trackerFor (P13 D3): registers the running query and hands back its
// own release. The identity check in the release closure is what makes a multi-statement op
// (mutate's BEGIN/…/COMMIT, console's "Run all") correct — an earlier statement settling after a
// later one has started must not unregister the later one, since both share this one opId.
func (a *Adapter) trackerFor(opID string) TrackQuery {
	return func(q RunningQuery) func() {
		a.mu.Lock()
		if a.runningByOp == nil {
			a.runningByOp = make(map[string]RunningQuery)
		}
		a.runningByOp[opID] = q
		a.mu.Unlock()
		a.inFlight.Add(1)
		return func() {
			defer a.inFlight.Done()
			a.mu.Lock()
			if a.runningByOp[opID] == q {
				delete(a.runningByOp, opID)
			}
			a.mu.Unlock()
		}
	}
}
