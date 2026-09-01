package clickhouse

import (
	"context"
	"sync"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/page"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

func init() {
	adapters.Register("clickhouse", func(deps adapters.Deps) (adapters.Adapter, error) {
		return &Adapter{deps: deps}, nil
	})
}

var relationKinds = map[string]bool{"table": true, "view": true, "matview": true}

// Adapter is index.ts's ClickHouseAdapter.
type Adapter struct {
	deps adapters.Deps

	handle   *Handle
	readOnly bool

	mu          sync.Mutex
	runningByOp map[string]string // opID -> query_id (D8), not a thread id or backend pid

	// inFlight mirrors postgres's/mysqlfamily's/sqlite's own field of the same name: RunWithAbortRace
	// can return to its caller on ctx.Done() before the background goroutine it spawned has actually
	// stopped touching the *http.Response body it is reading — Disconnect must not race that.
	inFlight sync.WaitGroup
}

func (a *Adapter) Kind() string        { return "clickhouse" }
func (a *Adapter) Caps() adapters.Caps { return caps }

// Connect is index.ts's connect.
func (a *Adapter) Connect(ctx context.Context, cfg model.ResolvedConnectionConfig, op *adapters.OpCtx) (adapters.ConnectInfo, error) {
	handle, err := OpenClient(cfg, a.deps.Log)
	if err != nil {
		return adapters.ConnectInfo{}, err
	}
	// P13 D1: assigned before the probe runs, not after it succeeds — Disconnect must reach the
	// handle from the instant OpenClient returns.
	a.handle = handle
	a.readOnly = handle.ReadOnly

	rows, err := RunCatalogQuery[struct {
		Version  string `json:"version"`
		Database string `json:"database"`
		Timezone string `json:"timezone"`
	}](ctx, handle, a.nextQueryID(op.OpID, 0), "SELECT version() AS version, currentDatabase() AS database, timezone() AS timezone", op, a.trackerFor(op.OpID), nil)
	if err != nil {
		_ = a.Disconnect(context.Background())
		return adapters.ConnectInfo{}, err
	}
	if len(rows) == 0 {
		_ = a.Disconnect(context.Background())
		return adapters.ConnectInfo{}, adapters.New(adapters.CodeConnect, "connect probe returned no rows", nil)
	}
	row := rows[0]
	return adapters.ConnectInfo{
		ServerVersion: "ClickHouse " + row.Version,
		Details:       map[string]string{"url": handle.URL, "database": row.Database, "timezone": row.Timezone},
	}, nil
}

// Disconnect is index.ts's disconnect.
func (a *Adapter) Disconnect(context.Context) error {
	a.inFlight.Wait()
	if a.handle != nil {
		a.handle.Client.CloseIdleConnections()
	}
	a.handle = nil
	a.mu.Lock()
	a.runningByOp = nil
	a.mu.Unlock()
	return nil
}

// nextQueryID is index.ts's opRuntime's own per-call closure (D8's own refinement) — this
// exported-package-level helper is only ever called with a fresh seq per top-level call, matching
// index.ts's own instance-per-call closure rather than an instance-level map, since every top-level
// Adapter method call already gets a fresh, unique op.OpID.
func (a *Adapter) nextQueryID(opID string, seq int) string {
	return "kira-" + opID + "-" + itoaPositive(seq)
}

// trackerFor is index.ts's trackerFor (P13 D3): registers the running query_id and hands back its
// own release. The identity check in the release closure is what makes a multi-statement op
// (mutate's insert, console's "Run all") correct.
func (a *Adapter) trackerFor(opID string) TrackQuery {
	return func(q RunningQuery) func() {
		a.mu.Lock()
		if a.runningByOp == nil {
			a.runningByOp = make(map[string]string)
		}
		a.runningByOp[opID] = q.QueryID
		a.mu.Unlock()
		a.inFlight.Add(1)
		return func() {
			defer a.inFlight.Done()
			a.mu.Lock()
			if a.runningByOp[opID] == q.QueryID {
				delete(a.runningByOp, opID)
			}
			a.mu.Unlock()
		}
	}
}

// opSeq hands out a fresh, monotonically increasing query_id sequence per top-level call — a
// closure captured once per Adapter method invocation, mirroring index.ts's own opRuntime.
type opSeq struct {
	opID string
	n    int
}

func (a *Adapter) newOpSeq(opID string) *opSeq { return &opSeq{opID: opID} }
func (s *opSeq) next(a *Adapter) string {
	id := a.nextQueryID(s.opID, s.n)
	s.n++
	return id
}

// Children is index.ts's children.
func (a *Adapter) Children(ctx context.Context, path model.NodePath, op *adapters.OpCtx) (adapters.TreeChildren, error) {
	handle, err := a.requireHandle()
	if err != nil {
		return adapters.TreeChildren{}, err
	}
	seq := a.newOpSeq(op.OpID)
	track := a.trackerFor(op.OpID)
	segments := path.Segments

	if len(segments) == 0 {
		nodes, err := listDatabases(ctx, handle, seq.next(a), op, track)
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
		nodes, err := listTablesAndViews(ctx, handle, seq.next(a), op, track, databaseSegment.Name)
		if err != nil {
			return adapters.TreeChildren{}, err
		}
		return adapters.TreeChildren{Nodes: nodes}, nil
	}

	objectSegment := segments[1]
	if len(segments) == 2 {
		// Adapter rule 5: Children returns [] for a leaf, never an error — a table/view/matview's
		// columns live in describe()/definition() (P19 D5).
		if relationKinds[objectSegment.Kind] {
			return adapters.TreeChildren{Nodes: []model.TreeNode{}}, nil
		}
		return adapters.TreeChildren{}, adapters.New(adapters.CodeNotFound, "unexpected object kind: "+objectSegment.Kind, nil)
	}

	return adapters.TreeChildren{}, adapters.New(adapters.CodeNotFound, "unrecognized path depth", nil)
}

func requireRelationPath(segments []model.PathSegment, opName string) (databaseSegment, objectSegment model.PathSegment, err error) {
	if len(segments) != 2 || segments[0].Kind != "database" || !relationKinds[segments[1].Kind] {
		return model.PathSegment{}, model.PathSegment{},
			adapters.New(adapters.CodeNotFound, opName+" requires a database/table path, got: "+model.EncodePath(segments), nil)
	}
	return segments[0], segments[1], nil
}

// Describe is index.ts's describe.
func (a *Adapter) Describe(ctx context.Context, path model.NodePath, op *adapters.OpCtx) (model.ObjectMeta, error) {
	databaseSegment, objectSegment, err := requireRelationPath(path.Segments, "describe")
	if err != nil {
		return model.ObjectMeta{}, err
	}
	handle, err := a.requireHandle()
	if err != nil {
		return model.ObjectMeta{}, err
	}
	seq := a.newOpSeq(op.OpID)
	track := a.trackerFor(op.OpID)

	target, err := getReadTarget(ctx, handle, seq.next(a), op, track, databaseSegment.Name, objectSegment.Name)
	if err != nil {
		return model.ObjectMeta{}, err
	}
	// Sequential, not concurrent — routes every catalog query for this op through the same tracked
	// query_id sequence, mirroring every other SQL adapter's own describe() discipline.
	indexes, err := listIndexes(ctx, handle, seq.next(a), op, track, databaseSegment.Name, objectSegment.Name, target.PrimaryKeyExpression)
	if err != nil {
		return model.ObjectMeta{}, err
	}

	var totalRows *int
	if target.TotalRows != nil {
		n := int(*target.TotalRows)
		totalRows = &n
	}
	return model.ObjectMeta{
		Path: model.EncodePath(path.Segments), Kind: objectSegment.Kind, Name: objectSegment.Name,
		QualifiedName: databaseSegment.Name + "." + objectSegment.Name, Columns: target.Columns,
		// D18: a MergeTree PRIMARY KEY is a sparse index, not a uniqueness constraint (F16) — never
		// claimed as ObjectMeta.PrimaryKey, even though individual columns still carry their own
		// IsPrimaryKey badge... which toColumnMeta already always reports false too (D18/D23).
		PrimaryKey: nil, ForeignKeys: []model.ForeignKeyMeta{}, ReferencedBy: []model.ForeignKeyMeta{},
		Indexes: indexes, RowEstimate: totalRows, Comment: target.Comment,
	}, nil
}

// Definition is index.ts's definition.
func (a *Adapter) Definition(ctx context.Context, path model.NodePath, op *adapters.OpCtx) (model.ObjectDefinition, error) {
	databaseSegment, objectSegment, err := requireRelationPath(path.Segments, "definition")
	if err != nil {
		return model.ObjectDefinition{}, err
	}
	handle, err := a.requireHandle()
	if err != nil {
		return model.ObjectDefinition{}, err
	}
	seq := a.newOpSeq(op.OpID)
	return buildDefinition(ctx, handle, seq.next(a), op, a.trackerFor(op.OpID), path.Segments, databaseSegment.Name, objectSegment.Kind, objectSegment.Name)
}

// Read is index.ts's read.
func (a *Adapter) Read(ctx context.Context, req adapters.ReadRequest, op *adapters.OpCtx) (page.Page, error) {
	databaseSegment, objectSegment, err := requireRelationPath(req.Path.Segments, "read")
	if err != nil {
		return nil, err
	}
	handle, err := a.requireHandle()
	if err != nil {
		return nil, err
	}
	seq := a.newOpSeq(op.OpID)
	track := a.trackerFor(op.OpID)
	target, err := getReadTarget(ctx, handle, seq.next(a), op, track, databaseSegment.Name, objectSegment.Name)
	if err != nil {
		return nil, err
	}
	result, err := readPage(ctx, handle, seq.next(a), op, track, target, readReq{
		Projection: req.Projection, Filter: req.Filter, Sort: req.Sort, PageSize: req.PageSize, Cursor: req.Cursor,
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

// Count is index.ts's count — no getReadTarget call (D19/scenario 30): count() needs only the
// qualified name, not the columns/engine/keys catalog round trips read() genuinely uses.
func (a *Adapter) Count(ctx context.Context, req adapters.CountRequest, op *adapters.OpCtx) (adapters.CountResult, error) {
	databaseSegment, objectSegment, err := requireRelationPath(req.Path.Segments, "count")
	if err != nil {
		return adapters.CountResult{}, err
	}
	handle, err := a.requireHandle()
	if err != nil {
		return adapters.CountResult{}, err
	}
	seq := a.newOpSeq(op.OpID)
	return countRows(ctx, handle, seq.next(a), op, a.trackerFor(op.OpID), QualifiedName{Database: databaseSegment.Name, Table: objectSegment.Name}, req.Filter)
}

// Preview is index.ts's preview.
func (a *Adapter) Preview(plan model.MutationPlan) ([]string, error) {
	return preview(plan)
}

// Mutate is index.ts's mutate.
func (a *Adapter) Mutate(ctx context.Context, plan model.MutationPlan, op *adapters.OpCtx) (model.MutationResult, error) {
	handle, err := a.requireHandle()
	if err != nil {
		return model.MutationResult{}, err
	}
	seq := a.newOpSeq(op.OpID)
	return mutate(ctx, handle, seq.next(a), op, a.trackerFor(op.OpID), a.readOnly, plan)
}

// Execute is index.ts's execute.
func (a *Adapter) Execute(ctx context.Context, req model.ConsoleRequest, op *adapters.OpCtx) ([]page.Page, error) {
	handle, err := a.requireHandle()
	if err != nil {
		return nil, err
	}
	seq := a.newOpSeq(op.OpID)
	return execute(ctx, handle, op, a.trackerFor(op.OpID), req.Statements, func() string { return seq.next(a) })
}

// DownloadObject is index.ts's downloadObject — caps.FileTransfer is false, so no UI ever offers
// Download for clickhouse; never reached.
func (a *Adapter) DownloadObject(context.Context, model.ObjectDownloadRequest, *adapters.OpCtx) (model.ObjectTransferResult, error) {
	return model.ObjectTransferResult{}, adapters.Unsupported("clickhouse", "file transfer")
}

// Cancel is index.ts's cancel — D7/D8: the KILL QUERY request never carries readonly, a second,
// free HTTP request on the client's own connection pool (F7/F9), never scoped by this connection's
// own read-only flag.
func (a *Adapter) Cancel(ctx context.Context, opID string) (bool, error) {
	a.mu.Lock()
	queryID, ok := a.runningByOp[opID]
	delete(a.runningByOp, opID)
	handle := a.handle
	a.mu.Unlock()
	if !ok || handle == nil {
		return false, nil
	}

	resp, err := doRequest(ctx, handle, "KILL QUERY WHERE query_id = {qid:String} SYNC", "", map[string]string{"qid": queryID}, false)
	if err != nil {
		a.deps.Log("warn", "clickhouse cancel("+opID+") failed: "+err.Error())
		return false, nil
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		a.deps.Log("warn", "clickhouse cancel("+opID+") failed: server returned "+itoaPositive(resp.StatusCode))
		return false, nil
	}
	return true, nil
}

func (a *Adapter) requireHandle() (*Handle, error) {
	return adapters.RequireConnected(a.handle)
}
