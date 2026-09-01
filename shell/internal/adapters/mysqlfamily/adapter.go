package mysqlfamily

import (
	"context"
	"database/sql"
	"regexp"
	"strconv"
	"sync"

	"github.com/go-sql-driver/mysql"

	"github.com/kirathecat/kira-studio/shell/internal/adapters"
	"github.com/kirathecat/kira-studio/shell/internal/page"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

// Adapter is index.ts's MysqlFamilyAdapter — one implementation for both MariaDB and MySQL,
// parameterized by a Profile (P34 D7/D9) plus a per-engine Caps literal (D10).
type Adapter struct {
	deps    adapters.Deps
	profile Profile
	caps    adapters.Caps

	connSet         *ConnSet
	cfg             *model.ResolvedConnectionConfig
	primaryDatabase string
	readOnly        bool

	mu          sync.Mutex
	runningByOp map[string]RunningQuery

	// inFlight mirrors postgres/adapter.go's own field and exists for exactly the same reason: a
	// adapters.RunWithAbortRace background goroutine can still be touching a *sql.Conn well after
	// its caller has returned on ctx.Done() — Disconnect must not close that connection out from
	// under it (found for real running go test ./... -race during P58a M5/P58b M6.1).
	inFlight sync.WaitGroup
}

// New constructs an Adapter for profile/caps — mariadb/adapter.go's and mysql/adapter.go's own
// init() call this, each with their own Profile and Caps literal (P34 D7).
func New(deps adapters.Deps, profile Profile, caps adapters.Caps) adapters.Adapter {
	return &Adapter{deps: deps, profile: profile, caps: caps}
}

func (a *Adapter) Kind() string        { return a.profile.Kind }
func (a *Adapter) Caps() adapters.Caps { return a.caps }

var mariadbVersionRE = regexp.MustCompile(`(?i)mariadb`)

// Connect is index.ts's connect.
func (a *Adapter) Connect(ctx context.Context, cfg model.ResolvedConnectionConfig, op *adapters.OpCtx) (adapters.ConnectInfo, error) {
	connSet := NewConnSet(cfg, a.profile, a.deps.Log)
	// P13 D1: assigned before anything is opened, not after the probe succeeds.
	a.connSet = connSet
	a.cfg = &cfg

	entry, err := connSet.Primary(ctx)
	if err != nil {
		_ = a.Disconnect(context.Background())
		return adapters.ConnectInfo{}, err
	}

	exec := execFor(entry.Conn, entry.ThreadID, op, a.trackerFor(op.OpID))
	var serverVersion, database, charset string
	found := false
	err = exec(ctx, "SELECT VERSION() AS version, DATABASE() AS `database`, @@character_set_server AS charset", nil,
		func(rows *sql.Rows) error {
			found = true
			return rows.Scan(&serverVersion, &database, &charset)
		})
	if err != nil {
		_ = a.Disconnect(context.Background())
		return adapters.ConnectInfo{}, err
	}
	if !found {
		_ = a.Disconnect(context.Background())
		return adapters.ConnectInfo{}, adapters.New(adapters.CodeConnect, "connect probe returned no rows", nil)
	}

	a.primaryDatabase = database
	a.readOnly = cfg.ReadOnly

	// D6: pointing the MySQL adapter at a MariaDB server (or vice versa) works — same driver, same
	// wire protocol — so this is a warning, not a connect failure.
	if a.profile.Kind == "mysql" && mariadbVersionRE.MatchString(serverVersion) {
		a.deps.Log("warn", "mysql: connected server identifies as MariaDB ("+serverVersion+")")
	}

	return adapters.ConnectInfo{
		ServerVersion: a.profile.ServerLabel + " " + serverVersion,
		Details:       map[string]string{"database": database, "charset": charset},
	}, nil
}

// Disconnect is index.ts's disconnect.
func (a *Adapter) Disconnect(ctx context.Context) error {
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

func (a *Adapter) requireEntry(ctx context.Context, database string) (Entry, error) {
	connSet, err := adapters.RequireConnected(a.connSet)
	if err != nil {
		return Entry{}, err
	}
	return connSet.Get(ctx, database)
}

// Children is index.ts's children.
func (a *Adapter) Children(ctx context.Context, path model.NodePath, op *adapters.OpCtx) (adapters.TreeChildren, error) {
	segments := path.Segments

	if len(segments) == 0 {
		entry, err := a.requireEntry(ctx, "")
		if err != nil {
			return adapters.TreeChildren{}, err
		}
		nodes, err := listDatabases(ctx, execFor(entry.Conn, entry.ThreadID, op, a.trackerFor(op.OpID)), a.primaryDatabase)
		if err != nil {
			return adapters.TreeChildren{}, err
		}
		return adapters.TreeChildren{Nodes: nodes}, nil
	}

	databaseSegment := segments[0]
	if databaseSegment.Kind != "database" {
		return adapters.TreeChildren{}, adapters.New(adapters.CodeNotFound, "unexpected root path segment kind: "+databaseSegment.Kind, nil)
	}
	entry, err := a.requireEntry(ctx, databaseSegment.Name)
	if err != nil {
		return adapters.TreeChildren{}, err
	}
	exec := execFor(entry.Conn, entry.ThreadID, op, a.trackerFor(op.OpID))

	if len(segments) == 1 {
		nodes, err := listTablesAndRoutines(ctx, exec, databaseSegment.Name)
		if err != nil {
			return adapters.TreeChildren{}, err
		}
		return adapters.TreeChildren{Nodes: nodes}, nil
	}

	objectSegment := segments[1]
	if len(segments) == 2 {
		// Rule 5: Children returns [] for a leaf, never an error. P19 D5: every relation is a leaf.
		switch objectSegment.Kind {
		case "sequence", "function", "table", "view":
			return adapters.TreeChildren{Nodes: []model.TreeNode{}}, nil
		}
		return adapters.TreeChildren{}, adapters.New(adapters.CodeNotFound, "unexpected object kind: "+objectSegment.Kind, nil)
	}

	return adapters.TreeChildren{}, adapters.New(adapters.CodeNotFound, "unrecognized path depth", nil)
}

func requireTwoSegmentPath(segments []model.PathSegment, opName string) (databaseSegment, objectSegment model.PathSegment, err error) {
	if len(segments) != 2 || segments[0].Kind != "database" {
		return model.PathSegment{}, model.PathSegment{},
			adapters.New(adapters.CodeNotFound, opName+" requires a database/table path, got depth "+strconv.Itoa(len(segments)), nil)
	}
	return segments[0], segments[1], nil
}

// Describe is index.ts's describe.
func (a *Adapter) Describe(ctx context.Context, path model.NodePath, op *adapters.OpCtx) (model.ObjectMeta, error) {
	databaseSegment, objectSegment, err := requireTwoSegmentPath(path.Segments, "describe")
	if err != nil {
		return model.ObjectMeta{}, err
	}
	entry, err := a.requireEntry(ctx, databaseSegment.Name)
	if err != nil {
		return model.ObjectMeta{}, err
	}
	exec := execFor(entry.Conn, entry.ThreadID, op, a.trackerFor(op.OpID))

	rawColumns, err := listColumns(ctx, exec, databaseSegment.Name, objectSegment.Name)
	if err != nil {
		return model.ObjectMeta{}, err
	}
	indexes, err := listIndexes(ctx, exec, databaseSegment.Name, objectSegment.Name)
	if err != nil {
		return model.ObjectMeta{}, err
	}
	foreignKeys, err := listForeignKeys(ctx, exec, databaseSegment.Name, objectSegment.Name)
	if err != nil {
		return model.ObjectMeta{}, err
	}
	referencedBy, err := listReferencedBy(ctx, exec, databaseSegment.Name, objectSegment.Name)
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

	var tableRows *int64
	var comment *string
	err = exec(ctx, `SELECT TABLE_ROWS AS table_rows, TABLE_COMMENT AS comment
	 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
		[]any{databaseSegment.Name, objectSegment.Name}, func(rows *sql.Rows) error {
			return rows.Scan(&tableRows, &comment)
		})
	if err != nil {
		return model.ObjectMeta{}, err
	}
	var rowEstimate *int
	if tableRows != nil {
		n := int(*tableRows)
		rowEstimate = &n
	}
	if comment != nil && *comment == "" {
		comment = nil
	}

	return model.ObjectMeta{
		Path: model.EncodePath(path.Segments), Kind: objectSegment.Kind, Name: objectSegment.Name,
		QualifiedName: databaseSegment.Name + "." + objectSegment.Name, Columns: columns,
		PrimaryKey: primaryKey, ForeignKeys: foreignKeys, ReferencedBy: referencedBy,
		Indexes: indexes, RowEstimate: rowEstimate, Comment: comment,
	}, nil
}

var definitionSupportedKinds = map[string]bool{"table": true, "view": true}

// Definition is index.ts's definition.
func (a *Adapter) Definition(ctx context.Context, path model.NodePath, op *adapters.OpCtx) (model.ObjectDefinition, error) {
	databaseSegment, objectSegment, err := requireTwoSegmentPath(path.Segments, "definition")
	if err != nil {
		return model.ObjectDefinition{}, err
	}
	if !definitionSupportedKinds[objectSegment.Kind] {
		return model.ObjectDefinition{}, adapters.Unsupported(a.Kind(), "definition for "+objectSegment.Kind)
	}
	entry, err := a.requireEntry(ctx, databaseSegment.Name)
	if err != nil {
		return model.ObjectDefinition{}, err
	}
	exec := execFor(entry.Conn, entry.ThreadID, op, a.trackerFor(op.OpID))
	return buildDefinition(ctx, exec, path.Segments, databaseSegment.Name, objectSegment.Kind, objectSegment.Name)
}

func requireTwoSegmentDataPath(segments []model.PathSegment, opName string) (databaseSegment, objectSegment model.PathSegment, err error) {
	if len(segments) != 2 || segments[0].Kind != "database" ||
		(segments[1].Kind != "table" && segments[1].Kind != "view") {
		return model.PathSegment{}, model.PathSegment{},
			adapters.New(adapters.CodeNotFound, opName+" requires a database/table path, got: "+model.EncodePath(segments), nil)
	}
	return segments[0], segments[1], nil
}

// Read is index.ts's read.
func (a *Adapter) Read(ctx context.Context, req adapters.ReadRequest, op *adapters.OpCtx) (page.Page, error) {
	databaseSegment, objectSegment, err := requireTwoSegmentDataPath(req.Path.Segments, "read")
	if err != nil {
		return nil, err
	}
	entry, err := a.requireEntry(ctx, databaseSegment.Name)
	if err != nil {
		return nil, err
	}
	target, err := getReadTarget(ctx, execFor(entry.Conn, entry.ThreadID, op, a.trackerFor(op.OpID)), databaseSegment.Name, objectSegment.Name)
	if err != nil {
		return nil, err
	}
	return readPage(ctx, entry.Conn, entry.ThreadID, op, a.trackerFor(op.OpID), target, readReq{
		Projection: req.Projection, Filter: req.Filter, Sort: req.Sort, PageSize: req.PageSize, Cursor: req.Cursor,
	})
}

// Count is index.ts's count.
func (a *Adapter) Count(ctx context.Context, req adapters.CountRequest, op *adapters.OpCtx) (adapters.CountResult, error) {
	databaseSegment, objectSegment, err := requireTwoSegmentDataPath(req.Path.Segments, "count")
	if err != nil {
		return adapters.CountResult{}, err
	}
	entry, err := a.requireEntry(ctx, databaseSegment.Name)
	if err != nil {
		return adapters.CountResult{}, err
	}
	target := QualifiedName{Database: databaseSegment.Name, Table: objectSegment.Name}
	return countRows(ctx, entry.Conn, entry.ThreadID, op, a.trackerFor(op.OpID), target, req.Filter)
}

// Preview is index.ts's preview.
func (a *Adapter) Preview(plan model.MutationPlan) ([]string, error) { return preview(plan) }

// Mutate is index.ts's mutate.
func (a *Adapter) Mutate(ctx context.Context, plan model.MutationPlan, op *adapters.OpCtx) (model.MutationResult, error) {
	if len(plan.Path.Segments) == 0 || plan.Path.Segments[0].Kind != "database" {
		return model.MutationResult{}, adapters.New(adapters.CodeNotFound, "unexpected root path segment kind", nil)
	}
	entry, err := a.requireEntry(ctx, plan.Path.Segments[0].Name)
	if err != nil {
		return model.MutationResult{}, err
	}
	return mutate(ctx, entry.Conn, entry.ThreadID, op, a.trackerFor(op.OpID), a.readOnly, plan)
}

// Execute is index.ts's execute.
func (a *Adapter) Execute(ctx context.Context, req model.ConsoleRequest, op *adapters.OpCtx) ([]page.Page, error) {
	database := ""
	if len(req.Path.Segments) > 0 && req.Path.Segments[0].Kind == "database" {
		database = req.Path.Segments[0].Name
	}
	entry, err := a.requireEntry(ctx, database)
	if err != nil {
		return nil, err
	}
	return execute(ctx, entry.Conn, entry.ThreadID, op, a.trackerFor(op.OpID), a.readOnly, req.Statements)
}

// DownloadObject is index.ts's downloadObject — caps.FileTransfer is false; never reached.
func (a *Adapter) DownloadObject(ctx context.Context, req model.ObjectDownloadRequest, op *adapters.OpCtx) (model.ObjectTransferResult, error) {
	return model.ObjectTransferResult{}, adapters.Unsupported(a.Kind(), "file transfer")
}

// Cancel is index.ts's cancel — a short-lived side connection, mirroring Postgres's
// pg_cancel_backend path (D26). Killing your own query needs no PROCESS/SUPER privilege — only
// killing someone else's does.
func (a *Adapter) Cancel(ctx context.Context, opID string) (bool, error) {
	a.mu.Lock()
	running, ok := a.runningByOp[opID]
	delete(a.runningByOp, opID)
	cfg := a.cfg
	a.mu.Unlock()
	if !ok || cfg == nil {
		return false, nil
	}

	mc, err := BuildConfig(*cfg, "", a.profile, a.deps.Log)
	if err != nil {
		a.deps.Log("warn", a.Kind()+" cancel("+opID+") failed: "+err.Error())
		return false, nil
	}
	connector, err := mysql.NewConnector(mc)
	if err != nil {
		a.deps.Log("warn", a.Kind()+" cancel("+opID+") failed: "+err.Error())
		return false, nil
	}
	side := sql.OpenDB(connector)
	defer side.Close()

	if _, err := side.ExecContext(ctx, "KILL QUERY "+strconv.FormatUint(uint64(running.ThreadID), 10)); err != nil {
		a.deps.Log("warn", a.Kind()+" cancel("+opID+") failed: "+err.Error())
		return false, nil
	}
	return true, nil
}

// trackerFor is index.ts's trackerFor (P13 D3): registers the running query and hands back its own
// release, identity-checked so an earlier statement settling after a later one has started never
// unregisters the later one.
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
