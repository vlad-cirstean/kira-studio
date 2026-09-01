package redis

import (
	"context"
	"regexp"
	"strconv"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/page"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

func init() {
	adapters.Register("redis", func(deps adapters.Deps) (adapters.Adapter, error) {
		return &Adapter{deps: deps}, nil
	})
}

// Adapter is index.ts's RedisAdapter.
type Adapter struct {
	deps adapters.Deps

	set            *dbConnectionSet
	defaultDbIndex int
	readOnly       bool
}

func (a *Adapter) Kind() string        { return "redis" }
func (a *Adapter) Caps() adapters.Caps { return caps }

var redisVersionRE = regexp.MustCompile(`redis_version:([^\r\n]+)`)

// Connect is index.ts's connect.
func (a *Adapter) Connect(ctx context.Context, cfg model.ResolvedConnectionConfig, op *adapters.OpCtx) (adapters.ConnectInfo, error) {
	set, defaultDbIndex, err := connectRedis(ctx, cfg, a.deps.Log)
	if err != nil {
		return adapters.ConnectInfo{}, err
	}
	primary, err := set.primary(ctx)
	if err != nil {
		set.closeAll()
		return adapters.ConnectInfo{}, err
	}
	serverInfo, err := primary.Info(ctx, "server").Result()
	if err != nil {
		set.closeAll()
		return adapters.ConnectInfo{}, mapError(err)
	}

	a.set = set
	a.defaultDbIndex = defaultDbIndex
	a.readOnly = cfg.ReadOnly

	version := "unknown"
	if m := redisVersionRE.FindStringSubmatch(serverInfo); m != nil {
		version = m[1]
	}
	return adapters.ConnectInfo{
		ServerVersion: "Redis " + version,
		Details:       map[string]string{"database": "db" + strconv.Itoa(a.defaultDbIndex)},
	}, nil
}

// Disconnect is index.ts's disconnect.
func (a *Adapter) Disconnect(ctx context.Context) error {
	if a.set != nil {
		a.set.closeAll()
	}
	a.set = nil
	return nil
}

func (a *Adapter) requireSet() (*dbConnectionSet, error) {
	return adapters.RequireConnected(a.set)
}

// Children is index.ts's children.
func (a *Adapter) Children(ctx context.Context, path model.NodePath, op *adapters.OpCtx) (adapters.TreeChildren, error) {
	segments := path.Segments
	set, err := a.requireSet()
	if err != nil {
		return adapters.TreeChildren{}, err
	}

	if len(segments) == 0 {
		primary, err := set.primary(ctx)
		if err != nil {
			return adapters.TreeChildren{}, err
		}
		nodes, err := listDatabases(ctx, primary)
		if err != nil {
			return adapters.TreeChildren{}, err
		}
		return adapters.TreeChildren{Nodes: nodes}, nil
	}

	dbSegment := segments[0]
	if dbSegment.Kind != "database" {
		return adapters.TreeChildren{}, adapters.New(adapters.CodeNotFound, "unexpected root path segment kind: "+dbSegment.Kind, nil)
	}
	rest := segments[1:]
	// Rule 5 (Adapter doc comment): Children returns [] for a leaf, never an error — a 'key' node
	// never has children.
	if len(rest) > 0 && rest[len(rest)-1].Kind == "key" {
		return adapters.TreeChildren{Nodes: []model.TreeNode{}}, nil
	}

	namespaceSegments := make([]string, 0, len(rest))
	for _, seg := range rest {
		if seg.Kind != "namespace" {
			return adapters.TreeChildren{}, adapters.New(adapters.CodeNotFound, "unexpected path segment kind: "+seg.Kind, nil)
		}
		namespaceSegments = append(namespaceSegments, seg.Name)
	}

	dbIndex, err := dbIndexFromName(dbSegment.Name)
	if err != nil {
		return adapters.TreeChildren{}, err
	}
	conn, err := set.get(ctx, dbIndex)
	if err != nil {
		return adapters.TreeChildren{}, err
	}
	return listNamespaceChildren(ctx, conn, dbSegment.Name, namespaceSegments, op)
}

// Describe is index.ts's describe — caps.Describe is false; unreachable while that flag gates
// every caller.
func (a *Adapter) Describe(ctx context.Context, path model.NodePath, op *adapters.OpCtx) (model.ObjectMeta, error) {
	return model.ObjectMeta{}, adapters.Unsupported("redis", "describe")
}

// Definition is index.ts's definition — caps.Definition is false; unreachable.
func (a *Adapter) Definition(ctx context.Context, path model.NodePath, op *adapters.OpCtx) (model.ObjectDefinition, error) {
	return model.ObjectDefinition{}, adapters.Unsupported("redis", "definition")
}

func (a *Adapter) resolveKeyTarget(path model.NodePath) (dbIndex int, key string, err error) {
	segments := path.Segments
	if len(segments) < 2 || segments[0].Kind != "database" || segments[len(segments)-1].Kind != "key" {
		return 0, "", adapters.New(adapters.CodeNotFound, "read requires a database/.../key path, got: "+model.EncodePath(segments), nil)
	}
	dbIndex, err = dbIndexFromName(segments[0].Name)
	if err != nil {
		return 0, "", err
	}
	return dbIndex, segments[len(segments)-1].Name, nil
}

// Read is index.ts's read.
func (a *Adapter) Read(ctx context.Context, req adapters.ReadRequest, op *adapters.OpCtx) (page.Page, error) {
	set, err := a.requireSet()
	if err != nil {
		return nil, err
	}
	dbIndex, key, err := a.resolveKeyTarget(req.Path)
	if err != nil {
		return nil, err
	}
	conn, err := set.get(ctx, dbIndex)
	if err != nil {
		return nil, err
	}
	result, err := readKey(ctx, conn, key, readReq{PageSize: req.PageSize, Cursor: req.Cursor}, op)
	if err != nil {
		return nil, err
	}
	return result, nil
}

// Count is index.ts's count.
func (a *Adapter) Count(ctx context.Context, req adapters.CountRequest, op *adapters.OpCtx) (adapters.CountResult, error) {
	set, err := a.requireSet()
	if err != nil {
		return adapters.CountResult{}, err
	}
	dbIndex, key, err := a.resolveKeyTarget(req.Path)
	if err != nil {
		return adapters.CountResult{}, err
	}
	conn, err := set.get(ctx, dbIndex)
	if err != nil {
		return adapters.CountResult{}, err
	}
	return countKey(ctx, conn, key)
}

// Preview is index.ts's preview.
func (a *Adapter) Preview(plan model.MutationPlan) ([]string, error) {
	return preview(plan)
}

// Mutate is index.ts's mutate. SET/DEL only: edit is scoped to string-type keys, delete is
// type-agnostic. plan.Path only ever resolves to a database — never a specific key, since a
// mutation plan's own ops name their target key via the _key sentinel — so this only needs to
// pick the right per-db-index connection.
func (a *Adapter) Mutate(ctx context.Context, plan model.MutationPlan, op *adapters.OpCtx) (model.MutationResult, error) {
	set, err := a.requireSet()
	if err != nil {
		return model.MutationResult{}, err
	}
	if len(plan.Path.Segments) == 0 || plan.Path.Segments[0].Kind != "database" {
		return model.MutationResult{}, adapters.New(adapters.CodeNotFound, "unexpected root path segment kind", nil)
	}
	dbIndex, err := dbIndexFromName(plan.Path.Segments[0].Name)
	if err != nil {
		return model.MutationResult{}, err
	}
	conn, err := set.get(ctx, dbIndex)
	if err != nil {
		return model.MutationResult{}, err
	}
	return mutateDB(ctx, conn, op, a.readOnly, plan)
}

// Execute is index.ts's execute.
func (a *Adapter) Execute(ctx context.Context, req model.ConsoleRequest, op *adapters.OpCtx) ([]page.Page, error) {
	set, err := a.requireSet()
	if err != nil {
		return nil, err
	}
	dbIndex := a.defaultDbIndex
	if len(req.Path.Segments) > 0 && req.Path.Segments[0].Kind == "database" {
		idx, err := dbIndexFromName(req.Path.Segments[0].Name)
		if err != nil {
			return nil, err
		}
		dbIndex = idx
	}
	return execute(ctx, set, dbIndex, a.readOnly, op, req.Statements)
}

// DownloadObject is index.ts's downloadObject — caps.FileTransfer is false; never reached.
func (a *Adapter) DownloadObject(ctx context.Context, req model.ObjectDownloadRequest, op *adapters.OpCtx) (model.ObjectTransferResult, error) {
	return model.ObjectTransferResult{}, adapters.Unsupported("redis", "file transfer")
}

// Cancel is index.ts's cancel (D7/D8): CheckCancelled between bounded SCAN-family rounds is fully
// sufficient on its own — every op this adapter issues is either a bounded SCAN-family loop or a
// single fast command — so this stays a permanent no-op rather than attempting a CLIENT KILL that
// would be unsafe under dbConnectionSet's one-connection-per-db-index sharing (C9).
func (a *Adapter) Cancel(ctx context.Context, opID string) (bool, error) {
	return false, nil
}
