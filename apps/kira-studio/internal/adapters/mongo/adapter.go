package mongo

import (
	"context"
	"sync/atomic"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	mongodriver "go.mongodb.org/mongo-driver/v2/mongo"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/page"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

func init() {
	adapters.Register("mongodb", func(deps adapters.Deps) (adapters.Adapter, error) {
		return &Adapter{deps: deps}, nil
	})
}

// disconnectTimeout bounds Disconnect's own client.Disconnect call (F4a): a no-deadline ctx makes
// the driver wait until every in-use connection returns on its own (confirmed against
// mongo-driver's own Client.Disconnect) — Router.Connect's reconnect path passes
// context.Background() with no bound at all (adapterhost, Part 6's own file, out of scope here),
// and even Router.Disconnect's own ctx could be near its own deadline already. A fixed deadline
// here is what actually force-closes a still-in-use connection regardless of what ctx this call was
// handed.
const disconnectTimeout = 10 * time.Second

// connState is every field Connect/Disconnect write concurrently with an in-flight op reading them
// (F3): requireClient's own RequireConnected(a.state.Load().client), Execute's own
// a.state.Load().defaultDatabase, Read/Count/Mutate/Execute's own a.state.Load().readOnly — the
// same class of data race Part 4's own F3 fixed for the SQL engines. Guarded via adapters.Guarded
// (P113 G1).
type connState struct {
	client          *mongodriver.Client
	defaultDatabase *string
	readOnly        bool
}

// Adapter is index.ts's MongoAdapter. D8: one pooled *mongo.Client — the driver's own internal
// pool handles concurrency, so there is no ConnSet/LRU analog to MariaDB's (client.Database(name)
// is a cheap synchronous handle-get, not a new connection).
type Adapter struct {
	deps adapters.Deps

	state adapters.Guarded[connState]

	// tracker replaces a bare inFlight sync.WaitGroup (F4): the old field's own doc comment claimed
	// it tracked RunWithAbortRace's detached background goroutines, but every RunWithAbortRace call
	// site in read.go/mutate.go/console.go passed a no-op release (func(){}), so nothing was ever
	// actually counted — Add/Done only ever wrapped the synchronous foreground call in
	// Read/Count/Mutate/Execute below, which returns to its caller in lockstep with the call it
	// wraps and proves nothing about the detached goroutine RunWithAbortRace itself spawns.
	// QueryTracker[uint64] (mirroring postgres/mysqlfamily/clickhouse's own shared tracker) is
	// registered directly at each RunWithAbortRace call site instead (via trackerFor below), and
	// additionally gives Disconnect a real opID Snapshot to killOp/Cancel before it Drains.
	tracker adapters.QueryTracker[uint64]
}

// setConnected is Connect's own locked write of every field a successful connect fills in (F3).
func (a *Adapter) setConnected(client *mongodriver.Client, defaultDatabase *string, readOnly bool) {
	a.state.Update(func(s *connState) {
		s.client = client
		s.defaultDatabase = defaultDatabase
		s.readOnly = readOnly
	})
}

// clearConnected is Disconnect's own locked write, once client.Disconnect (a real network call, run
// with no lock held) has returned (F3).
func (a *Adapter) clearConnected() {
	a.state.Update(func(s *connState) {
		s.client = nil
		s.defaultDatabase = nil
	})
}

// queryTokenSeq hands trackerFor a unique identity per registration (F4b/c): mongo has no natural
// per-call identity the way postgres's own backend PID is — RunWithAbortRace can return to its
// caller well before its own goroutine actually finishes, so a later statement in the same
// batch/op can start (and register) while an earlier one's release is still pending; without a
// unique token, the earlier release's own identity check in QueryTracker could delete the later
// registration out from under it.
var queryTokenSeq atomic.Uint64

// TrackQuery is trackerFor's own release-registration hook, threaded down to read.go/mutate.go/
// console.go's RunWithAbortRace call sites in place of the previous no-op release (F4b).
type TrackQuery func() (release func())

// trackerFor is Read/Count/Mutate/Execute's own registration hook (F4b/c).
func (a *Adapter) trackerFor(opID string) TrackQuery {
	register := a.tracker.TrackerFor(opID)
	return func() (release func()) {
		return register(queryTokenSeq.Add(1))
	}
}

func (a *Adapter) Kind() string        { return "mongodb" }
func (a *Adapter) Caps() adapters.Caps { return caps }

type buildInfoResult struct {
	Version string `bson:"version"`
}

// Connect is index.ts's connect.
func (a *Adapter) Connect(ctx context.Context, cfg model.ResolvedConnectionConfig, op *adapters.OpCtx) (adapters.ConnectInfo, error) {
	handle, err := Connect(ctx, cfg, a.deps.Log)
	if err != nil {
		return adapters.ConnectInfo{}, err
	}

	var info buildInfoResult
	err = handle.Client.Database("admin").RunCommand(ctx, bson.D{{Key: "buildInfo", Value: 1}}).Decode(&info)
	if err != nil {
		_ = handle.Client.Disconnect(context.Background())
		return adapters.ConnectInfo{}, mapError(err)
	}

	a.setConnected(handle.Client, handle.DefaultDatabase, cfg.ReadOnly)

	version := info.Version
	if version == "" {
		version = "unknown"
	}
	var details map[string]string
	if handle.DefaultDatabase != nil {
		details = map[string]string{"database": *handle.DefaultDatabase}
	}
	return adapters.ConnectInfo{ServerVersion: "MongoDB " + version, Details: details}, nil
}

// Disconnect is index.ts's disconnect.
func (a *Adapter) Disconnect(ctx context.Context) error {
	// F4: cancel every query this adapter still tracks as running, server-side, before Drain —
	// mirrors postgres/mysqlfamily/clickhouse's own Part 4 F4 fix, via the identical killOp path
	// Cancel already uses.
	for _, opID := range a.tracker.Snapshot() {
		_, _ = a.Cancel(ctx, opID)
	}
	a.tracker.Drain(ctx)

	if client := a.state.Load().client; client != nil {
		disconnectCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), disconnectTimeout)
		_ = client.Disconnect(disconnectCtx)
		cancel()
	}
	a.clearConnected()
	return nil
}

func (a *Adapter) requireClient() (*mongodriver.Client, error) {
	return adapters.RequireConnected(a.state.Load().client)
}

func (a *Adapter) dbFor(name string) (*mongodriver.Database, error) {
	client, err := a.requireClient()
	if err != nil {
		return nil, err
	}
	return client.Database(name), nil
}

// Children is index.ts's children.
func (a *Adapter) Children(ctx context.Context, path model.NodePath, op *adapters.OpCtx) (adapters.TreeChildren, error) {
	segments := path.Segments
	if len(segments) == 0 {
		client, err := a.requireClient()
		if err != nil {
			return adapters.TreeChildren{}, err
		}
		nodes, err := listDatabases(ctx, client)
		if err != nil {
			return adapters.TreeChildren{}, err
		}
		return adapters.TreeChildren{Nodes: nodes}, nil
	}

	databaseSegment := segments[0]
	if databaseSegment.Kind != "database" {
		return adapters.TreeChildren{}, adapters.UnexpectedPathKind(0, databaseSegment.Kind)
	}
	db, err := a.dbFor(databaseSegment.Name)
	if err != nil {
		return adapters.TreeChildren{}, err
	}

	if len(segments) == 1 {
		nodes, err := listCollections(ctx, db)
		if err != nil {
			return adapters.TreeChildren{}, err
		}
		return adapters.TreeChildren{Nodes: nodes}, nil
	}

	objectSegment := segments[1]
	// Rule 5 (Adapter doc comment): Children returns [] for a leaf, never an error. P19 D5's own
	// SQL-relation precedent applies here too: a collection's indexes moved into the definition
	// view (describeIndexes, still used by Describe), so a collection is a leaf like a table.
	if len(segments) == 2 {
		if objectSegment.Kind != "collection" {
			return adapters.TreeChildren{}, adapters.New(adapters.CodeNotFound, "unexpected object kind: "+objectSegment.Kind, nil)
		}
		return adapters.TreeChildren{Nodes: []model.TreeNode{}}, nil
	}

	return adapters.TreeChildren{}, adapters.New(adapters.CodeNotFound, "unrecognized path depth", nil)
}

// requireTwoSegmentObjectPath is Describe/Definition/Read/Count/Mutate's shared database/collection
// path check (P113 G2) — both positions are kind-exact here, unlike postgres/mysqlfamily's own
// unconstrained-object-segment variants, since mongo's Describe/Definition never branch on the
// object segment's Kind the way those do.
func requireTwoSegmentObjectPath(path model.NodePath, opName string) (databaseSegment, objectSegment model.PathSegment, err error) {
	segs, err := adapters.RequirePath(path, opName, adapters.Seg("database"), adapters.Seg("collection"))
	if err != nil {
		return model.PathSegment{}, model.PathSegment{}, err
	}
	return segs[0], segs[1], nil
}

// Describe is index.ts's describe. §8.5: "Mongo has no FK navigation in v1" — this stub satisfies
// the Adapter contract without wiring detail no caller reaches; a document tab never calls
// describe() (ground rules).
func (a *Adapter) Describe(ctx context.Context, path model.NodePath, op *adapters.OpCtx) (model.ObjectMeta, error) {
	databaseSegment, objectSegment, err := requireTwoSegmentObjectPath(path, "describe")
	if err != nil {
		return model.ObjectMeta{}, err
	}
	db, err := a.dbFor(databaseSegment.Name)
	if err != nil {
		return model.ObjectMeta{}, err
	}
	indexes, err := describeIndexes(ctx, db, objectSegment.Name)
	if err != nil {
		return model.ObjectMeta{}, err
	}
	indexMetas := make([]model.IndexMeta, len(indexes))
	for i, idx := range indexes {
		indexMetas[i] = model.IndexMeta{
			Name: idx.Name, Columns: idx.Columns, Unique: idx.Unique,
			Primary: idx.Name == "_id_", Method: nil,
		}
	}
	return model.ObjectMeta{
		Path: model.EncodePath(path.Segments), Kind: "collection", Name: objectSegment.Name,
		QualifiedName: databaseSegment.Name + "." + objectSegment.Name,
		Columns:       []model.ColumnMeta{}, PrimaryKey: nil,
		ForeignKeys: []model.ForeignKeyMeta{}, ReferencedBy: []model.ForeignKeyMeta{},
		Indexes: indexMetas, RowEstimate: nil, Comment: nil,
	}, nil
}

// SchemaColumns — caps.SchemaColumns is false (P22c F11/D8); unreachable while that flag gates
// every caller. A Mongo collection has no declared field set — adapter.go:191's own Describe
// already reports Columns: []model.ColumnMeta{} for the identical reason. Mongo's completion
// mechanism is a different one entirely: sampled from loaded documents (P22c D8), never cached
// here.
func (a *Adapter) SchemaColumns(ctx context.Context, path model.NodePath, op *adapters.OpCtx) ([]model.RelationColumns, error) {
	return nil, adapters.Unsupported("mongodb", "schemaColumns")
}

// Definition is index.ts's definition.
func (a *Adapter) Definition(ctx context.Context, path model.NodePath, op *adapters.OpCtx) (model.ObjectDefinition, error) {
	databaseSegment, objectSegment, err := requireTwoSegmentObjectPath(path, "definition")
	if err != nil {
		return model.ObjectDefinition{}, err
	}
	db, err := a.dbFor(databaseSegment.Name)
	if err != nil {
		return model.ObjectDefinition{}, err
	}
	return buildDefinition(ctx, db, path.Segments, databaseSegment.Name, objectSegment.Name)
}

func (a *Adapter) resolveCollectionTarget(path model.NodePath) (db *mongodriver.Database, collection string, err error) {
	databaseSegment, objectSegment, err := requireTwoSegmentObjectPath(path, "read")
	if err != nil {
		return nil, "", err
	}
	db, err = a.dbFor(databaseSegment.Name)
	if err != nil {
		return nil, "", err
	}
	return db, objectSegment.Name, nil
}

// Read is index.ts's read.
func (a *Adapter) Read(ctx context.Context, req adapters.ReadRequest, op *adapters.OpCtx) (page.Page, error) {
	db, collection, err := a.resolveCollectionTarget(req.Path)
	if err != nil {
		return nil, err
	}
	result, err := readPage(ctx, db, collection, readReq{
		Projection: req.Projection, Filter: req.Filter, Sort: req.Sort,
		PageSize: req.PageSize, Cursor: req.Cursor,
	}, op, a.trackerFor(op.OpID))
	if err != nil {
		return nil, err
	}
	return result, nil
}

// Count is index.ts's count.
func (a *Adapter) Count(ctx context.Context, req adapters.CountRequest, op *adapters.OpCtx) (adapters.CountResult, error) {
	db, collection, err := a.resolveCollectionTarget(req.Path)
	if err != nil {
		return adapters.CountResult{}, err
	}
	return countRows(ctx, db, collection, req.Filter, op, a.trackerFor(op.OpID))
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
	db, err := a.dbFor(plan.Path.Segments[0].Name)
	if err != nil {
		return model.MutationResult{}, err
	}
	return mutateDB(ctx, db, op, a.state.Load().readOnly, plan, a.trackerFor(op.OpID))
}

// Execute is index.ts's execute.
func (a *Adapter) Execute(ctx context.Context, req model.ConsoleRequest, op *adapters.OpCtx) ([]page.Page, error) {
	dbName := a.state.Load().defaultDatabase
	if len(req.Path.Segments) > 0 && req.Path.Segments[0].Kind == "database" {
		name := req.Path.Segments[0].Name
		dbName = &name
	}
	if dbName == nil {
		return nil, adapters.New(adapters.CodeNotFound, "no database selected for the console", nil)
	}
	db, err := a.dbFor(*dbName)
	if err != nil {
		return nil, err
	}
	return execute(ctx, db, a.state.Load().readOnly, op, req.Statements, a.trackerFor(op.OpID))
}

// DownloadObject is index.ts's downloadObject — caps.FileTransfer is false, so no UI ever offers
// Download for mongodb; never reached.
func (a *Adapter) DownloadObject(ctx context.Context, req model.ObjectDownloadRequest, op *adapters.OpCtx) (model.ObjectTransferResult, error) {
	return model.ObjectTransferResult{}, adapters.Unsupported("mongodb", "file transfer")
}

// KeyTypes — caps.KeyTypes is false; unreachable. A collection's documents have no per-item
// engine-level "type" the way a redis key does.
func (a *Adapter) KeyTypes(ctx context.Context, paths []model.NodePath, op *adapters.OpCtx) ([]string, error) {
	return nil, adapters.Unsupported("mongodb", "key types")
}

type currentOpEntry struct {
	// Not necessarily a plain number (can be a compound shard-qualified value) — round-tripped to
	// killOp verbatim rather than assumed to be any particular type.
	OpID any `bson:"opid"`
}

// Cancel is index.ts's cancel. D7's fallback layer: the op's own detached-context race
// (RunWithAbortRace, C6) is the primary cancel path from the caller's perspective; $currentOp +
// killOp, matched by the comment: opId tag every op carries, covers a server-side op the
// client-side abort has already stopped waiting on but that is still running. The $currentOp
// aggregation stage with the default allUsers: false returns only this connection's own in-flight
// ops and needs no special privilege — the common case is an ordinary connection with plain
// readWrite on its own database, not an admin one.
func (a *Adapter) Cancel(ctx context.Context, opID string) (bool, error) {
	client := a.state.Load().client
	if client == nil {
		return false, nil
	}
	admin := client.Database("admin")
	pipeline := mongodriver.Pipeline{
		{{Key: "$currentOp", Value: bson.D{{Key: "allUsers", Value: false}, {Key: "idleConnections", Value: false}}}},
		{{Key: "$match", Value: bson.D{{Key: "command.comment", Value: opID}}}},
	}
	cursor, err := admin.Aggregate(ctx, pipeline)
	if err != nil {
		a.deps.Log("warn", "mongodb cancel("+opID+") failed: "+err.Error())
		return false, nil
	}
	defer cursor.Close(ctx)
	var ops []currentOpEntry
	if err := cursor.All(ctx, &ops); err != nil {
		a.deps.Log("warn", "mongodb cancel("+opID+") failed: "+err.Error())
		return false, nil
	}
	killed := false
	for _, op := range ops {
		if op.OpID == nil {
			continue
		}
		if err := admin.RunCommand(ctx, bson.D{{Key: "killOp", Value: 1}, {Key: "op", Value: op.OpID}}).Err(); err != nil {
			a.deps.Log("warn", "mongodb cancel("+opID+") failed: "+err.Error())
			return false, nil
		}
		killed = true
	}
	return killed, nil
}
