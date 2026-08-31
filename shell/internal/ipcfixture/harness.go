package ipcfixture

import (
	"context"
	"testing"

	"github.com/kirathecat/kira-studio/shell/internal/adapterhost"
	"github.com/kirathecat/kira-studio/shell/internal/adapters"
	"github.com/kirathecat/kira-studio/shell/internal/appcore"
	"github.com/kirathecat/kira-studio/shell/internal/bridge"
	"github.com/kirathecat/kira-studio/shell/internal/connections"
	"github.com/kirathecat/kira-studio/shell/internal/enginecache"
	"github.com/kirathecat/kira-studio/shell/internal/preconnect"
	"github.com/kirathecat/kira-studio/shell/internal/secrets"
	"github.com/kirathecat/kira-studio/shell/internal/storage"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
	"github.com/kirathecat/kira-studio/shell/internal/storage/repos"
	"github.com/kirathecat/kira-studio/shell/internal/tree"
)

// cacheBudgetBytes matches the plan's own §4.2 illustration (64<<20) — any budget large enough
// that a fixture scenario never evicts under memory pressure works; the exact number is not itself
// under test here (internal/enginecache has its own suite for that).
const cacheBudgetBytes = 64 << 20

// App wires the real app stack a fixture generator needs (P58f §4.2): storage through the real
// migrations, a real (Linux-fallback) cipher, connections.Service and tree.Service over a real
// adapterhost.Router/Dispatcher, and the three bridge services every committed fixture's channels
// route through. It is the Go analogue of tests/ipc/support/harness.ts, built with strictly higher
// fidelity: no connectionSummaryOf fabrication and no Map-backed tree stand-in, because the real
// services already exist to call.
type App struct {
	Repos       *repos.Repos
	Secrets     *repos.SecretsRepo
	Connections *connections.Service
	Tree        *tree.Service
	Router      *adapterhost.Router
	Dispatcher  *adapterhost.Dispatcher

	ConnectionsSvc *bridge.ConnectionsService
	TreeSvc        *bridge.TreeService
	OpsSvc         *bridge.OpsService
}

// NewApp builds one App per test, in a fresh temp KIRA_HOME, and registers cleanup in the reverse
// order main.go's own teardown does.
func NewApp(t *testing.T) *App {
	t.Helper()
	t.Setenv("KIRA_HOME", t.TempDir())
	// Required on Linux (AGENTS.md's Secrets section) — the real macOS Keychain path is untestable
	// here, and every fixture scenario needs a working cipher to store a connection's password.
	t.Setenv("KIRA_INSECURE_SECRETS", "1")

	db, err := storage.Open()
	if err != nil {
		t.Fatalf("ipcfixture: storage.Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	r, err := repos.New(db.DB)
	if err != nil {
		t.Fatalf("ipcfixture: repos.New: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })

	cipher := secrets.New()
	if !cipher.Status().Available {
		t.Fatalf("ipcfixture: cipher unavailable: %+v", cipher.Status())
	}
	secretsRepo := repos.NewSecrets(db.DB, cipher)

	deps := adapters.Deps{Log: func(level, message string) {}}
	cache := enginecache.NewCache(cacheBudgetBytes, deps.Log)
	router := adapterhost.NewRouter(deps, cache)
	dispatcher := adapterhost.NewDispatcher(router.Host(), cache)

	pre := preconnect.New()
	connectionsSvc := connections.New(connections.Deps{
		Conns: r.Connections, Secrets: secretsRepo, Metadata: r.Metadata,
		Cipher: cipher, Backend: router, Preconnect: pre,
	})
	connectionsSvc.Start()
	t.Cleanup(connectionsSvc.Shutdown)

	treeSvc := tree.New(r.Connections, r.Metadata, router, connectionsSvc)

	appDeps := appcore.Deps{
		DB: db.DB, Repos: r, Connections: connectionsSvc, Tree: treeSvc, Router: router,
	}

	return &App{
		Repos: r, Secrets: secretsRepo, Connections: connectionsSvc, Tree: treeSvc, Router: router, Dispatcher: dispatcher,
		ConnectionsSvc: &bridge.ConnectionsService{Deps: appDeps},
		TreeSvc:        &bridge.TreeService{Deps: appDeps},
		OpsSvc:         &bridge.OpsService{Deps: appDeps, Canceller: router},
	}
}

// SeedConnection inserts a connection row through the real repo (bypassing only
// connections.Service.Create's own random id.New() assignment, so the fixture's connection id is
// the fixed literal every committed fixture already carries — a harness-only deviation, the same
// one internal/tree's and internal/connections' own fake-backend tests already make) and stores its
// password through the real secrets repo.
func (a *App) SeedConnection(t *testing.T, id string, fields model.ConnectionFields, password *string) model.ConnectionSummary {
	t.Helper()
	created, err := a.Repos.Connections.Insert(id, fields, model.NowISO())
	if err != nil {
		t.Fatalf("ipcfixture: seed connection %s: %v", id, err)
	}
	if err := a.Secrets.Set(id, password); err != nil {
		t.Fatalf("ipcfixture: seed secret %s: %v", id, err)
	}
	return created
}

// Recorder is one scenario's worth of ControlSnapshot/PortSnapshot capture (tests/ipc/support/
// harness.ts's own openHarness() closures, restated as methods since Go has no closures-over-
// mutable-slice idiom as light as JS's). Each method both drives the real call and appends its own
// fixture entry — the same "one call site, one snapshot" discipline every backend.spec.ts follows.
type Recorder struct {
	App     *App
	Control []ControlSnapshot
	Port    []PortSnapshot
}

func NewRecorder(app *App) *Recorder { return &Recorder{App: app} }

func (r *Recorder) recordControl(channel string, args, response any) {
	r.Control = append(r.Control, ControlSnapshot{Channel: channel, Args: rawJSON(args), Response: rawJSON(response)})
}

func (r *Recorder) recordPort(op string, payload, response any, delayMs *int) {
	r.Port = append(r.Port, PortSnapshot{Op: op, Payload: rawJSON(payload), Response: rawJSON(response), DelayMs: delayMs})
}

// ConnectionsList is IPC.connectionsList: bridge.ConnectionsService.List, frozen per §4.3(d).
func (r *Recorder) ConnectionsList(t *testing.T) []model.ConnectionSummary {
	t.Helper()
	list, err := r.App.ConnectionsSvc.List()
	if err != nil {
		t.Fatalf("ipcfixture: connections list: %v", err)
	}
	frozen := make([]FrozenConnectionSummary, len(list))
	for i, s := range list {
		frozen[i] = FreezeConnectionSummary(s)
	}
	r.recordControl(channelConnectionsList, nil, frozen)
	return list
}

// ConnectionsStates is IPC.connectionsStates: bridge.ConnectionsService.States.
func (r *Recorder) ConnectionsStates(t *testing.T) []model.ConnectionState {
	t.Helper()
	states, err := r.App.ConnectionsSvc.States()
	if err != nil {
		t.Fatalf("ipcfixture: connections states: %v", err)
	}
	if states == nil {
		states = []model.ConnectionState{}
	}
	r.recordControl(channelConnectionsStates, nil, states)
	return states
}

// ConnectionsConnect is IPC.connectionsConnect: bridge.ConnectionsService.Connect.
func (r *Recorder) ConnectionsConnect(t *testing.T, id string) model.ConnectionState {
	t.Helper()
	state, err := r.App.ConnectionsSvc.Connect(bridge.ConnectionsIDArgs{ID: id})
	if err != nil {
		t.Fatalf("ipcfixture: connect %s: %v", id, err)
	}
	if state.Status != "connected" {
		msg := ""
		if state.Error != nil {
			msg = *state.Error
		}
		t.Fatalf("ipcfixture: connect %s: status=%s error=%s", id, state.Status, msg)
	}
	r.recordControl(channelConnectionsConnect, bridge.ConnectionsIDArgs{ID: id}, FreezeConnectionState(state))
	return state
}

// TreeChildren is IPC.treeChildren: bridge.TreeService.Children.
func (r *Recorder) TreeChildren(t *testing.T, connectionID, path string, refresh bool) tree.ChildrenResult {
	t.Helper()
	args := bridge.TreeChildrenArgs{ConnectionID: connectionID, Path: path, Refresh: refresh}
	result, err := r.App.TreeSvc.Children(args)
	if err != nil {
		t.Fatalf("ipcfixture: tree children %s %q: %v", connectionID, path, err)
	}
	if result.Nodes == nil {
		result.Nodes = []model.TreeNode{}
	}
	r.recordControl(channelTreeChildren, args, result)
	return result
}

// TreeDescribe is IPC.treeDescribe: bridge.TreeService.Describe.
func (r *Recorder) TreeDescribe(t *testing.T, connectionID, path string, refresh bool, tabID *string) tree.DescribeResult {
	t.Helper()
	args := bridge.TreeDescribeArgs{ConnectionID: connectionID, Path: path, Refresh: refresh, TabID: tabID}
	result, err := r.App.TreeSvc.Describe(args)
	if err != nil {
		t.Fatalf("ipcfixture: tree describe %s %q: %v", connectionID, path, err)
	}
	r.recordControl(channelTreeDescribe, args, result)
	return result
}

// TreeDefinition is IPC.treeDefinition: bridge.TreeService.Definition.
func (r *Recorder) TreeDefinition(t *testing.T, connectionID, path string, refresh bool, tabID *string) tree.DefinitionResult {
	t.Helper()
	args := bridge.TreeDescribeArgs{ConnectionID: connectionID, Path: path, Refresh: refresh, TabID: tabID}
	result, err := r.App.TreeSvc.Definition(args)
	if err != nil {
		t.Fatalf("ipcfixture: tree definition %s %q: %v", connectionID, path, err)
	}
	r.recordControl(channelTreeDefinition, args, result)
	return result
}

// OpsCancel is IPC.opsCancel: bridge.OpsService.Cancel. Every committed fixture captures this
// channel with no args and no response (the TypeScript spec pushed `{channel: IPC.opsCancel}`
// literally, never the real opId or the void result) — matched here rather than "improved", so a
// regenerated fixture does not gratuitously diff commit 12 read-mode's own committed file.
func (r *Recorder) OpsCancel(t *testing.T, opID string) bool {
	t.Helper()
	cancelled, err := r.App.Router.Cancel(context.Background(), opID)
	if err != nil {
		t.Fatalf("ipcfixture: cancel %s: %v", opID, err)
	}
	r.recordControl(channelOpsCancel, nil, nil)
	return cancelled
}

// DataRead is DATA_OP.read: adapterhost.Dispatcher.Read, decoded to a LogicalPage per §4.3(b) and
// wrapped the same way every backend.spec.ts wraps it: {kind: 'read', page, source}.
func (r *Recorder) DataRead(t *testing.T, req adapterhost.ReadRequestWire, delayMs *int) adapterhost.ReadResponse {
	t.Helper()
	resp, err := r.App.Dispatcher.Read(context.Background(), req)
	if err != nil {
		t.Fatalf("ipcfixture: data read %s: %v", req.OpID, err)
	}
	logical, err := DecodePage(resp.Page)
	if err != nil {
		t.Fatalf("ipcfixture: decode page for %s: %v", req.OpID, err)
	}
	response := struct {
		Kind   string `json:"kind"`
		Page   any    `json:"page"`
		Source string `json:"source"`
	}{Kind: "read", Page: logical, Source: resp.Source}
	r.recordPort(dataOpRead, req, response, delayMs)
	return resp
}

// DataCount is DATA_OP.count: adapterhost.Dispatcher.Count, wrapped {kind: 'count', value, exact,
// stale, source} the same way every backend.spec.ts wraps it.
func (r *Recorder) DataCount(t *testing.T, req adapterhost.CountRequestWire) adapterhost.CountResponse {
	t.Helper()
	resp, err := r.App.Dispatcher.Count(context.Background(), req)
	if err != nil {
		t.Fatalf("ipcfixture: data count %s: %v", req.OpID, err)
	}
	response := struct {
		Kind   string `json:"kind"`
		Value  int64  `json:"value"`
		Exact  bool   `json:"exact"`
		Stale  bool   `json:"stale"`
		Source string `json:"source"`
	}{Kind: "count", Value: resp.Value, Exact: resp.Exact, Stale: false, Source: resp.Source}
	r.recordPort(dataOpCount, req, response, nil)
	return resp
}
