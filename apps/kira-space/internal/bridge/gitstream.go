package bridge

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"

	"github.com/kirathecat/kira-studio/internal/rpcstream"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitrpc"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsession"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
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

// allowedMethods is an ALLOWLIST, deliberately: a contract method added later is refused by this
// stream until someone adds it here on purpose. A denylist would admit every future write by
// default, which is the failure mode this file exists to prevent (docs/v1.5/plans/
// C10-git-graph-native.md §4.2).
//
// P67e relaxed this stream's own posture from refusing every repository write to admitting every
// operation that writes through git itself — the native window is a writing git client (fetch/
// pull/push/force-push, merge and rebase as pull strategies, undo, restack, stash, worktree add/
// remove, and the sequencer verbs a conflict needs to carry on). Of the 55 methods
// internal/gitrpc's Router.ForConn dispatches, exactly three stay refused here, each for a reason
// this allowlist cannot admit around:
//
//   - worktree.prepare/worktree.cancelPrepare — RunPrepare executes a user-stored shell command
//     with no human-approval gate anywhere in this codebase (its only check is "does this match
//     what's currently stored"); a security boundary, not a file-editing one. Gated client-side by
//     capabilities.runPrepareScript: false (hostHandlers.ts) — the flow stays reachable, WorktreeDialog
//     just refuses to run the script while the flag is false, rather than hiding the affordance.
//   - settings.setGitPath — writes the global git path, which this app's own Settings dialog
//     already owns; no git-ui affordance calls it at all (it is the VS Code extension's own
//     one-time migration routine).
//
// Two more methods stay refused at layer two (repo/git/hostHandlers.ts) as defence in depth even
// though Router.ForConn has no case for either, so they never reach this file's own check:
// editor.resolveConflict (this app has no merge editor — the user's own stated carve-out) and
// worktree.openWindow (vscode.openFolder has no native meaning).
//
// The nine review.* methods below (C11 §3) look like writes but never touch the repository: every
// one is a thin decode-validate-delegate onto gitsession.RepoEntry whose only persistence is
// review.db, a second SQLite file under KIRA_HOME (gitreview/db.go) — internal/gitreview has no
// exec.Command, no os.WriteFile and no git invocation of any kind; its only writes are
// INSERT/UPDATE/DELETE against review_session/review_file/review_range/review_comment. The git
// work these handlers do perform is non-mutating porcelain (cat-file, merge-base --is-ancestor,
// diff) — no update-index, no write-tree, no commit-tree, no ref update, no working-tree write,
// anywhere in the review path. This is the same shape as repoSettings.set below: a name that says
// "write" whose writes land in Kira's own storage, never the user's repository.
//
// commit.resolvePr/branch.resolvePr are plain reads (a GitHub lookup, never returning an RPC
// error for a GitHub-side failure) with one side effect worth naming here since nothing else
// documents it: each purges review.db's own review session for a branch/commit whose PR GitHub
// now reports closed or merged — review.db only, exactly the same storage review.mark and the
// review.comment.* methods already write, never the repository itself.
//
// review.session.save/.load are NOT here — handlers.go has no case for either (contract.go's own
// history note: they resume the extension's own context.workspaceState and never reach this
// server), so they stay refused as defence in depth even though nothing routes them anyway.
// review.open/editor.openRangeDiff are likewise absent — answered host-side, never forwarded here.
// undo.peek is admitted because UndoButton.vue reads it to render a label even when undo itself is
// hidden.
var allowedMethods = map[string]struct{}{
	"app.init": {}, "repo.open": {}, "repo.close": {},
	"graph.status": {}, "graph.loadMore": {}, "graph.refresh": {},
	"commit.detail": {}, "commit.fileDiff": {}, "file.read": {}, "file.goToTarget": {},
	"blame.line": {}, "working.detail": {}, "refs.list": {}, "status.get": {},
	"stash.list": {}, "stash.show": {}, "globalStash.list": {},
	"undo.peek": {}, "search.run": {},
	"commit.resolvePr": {}, "branch.resolvePr": {},
	// pr.browserUrl: a plain read (P74 §3.3) — composes and re-validates a PR's URL for the host's
	// own browser-open path, same shape as commit.resolvePr/branch.resolvePr just above.
	"pr.browserUrl": {},
	"worktree.list": {}, "stack.list": {},
	// repoSettings.set: §4.4 says it only ever writes Kira's own SQLite, never the repository — true,
	// but two of its patch fields are write-only surface this stream must still refuse at the FIELD
	// level (guardRepoSettingsSet below): WorktreePrepareScript/WorktreeBasePath — an approved patch
	// here can later be executed as a real shell command by worktree.prepare; RunPrepare's only gate
	// is "does this match what's currently stored", not "did a human approve this content", and there
	// is no separate prepareScriptApprovedSha gate anywhere in this codebase despite contract.go's own
	// comment naming one. PullStrategy/CheckoutAutoStash are now ordinary settings for operations this
	// stream admits (P67e) and are no longer restricted. GraphPageSize/GraphScope/StashShowInGraph/
	// StashIncludeUntracked/ReviewBaseCandidates/LogLevel/GithubEnabled stay allowed, as before.
	"repoSettings.get": {}, "repoSettings.set": {},
	"review.resolveBase": {}, "review.files": {}, "review.fileDiff": {}, "review.mark": {},
	"review.comment.add": {}, "review.comment.list": {}, "review.comment.remove": {},
	"review.comment.clear": {}, "review.comment.export": {}, // review.db only — see above.
	// P67e: every preflight — a read whose only purpose is to stage a write for a subsequent
	// op.run/remote.run — is now admitted alongside the write it stages, so a confirm dialog's
	// confirm button no longer fails at this layer for an operation the toolbar already offers.
	"preflight.checkout": {}, "preflight.revert": {}, "preflight.reset": {},
	"preflight.cherryPick": {}, "preflight.stashPop": {}, "preflight.stashBranch": {},
	"preflight.worktreeAdd": {}, "preflight.worktreeRemove": {}, "preflight.restack": {},
	"remote.pullPreflight": {}, "remote.pushPreflight": {},
	// P67e: the repository-mutating operations themselves. op.run covers checkout/revert/reset/
	// cherryPick/stashPop/stashBranch/worktreeAdd/worktreeRemove and the sequencer verbs
	// (continue/skip/abort) a conflict needs to carry on; remote.run covers fetch/push/forcePush/
	// deleteRemoteBranch/pull (pull's own strategy — ff-only/merge/rebase — is the only merge or
	// rebase this stack has anywhere, per P67e's own plan doc §7, docs/v1.6/plans/).
	// credential.provide answers git's own askpass prompt for this stream's own remote op
	// (gitCredential.ts/GitCredentialDialog.vue) — the native window now owns the connection the
	// prompt is for, so it is the one that must be able to answer it.
	"op.run": {}, "remote.run": {}, "remote.cancel": {}, "undo.run": {},
	"stack.restack": {}, "stack.cancelRestack": {}, "credential.provide": {},
}

// allowedStreamMethods is layer 1's own allowlist for the one streaming method — graph.stream is
// the only OpenStream call the graph makes; everything else streamed (SPEC's remote progress, for
// instance) is a write-triggered stream with no native caller.
var allowedStreamMethods = map[string]struct{}{
	"graph.stream": {},
}

type requestFn = func(ctx context.Context, method string, params json.RawMessage) (any, error)
type streamFn = func(ctx context.Context, method string, params json.RawMessage, emit func(payload any, blob []byte) error) error

// allowedRequest wraps next so every request this stream ever serves is checked against
// allowedMethods before next is even called — the load-bearing boundary. This cannot be bypassed
// by any frontend change: a method missing here is refused regardless of what hostHandlers.ts or
// any git-ui component believes is safe.
func allowedRequest(next requestFn) requestFn {
	return func(ctx context.Context, method string, params json.RawMessage) (any, error) {
		if _, ok := allowedMethods[method]; !ok {
			return nil, ipcerr.New("E_READ_ONLY",
				"gitstream: "+method+" is not available from the native graph surface")
		}
		return next(ctx, method, params)
	}
}

// repoSettingsSetTouchesRestrictedField are the RepoSettingsPatchWire leaves repoSettings.set must
// refuse on this stream even though the method itself is allowlisted (see allowedMethods' own
// comment). Follows this package's existing json.RawMessage-decode-and-inspect precedent
// (gitrpc's own handlers all decode params into a typed struct before acting on it; this does the
// same, just to inspect instead of dispatch).
func repoSettingsSetTouchesRestrictedField(params json.RawMessage) bool {
	var p gitrpc.RepoSettingsSetParams
	if err := json.Unmarshal(params, &p); err != nil {
		// Malformed params: let it through to the real handler, which rejects it properly. This
		// wrapper only ever narrows what the allowlist admits — it is never a substitute for the
		// inner handler's own request validation.
		return false
	}
	patch := p.Patch
	return patch.WorktreePrepareScript != nil || patch.WorktreeBasePath != nil
}

// guardRepoSettingsSet is allowedRequest's companion, adding the one FIELD-level restriction this
// stream needs on top of every other method's method-level allow/refuse: repoSettings.set is
// allowed, but only for a patch that leaves every restricted field (above) absent. Composed around
// allowedRequest in ServeGitStream so a restricted field is refused before the method-level check
// even runs. Scoped to gitstream.go alone — gitsock's own paired-client path calls
// handlers.Request directly and is completely unaffected by this wrapper.
func guardRepoSettingsSet(next requestFn) requestFn {
	return func(ctx context.Context, method string, params json.RawMessage) (any, error) {
		if method == "repoSettings.set" && repoSettingsSetTouchesRestrictedField(params) {
			return nil, ipcerr.New("E_READ_ONLY",
				"gitstream: repoSettings.set: this field is not available from the native graph surface")
		}
		return next(ctx, method, params)
	}
}

// allowedStream is allowedRequest's counterpart for OpenStream calls.
func allowedStream(next streamFn) streamFn {
	return func(ctx context.Context, method string, params json.RawMessage, emit func(payload any, blob []byte) error) error {
		if _, ok := allowedStreamMethods[method]; !ok {
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
// repo.changed and, since P67e, credential.request.
func ServeGitStream(router *gitrpc.Router, conn StreamSession) {
	gconn := gitsession.NewConn(newStreamConnID(), nativeClientID, nativeLabel, nil)
	// P67e/D5: still opted out, but no longer because writes were refused here — a periodic
	// background `git fetch --prune` is a network write the user never pressed a button for, and
	// every fetch this phase admits is one they did (P67e's own plan doc §9 OQ-2, docs/v1.6/plans/).
	// One deleted line whenever someone actually wants automatic background fetching for this Conn
	// (unaffected: only this Conn opts out, not RepoEntry.EnsureAutoFetch itself, so an
	// already-paired VS Code extension window opening the identical repository still arms it).
	gconn.DisableAutoFetch()
	defer gconn.Close()

	handlers := router.ForConn(gconn)
	sess := rpcstream.NewSession(conn, rpcstream.Handlers{
		ContractVersion: gitrpc.ContractVersion,
		Request:         guardRepoSettingsSet(allowedRequest(handlers.Request)),
		Stream:          allowedStream(handlers.Stream),
		MaxFrameBytes:   maxGitStreamFrameBytes,
	})
	gconn.Emit = sess.Emit
	sess.Serve()
}
