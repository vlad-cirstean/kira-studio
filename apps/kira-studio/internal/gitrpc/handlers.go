package gitrpc

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitaskpass"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitpath"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/notify"
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
	// SetGitPath is G18 D11's own migration leg for kiraVersion.git.path: a plain func, not an
	// interface (the same seam gitsession.Registry.Settings already is), writing straight through
	// to storage/repos.SettingsRepo.Set — never repoSettings.set, since git.path never lived in
	// the per-repo store (D15). Extension-only; nil-safe (see settings.go's handleSettingsSetGitPath).
	SetGitPath func(gitPath string) error
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

// repoSettingsQueueCap bounds each connection's own repoSettings.changed mailbox (ForConn, G32
// round-3 architecture/security review, finding #5) — generous for any realistic burst of
// concurrent repoSettings.set calls while staying tiny; a full queue drops its oldest entry
// rather than growing further, since every payload is a full snapshot anyway.
const repoSettingsQueueCap = 8

// Router builds a per-connection Handlers over one shared Deps — the piece D18 adds: every method
// that touches a repository now needs to know which connection is asking, so it can route through
// that connection's own gitsession.Conn (its holds, its Emit) rather than a single global registry
// (F7).
type Router struct {
	deps Deps

	// repoSettingsChanged is G18 D4/D7's own fan-out: every currently connected client gets
	// repoSettings.set's own result, not only the connection that made the change (§3.18's own
	// cross-connection regression guard) — the same internal/notify.Emitter[T] mechanism
	// gitsock.Server's own clientsChanged already uses, one Router-wide instance rather than a new
	// pub/sub of its own.
	repoSettingsChanged notify.Emitter[RepoSettingsChangedPayload]
}

// New constructs a Router over deps.
func New(deps Deps) *Router { return &Router{deps: deps} }

// ForConn returns the two-function Handlers gitsock hands to one connection's rpcstream.Session —
// c is closed over by repo.open/repo.close, exactly the shape the wire contract itself does not
// change at all (D18): params, results and CONTRACT_VERSION are untouched, only what repo.close
// means does (evict globally -> release this connection's hold).
//
// G18 D7: also subscribes c to repoSettingsChanged for the life of the connection — unsubscribed
// via c.Done() rather than repo.close, since repoSettings.changed is not scoped to any one repo
// being held open (log.level, in particular, is instance-wide). The nil check mirrors entry.go's
// own Subscribe callback: c.Emit is not assigned until just after ForConn returns (gitsock's own
// handleConn), so an event landing in that narrow window is silently dropped rather than panicking
// on a nil func — never observable in practice, since nothing can call repoSettings.set before
// this connection's own Handlers exist to dispatch it.
//
// G32 round-3 architecture/security review, finding #5: notify.Emitter.Emit (notify.go) calls
// every subscriber SEQUENTIALLY, on the calling repoSettings.set request's own goroutine.
// rpcstream.Session.Emit's own send() blocks on a bounded channel until it either accepts the
// frame or THAT connection's own s.done fires — a slow-reading or wedged OTHER client used to be
// able to stall the fan-out entirely, delaying the repoSettings.set RPC response for the client
// that actually made the change, and every subscriber snapshotted after the wedged one. Each
// connection now gets its own small, bounded mailbox (repoSettingsQueueCap) plus ONE dedicated
// forwarding goroutine — never one goroutine per event, which could reorder deliveries against
// each other — so the subscribe callback itself is a non-blocking channel send: a wedged
// connection can only ever stall its own forwarding goroutine, never the emitting caller or any
// other connection. Dropping the oldest queued entry when a connection falls behind is safe
// because RepoSettingsChangedPayload always carries a FULL snapshot (D4) — the next delivery makes
// the client current regardless of what was skipped in between.
func (r *Router) ForConn(c *gitsession.Conn) Handlers {
	settingsQueue := make(chan RepoSettingsChangedPayload, repoSettingsQueueCap)
	unsubscribeRepoSettings := r.repoSettingsChanged.Subscribe(func(payload RepoSettingsChangedPayload) {
		select {
		case settingsQueue <- payload:
		default:
			// The queue is full — this connection is badly behind. Drop the oldest pending
			// snapshot and enqueue the newest, non-blockingly either way; both selects have a
			// default case so a race with the forwarding goroutine draining concurrently can never
			// make this block.
			select {
			case <-settingsQueue:
			default:
			}
			select {
			case settingsQueue <- payload:
			default:
			}
		}
	})
	go func() {
		for {
			select {
			case payload := <-settingsQueue:
				if c.Emit != nil {
					c.Emit("repoSettings.changed", payload)
				}
			case <-c.Done():
				return
			}
		}
	}()
	go func() {
		<-c.Done()
		unsubscribeRepoSettings()
	}()

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
			case "blame.line":
				return r.handleBlameLine(ctx, c, params)
			case "refs.list":
				return r.handleRefsList(ctx, c, params)
			case "status.get":
				return r.handleStatusGet(ctx, c, params)
			case "preflight.checkout":
				return r.handlePreflightCheckout(ctx, c, params)
			case "preflight.revert":
				return r.handlePreflightRevert(ctx, c, params)
			case "preflight.reset":
				return r.handlePreflightReset(ctx, c, params)
			case "preflight.cherryPick":
				return r.handlePreflightCherryPick(ctx, c, params)
			case "stash.list":
				return r.handleStashList(ctx, c, params)
			case "stash.show":
				return r.handleStashShow(ctx, c, params)
			case "preflight.stashPop":
				return r.handlePreflightStashPop(ctx, c, params)
			case "preflight.stashBranch":
				return r.handlePreflightStashBranch(ctx, c, params)
			case "globalStash.list":
				return r.handleGlobalStashList(ctx, c, params)
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
			case "review.comment.add":
				return r.handleReviewCommentAdd(ctx, c, params)
			case "review.comment.list":
				return r.handleReviewCommentList(ctx, c, params)
			case "review.comment.remove":
				return r.handleReviewCommentRemove(ctx, c, params)
			case "review.comment.clear":
				return r.handleReviewCommentClear(ctx, c, params)
			case "review.comment.export":
				return r.handleReviewCommentExport(ctx, c, params)
			case "repoSettings.get":
				return r.handleRepoSettingsGet(ctx, c, params)
			case "repoSettings.set":
				return r.handleRepoSettingsSet(ctx, c, params)
			case "settings.setGitPath":
				return r.handleSettingsSetGitPath(ctx, params)
			case "search.run":
				return r.handleSearchRun(ctx, c, params)
			case "commit.resolvePr":
				return r.handleCommitResolvePr(ctx, c, params)
			case "branch.resolvePr":
				return r.handleBranchResolvePr(ctx, c, params)
			case "worktree.list":
				return r.handleWorktreeList(ctx, c, params)
			case "preflight.worktreeAdd":
				return r.handlePreflightWorktreeAdd(ctx, c, params)
			case "preflight.worktreeRemove":
				return r.handlePreflightWorktreeRemove(ctx, c, params)
			case "worktree.prepare":
				return r.handleWorktreePrepare(ctx, c, params)
			case "worktree.cancelPrepare":
				return r.handleWorktreeCancelPrepare(ctx, c, params)
			case "stack.list":
				return r.handleStackList(ctx, c, params)
			case "preflight.restack":
				return r.handlePreflightRestack(ctx, c, params)
			case "stack.restack":
				return r.handleStackRestack(ctx, c, params)
			case "stack.cancelRestack":
				return r.handleStackCancelRestack(ctx, c, params)
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
		Git:             r.deps.Discovery.Status(ctx, gitPathFrom(r.deps.Registry)),
	}
}

// gitPathFrom is G18 D15's own tiny helper: Registry.Settings' three-value destructure, named so
// it is not repeated at every Discovery.Status call site across handlers.go/graph.go.
// protectedBranches/autoFetchMinutes are unused here — Discovery.Status wants only the third
// value.
func gitPathFrom(reg *gitsession.Registry) string {
	_, _, gitPath := reg.Settings()
	return gitPath
}

func (r *Router) handleRepoOpen(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p RepoOpenParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: repo.open: invalid params")
	}
	if p.Path == "" {
		return nil, ipcerr.BadRequest("gitrpc: repo.open: path is required")
	}
	p.Path = gitpath.CleanNFC(p.Path) // G27 D5d: a client-supplied directory param (D2 tier 1).

	status := r.deps.Discovery.Status(ctx, gitPathFrom(r.deps.Registry))
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
	// G31 round-2 architecture/security review, finding #4: CloseRepo's own map is keyed by
	// entry.Summary.RepoID (NFC, since Identify normalizes) — a decomposed repoId for a non-ASCII
	// repository path used to silently no-op here (CloseRepo already answers {} either way, so
	// nothing errored), leaking that connection's RepoEntry refcount and its watcher subscription
	// for the connection's whole life.
	c.CloseRepo(gitpath.CleanNFC(p.RepoID)) // idempotent either way (D15) — repo.close always answers {}.
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
