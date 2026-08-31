package adapterhost

import (
	"context"
	"encoding/json"
	"sync"

	"github.com/kirathecat/kira-studio/shell/internal/adapters"
	"github.com/kirathecat/kira-studio/shell/internal/connections"
	"github.com/kirathecat/kira-studio/shell/internal/enginecache"
	"github.com/kirathecat/kira-studio/shell/internal/enginehost"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

// nativeKinds is the single source of truth for which connection kinds are served in-process. A
// kind is added here in the same commit as its adapter's tests going green, and never earlier
// (A12). Postgres is native as of M5 (checkpoint C1) — every other kind still routes to the Node
// engine child until its own milestone lands.
var nativeKinds = map[string]bool{"postgres": true, "mariadb": true, "mysql": true, "sqlite": true, "clickhouse": true, "mongodb": true, "redis": true, "sqs": true}

// TestKindNodeServed is a connection kind guaranteed to still route to the Node engine child —
// exported so other packages' tests can use one definitely-not-yet-native kind as a placeholder
// without hardcoding a literal that a later milestone's own nativeKinds flip silently turns into a
// real (and wrong) routing decision (P58b B16; AGENTS.md's P58a findings recorded the mechanical
// fix this constant replaces: five files, one grep, every time a kind goes native). Update this to
// the next still-Node-served kind in the same commit that flips its current value's own
// nativeKinds bit. Kafka (P58c C14): the last of the ten kinds to go native (P58e), so this is the
// final move before P58f retires the constant entirely — never point it at redis (this
// sub-phase's own second kind) or at a P58d kind (sqs/s3, native one sub-phase before Kafka).
const TestKindNodeServed = "kafka"

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
		cache: cache, child: child, conns: conns,
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

// isNative reports whether kind is currently served by a Go adapter in this process.
func isNative(kind string) bool { return nativeKinds[kind] }

// IsNativeKind is connections.Backend's fourth method (A15): MarkAllErrored uses it to skip a
// Go-native connection when the Node engine child exits.
func (r *Router) IsNativeKind(kind string) bool { return isNative(kind) }

// ---- connections.Backend ----

// Connect is the Go analogue of control.ts's handleConnect (native) or a plain forward to the
// engine child (Node-served), chosen by cfg.Kind directly — there is no connection state yet to
// look up (§4.9).
func (r *Router) Connect(ctx context.Context, cfg model.ResolvedConnectionConfig) (connections.ConnectResult, error) {
	if isNative(cfg.Kind) {
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
	if isNative(cfg.Kind) {
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
	if kind, ok := r.conns.KindOf(connectionID); ok && isNative(kind) {
		return r.disconnectNative(ctx, connectionID)
	}
	return r.disconnectViaChild(connectionID)
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

func (r *Router) disconnectViaChild(connectionID string) error {
	_, err := r.child.Call(enginehost.OpDisconnect, map[string]any{"connectionId": connectionID})
	return err
}

// ---- tree.Backend ----

func (r *Router) Children(ctx context.Context, connectionID string, path model.NodePath) (adapters.TreeChildren, error) {
	if kind, ok := r.conns.KindOf(connectionID); ok && isNative(kind) {
		return r.childrenNative(ctx, connectionID, path)
	}
	return r.childrenViaChild(connectionID, path)
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

func (r *Router) childrenViaChild(connectionID string, path model.NodePath) (adapters.TreeChildren, error) {
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
	if kind, ok := r.conns.KindOf(connectionID); ok && isNative(kind) {
		return r.describeNative(ctx, connectionID, path)
	}
	return r.describeViaChild(connectionID, path, tabID)
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

func (r *Router) describeViaChild(connectionID string, path model.NodePath, tabID *string) (model.ObjectMeta, error) {
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
	if kind, ok := r.conns.KindOf(connectionID); ok && isNative(kind) {
		return r.definitionNative(ctx, connectionID, path)
	}
	return r.definitionViaChild(connectionID, path, tabID)
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

func (r *Router) definitionViaChild(connectionID string, path model.NodePath, tabID *string) (model.ObjectDefinition, error) {
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
