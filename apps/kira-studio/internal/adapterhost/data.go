package adapterhost

import (
	"context"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/enginecache"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/page"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// Dispatcher is rpc.ts + data.ts in Go: one method per DATA_OP string, for a connection this
// process serves natively. It never decides whether a connection is native — router.go does that
// before ever reaching here — so every method assumes its connectionId already resolved to a live
// Go adapter.
type Dispatcher struct {
	host  *Host
	cache *enginecache.Cache
}

// NewDispatcher constructs a Dispatcher over host (the scheduler) and cache (L2/L3).
func NewDispatcher(host *Host, cache *enginecache.Cache) *Dispatcher {
	return &Dispatcher{host: host, cache: cache}
}

func requireLiveAdapter(connectionID string) (adapters.Adapter, error) {
	a, ok := adapters.GetLiveAdapter(connectionID)
	if !ok {
		// E_ENGINE_DOWN, not E_NOT_FOUND — several adapters also throw E_NOT_FOUND for an
		// ordinary query-time "not found" unrelated to the connection, and that must not gate a
		// tab behind "Reconnect & load" (viewOp.ts's DISCONNECTED_CODES) for an unknown column.
		return nil, adapters.New(adapters.CodeEngineDown, "connection "+connectionID+" has no active adapter", nil)
	}
	return a, nil
}

func decodePath(connectionID, encoded string) (model.NodePath, error) {
	p, err := model.DecodePath(connectionID, encoded)
	if err != nil {
		return model.NodePath{}, adapters.New(adapters.CodeQuery, err.Error(), err)
	}
	return p, nil
}

// Read is data.ts's handleRead: the phase's hot path. A cache hit is not a database operation and
// must not appear in the op log (P1/P2's contract) — it returns before RunOp is ever called.
func (d *Dispatcher) Read(ctx context.Context, req ReadRequestWire) (ReadResponse, error) {
	cacheReq := enginecache.ReadRequest{
		ConnectionID: req.ConnectionID, Path: req.Path, Projection: req.Projection,
		Filter: req.Filter, Sort: req.Sort, PageSize: req.PageSize, Cursor: req.Cursor,
	}
	key, label := enginecache.PageCacheKey(cacheReq)
	if cached, ok := d.cache.ReadPage(key); ok {
		return ReadResponse{Page: cached, Source: "cache"}, nil
	}

	adapter, err := requireLiveAdapter(req.ConnectionID)
	if err != nil {
		return ReadResponse{}, err
	}
	path, err := decodePath(req.ConnectionID, req.Path)
	if err != nil {
		return ReadResponse{}, err
	}

	connID := req.ConnectionID
	_, value, err := d.host.RunOp(ctx, OpSpec{ConnectionID: &connID, Kind: "read", OpID: req.OpID, TabID: req.TabID},
		func(ctx context.Context, op *adapters.OpCtx) (any, error) {
			p, err := adapter.Read(ctx, adapters.ReadRequest{
				Path: path, Projection: req.Projection, Filter: req.Filter, Sort: req.Sort,
				PageSize: req.PageSize, Cursor: req.Cursor,
			}, op)
			if err != nil {
				return nil, err
			}
			op.SetRows(p.Rows())
			return p, nil
		})
	if err != nil {
		return ReadResponse{}, err
	}

	p := value.(page.Page)
	d.cache.StorePage(key, label, cacheReq, p)
	return ReadResponse{Page: p, Source: "server"}, nil
}

// Count is data.ts's handleCount. Refresh (P13 D18: the renderer's explicit refresh affordance on
// a stale count) bypasses the L3 hit.
func (d *Dispatcher) Count(ctx context.Context, req CountRequestWire) (CountResponse, error) {
	if !req.Refresh {
		if cached, ok := d.cache.Count(req.ConnectionID, req.Path, req.Filter); ok {
			return CountResponse{Value: cached.Value, Exact: cached.Exact, At: cached.At.UnixMilli(), Stale: cached.Stale, Source: "cache"}, nil
		}
	}

	adapter, err := requireLiveAdapter(req.ConnectionID)
	if err != nil {
		return CountResponse{}, err
	}
	path, err := decodePath(req.ConnectionID, req.Path)
	if err != nil {
		return CountResponse{}, err
	}

	connID := req.ConnectionID
	_, value, err := d.host.RunOp(ctx, OpSpec{ConnectionID: &connID, Kind: "count", OpID: req.OpID, TabID: req.TabID},
		func(ctx context.Context, op *adapters.OpCtx) (any, error) {
			result, err := adapter.Count(ctx, adapters.CountRequest{Path: path, Filter: req.Filter}, op)
			if err != nil {
				return nil, err
			}
			rows := int(result.Value)
			op.SetRows(rows)
			return result, nil
		})
	if err != nil {
		return CountResponse{}, err
	}

	result := value.(adapters.CountResult)
	d.cache.StoreCount(req.ConnectionID, req.Path, req.Filter, result.Value, result.Exact)
	return CountResponse{Value: result.Value, Exact: result.Exact, At: time.Now().UnixMilli(), Stale: false, Source: "server"}, nil
}

// Preview is data.ts's handlePreview: never an op, never touches the server (P5 D6) —
// adapter.Preview renders literal SQL text for display only.
func (d *Dispatcher) Preview(req PreviewRequestWire) (PreviewResponse, error) {
	adapter, err := requireLiveAdapter(req.ConnectionID)
	if err != nil {
		return PreviewResponse{}, err
	}
	path, err := decodePath(req.ConnectionID, req.Path)
	if err != nil {
		return PreviewResponse{}, err
	}
	statements, err := adapter.Preview(model.MutationPlan{Path: path, Ops: req.Ops})
	if err != nil {
		return PreviewResponse{}, err
	}
	return PreviewResponse{Statements: statements}, nil
}

// Mutate is data.ts's handleMutate. cache.InvalidateAfterMutation runs unconditionally, mirroring
// the TS's `finally` (P43 F12/D17): six of the eleven adapters mutate without a transaction, so a
// plan that fails part-way through has still changed the server, and leaving its pre-mutation page
// cached as a hit would be silently wrong until the user happened to press Refresh.
func (d *Dispatcher) Mutate(ctx context.Context, req MutateRequestWire) (MutateResponse, error) {
	adapter, err := requireLiveAdapter(req.ConnectionID)
	if err != nil {
		return MutateResponse{}, err
	}
	path, err := decodePath(req.ConnectionID, req.Path)
	if err != nil {
		return MutateResponse{}, err
	}

	connID := req.ConnectionID
	defer d.cache.InvalidateAfterMutation(req.ConnectionID, req.Path)

	_, value, err := d.host.RunOp(ctx, OpSpec{ConnectionID: &connID, Kind: "mutate", OpID: req.OpID, TabID: req.TabID},
		func(ctx context.Context, op *adapters.OpCtx) (any, error) {
			return adapter.Mutate(ctx, model.MutationPlan{Path: path, Ops: req.Ops}, op)
		})
	if err != nil {
		return MutateResponse{}, err
	}
	return MutateResponse{AffectedRows: value.(model.MutationResult).AffectedRows}, nil
}

// ObjectDownload is data.ts's handleObjectDownload. "transfer", not "read" (D9), so a
// multi-hundred-MB download reads as a file transfer in the Operations panel. No cache interaction
// at all — a download streams bytes to a local file, never a Page.
func (d *Dispatcher) ObjectDownload(ctx context.Context, req ObjectDownloadRequestWire) (ObjectDownloadResponse, error) {
	adapter, err := requireLiveAdapter(req.ConnectionID)
	if err != nil {
		return ObjectDownloadResponse{}, err
	}
	path, err := decodePath(req.ConnectionID, req.Path)
	if err != nil {
		return ObjectDownloadResponse{}, err
	}

	connID := req.ConnectionID
	_, value, err := d.host.RunOp(ctx, OpSpec{ConnectionID: &connID, Kind: "transfer", OpID: req.OpID, TabID: req.TabID},
		func(ctx context.Context, op *adapters.OpCtx) (any, error) {
			return adapter.DownloadObject(ctx, model.ObjectDownloadRequest{Path: path, DestPath: req.DestPath}, op)
		})
	if err != nil {
		return ObjectDownloadResponse{}, err
	}
	return ObjectDownloadResponse{Bytes: value.(model.ObjectTransferResult).Bytes}, nil
}

// Execute is data.ts's handleExecute: no cache interaction at all, either direction — console
// results never populate L2, and running a statement here does not auto-invalidate any data tab's
// cache (the adapter has no reliable way to know which table free-form SQL touched).
func (d *Dispatcher) Execute(ctx context.Context, req ExecuteRequestWire) (ExecuteResponse, error) {
	adapter, err := requireLiveAdapter(req.ConnectionID)
	if err != nil {
		return ExecuteResponse{}, err
	}
	path, err := decodePath(req.ConnectionID, req.Path)
	if err != nil {
		return ExecuteResponse{}, err
	}

	connID := req.ConnectionID
	_, value, err := d.host.RunOp(ctx, OpSpec{ConnectionID: &connID, Kind: "execute", OpID: req.OpID, TabID: req.TabID},
		func(ctx context.Context, op *adapters.OpCtx) (any, error) {
			pages, err := adapter.Execute(ctx, model.ConsoleRequest{Path: path, Statements: req.Statements}, op)
			if err != nil {
				return nil, err
			}
			total := 0
			for _, p := range pages {
				total += p.Rows()
			}
			op.SetRows(total)
			return pages, nil
		})
	if err != nil {
		return ExecuteResponse{}, err
	}
	return ExecuteResponse{Pages: value.([]page.Page)}, nil
}

// Invalidate is rpc.ts's inline DATA_OP.invalidate handler (P13 D18): 'pages' is the post-mutation
// reload and must leave the stale count mark DATA_OP.mutate already set intact; anything else is
// the explicit ↻ Refresh, which drops both hard.
func (d *Dispatcher) Invalidate(req InvalidateRequestWire) {
	if req.Scope == "pages" {
		d.cache.DropPagesOnly(req.ConnectionID, req.Path)
	} else {
		d.cache.DropTarget(req.ConnectionID, req.Path)
	}
}
