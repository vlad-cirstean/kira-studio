package bridge

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge/rpcstream"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitrpc"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ipcerr"
)

// GitStreamName is the second named stream (docs/v1.5/plans/C10-git-graph-native.md §3.2) —
// StreamName's peer, carrying gitrpc's own wire protocol instead of adapterhost's.
const GitStreamName = "git"

// nativeClientID/nativeLabel identify the native graph's own gitsession.Conn in the same two
// slots an external gitsock client's handshake would fill (ClientID/ClientLabel) — used only for
// attribution (e.g. the undo slot's "made in this window" label), never for trust: there is no
// pairing here to trust (docs/v1.5/plans/C10-git-graph-native.md §3.2).
const (
	nativeClientID = "kira-native"
	nativeLabel    = "This window"
)

// maxGitStreamFrameBytes reuses gitsock's own 8 MiB cap (gitsock/frame.go) — the graph-chunk blobs
// crossing this stream are the same blobs, so there is no reason for a different limit.
const maxGitStreamFrameBytes = 8 << 20

// newStreamConnID mints a per-connection gitsession.ConnID. There is no handshake here to mint one
// for us (gitsock's own sessionId comes from runHandshake) — a fresh random id per ServeGitStream
// call is all gitsession.Conn needs it for: keying this connection's own repo holds and walk state,
// never anything cross-process.
func newStreamConnID() gitsession.ConnID {
	buf := make([]byte, 16)
	_, _ = rand.Read(buf) // crypto/rand.Read never errors on a Reader that never fails to fill.
	return gitsession.ConnID(hex.EncodeToString(buf))
}

// readOnlyMethods is an ALLOWLIST, deliberately: a contract method added later is refused by this
// stream until someone adds it here on purpose. A denylist would admit every future write by
// default, which is the failure mode this file exists to prevent (docs/v1.5/plans/
// C10-git-graph-native.md §4.2).
//
// Every preflight.* method — and remote.pullPreflight/remote.pushPreflight, the same shape under a
// different name — is deliberately ABSENT. A pre-flight is a read, but its only purpose is to stage
// a write; admitting it would let a UI bug render a confirm dialog whose confirm button then fails
// at this layer — a worse experience than the action simply not existing. Pinned explicitly (not
// merely relying on default-deny) by gitstream_test.go's own preflightMethods list, alongside this
// stream's other two "must stay refused" tables (writeMethods, hostAnsweredMethods) — C13-11.
//
// The nine review.* methods below (C11 §3) look like writes but never touch the repository: every
// one is a thin decode-validate-delegate onto gitsession.RepoEntry whose only persistence is
// review.db, a second SQLite file under KIRA_HOME (gitreview/db.go) — internal/gitreview has no
// exec.Command, no os.WriteFile and no git invocation of any kind; its only writes are
// INSERT/UPDATE/DELETE against review_session/review_file/review_range/review_comment. The git
// work these handlers do perform is read-only porcelain (cat-file, merge-base --is-ancestor,
// diff) — no update-index, no write-tree, no commit-tree, no ref update, no working-tree write,
// anywhere in the review path. This is the same shape as repoSettings.set below: a name that says
// "write" whose writes land in Kira's own storage, never the user's repository.
//
// review.session.save/.load are NOT here — handlers.go has no case for either (contract.go's own
// history note: they resume the extension's own context.workspaceState and never reach this
// server), so they stay refused as defence in depth even though nothing routes them anyway.
// review.open/editor.openRangeDiff are likewise absent — answered host-side, never forwarded here.
// undo.peek is admitted because UndoButton.vue reads it to render a label even when undo itself is
// hidden.
var readOnlyMethods = map[string]struct{}{
	"app.init": {}, "repo.open": {}, "repo.close": {},
	"graph.status": {}, "graph.loadMore": {}, "graph.refresh": {},
	"commit.detail": {}, "commit.fileDiff": {}, "file.read": {}, "file.goToTarget": {},
	"blame.line": {}, "working.detail": {}, "refs.list": {}, "status.get": {},
	"stash.list": {}, "stash.show": {}, "globalStash.list": {},
	"undo.peek": {}, "search.run": {},
	"commit.resolvePr": {}, "branch.resolvePr": {},
	"worktree.list": {}, "stack.list": {},
	// repoSettings.set: §4.4 says it only ever writes Kira's own SQLite, never the repository — true,
	// but four of its patch fields are write-only surface this stream must still refuse at the FIELD
	// level (readOnlyRepoSettingsSet below): WorktreePrepareScript/WorktreeBasePath (an approved patch
	// here can later be executed as a real shell command by worktree.prepare — RunPrepare's only gate
	// is "does this match what's currently stored", not "did a human approve this content"; there is
	// no separate prepareScriptApprovedSha gate anywhere in this codebase despite contract.go's own
	// comment naming one) and PullStrategy/CheckoutAutoStash (already hidden client-side per C10 §4.4,
	// never blocked at this layer until now). GraphPageSize/GraphScope/StashShowInGraph/
	// StashIncludeUntracked/ReviewBaseCandidates/LogLevel/GithubEnabled stay allowed.
	"repoSettings.get": {}, "repoSettings.set": {},
	"review.resolveBase": {}, "review.files": {}, "review.fileDiff": {}, "review.mark": {},
	"review.comment.add": {}, "review.comment.list": {}, "review.comment.remove": {},
	"review.comment.clear": {}, "review.comment.export": {}, // review.db only — see above.
}

// readOnlyStreamMethods is layer 1's own allowlist for the one streaming method — graph.stream is
// the only OpenStream call the graph makes; everything else streamed (SPEC's remote progress, for
// instance) is a write-triggered stream with no native caller.
var readOnlyStreamMethods = map[string]struct{}{
	"graph.stream": {},
}

type requestFn = func(ctx context.Context, method string, params json.RawMessage) (any, error)
type streamFn = func(ctx context.Context, method string, params json.RawMessage, emit func(payload any, blob []byte) error) error

// readOnlyRequest wraps next so every request this stream ever serves is checked against
// readOnlyMethods before next is even called — the load-bearing boundary (§4.2 layer 1). This
// cannot be bypassed by any frontend change: a method missing here is refused regardless of what
// hostHandlers.ts or any git-ui component believes is safe.
func readOnlyRequest(next requestFn) requestFn {
	return func(ctx context.Context, method string, params json.RawMessage) (any, error) {
		if _, ok := readOnlyMethods[method]; !ok {
			return nil, ipcerr.New("E_READ_ONLY",
				"gitstream: "+method+" is not available from the native graph surface")
		}
		return next(ctx, method, params)
	}
}

// restrictedRepoSettingsFields are the RepoSettingsPatchWire leaves repoSettings.set must refuse on
// this stream even though the method itself is allowlisted (see readOnlyMethods' own comment).
// repoSettingsSetTouchesRestrictedField decodes just enough of params to check them, following this
// package's existing json.RawMessage-decode-and-inspect precedent (gitrpc's own handlers all decode
// params into a typed struct before acting on it; this does the same, just to inspect instead of
// dispatch).
func repoSettingsSetTouchesRestrictedField(params json.RawMessage) bool {
	var p gitrpc.RepoSettingsSetParams
	if err := json.Unmarshal(params, &p); err != nil {
		// Malformed params: let it through to the real handler, which rejects it properly. This
		// wrapper only ever narrows what the allowlist admits — it is never a substitute for the
		// inner handler's own request validation.
		return false
	}
	patch := p.Patch
	return patch.WorktreePrepareScript != nil || patch.WorktreeBasePath != nil ||
		patch.PullStrategy != nil || patch.CheckoutAutoStash != nil
}

// readOnlyRepoSettingsSet is readOnlyRequest's companion, adding the one FIELD-level restriction
// this stream needs on top of every other method's method-level allow/refuse: repoSettings.set is
// allowed, but only for a patch that leaves every restricted field (above) absent. Composed around
// readOnlyRequest in ServeGitStream so a restricted field is refused before the method-level check
// even runs. Scoped to gitstream.go alone — gitsock's own paired-client path calls
// handlers.Request directly and is completely unaffected by this wrapper.
func readOnlyRepoSettingsSet(next requestFn) requestFn {
	return func(ctx context.Context, method string, params json.RawMessage) (any, error) {
		if method == "repoSettings.set" && repoSettingsSetTouchesRestrictedField(params) {
			return nil, ipcerr.New("E_READ_ONLY",
				"gitstream: repoSettings.set: this field is not available from the native graph surface")
		}
		return next(ctx, method, params)
	}
}

// readOnlyStream is readOnlyRequest's counterpart for OpenStream calls.
func readOnlyStream(next streamFn) streamFn {
	return func(ctx context.Context, method string, params json.RawMessage, emit func(payload any, blob []byte) error) error {
		if _, ok := readOnlyStreamMethods[method]; !ok {
			return ipcerr.New("E_READ_ONLY",
				"gitstream: "+method+" is not available from the native graph surface")
		}
		return next(ctx, method, params, emit)
	}
}

// ServeGitStream runs for the life of one renderer connection, mirroring ServeEngineStream
// (stream.go). Unlike gitsock.handleConn there is no handshake: the peer is this process's own
// webview, not an external client the trust store exists to gate (docs/v1.5/plans/
// C10-git-graph-native.md §3.2). gconn still does its real job — per-connection repo holds, so
// repo.close only ever releases this connection's own hold (gitrpc/handlers.go), and Emit for
// repo.changed.
func ServeGitStream(router *gitrpc.Router, conn StreamSession) {
	gconn := gitsession.NewConn(newStreamConnID(), nativeClientID, nativeLabel, nil)
	// C13-10: the native mount's own repo.open must never arm a RepoEntry's background auto-fetch
	// timer (autofetch.go) — docs/ARCHITECTURE.md documents this surface as provably read-only, and
	// a real git fetch --prune is a write gitsock's own paired, external clients still get to make
	// (unaffected: only this Conn opts out, not RepoEntry.EnsureAutoFetch itself).
	gconn.DisableAutoFetch()
	defer gconn.Close()

	handlers := router.ForConn(gconn)
	sess := rpcstream.NewSession(conn, rpcstream.Handlers{
		ContractVersion: gitrpc.ContractVersion,
		Request:         readOnlyRepoSettingsSet(readOnlyRequest(handlers.Request)),
		Stream:          readOnlyStream(handlers.Stream),
		MaxFrameBytes:   maxGitStreamFrameBytes,
	})
	gconn.Emit = sess.Emit
	sess.Serve()
}
