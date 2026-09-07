package gitrpc

import (
	"context"
	"encoding/json"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ipcerr"
)

// Deps is everything gitrpc needs; nothing more reaches it (D10/D11).
type Deps struct {
	Client        *gitclient.Client
	ServerVersion string
}

// Handlers is gitrpc's own two-function method table — deliberately not rpcstream.Handlers: gitrpc
// must not import internal/bridge/rpcstream (a domain package must stay under the layering line,
// §3.4), so gitsock is the one that adapts these two functions onto rpcstream.Handlers.
type Handlers struct {
	Request func(ctx context.Context, method string, params json.RawMessage) (any, error)
	Stream  func(ctx context.Context, method string, params json.RawMessage) error
}

// New builds D12's three-arm method table plus its uniform default. There is no per-method test:
// each arm is a thin, already-tested dispatch (AGENTS.md's "thin pass-through wrapper" exclusion)
// — the behaviour that matters is proven end-to-end (§8.1), not restated in a unit test.
func New(deps Deps) Handlers {
	return Handlers{
		Request: func(ctx context.Context, method string, params json.RawMessage) (any, error) {
			switch method {
			case "app.init":
				return handleAppInit(ctx, deps), nil
			case "repo.open":
				return handleRepoOpen(ctx, deps, params)
			case "repo.close":
				return handleRepoClose(deps, params)
			default:
				return nil, ipcerr.New("E_UNKNOWN_METHOD", "gitrpc: unknown method "+method)
			}
		},
		Stream: func(ctx context.Context, method string, params json.RawMessage) error {
			// G1 registers no stream handler (D12) — rpcstream's own Handlers.Stream signature
			// cannot emit a chunk yet regardless (F3), so there is nothing this could serve.
			return ipcerr.New("E_UNKNOWN_METHOD", "gitrpc: unknown method "+method)
		},
	}
}

func handleAppInit(ctx context.Context, deps Deps) AppInitResult {
	return AppInitResult{
		ContractVersion: ContractVersion,
		ServerVersion:   deps.ServerVersion,
		Git:             deps.Client.Status(ctx, ""),
	}
}

func handleRepoOpen(ctx context.Context, deps Deps, params json.RawMessage) (any, error) {
	var p RepoOpenParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: repo.open: invalid params")
	}
	if p.Path == "" {
		return nil, ipcerr.BadRequest("gitrpc: repo.open: path is required")
	}
	return deps.Client.OpenRepo(ctx, "", p.Path)
}

func handleRepoClose(deps Deps, params json.RawMessage) (any, error) {
	var p RepoCloseParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: repo.close: invalid params")
	}
	if p.RepoID == "" {
		return nil, ipcerr.BadRequest("gitrpc: repo.close: repoId is required")
	}
	deps.Client.CloseRepo(p.RepoID)
	return struct{}{}, nil
}
