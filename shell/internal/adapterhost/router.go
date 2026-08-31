package adapterhost

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"sync/atomic"

	"github.com/kirathecat/kira-studio/shell/internal/adapters"
	"github.com/kirathecat/kira-studio/shell/internal/connections"
	"github.com/kirathecat/kira-studio/shell/internal/enginecache"
	"github.com/kirathecat/kira-studio/shell/internal/enginehost"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

// nativeKinds is the single source of truth for which connection kinds are served in-process. A
// kind is added here in the same commit as its adapter's tests going green, and never earlier
// (A12). Ten of ten as of P58e M9.3 (checkpoint C2, §7) — every kind is now served by a Go
// adapter, and the Node engine child, still spawned until P58f's M10, answers no connection
// traffic at all.
var nativeKinds = map[string]bool{"postgres": true, "mariadb": true, "mysql": true, "sqlite": true, "clickhouse": true, "mongodb": true, "redis": true, "sqs": true, "s3": true, "kafka": true}

// KindLookup is the one thing the router needs from internal/connections to make a per-connection
// routing decision — a two-line method on *repos.ConnectionsRepo satisfies it (A11).
type KindLookup interface {
	KindOf(connectionID string) (string, bool)
}

// Router is the concrete type that satisfies connections.Backend, tree.Backend and
// bridge.Canceller structurally (A11) — one type, three small consumer-declared interfaces, so
// P58f can delete three declarations rather than a package. It also owns the data-plane routing
// (dataframe.go) and the per-session write queue (session.go).
type Router struct {
	deps       adapters.Deps
	host       *Host
	dispatcher *Dispatcher
	cache      *enginecache.Cache
	child      *enginehost.Host // nil once P58f deletes the Node sidecar
	conns      KindLookup

	// native is the set of kinds this Router serves in-process. NewRouter shares the package-level
	// nativeKinds map by reference, so a later flip of that map is visible without reconstructing
	// the Router; NewRouterAllNodeServed gives it an empty map instead, so every kind forwards to
	// the child regardless of nativeKinds' own contents.
	native map[string]bool

	// childRoutes counts connection-scoped requests routed to the Node engine child — checkpoint
	// C2's instrument (§7, P58e E24). Zero for the life of the process is the passing value once
	// every kind is native; see noteChildRoute for exactly what is (and is not) counted.
	childRoutes atomic.Int64

	// statsMu guards the router's own passively-observed snapshot of the child's last cache:stats
	// push (A16, dataframe.go's observeChildEvent/mergedCacheStats) — a separate mutex from
	// enginecache.Cache's own, since these two fields have nothing to do with Go's cache.
	statsMu        sync.Mutex
	lastChildStats enginecache.CacheStats
	haveChildStats bool
}

// NewRouter constructs a Router. child may be nil only in a test that never exercises the
// Node-forwarding path; production always has a live engine child through the whole of P58a.
func NewRouter(deps adapters.Deps, cache *enginecache.Cache, child *enginehost.Host, conns KindLookup) *Router {
	host := NewHost(deps, cache)
	return &Router{
		deps: deps, host: host, dispatcher: NewDispatcher(host, cache),
		cache: cache, child: child, conns: conns, native: nativeKinds,
	}
}

// NewRouterAllNodeServed constructs a Router that forwards EVERY kind to the Node engine child.
// Test-only, and it exists for exactly one reason: internal/connections' and internal/tree's tests
// cover connections.Service's and tree.Service's child-forwarding paths, which are still live
// shipped code until P58f's M10 collapses the two EngineBackend implementations into one. Before
// P58e there was always a real kind left to point them at (adapterhost.TestKindNodeServed, retired
// in M9.3); after it there is none. Delete this with the child.
func NewRouterAllNodeServed(deps adapters.Deps, cache *enginecache.Cache, child *enginehost.Host, conns KindLookup) *Router {
	host := NewHost(deps, cache)
	return &Router{
		deps: deps, host: host, dispatcher: NewDispatcher(host, cache),
		cache: cache, child: child, conns: conns, native: map[string]bool{},
	}
}

// Host returns the router's own scheduler, for callers that need to Subscribe to op:start/op:end
// (enginebackend.Merge) or push cache config to the same Cache the router's Backend methods use.
func (r *Router) Host() *Host { return r.host }

// PushCacheConfig pushes engine-relevant settings (today: the L2 cache byte budget) into both
// caches (§4.9) — the Go-native one this router's Dispatcher reads and the Node engine's own,
// which enginehost.PushCacheConfig already reaches unchanged.
func (r *Router) PushCacheConfig(settings model.Settings) {
	r.cache.Configure(settings.Cache.L2BudgetMb * 1024 * 1024)
	if r.child != nil {
		enginehost.PushCacheConfig(r.child, settings)
	}
}

// isNative reports whether kind is currently served by a Go adapter through this Router.
func (r *Router) isNative(kind string) bool { return r.native[kind] }

// IsNativeKind is connections.Backend's fourth method (A15): MarkAllErrored uses it to skip a
// Go-native connection when the Node engine child exits.
func (r *Router) IsNativeKind(kind string) bool { return r.isNative(kind) }

// noteChildRoute records that a request reached the Node engine child on behalf of a real
// connection — the thing checkpoint C2 (P58 §0.3) must observe zero of before P58f's M10 deletes
// the sidecar. It deliberately does NOT count the three kind-agnostic paths that survive a fully
// native app: "ping" (A17, one per boot, paints the status bar), "cache:configure" (settings), and
// "cache:clear" — none of them belongs to a connection, and none of them is what a forgotten kind
// would look like. The slog line names the kind and the op because "the counter is 3" is not
// actionable and "connection kind X still routes adapter:children to the child" is.
func (r *Router) noteChildRoute(op, kind string) {
	r.childRoutes.Add(1)
	slog.Warn("adapterhost: routed a connection request to the Node engine child",
		"scope", "adapterhost", "op", op, "kind", kind)
}

// ChildRoutes reports how many connection-scoped requests have reached the Node child in this
// process's lifetime. Checkpoint C2's instrument; zero is the passing value.
func (r *Router) ChildRoutes() int64 { return r.childRoutes.Load() }

// ---- connections.Backend ----

// Connect is the Go analogue of control.ts's handleConnect (native) or a plain forward to the
// engine child (Node-served), chosen by cfg.Kind directly — there is no connection state yet to
// look up (§4.9).
func (r *Router) Connect(ctx context.Context, cfg model.ResolvedConnectionConfig) (connections.ConnectResult, error) {
	if r.isNative(cfg.Kind) {
		return r.connectNative(ctx, cfg)
	}
	return r.connectViaChild(cfg)
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

func (r *Router) connectViaChild(cfg model.ResolvedConnectionConfig) (connections.ConnectResult, error) {
	r.noteChildRoute("connect", cfg.Kind)
	payload, err := r.child.CallTimeout(enginehost.OpConnect, map[string]any{"config": cfg}, enginehost.ConnectTimeout)
	if err != nil {
		return connections.ConnectResult{}, err
	}
	var result struct {
		ServerVersion string `json:"serverVersion"`
		Caps          any    `json:"caps"`
	}
	if err := json.Unmarshal(payload, &result); err != nil {
		return connections.ConnectResult{}, err
	}
	return connections.ConnectResult{ServerVersion: result.ServerVersion, Caps: result.Caps}, nil
}

// Test is control.ts's handleTest (native): a throwaway adapter, never registered live, connected
// and unconditionally disconnected — or a plain forward for a Node-served kind.
func (r *Router) Test(ctx context.Context, cfg model.ResolvedConnectionConfig) (string, error) {
	if r.isNative(cfg.Kind) {
		return r.testNative(ctx, cfg)
	}
	return r.testViaChild(cfg)
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

// testViaChild mirrors handleTest's own engine-side contract: a connect attempt that fails is a
// normal {ok:false, error} response, not a thrown protocol error — CallTimeout's own error return
// stays reserved for a genuine transport failure (timeout, engine down, unknown op).
func (r *Router) testViaChild(cfg model.ResolvedConnectionConfig) (string, error) {
	r.noteChildRoute("test", cfg.Kind)
	payload, err := r.child.CallTimeout(enginehost.OpTest, map[string]any{"config": cfg}, enginehost.ConnectTimeout)
	if err != nil {
		return "", err
	}
	var result struct {
		OK            bool    `json:"ok"`
		ServerVersion *string `json:"serverVersion"`
		Error         *string `json:"error"`
	}
	if err := json.Unmarshal(payload, &result); err != nil {
		return "", err
	}
	if !result.OK {
		msg := "connection test failed"
		if result.Error != nil {
			msg = *result.Error
		}
		return "", adapters.New(adapters.CodeConnect, msg, nil)
	}
	if result.ServerVersion == nil {
		return "", nil
	}
	return *result.ServerVersion, nil
}

// Disconnect routes on the connection's own kind (sites 1, 2, 5 all forward here — A11's own
// count settled on three connections.Backend methods, not four).
func (r *Router) Disconnect(ctx context.Context, connectionID string) error {
	kind, _ := r.conns.KindOf(connectionID)
	if r.isNative(kind) {
		return r.disconnectNative(ctx, connectionID)
	}
	return r.disconnectViaChild(connectionID, kind)
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

func (r *Router) disconnectViaChild(connectionID, kind string) error {
	r.noteChildRoute("disconnect", kind)
	_, err := r.child.Call(enginehost.OpDisconnect, map[string]any{"connectionId": connectionID})
	return err
}

// ---- tree.Backend ----

func (r *Router) Children(ctx context.Context, connectionID string, path model.NodePath) (adapters.TreeChildren, error) {
	kind, _ := r.conns.KindOf(connectionID)
	if r.isNative(kind) {
		return r.childrenNative(ctx, connectionID, path)
	}
	return r.childrenViaChild(connectionID, path, kind)
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

func (r *Router) childrenViaChild(connectionID string, path model.NodePath, kind string) (adapters.TreeChildren, error) {
	r.noteChildRoute("children", kind)
	payload, err := r.child.Call(enginehost.OpChildren, map[string]any{"connectionId": connectionID, "path": path})
	if err != nil {
		return adapters.TreeChildren{}, err
	}
	var result struct {
		Nodes     []model.TreeNode `json:"nodes"`
		Truncated bool             `json:"truncated"`
	}
	if err := json.Unmarshal(payload, &result); err != nil {
		return adapters.TreeChildren{}, err
	}
	var truncated *bool
	if result.Truncated {
		t := true
		truncated = &t
	}
	return adapters.TreeChildren{Nodes: result.Nodes, Truncated: truncated}, nil
}

func (r *Router) Describe(ctx context.Context, connectionID string, path model.NodePath, tabID *string) (model.ObjectMeta, error) {
	kind, _ := r.conns.KindOf(connectionID)
	if r.isNative(kind) {
		return r.describeNative(ctx, connectionID, path)
	}
	return r.describeViaChild(connectionID, path, tabID, kind)
}

func (r *Router) describeNative(ctx context.Context, connectionID string, path model.NodePath) (model.ObjectMeta, error) {
	adapter, err := requireLiveAdapter(connectionID)
	if err != nil {
		return model.ObjectMeta{}, err
	}
	id := connectionID
	_, value, err := r.host.RunOp(ctx, OpSpec{ConnectionID: &id, Kind: "describe"},
		func(ctx context.Context, op *adapters.OpCtx) (any, error) {
			meta, err := adapter.Describe(ctx, path, op)
			if err != nil {
				return nil, err
			}
			// Native adapters build their list fields (e.g. ReferencedBy) as `var x []T` and leave
			// them nil when empty, which json.Marshal renders as `null` — the TS engine's own
			// arrays were never nil over the wire. describeViaChild's json.Unmarshal path gets this
			// normalization for free from tree/service.go's cache load; a native Describe result
			// never passes through there, so it needs the same nil->[] normalization here.
			model.ValidateObjectMeta(&meta)
			op.SetRows(len(meta.Columns))
			return meta, nil
		})
	if err != nil {
		return model.ObjectMeta{}, err
	}
	return value.(model.ObjectMeta), nil
}

func (r *Router) describeViaChild(connectionID string, path model.NodePath, tabID *string, kind string) (model.ObjectMeta, error) {
	r.noteChildRoute("describe", kind)
	payload, err := r.child.Call(enginehost.OpDescribe, map[string]any{
		"connectionId": connectionID, "path": path, "tabId": tabID,
	})
	if err != nil {
		return model.ObjectMeta{}, err
	}
	var result struct {
		Meta model.ObjectMeta `json:"meta"`
	}
	if err := json.Unmarshal(payload, &result); err != nil {
		return model.ObjectMeta{}, err
	}
	return result.Meta, nil
}

func (r *Router) Definition(ctx context.Context, connectionID string, path model.NodePath, tabID *string) (model.ObjectDefinition, error) {
	kind, _ := r.conns.KindOf(connectionID)
	if r.isNative(kind) {
		return r.definitionNative(ctx, connectionID, path)
	}
	return r.definitionViaChild(connectionID, path, tabID, kind)
}

func (r *Router) definitionNative(ctx context.Context, connectionID string, path model.NodePath) (model.ObjectDefinition, error) {
	adapter, err := requireLiveAdapter(connectionID)
	if err != nil {
		return model.ObjectDefinition{}, err
	}
	id := connectionID
	_, value, err := r.host.RunOp(ctx, OpSpec{ConnectionID: &id, Kind: "definition"},
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

func (r *Router) definitionViaChild(connectionID string, path model.NodePath, tabID *string, kind string) (model.ObjectDefinition, error) {
	r.noteChildRoute("definition", kind)
	payload, err := r.child.Call(enginehost.OpDefinition, map[string]any{
		"connectionId": connectionID, "path": path, "tabId": tabID,
	})
	if err != nil {
		return model.ObjectDefinition{}, err
	}
	var result struct {
		Definition model.ObjectDefinition `json:"definition"`
	}
	if err := json.Unmarshal(payload, &result); err != nil {
		return model.ObjectDefinition{}, err
	}
	return result.Definition, nil
}

// ---- bridge.Canceller ----

// Cancel is A13: ask the in-process scheduler first (op ids are UUIDs — renderer-minted for data
// ops, scheduler-minted for control ops — so they never collide across the two hosts, and "unknown
// here" is a safe discriminator); an op this process never started is forwarded to the child
// unconditionally, which is what makes this the same code path on the day the child is gone (it
// just stops being reached).
func (r *Router) Cancel(ctx context.Context, opID string) (bool, error) {
	if ok, _ := r.host.CancelOp(ctx, opID); ok {
		return true, nil
	}
	if r.child == nil {
		return false, nil
	}
	// This fallback routes on op ownership, not kind (A13) — the router has no connection to look a
	// kind up from here, so noteChildRoute's kind is empty. After M9.3 the Go scheduler owns every
	// op, so this should never fire; if it does, it counts.
	r.noteChildRoute("cancel", "")
	payload, err := r.child.Call(enginehost.OpCancel, map[string]any{"opId": opID})
	if err != nil {
		return false, err
	}
	var result struct {
		Cancelled bool `json:"cancelled"`
	}
	if err := json.Unmarshal(payload, &result); err != nil {
		return false, err
	}
	return result.Cancelled, nil
}
