package adapterhost

import (
	"context"

	"github.com/kirathecat/kira-studio/shell/internal/adapters"
	"github.com/kirathecat/kira-studio/shell/internal/connections"
	"github.com/kirathecat/kira-studio/shell/internal/enginecache"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

// Router is the concrete type that satisfies connections.Backend, tree.Backend and
// bridge.Canceller structurally (A11) — one type, three small consumer-declared interfaces, so
// P58f can delete three declarations rather than a package. It also owns the data-plane routing
// (dataframe.go) and the per-session write queue (session.go).
//
// P58f M10 Phase 4: every kind has been served in-process since P58e M9.3 (ten of ten,
// checkpoint C2), so the Node engine child this Router used to forward non-native kinds to is
// gone — there is no more routing decision to make, only the native path. `NewRouterAllNodeServed`
// and the `*ViaChild` methods that existed solely for internal/connections' and internal/tree's
// tests died in the same commit as this collapse, since nothing left in this package's own tests
// exercised a "kind not native" case once every real kind always is.
type Router struct {
	deps       adapters.Deps
	host       *Host
	dispatcher *Dispatcher
	cache      *enginecache.Cache
}

// NewRouter constructs a Router.
func NewRouter(deps adapters.Deps, cache *enginecache.Cache) *Router {
	host := NewHost(deps, cache)
	return &Router{deps: deps, host: host, dispatcher: NewDispatcher(host, cache), cache: cache}
}

// Host returns the router's own scheduler, for callers that need to Subscribe to op:start/op:end
// (oplog.New, main.go — P58f D9) or push cache config to the same Cache the router's Backend
// methods use.
func (r *Router) Host() *Host { return r.host }

// PushCacheConfig pushes engine-relevant settings (today: the L2 cache byte budget) into the
// Go-native cache this router's Dispatcher reads (§4.9).
func (r *Router) PushCacheConfig(settings model.Settings) {
	r.cache.Configure(settings.Cache.L2BudgetMb * 1024 * 1024)
}

// ---- connections.Backend ----

// Connect is the Go analogue of control.ts's handleConnect.
func (r *Router) Connect(ctx context.Context, cfg model.ResolvedConnectionConfig) (connections.ConnectResult, error) {
	return r.connectNative(ctx, cfg)
}

func (r *Router) connectNative(ctx context.Context, cfg model.ResolvedConnectionConfig) (connections.ConnectResult, error) {
	// A reconnect is a disconnect + connect, never two live clients for the same connection.
	if existing, ok := adapters.GetLiveAdapter(cfg.ID); ok {
		_ = existing.Disconnect(context.Background())
		adapters.DeleteLiveAdapter(cfg.ID)
	}
	adapter, err := adapters.CreateAdapter(cfg.Kind, r.deps)
	if err != nil {
		return connections.ConnectResult{}, err
	}

	id := cfg.ID
	_, value, err := r.host.RunOp(ctx, OpSpec{ConnectionID: &id, Kind: "connect"},
		func(ctx context.Context, op *adapters.OpCtx) (any, error) {
			return adapter.Connect(ctx, cfg, op)
		})
	if err != nil {
		// P13 D2: the engine created this adapter, so it disconnects it on every path, including
		// a failed probe or an aborted connect — an adapter left un-disconnected here can leak
		// whatever its driver already opened (D1).
		_ = adapter.Disconnect(context.Background())
		return connections.ConnectResult{}, err
	}
	adapters.SetLiveAdapter(cfg.ID, adapter)
	info := value.(adapters.ConnectInfo)
	return connections.ConnectResult{ServerVersion: info.ServerVersion, Caps: adapter.Caps()}, nil
}

// Test is control.ts's handleTest: a throwaway adapter, never registered live, connected and
// unconditionally disconnected.
func (r *Router) Test(ctx context.Context, cfg model.ResolvedConnectionConfig) (string, error) {
	return r.testNative(ctx, cfg)
}

func (r *Router) testNative(ctx context.Context, cfg model.ResolvedConnectionConfig) (string, error) {
	adapter, err := adapters.CreateAdapter(cfg.Kind, r.deps)
	if err != nil {
		return "", err
	}
	// P13 D2: unconditional, so a failed probe is cleaned up the same as a successful one.
	defer func() { _ = adapter.Disconnect(context.Background()) }()

	_, value, err := r.host.RunOp(ctx, OpSpec{Kind: "test"},
		func(ctx context.Context, op *adapters.OpCtx) (any, error) {
			return adapter.Connect(ctx, cfg, op)
		})
	if err != nil {
		return "", err
	}
	return value.(adapters.ConnectInfo).ServerVersion, nil
}

// Disconnect covers all three fire-and-forget call sites (onPreconnectExit, Remove, Disconnect —
// A11's own count settled on three connections.Backend methods, not four).
func (r *Router) Disconnect(ctx context.Context, connectionID string) error {
	return r.disconnectNative(ctx, connectionID)
}

func (r *Router) disconnectNative(ctx context.Context, connectionID string) error {
	adapter, ok := adapters.GetLiveAdapter(connectionID)
	if !ok {
		return nil
	}
	id := connectionID
	_, _, err := r.host.RunOp(ctx, OpSpec{ConnectionID: &id, Kind: "disconnect"},
		func(ctx context.Context, op *adapters.OpCtx) (any, error) {
			return nil, adapter.Disconnect(ctx)
		})
	if err != nil {
		return err
	}
	adapters.DeleteLiveAdapter(connectionID)
	// §2.2: disconnecting releases the connection's driver state and all its cached pages.
	r.cache.DropConnection(connectionID)
	return nil
}

// ---- tree.Backend ----

func (r *Router) Children(ctx context.Context, connectionID string, path model.NodePath) (adapters.TreeChildren, error) {
	return r.childrenNative(ctx, connectionID, path)
}

func (r *Router) childrenNative(ctx context.Context, connectionID string, path model.NodePath) (adapters.TreeChildren, error) {
	adapter, err := requireLiveAdapter(connectionID)
	if err != nil {
		return adapters.TreeChildren{}, err
	}
	id := connectionID
	_, value, err := r.host.RunOp(ctx, OpSpec{ConnectionID: &id, Kind: "children"},
		func(ctx context.Context, op *adapters.OpCtx) (any, error) {
			result, err := adapter.Children(ctx, path, op)
			if err != nil {
				return nil, err
			}
			op.SetRows(len(result.Nodes))
			return result, nil
		})
	if err != nil {
		return adapters.TreeChildren{}, err
	}
	children := value.(adapters.TreeChildren)
	// Same nil-slice-over-the-wire hazard describeNative/definitionNative already guard against
	// (P58b's own closeout finding): a native adapter's `var nodes []model.TreeNode` left empty
	// marshals as `null`, not `[]`, and Adapter rule 5 requires Children() to answer a leaf with
	// an empty list, never null -- project/state/tree.ts's `if (treeState.children[k])` and
	// filterTree.ts's `Object.entries` both treat null as "not loaded" or crash outright.
	if children.Nodes == nil {
		children.Nodes = []model.TreeNode{}
	}
	return children, nil
}

func (r *Router) Describe(ctx context.Context, connectionID string, path model.NodePath, tabID *string) (model.ObjectMeta, error) {
	return r.describeNative(ctx, connectionID, path, tabID)
}

func (r *Router) describeNative(ctx context.Context, connectionID string, path model.NodePath, tabID *string) (model.ObjectMeta, error) {
	adapter, err := requireLiveAdapter(connectionID)
	if err != nil {
		return model.ObjectMeta{}, err
	}
	id := connectionID
	_, value, err := r.host.RunOp(ctx, OpSpec{ConnectionID: &id, Kind: "describe", TabID: tabID},
		func(ctx context.Context, op *adapters.OpCtx) (any, error) {
			meta, err := adapter.Describe(ctx, path, op)
			if err != nil {
				return nil, err
			}
			// Native adapters build their list fields (e.g. ReferencedBy) as `var x []T` and leave
			// them nil when empty, which json.Marshal renders as `null` — a cached result gets this
			// normalization for free from tree/service.go's own JSON round trip through the cache,
			// but a live Describe result never passes through there, so it needs it here.
			model.ValidateObjectMeta(&meta)
			op.SetRows(len(meta.Columns))
			return meta, nil
		})
	if err != nil {
		return model.ObjectMeta{}, err
	}
	return value.(model.ObjectMeta), nil
}

func (r *Router) Definition(ctx context.Context, connectionID string, path model.NodePath, tabID *string) (model.ObjectDefinition, error) {
	return r.definitionNative(ctx, connectionID, path, tabID)
}

func (r *Router) definitionNative(ctx context.Context, connectionID string, path model.NodePath, tabID *string) (model.ObjectDefinition, error) {
	adapter, err := requireLiveAdapter(connectionID)
	if err != nil {
		return model.ObjectDefinition{}, err
	}
	id := connectionID
	_, value, err := r.host.RunOp(ctx, OpSpec{ConnectionID: &id, Kind: "definition", TabID: tabID},
		func(ctx context.Context, op *adapters.OpCtx) (any, error) {
			def, err := adapter.Definition(ctx, path, op)
			if err != nil {
				return nil, err
			}
			// Same nil-slice-over-the-wire hazard as describeNative above, for Notes/Constraints/
			// Sections.
			model.ValidateObjectDefinition(&def)
			op.SetRows(len(def.Statements))
			return def, nil
		})
	if err != nil {
		return model.ObjectDefinition{}, err
	}
	return value.(model.ObjectDefinition), nil
}

// ---- bridge.Canceller ----

// Cancel asks the in-process scheduler — the only place an op can be running now that P58f's
// Phase 4 deleted the Node engine child it used to fall back to.
func (r *Router) Cancel(ctx context.Context, opID string) (bool, error) {
	return r.host.CancelOp(ctx, opID)
}
