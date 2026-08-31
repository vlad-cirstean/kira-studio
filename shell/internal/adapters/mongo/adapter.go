package mongo

import (
	"context"
	"sync"

	"go.mongodb.org/mongo-driver/v2/bson"
	mongodriver "go.mongodb.org/mongo-driver/v2/mongo"

	"github.com/kirathecat/kira-studio/shell/internal/adapters"
	"github.com/kirathecat/kira-studio/shell/internal/page"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

func init() {
	adapters.Register("mongodb", func(deps adapters.Deps) (adapters.Adapter, error) {
		return &Adapter{deps: deps}, nil
	})
}

// Adapter is index.ts's MongoAdapter. D8: one pooled *mongo.Client — the driver's own internal
// pool handles concurrency, so there is no ConnSet/LRU analog to MariaDB's (client.Database(name)
// is a cheap synchronous handle-get, not a new connection).
type Adapter struct {
	deps adapters.Deps

	client          *mongodriver.Client
	defaultDatabase *string
	readOnly        bool

	// inFlight mirrors postgres's/mysqlfamily's/clickhouse's own field of the same name:
	// RunWithAbortRace's background goroutines can still be touching the client well after a
	// local op abort returns to its caller. Disconnect must wait for them before closing.
	inFlight sync.WaitGroup
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

	a.client = handle.Client
	a.defaultDatabase = handle.DefaultDatabase
	a.readOnly = cfg.ReadOnly

	version := info.Version
	if version == "" {
		version = "unknown"
	}
	var details map[string]string
	if a.defaultDatabase != nil {
		details = map[string]string{"database": *a.defaultDatabase}
	}
	return adapters.ConnectInfo{ServerVersion: "MongoDB " + version, Details: details}, nil
}

// Disconnect is index.ts's disconnect.
func (a *Adapter) Disconnect(ctx context.Context) error {
	a.inFlight.Wait()
	if a.client != nil {
		_ = a.client.Disconnect(ctx)
	}
	a.client = nil
	a.defaultDatabase = nil
	return nil
}

func (a *Adapter) requireClient() (*mongodriver.Client, error) {
	return adapters.RequireConnected(a.client)
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
		return adapters.TreeChildren{}, adapters.New(adapters.CodeNotFound,
			"unexpected root path segment kind: "+databaseSegment.Kind, nil)
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

func requireTwoSegmentObjectPath(segments []model.PathSegment, opName string) (databaseSegment, objectSegment model.PathSegment, err error) {
	if len(segments) != 2 || segments[0].Kind != "database" || segments[1].Kind != "collection" {
		return model.PathSegment{}, model.PathSegment{}, adapters.New(adapters.CodeNotFound,
			opName+" requires a database/collection path, got depth "+itoaLen(len(segments)), nil)
	}
	return segments[0], segments[1], nil
}

func itoaLen(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [8]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}

// Describe is index.ts's describe. §8.5: "Mongo has no FK navigation in v1" — this stub satisfies
// the Adapter contract without wiring detail no caller reaches; a document tab never calls
// describe() (ground rules).
func (a *Adapter) Describe(ctx context.Context, path model.NodePath, op *adapters.OpCtx) (model.ObjectMeta, error) {
	databaseSegment, objectSegment, err := requireTwoSegmentObjectPath(path.Segments, "describe")
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

// Definition is index.ts's definition.
func (a *Adapter) Definition(ctx context.Context, path model.NodePath, op *adapters.OpCtx) (model.ObjectDefinition, error) {
	databaseSegment, objectSegment, err := requireTwoSegmentObjectPath(path.Segments, "definition")
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
	databaseSegment, objectSegment, err := requireTwoSegmentObjectPath(path.Segments, "read")
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
	a.inFlight.Add(1)
	defer a.inFlight.Done()
	result, err := readPage(ctx, db, collection, readReq{
		Projection: req.Projection, Filter: req.Filter, Sort: req.Sort,
		PageSize: req.PageSize, Cursor: req.Cursor,
	}, op)
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
	a.inFlight.Add(1)
	defer a.inFlight.Done()
	return countRows(ctx, db, collection, req.Filter, op)
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
	a.inFlight.Add(1)
	defer a.inFlight.Done()
	return mutateDB(ctx, db, op, a.readOnly, plan)
}

// Execute is index.ts's execute.
func (a *Adapter) Execute(ctx context.Context, req model.ConsoleRequest, op *adapters.OpCtx) ([]page.Page, error) {
	dbName := a.defaultDatabase
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
	a.inFlight.Add(1)
	defer a.inFlight.Done()
	return execute(ctx, db, op, req.Statements)
}

// DownloadObject is index.ts's downloadObject — caps.FileTransfer is false, so no UI ever offers
// Download for mongodb; never reached.
func (a *Adapter) DownloadObject(ctx context.Context, req model.ObjectDownloadRequest, op *adapters.OpCtx) (model.ObjectTransferResult, error) {
	return model.ObjectTransferResult{}, adapters.Unsupported("mongodb", "file transfer")
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
	client := a.client
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
