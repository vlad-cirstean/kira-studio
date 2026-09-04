package bridge

import (
	"context"
	"encoding/json"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge/ipcerr"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge/rpcstream"
)

// GitStreamName is §3's second named Wails stream, "git" — Option C over reusing bridge.StreamName
// (§1.3 establishes HandleStream is a map insert; a second name costs nothing and needs no change
// to the first) or building Git's stream on Wails' broadcast Events (rejected: no backpressure,
// and @kira/git-ipc's stream contract is explicitly credit-based).
const GitStreamName = "git"

// This file is the adapter between GitService and internal/bridge/rpcstream, the module-agnostic
// frame protocol that speaks @kira/git-ipc's own req/res/evt/open/chunk/end/credit/cancel wire
// contract (packages/git-ipc/src/rpc.ts). rpcstream owns the protocol — correlation, credits,
// cancellation, the versioned envelope; this file owns only the mapping from a contract method
// name to a GitService call, which is what stays reviewable against rpc.ts's own vocabulary
// without wading through protocol machinery to find it.

// gitRequestHandler adapts one GitService method to the request dispatch table — params arrive as
// raw JSON (already-unmarshalled by json.Unmarshal into whichever concrete Args type the method
// needs), result returned as `any` for the caller to re-marshal onto the wire.
type gitRequestHandler func(ctx context.Context, svc *GitService, params json.RawMessage) (any, error)

// gitRequestHandlers is the complete request-key table — REQUEST_KEYS in validate.ts, restated in
// Go rather than imported (TypeScript is not importable here); tests/unit/wireConformance-shaped
// drift between the two is what a later phase's own parity test (mirroring
// go-ts-vocabulary-parity.spec.ts's existing precedent for tab kinds) would catch, not attempted
// here since P1 adds no new phase-spanning vocabulary of that kind.
var gitRequestHandlers = map[string]gitRequestHandler{
	"app.init": func(ctx context.Context, svc *GitService, _ json.RawMessage) (any, error) {
		return svc.Init(ctx)
	},
	"repo.list": func(_ context.Context, svc *GitService, _ json.RawMessage) (any, error) {
		return svc.ListRepos()
	},
	"repo.pick": func(_ context.Context, svc *GitService, _ json.RawMessage) (any, error) {
		return svc.PickRepo()
	},
	"repo.open": func(ctx context.Context, svc *GitService, params json.RawMessage) (any, error) {
		var args GitRepoOpenArgs
		if err := json.Unmarshal(params, &args); err != nil {
			return nil, ipcerr.BadRequest("invalid params: " + err.Error())
		}
		return svc.OpenRepo(ctx, args)
	},
	"repo.close": func(_ context.Context, svc *GitService, params json.RawMessage) (any, error) {
		var args GitRepoCloseArgs
		if err := json.Unmarshal(params, &args); err != nil {
			return nil, ipcerr.BadRequest("invalid params: " + err.Error())
		}
		return svc.CloseRepo(args)
	},
	"graph.status": func(_ context.Context, svc *GitService, params json.RawMessage) (any, error) {
		var args GitGraphStatusArgs
		if err := json.Unmarshal(params, &args); err != nil {
			return nil, ipcerr.BadRequest("invalid params: " + err.Error())
		}
		return svc.GraphStatus(args)
	},
	"graph.loadMore": func(_ context.Context, svc *GitService, params json.RawMessage) (any, error) {
		var args GitGraphLoadMoreArgs
		if err := json.Unmarshal(params, &args); err != nil {
			return nil, ipcerr.BadRequest("invalid params: " + err.Error())
		}
		return svc.GraphLoadMore(args)
	},
	"graph.refresh": func(_ context.Context, svc *GitService, params json.RawMessage) (any, error) {
		var args GitGraphRefreshArgs
		if err := json.Unmarshal(params, &args); err != nil {
			return nil, ipcerr.BadRequest("invalid params: " + err.Error())
		}
		return svc.GraphRefresh(args)
	},
}

// gitGraphStreamParams is graph.stream's own params shape — a local, minimal decode (only what
// this handler actually reads) rather than importing a wire type from gitclient, since nothing in
// gitclient needs to know its own capability is reachable over a stream.
type gitGraphStreamParams struct {
	RepoID string `json:"repoId"`
}

// ServeGitStream runs for the life of one connection: rpcstream owns the frame protocol
// (correlation, credits, cancellation, the versioned envelope); this file owns only the mapping
// from a contract method name to a GitService call.
func ServeGitStream(svc *GitService, conn StreamSession) {
	rpcstream.Serve(conn, rpcstream.Handlers{
		ContractVersion: GitContractVersion,
		Request: func(ctx context.Context, method string, params json.RawMessage) (any, error) {
			handler, ok := gitRequestHandlers[method]
			if !ok {
				return nil, ipcerr.BadRequest("unknown request method: " + method)
			}
			return handler(ctx, svc, params)
		},
		Stream: func(_ context.Context, method string, params json.RawMessage) error {
			if method != "graph.stream" {
				return ipcerr.BadRequest("unknown stream method: " + method)
			}
			var args gitGraphStreamParams
			if err := json.Unmarshal(params, &args); err != nil {
				return ipcerr.BadRequest("invalid params: " + err.Error())
			}
			if args.RepoID == "" {
				return ipcerr.BadRequest("repoId is required")
			}
			if _, ok := svc.Client.Registry.Get(args.RepoID); !ok {
				return ipcerr.New("E_NOT_FOUND", "no such open repository: "+args.RepoID)
			}
			// A valid open has nothing to walk yet (P1 §0.2: no porcelain parser, no paged
			// `git log`) — a nil return is the clean 'end' with zero chunks that tells
			// graphView's own store "0 rows, exhausted" rather than leaving it waiting.
			return nil
		},
	})
}
