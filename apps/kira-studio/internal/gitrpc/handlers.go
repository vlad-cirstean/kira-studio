package gitrpc

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitaskpass"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ipcerr"
)

// Deps is everything a Router needs; nothing more reaches it (D10/D11 from G1, unchanged in shape
// — only the fields differ, D18).
type Deps struct {
	Discovery     *gitclient.Discovery
	Runner        gitclient.Runner
	Registry      *gitsession.Registry
	ServerVersion string
	// Askpass is G7's credential broker — nil when it failed to start (main.go's own D8 posture:
	// every remote op then runs with no askpass interposition at all, never a fatal boot error).
	Askpass *gitaskpass.Broker
}

// Handlers is gitrpc's own two-function method table — deliberately not rpcstream.Handlers: gitrpc
// must not import internal/bridge/rpcstream (a domain package must stay under the layering line,
// SPEC §7), so gitsock is the one that adapts these two functions onto rpcstream.Handlers.
type Handlers struct {
	Request func(ctx context.Context, method string, params json.RawMessage) (any, error)
	// Stream mirrors rpcstream.Handlers.Stream structurally (D5) — gitrpc still does not import
	// internal/bridge/rpcstream (SPEC §7's layering rule); gitsock is what adapts the two.
	Stream func(ctx context.Context, method string, params json.RawMessage, emit func(payload any, blob []byte) error) error
}

// Router builds a per-connection Handlers over one shared Deps — the piece D18 adds: every method
// that touches a repository now needs to know which connection is asking, so it can route through
// that connection's own gitsession.Conn (its holds, its Emit) rather than a single global registry
// (F7).
type Router struct{ deps Deps }

// New constructs a Router over deps.
func New(deps Deps) *Router { return &Router{deps: deps} }

// ForConn returns the two-function Handlers gitsock hands to one connection's rpcstream.Session —
// c is closed over by repo.open/repo.close, exactly the shape the wire contract itself does not
// change at all (D18): params, results and CONTRACT_VERSION are untouched, only what repo.close
// means does (evict globally -> release this connection's hold).
func (r *Router) ForConn(c *gitsession.Conn) Handlers {
	return Handlers{
		Request: func(ctx context.Context, method string, params json.RawMessage) (any, error) {
			switch method {
			case "app.init":
				return r.handleAppInit(ctx), nil
			case "repo.open":
				return r.handleRepoOpen(ctx, c, params)
			case "repo.close":
				return handleRepoClose(c, params)
			case "graph.status":
				return r.handleGraphStatus(ctx, c, params)
			case "graph.loadMore":
				return r.handleGraphLoadMore(ctx, c, params)
			case "graph.refresh":
				return r.handleGraphRefresh(ctx, c, params)
			case "commit.detail":
				return r.handleCommitDetail(ctx, c, params)
			case "commit.fileDiff":
				return r.handleCommitFileDiff(ctx, c, params)
			case "file.read":
				return r.handleFileRead(ctx, c, params)
			case "file.goToTarget":
				return r.handleFileGoToTarget(ctx, c, params)
			case "refs.list":
				return r.handleRefsList(ctx, c, params)
			case "status.get":
				return r.handleStatusGet(ctx, c, params)
			case "preflight.checkout":
				return r.handlePreflightCheckout(ctx, c, params)
			case "preflight.revert":
				return r.handlePreflightRevert(ctx, c, params)
			case "op.run":
				return r.handleOpRun(ctx, c, params)
			case "undo.peek":
				return r.handleUndoPeek(ctx, c, params)
			case "undo.run":
				return r.handleUndoRun(ctx, c, params)
			case "review.resolveBase":
				return r.handleReviewResolveBase(ctx, c, params)
			case "remote.pullPreflight":
				return r.handleRemotePullPreflight(ctx, c, params)
			case "remote.pushPreflight":
				return r.handleRemotePushPreflight(ctx, c, params)
			case "remote.run":
				return r.handleRemoteRun(ctx, c, params)
			case "remote.cancel":
				return r.handleRemoteCancel(ctx, c, params)
			case "credential.provide":
				return r.handleCredentialProvide(ctx, c, params)
			case "review.files":
				return r.handleReviewFiles(ctx, c, params)
			case "review.fileDiff":
				return r.handleReviewFileDiff(ctx, c, params)
			case "review.mark":
				return r.handleReviewMark(ctx, c, params)
			default:
				return nil, ipcerr.New("E_UNKNOWN_METHOD", "gitrpc: unknown method "+method)
			}
		},
		Stream: func(ctx context.Context, method string, params json.RawMessage, emit func(payload any, blob []byte) error) error {
			switch method {
			case "graph.stream":
				return r.handleGraphStream(ctx, c, params, emit)
			default:
				return ipcerr.New("E_UNKNOWN_METHOD", "gitrpc: unknown method "+method)
			}
		},
	}
}

func (r *Router) handleAppInit(ctx context.Context) AppInitResult {
	return AppInitResult{
		ContractVersion: ContractVersion,
		ServerVersion:   r.deps.ServerVersion,
		Git:             r.deps.Discovery.Status(ctx, ""),
	}
}

func (r *Router) handleRepoOpen(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p RepoOpenParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: repo.open: invalid params")
	}
	if p.Path == "" {
		return nil, ipcerr.BadRequest("gitrpc: repo.open: path is required")
	}

	status := r.deps.Discovery.Status(ctx, "")
	if status.Kind != "ok" {
		return RepoOpenResult{Kind: "gitUnavailable", Git: &status}, nil
	}

	summary, err := c.Open(ctx, r.deps.Registry, status.Path, p.Path)
	if err != nil {
		if kind, ok := gitclient.KindOf(err); ok && kind == gitclient.KindNotARepository {
			return RepoOpenResult{Kind: "notARepository", Path: p.Path}, nil
		}
		return nil, mapGitError(err)
	}
	// D16: compose the summary with the entry's own LIVE head rather than the value Identify froze
	// at whichever window opened this repo first — a second window opening an already-open
	// repository must see HEAD as it stands now, not as it stood at that first open. Best-effort:
	// a failure here falls back to the frozen value rather than failing repo.open outright.
	if entry, ok := c.Entry(summary.RepoID); ok {
		if head, herr := entry.Head(ctx); herr == nil {
			summary.Head = head
		}
	}
	return RepoOpenResult{Kind: "ok", Repo: &summary}, nil
}

func handleRepoClose(c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p RepoCloseParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: repo.close: invalid params")
	}
	if p.RepoID == "" {
		return nil, ipcerr.BadRequest("gitrpc: repo.close: repoId is required")
	}
	c.CloseRepo(p.RepoID) // idempotent either way (D15) — repo.close always answers {}.
	return struct{}{}, nil
}

// mapGitError turns gitclient's closed error vocabulary into ipcerr codes so the classification
// survives the wire (D6, resolving F6). rpcstream folds anything that is not an *ipcerr.Error into
// E_INTERNAL (bridge/rpcstream/frame.go), which is the whole reason this exists — a git failure
// must cross as E_GIT_<KIND>, never as an anonymous internal error.
func mapGitError(err error) error {
	kind, ok := gitclient.KindOf(err)
	if !ok {
		return err
	}
	return ipcerr.New("E_GIT_"+camelToSnake(string(kind)), err.Error())
}

// camelToSnake converts gitclient's camelCase ErrorKind values ("notARepository") into
// SCREAMING_SNAKE_CASE ("NOT_A_REPOSITORY") for the E_GIT_<KIND> wire code.
func camelToSnake(s string) string {
	var b strings.Builder
	for i, r := range s {
		switch {
		case r >= 'A' && r <= 'Z':
			if i > 0 {
				b.WriteByte('_')
			}
			b.WriteRune(r)
		case r >= 'a' && r <= 'z':
			b.WriteRune(r - ('a' - 'A'))
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}
