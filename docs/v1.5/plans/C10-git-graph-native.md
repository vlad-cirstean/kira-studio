# C10 — Git graph mounted natively, pinned per repo

Mount `packages/git-ui`'s existing graph — the same Vue components the VS Code extension runs today
— into the pinned first tab C5 reserved in every repository workspace. No reimplementation. The
review layer stays out; C11 takes it.

Three things this phase decides, because SPEC assigned them here: the transport, the read-only
boundary, and how a file/diff open from the graph reaches C5/C6's tabs.

## 0. What C5/C6 shipped, and what C10 inherits

- **The pinned tab exists and is empty.** `views/repo/RepoGraphView.vue` is 20 lines: a
  `defineProps<{ tab?: TabRecord }>()` and an `EmptyState` reading "The commit graph for this
  repository is not available yet." Registered at `workbench/tabViews.ts:36` as
  `TAB_VIEWS['repo-graph']`. Created by `createPinnedRepoGraphTab` (`state/tabs.ts:506`), which
  `ensureWorkspaceShell` (`state/repoTabs.ts:63`) calls once per repo workspace. Pinning is real:
  `state/tabs.ts` refuses to close (`:558`), duplicate (`:530`), reorder (`:712`) or bulk-close
  (`:615`, `:669`) a `TAB_KINDS[kind].pinned` tab.
  Both `RepoGraphView.vue`'s own header comment and `tabViews.ts:34` say "replaced wholesale by C9".
  That is stale — SPEC assigns it to C10. Fix both comments in this phase.
- **File tabs work.** `openRepoFileTab(repoId, path, {preview, reveal})` (`state/repoTabs.ts:24`) is
  the single file-open entry point, with C5's preview/permanent slot rules inside `openTab`.
- **Diff tabs work, for one comparison only.** `openRepoDiffTab(repoId, path)`
  (`state/repoTabs.ts:50`) opens a `repo-diff` tab; `RepoDiffView.vue:41` reads it through
  `control.codeWorkspaceReadDiff(repoId, path)`, which is HEAD-vs-worktree
  (`internal/bridge/codeworkspace.go:259`). `repoDiffTabStateSchema` is `z.object({})`
  (`packages/shared/domain/tabs.ts:261`) — a diff tab carries a path and nothing else.
- **The git backend is complete and already serving.** `internal/gitrpc.Router.ForConn`
  (`handlers.go:93`) is a 60-method table; `internal/gitsock` serves it over `${KIRA_HOME}/git.sock`
  behind a pairing handshake. The native app has never spoken to it.

Nothing in C5/C6 anticipated a *commit* diff. That gap is §6's main work.

## 1. What SPEC left open, and how each is resolved

**D1 — Transport: a second, in-process Wails stream, not the socket.** §3. The Go handler table is
reused verbatim; the pairing/trust-store layer is not, because there is no external process to gate.

**D2 — Read-only: a default-deny allowlist in Go, plus host refusal, plus UI absence.** §4. Three
layers, with the Go allowlist as the one that cannot be forgotten by a later Vue edit.

**D3 — SPEC's list of write actions is wrong, and the real one is larger.** §4.1. `git-ui` has no
stage, no unstage, no commit and no discard. It has 24 `OpRequest` kinds, 5 remote ops, undo,
restack, worktree prepare, and more.

**D4 — Commit diffs extend `repo-diff`, they do not fork it.** §6. `repoDiffTabStateSchema` grows a
revision pair; `RepoDiffView.vue` grows one branch; `openTab` is untouched.

**D5 — `HostKind` gains `'kira'`.** `packages/git-ipc/src/contract.ts:16` is
`'vscode' | 'harness'`. A third member is a contract change, not a cast.

**D6 — `capabilities` gains `write: boolean`.** The feature-detect object at `contract.ts:1479` is
already the established "a host does not branch on host kind" mechanism
(`state/detailActions.ts:11`). Native reports `false`; VS Code and the harness report `true`.

**D7 — The C11 seam already exists and costs C10 nothing.** §9.

**D8 — Theme: define `--vscode-*` from `--kira-*`.** §7. One additive stylesheet, zero changes to
`git-ui`'s token layer.

## 2. Where the code lives

**Go, new:**
- `internal/bridge/gitstream.go` — `ServeGitStream`, the read-only allowlist, ~120 lines. Mirrors
  `internal/bridge/stream.go` file for file.
- `internal/shell/app.go` — `RegisterGitStream`, beside `RegisterEngineStream` (`:126`).

**Go, edited:**
- `main.go:143-160` — hoist the inline `gitrpc.New(...)` to a `gitRouter` variable so both
  `gitsock.Deps.Router` and the new stream share one; call `shell.RegisterGitStream` beside
  `shell.RegisterEngineStream` (`:493`).

**`packages/git-ipc`, new/edited:**
- `src/blobFrame.ts` (new) — the blob-frame body parse and `$blob` substitution, lifted out of
  `socketChannel.ts:93-130` unchanged so there is one implementation.
- `src/streamChannel.ts` (new) — a `MessageChannelLike` over a WebSocket-like object.
- `src/socketChannel.ts` — import from `blobFrame.ts` instead of holding its own copy.
- `src/contract.ts` — `HostKind` gains `'kira'`; `capabilities` gains `write`.
- `src/index.ts` — export the two new modules.

**`packages/git-ui`, edited (additive only):**
- `src/components/rowMenuModel.ts` — three read-only menu builders beside the existing five.
- The components listed in §4.3's table — each gains a `v-if` on the new capability.

**Native frontend, new:**
- `src/repo/git/transport.ts` — the split `Transport` (§3.5).
- `src/repo/git/hostHandlers.ts` — the ~10 methods answered in the frontend (§5).
- `src/repo/git/viewStateStore.ts` — `ViewStateStore` over the `repo-graph` tab's state.
- `src/theme/vscode-bridge.css` — `--vscode-*` from `--kira-*` (§7).

**Native frontend, edited:**
- `src/views/repo/RepoGraphView.vue` — replaced wholesale.
- `src/views/repo/RepoDiffView.vue` — the revision branch (§6.2).
- `src/state/repoTabs.ts` — `openRepoCommitDiffTab`.
- `packages/shared/domain/tabs.ts` — `repoDiffTabStateSchema` and `repoGraphTabStateSchema`.
- `apps/kira-studio/frontend/package.json` — four workspace dependencies.

## 3. The transport

### 3.1 What exists

Two facts settle this.

**The Go protocol layer is already transport-agnostic.** `rpcstream.Session` (`session.go:70`) speaks
the whole correlated-RPC-with-credits protocol over `rpcstream.Conn` (`session.go:24`), which is
exactly two methods:

```go
type Conn interface {
	Send(frame []byte) error
	Receive() ([]byte, error)
}
```

`gitsock` supplies that over a `net.Conn` with a 4-byte big-endian length prefix
(`gitsock/frame.go:31,46,67`) — the prefix exists *only* because a `net.Conn` is a byte stream with
no message boundaries. `encodeBody` (`rpcstream/frame.go:63`), including the blob-frame layout
`0x00 | uint32BE headerLen | headerJSON | blob`, lives in `rpcstream`, above the prefix.

**Wails already carries one such stream, and its connection type already fits.**
`internal/bridge/stream.go:8-16` documents it:

> `*application.StreamConn` satisfies it structurally — `Send(frame []byte) error` (stream.go:234)
> and `Receive() ([]byte, error)` (stream.go:274) — so this package still imports no Wails.

`bridge.StreamSession` and `rpcstream.Conn` are the same method set. `RegisterEngineStream`
(`shell/app.go:126`) registers the one named stream today; `app.HandleStream` takes a name, so a
second is one call.

A Wails stream is message-framed. So `*application.StreamConn` can be handed to
`rpcstream.NewSession` **directly**, with no framing adapter at all — the length prefix
`gitsock/frame.go` adds is redundant here, and omitting it is not a protocol change, only the
absence of a byte-stream workaround.

### 3.2 The decision, and why not the socket

**Decision: a second, in-process Wails stream named `"git"`, serving the same `gitrpc.Router`
through the same `rpcstream.Session`, with no handshake, no token and no `git_clients` row.**

Reusing `git.sock` with a self-trusted pre-paired client was considered and rejected on four
grounds, three of them structural:

1. **It breaks outright in a second instance.** `gitsock.Server.Start` (`server.go:94-101`) acquires
   a flock and, when another instance already holds it, logs "another instance is already serving"
   and returns with no listener. That is correct for an external VS Code client — one server is
   enough. It is fatal for the app's own UI: the second window would have no graph at all. An
   in-process stream is per-process by construction and has no such failure mode.
2. **There is no trust boundary to gate.** `gitsock/clients.go`'s `TrustStore` and the pairing
   broker exist to decide whether *some other process on this machine* may drive this repository.
   The Wails renderer is this process's own webview, reached over a channel Wails owns; it is
   already inside every boundary the socket protects. A pairing decision here is a ceremony with no
   question behind it.
3. **It would corrupt a user-facing surface.** A self-paired client needs a real `git_clients` row,
   which the Settings → Connected editors pane lists and offers a Revoke button for
   (`bridge/gitclients.go:45,58`). Revoking the app's own graph from inside the app is not a state
   worth being able to reach.
4. It needs a token minted, stored and read back, plus a special case to suppress the pairing prompt
   — all to reproduce what an in-process call already has.

**Precedent check.** CLAUDE.md asks for precedent reuse. This *is* the precedent: `bridge/stream.go`
is the Wails-side transport and `internal/gitsock` is the socket-side one, and
`internal/layering_test.go` already names them as peers —

> internal/gitsock is the socket-side transport package — the git module's peer of internal/bridge's
> Wails-side transport (SPEC §7), not a domain package sitting underneath

C10 gives the Wails-side peer the same handler table the socket-side one already serves. No new
layer, no new protocol, no third shape.

### 3.3 Go side — `internal/bridge/gitstream.go`

```go
// ServeGitStream runs for the life of one renderer connection, mirroring ServeEngineStream.
// Unlike gitsock.handleConn there is no handshake: the peer is this process's own webview,
// not an external client the trust store exists to gate (see docs/v1.5/plans/C10 §3.2).
func ServeGitStream(router *gitrpc.Router, conn StreamSession) {
	gconn := gitsession.NewConn(gitsession.ConnID(newStreamConnID()), nativeClientID, nativeLabel, nil)
	defer gconn.Close()

	handlers := router.ForConn(gconn)
	sess := rpcstream.NewSession(conn, rpcstream.Handlers{
		ContractVersion: gitrpc.ContractVersion,
		Request:         readOnlyRequest(handlers.Request),
		Stream:          readOnlyStream(handlers.Stream),
		MaxFrameBytes:   maxGitStreamFrameBytes,
	})
	gconn.Emit = sess.Emit
	sess.Serve()
}
```

Structurally identical to `gitsock/server.go:187-219` minus `runHandshake`, `addConn` and `Revoke`
(all three exist for an external client). `gitsession.Conn` still does its real job: per-connection
repo holds, so `repo.close` releases only this renderer's hold (`handlers.go:67-71`'s own F7), and
`Emit` for `repo.changed`.

`readOnlyRequest`/`readOnlyStream` are §4.2. `maxGitStreamFrameBytes` reuses `gitsock`'s 8 MiB
(`gitsock/frame.go:20`) — the graph-chunk blobs are the same blobs.

`main.go` hoists the router:

```go
gitRouter := gitrpc.New(gitrpc.Deps{ /* unchanged, verbatim from main.go:148-158 */ })
gitSock := gitsock.New(gitsock.Deps{ /* … */ Router: gitRouter, /* … */ })
```

and, beside `shell.RegisterEngineStream(app, router)` at `:493`:

```go
shell.RegisterGitStream(app, gitRouter)
```

`internal/bridge` importing `gitrpc`/`gitsession` is allowed — `layering_test.go` forbids the
*reverse* edge (a domain package importing bridge), and `bridge/gitclients.go` already imports
`gitsock`.

### 3.4 Frontend side — the channel

`packages/git-ipc/src/streamChannel.ts`, a `MessageChannelLike` (`rpc.ts:42`) over the Wails
`Stream('git')` object, which is WebSocket-shaped (`bridge/port.ts:31-35` is the precedent:
`Stream('engine')`, `binaryType = 'arraybuffer'`).

- `bufferEncoding: 'native'` — a Wails stream carries real `ArrayBuffer`s, like the socket and unlike
  a VS Code `WebviewView` (`socketChannel.ts:7-9`).
- `post(message)` — `JSON.stringify` and `send`. The client never sends a blob
  (`socketChannel.ts:22`), so there is no encode-side blob path.
- `onMessage(handler)` — each inbound message is one whole frame body. Branch on the first byte: a
  `0x00` is a blob frame, parsed by the shared helper; anything else is `JSON.parse`.
- No length prefix, no `recvBuffer`, no drain loop, no `MAX_PENDING_FRAMES` queue. All four exist in
  `socketChannel.ts` solely because a socket delivers bytes, not messages.

`blobFrame.ts` is `socketChannel.ts:93-130` moved verbatim — `BLOB_FRAME_DISCRIMINANT`,
`isBlobMarker`, `substituteBlob`, `substituteBlobRoot`, `MalformedBlobFrameError` — plus a
`parseBlobFrameBody(body: Uint8Array): unknown` holding the header-length/bounds checks currently
inline at `socketChannel.ts:179-200`. `socketChannel.ts` then imports them. One implementation of
the blob layout on the TypeScript side, matching the one implementation on the Go side
(`rpcstream/frame.go:63`).

### 3.5 The split transport

VS Code has three tiers: webview → (postMessage) → extension host → (socket) → Go. The middle tier
is `proxyHandlers.ts` (`:180`), which answers ~12 methods locally and forwards the rest
(`connection.request`, `:198-200`).

The native app has two tiers. The middle tier's *job* still exists — `editor.openDiff`,
`clipboard.write`, `app.init`'s host half and `repo.list` are host concerns the Go server has no
case for (`review.open`'s comment at `proxyHandlers.ts:470` says so explicitly: "The server has no
review.open case and answers E_UNKNOWN_METHOD"). Its *process* does not.

So: implement `Transport` (`git-ipc/src/transport.ts:33` — four methods) directly, dispatching per
method, rather than stacking a second `createRpcClient`/`createRpcServer` correlation layer inside
one JS context to move objects between two halves of the same heap.

```ts
// src/repo/git/transport.ts
export function createNativeGitTransport(deps: HostDeps): Transport {
  const remote = createRpcClient(createStreamChannel(Stream('git')));
  const host = createHostHandlers(deps);           // §5, total over its own key set
  return {
    request(method, params, signal) {
      const local = host[method];
      return local ? local(params, signal) : remote.request(method, params, signal);
    },
    on: (method, handler) => remote.on(method, handler),
    stream: (method, params, onChunk, signal) => remote.stream(method, params, onChunk, signal),
    dispose: () => remote.dispose(),
  };
}
```

`on`/`stream` never need a local arm: every event and the one stream (`graph.stream`) originate in
Go. `BridgeClient` (`git-ui/src/bridge/client.ts:31`) consumes only this interface, so `mount()`
takes it unchanged.

`host` is typed `Partial<{ [K in RequestKey]: (p: ParamsOf<K>, s?: AbortSignal) => Promise<ResultOf<K>> }>`.
Partial, not total — unlike `ServerHandlers`, an absent key here means "forward", which is the
correct default and the one that cannot silently drop a method a later contract adds. The methods
that must *never* forward get an explicit throwing entry, exactly as `proxyHandlers.ts:520` and
`:576` already do for `credential.provide`/`settings.setGitPath`.

## 4. The read-only boundary

The safety-critical section. C5 §11 and C6 §12 both hold: no write reaches the repository from the
native surface.

### 4.1 The real write surface

SPEC's C10 row names "stage/unstage, commit, discard and undo". Checked against the code:
**`git-ui` has no stage, no unstage, no commit and no discard action at all.** `staged`/`unstaged`
appear only as counts read from `status.get` (`UncommittedChangesStrip.vue:116`, `ops.ts:1727`) and
as prose inside two dialogs. There is no `commit` `OpRequest` kind and no commit button.

The actual surface, enumerated from `contract.ts:889-1120` (`OpRequest`), `:792` (`RemoteOpKind`)
and the call sites in `git-ui/src/state/`:

| RPC method | What it writes |
|---|---|
| `op.run` | 24 kinds: `checkout`, `branchCreate`, `branchDelete`, `branchRename`, `tagCreate`, `tagDelete`, `tagPush`, `tagDeleteRemote`, `revert`, `reset`, `cherryPick`, `stashPush`, `stashApply`, `stashPop`, `stashDrop`, `stashBranch`, `globalStashSave`, `globalStashRemove`, `worktreeAdd`, `worktreeRemove`, `stackSet`, `opContinue`, `opAbort`, `opSkip` |
| `remote.run` | `fetch`, `push`, `pull`, `forcePush`, `deleteRemoteBranch` |
| `remote.cancel` | cancels the above |
| `undo.run` | reflog-based undo of a previous op |
| `worktree.prepare` | runs a user-supplied prepare script in a new worktree |
| `worktree.cancelPrepare` | cancels the above |
| `stack.restack` / `stack.cancelRestack` | rebases a branch stack |
| `credential.provide` | answers a git credential prompt |
| `editor.resolveConflict` | opens a conflicted file for editing |
| `settings.setGitPath` | writes Kira's global git path |
| `repoSettings.set` | writes Kira's per-repo display settings (SQLite only — see §4.4) |
| `review.mark`, `review.comment.add/remove/clear`, `review.session.save` | review state (C11) |

Call sites: `ops.ts:436,491,508,614,687,703,799,887,954,1144,1272,1325,1438,1532,1700,1745`,
`stack.ts:123`, `repoSettings.ts:97`, `reviewFiles.ts:260`, `reviewComments.ts:99,132,155`,
`App.vue:758`.

### 4.2 Three layers, and which one is load-bearing

**Layer 1 — a default-deny allowlist in Go (`gitstream.go`). This is the real boundary.**

```go
// readOnlyMethods is an ALLOWLIST, deliberately: a contract method added later is refused by this
// stream until someone adds it here on purpose. A denylist would admit every future write by
// default, which is the failure mode this file exists to prevent.
var readOnlyMethods = map[string]struct{}{
	"app.init": {}, "repo.open": {}, "repo.close": {},
	"graph.status": {}, "graph.loadMore": {}, "graph.refresh": {},
	"commit.detail": {}, "commit.fileDiff": {}, "file.read": {}, "file.goToTarget": {},
	"blame.line": {}, "working.detail": {}, "refs.list": {}, "status.get": {},
	"stash.list": {}, "stash.show": {}, "globalStash.list": {},
	"undo.peek": {}, "search.run": {},
	"commit.resolvePr": {}, "branch.resolvePr": {},
	"worktree.list": {}, "stack.list": {},
	"repoSettings.get": {}, "repoSettings.set": {}, // §4.4
}

func readOnlyRequest(next requestFn) requestFn {
	return func(ctx context.Context, method string, params json.RawMessage) (any, error) {
		if _, ok := readOnlyMethods[method]; !ok {
			return nil, ipcerr.New("E_READ_ONLY",
				"gitstream: "+method+" is not available from the native graph surface")
		}
		return next(ctx, method, params)
	}
}
```

Every `preflight.*` method is deliberately **absent**. A pre-flight is a read, but its only purpose
is to stage a write; admitting them would let a UI bug render a confirm dialog whose confirm button
then fails at layer 1 — a worse experience than the action simply not existing. `undo.peek` is
admitted because `UndoButton.vue` reads it to render a label even when undo itself is hidden, and
removing it would mean editing `ops.ts`'s polling.

`readOnlyStream` admits `graph.stream` only.

This layer cannot be bypassed by any frontend change, and it is the only layer with that property.

**Layer 2 — host refusal in `hostHandlers.ts`.** `credential.provide`, `editor.resolveConflict`,
`settings.setGitPath`, `worktree.openWindow` and `review.open` get explicit throwing entries. These
never reach Go at all under VS Code either, so layer 1 would refuse them with a confusing message;
a local throw names the real reason.

**Layer 3 — UI absence.** §4.3. Not a security boundary — a convenience and an honesty measure, so
the surface never offers something the layers below will refuse.

### 4.3 Per-action treatment

The mechanism is D6's `capabilities.write`, threaded exactly like the five capabilities already
threaded (`App.vue:1440,1479,1507,1709`; `detailActions.ts:11-14`). Native: `false`.

**Hidden, not disabled — the default.** A greyed control invites "how do I enable this?", and here
there is no answer: the surface is read-only by design, permanently. `buildRowMenu:99` already
establishes "absent (not disabled)" for a capability the host lacks, and
`buildReviewRowMenu`'s doc comment (`rowMenuModel.ts:110-118`) argues the general case:

> Kept separate from `buildRowMenu` rather than that function gated down to nothing by a flag, so a
> reader never has to check "which of these does the review row actually get" against a table of
> conditions — there is no table, there is a second, smaller function.

C10 follows that precedent rather than inventing a second convention.

| Affordance | Where | Treatment | Why |
|---|---|---|---|
| Fetch, Push, Force-push | `AppToolbar.vue:308-345` | Hidden (`v-if="write"`) | No read meaning. Three permanently-dead buttons is pure noise. |
| Pull + strategy picker | `AppToolbar.vue:318` (`PullStrategyPicker`) | Hidden | Same. |
| Stash changes | `AppToolbar.vue:365` | Hidden | Same. |
| Cancel remote op / cancel worktree prepare | `AppToolbar.vue:399,420` | Hidden | Only reachable while a write is running; none can start. |
| Undo | `UndoButton.vue`, mounted `AppToolbar.vue:429` | Hidden | SPEC names undo explicitly. It is a write (`undo.run`). |
| Refresh | `RefreshButton.vue`, `AppToolbar.vue:304` | **Kept** | `graph.refresh` re-walks; writes nothing. |
| Search toggle | `AppToolbar.vue:377` | **Kept** | Read. |
| Repo settings gear | `AppToolbar.vue:387` | **Kept, dialog narrowed** | §4.4. |
| Commit row menu: checkout / create branch / create tag / revert / reset / cherry-pick | `rowMenuModel.ts:63-97` | Hidden — new `buildReadOnlyRowMenu` returning only the clipboard section | The `buildReviewRowMenu` precedent, verbatim. |
| Commit row menu: copy SHA / copy message | `rowMenuModel.ts:102-103` | **Kept** | Clipboard, not git. |
| Ref menu: checkout / rename / delete / push tag / delete on remote | `buildRefMenu:175-250` | Hidden — new `buildReadOnlyRefMenu` | As above. |
| Ref menu: "Review branch changes" | `buildRefMenu:219,227`; handled `App.vue:736` | **Hidden in C10** | Routes to `review.open`, which has no native surface until C11. Restored by C11. |
| Ref menu: stack set-parent / remove / restack | `buildRefMenu:256-273` | Hidden | `stackSet` is an `op.run` kind; `stack.restack` rebases. |
| Ref menu: go to parent/child branch | `buildRefMenu:267,270` | Hidden | Both resolve a branch and call `runCheckout` (`contract.ts:1446-1451`) — a write despite the navigational name. |
| Stash row menu: apply / pop / drop / create branch / save to global | `buildStashMenu:295`, `buildGlobalStashMenu:336` | Hidden — new `buildReadOnlyStashMenu` returning `stashShow` only | |
| Stash row menu: "Show changes" | `rowMenuModel.ts:323` | **Kept** | Read. |
| Worktree create / remove | `WorktreeList.vue:31` emit, its own remove dialog (`:49-53`) | Hidden | |
| Worktree switch / open in new window | `WorktreeList.vue:29-30` | Hidden | Switch is a checkout; "open in new window" has no native meaning (`worktree.openWindow` is VS Code's `openFolder`). |
| Worktree list itself | `WorktreeList.vue` | **Kept** | Read. |
| Every dialog under `components/dialogs/` except `RepoSettingsDialog.vue` | 14 files | Not mounted | Each exists to confirm one write. With every entry point hidden, mounting them is dead code. Remove from `App.vue`'s template under `v-if="write"`, not from the package. |
| Conflict banner's "Resolve in VS Code" | `App.vue:758`, gated `:1507` on `capabilities.resolveConflict` | Already off | Native reports `resolveConflict: false`; the existing gate covers it. Layer 2 throws regardless. |
| Working-tree strip and pane | `UncommittedChangesStrip.vue`, `WorkingDetailPane.vue` | **Kept** | Read-only already: its only action is `editor.openWorkingDiff` (`App.vue:1220-1228`), which §6.3 routes to a diff tab. |
| File tree "Copy path" | `buildFileRowMenu:138` | **Kept** | Clipboard. |

Nothing in this table is "disabled with a visible reason". That is a deliberate uniform answer, and
§14 OQ2 asks a human to confirm it — the one plausible counter-case is a user who knows the VS Code
extension and wonders where the buttons went.

### 4.4 `repoSettings.*` is the one honest exception

`repoSettings.set` writes **Kira's own SQLite**, never the repository: `main.go:134` wires
`gitRegistry.RepoSettingsSet = repositories.GitRepoSettings.Set`. The settings it holds include
graph scope and page size — genuinely read-side controls governing how much history the graph walks.
Denying it would remove a read feature to enforce a write boundary it does not cross.

So: allowed at layer 1, gear kept, and `RepoSettingsDialog.vue`'s write-only fields (pull strategy,
protected branches) hidden under the same `write` capability. `settings.setGitPath` is **denied** —
it is the global git path, which the native app already owns through its own Settings dialog, and
two surfaces writing one row is a bug waiting to happen.

## 5. Host-answered methods

`hostHandlers.ts`, the native counterpart to `proxyHandlers.ts`'s local arm:

| Method | Native answer |
|---|---|
| `app.init` | Forward to Go for `contractVersion`/`git` (Go's `handleAppInit` returns exactly those plus `serverVersion`, `handlers.go:258`), then compose `host: 'kira'`, `settings` from the native settings store, and `capabilities: { openInEditor: true, goToFile: false, clipboard: true, resolveConflict: false, openWorktreeWindow: false, runPrepareScript: false, write: false }`. Mirrors `proxyHandlers.ts:218-239`. |
| `repo.list` | From `code_repos` via `state/coderepos.ts`. `candidates` maps each `CodeRepo` to `{path: root}`; `activeRepoId` is the current workspace's repo. |
| `repo.open` | Forward verbatim. §5.1 on identity. |
| `editor.openDiff` | §6.1 |
| `editor.openAllChanges` | §6.1 |
| `editor.openWorkingDiff` | §6.3 |
| `editor.openRangeDiff` | Throw (C11). |
| `editor.goToFile` | Throw. `detailActions.ts:58` records that no caller remains after G21 D12; a throw is honest and costs nothing. |
| `clipboard.write` | `navigator.clipboard.writeText`. |
| `review.open`, `review.session.save/load` | Throw (C11). |
| `credential.provide`, `editor.resolveConflict`, `settings.setGitPath`, `worktree.openWindow` | Throw (§4.2 layer 2). |

### 5.1 Three identities, and the one that will cause a bug

`model.CodeRepo` (`internal/storage/model/coderepos.go:8`) carries both:

- `ID` — `code_repos.id`, a UUID. **This is what the native frontend calls `repoId` everywhere**:
  `repoWorkspaceKey(repoId)`, `openRepoFileTab(repoId, …)`, `codeWorkspaceReadDiff(repoId, …)`.
- `RepoID` — `gitclient.RepoSummary.RepoID`, set at import (`bridge/codeworkspace.go:150`).
  **This is what `git-ui` calls `repoId`**, and what every `gitrpc` method is addressed by.

`internal/codeworkspace/session.go:26` states the trap outright:

> `RepoID  string // code_repos.id — the app's own handle, not gitclient's RepoID.`

The two are never equal and never interchangeable. `hostHandlers.ts` owns the only mapping —
`gitRepoIdFor(codeRepoId)` and `codeRepoIdFor(gitRepoId)`, both over the `code_repos` list, both
returning `undefined` rather than guessing. Every `editor.*` handler converts on the way in (git →
code) before touching `openRepoFileTab`/`openRepoDiffTab`, which speak `CodeRepo.ID` only.

Because C5's import already stores `RepoID` from the same `gitclient.Identify` call `repo.open` runs
(`codeworkspace.go:131`), the mapping is exact, not heuristic.

## 6. File and diff opens

### 6.1 Commit diffs — the real gap

`editor.openDiff`'s params are `{repoId, sha, path, parentIndex, pinned, fallbackSha?}`
(`detailActions.ts:37-44`). C6's `repo-diff` tab holds a path and compares HEAD to the worktree. A
commit diff is neither side.

**Extend, don't fork.**

`packages/shared/domain/tabs.ts:261`:

```ts
export const repoDiffTabStateSchema = /*#__PURE__*/ z.object({
  // C10: the revision pair. Both null ⇒ C6's HEAD-vs-worktree comparison, unchanged.
  // `.default(null)` keeps every tab saved before this field existed restorable — the same
  // discipline repoFileTabStateSchema's own revealLine already follows.
  left: z.string().nullable().default(null),
  right: z.string().nullable().default(null),
  leftLabel: z.string().nullable().default(null),
  rightLabel: z.string().nullable().default(null),
});
```

`state/repoTabs.ts` gains:

```ts
// C10: openTab's dedupe key is (workspaceId, kind, connectionId, path) — two commits' diffs of the
// same file would collide on it. This wrapper does its own lookup over the revision pair as well,
// then delegates with reuse:false, so openTab's own key stays exactly what C5 defined.
export function openRepoCommitDiffTab(
  repoId: string, path: string, left: string, right: string,
  labels: { left: string; right: string }, pinned: boolean,
): OpenTabResult
```

`RepoDiffView.vue:29-60` gains one branch at the top of `mount()`:

- `tab.state.left === null` → today's `control.codeWorkspaceReadDiff(repoId, path)`, byte-identical.
- otherwise → two `file.read` calls over the git transport. `file.read`'s params are
  `{repoId, rev, path}` and its result is `found | missing | binary | tooLarge`
  (`contract.ts:2024-2031`) — the same four states this component already renders at `:48-59`, so
  the classification code is reused rather than rewritten. `repoId` here is the **git** repoId.

`proxyHandlers.ts:390` confirms the revision freedom: "`file.read` already accepts any git-resolvable
`rev`, `HEAD` included — it is not restricted to a sha `commit.detail` already named".

The rest of `mount()` — `loadMonaco`, `getOrCreateModel`, `createDiffEditor` with `readOnly: true`,
`renderMarginRevertIcon: false`, `renderGutterMenu: false` (`:77-93`) — is untouched. C6 D7's rule
(only the worktree side is registered as navigable, `:71-75`) extends naturally: for a commit diff
**neither** side is on disk, so neither is registered.

`editor.openDiff`'s handler resolves the base sha the way `proxyHandlers.ts:280-307` does — one
`commit.detail` call, `detail.parents[detail.parentIndex]`, with the `fallbackSha` retry for the
untracked-stash case — then calls `openRepoCommitDiffTab`. `pinned` maps straight onto C5's
preview/permanent split: `pinned: false` → `{preview: true}`.

`editor.openAllChanges` loops the same opener over `detail.files` and returns
`{opened, failed, mode: 'tabs'}` — the `'tabs'` arm of a result shape that already exists
(`detailActions.ts:54`), because the native workspace has no multi-diff editor.

### 6.2 File opens

`git-ui` has no plain "open this file" action reaching a host — every file row opens a *diff*
(`FileTree.vue:81`'s `openFile` → `DetailPane` → `actions.openInEditor` → `editor.openDiff`). So
§6.1 covers it, and `openRepoFileTab` is reached from the graph only through C7's search and C9's
quick-open, both already wired.

### 6.3 Working-tree diffs

`editor.openWorkingDiff` (`App.vue:1220-1228`) is exactly C6's comparison. Its handler calls
`openRepoDiffTab(codeRepoId, path)` unchanged — no revision fields, no new code path.

## 7. Theme and CSS

**Tokens.** `git-ui`'s whole colour layer is `--kv-X: var(--vscode-X, <literal>)`
(`theme/vscode-tokens.css:9+`). With no `--vscode-*` defined, every token falls back to its
hardcoded VS Code Dark literal — `git-ui` would render dark inside a light Kira window.

Fix: `src/theme/vscode-bridge.css`, defining the `--vscode-*` names `vscode-tokens.css` reads, from
Kira's own `--kira-*`. Additive, zero changes to `git-ui`, and it works through the existing
`var(…, fallback)` chain — a name Kira has no equivalent for simply keeps its literal.

This also resolves what would otherwise be a collision. `git-ui/src/main.ts:16-17` imports its own
`theme/kui-bridge.css` (mapping `--kui-*` from `--kv-*`) and the native app already has
`src/theme/kui-bridge.css` (mapping `--kui-*` from `--kira-*`); both declare at `:root`, so the
later import wins globally. Once `--kv-*` resolves *from* `--kira-*`, both bridges compute the same
values and the collision is harmless rather than needing resolution.

The native bridge was written for this moment — its header (`theme/kui-bridge.css:5-6`) says:

> nothing in this app's own UI imports `@kira/kira-ui` yet (§8 item 1's own explicit non-goal for
> this phase) — this file alone stays inert until something does.

C10 is what does.

**Document CSS.** `git-ui/src/main.ts:10` imports `theme/app-shell.css`, which sets
`html, body { height: 100%; margin: 0; padding: 0; overflow: hidden }`. That file's own comment
warns:

> A future host that wants to mount this package into a region of a larger page, rather than own the
> whole document, needs a different entry point — not a flag here.

Checked against the native document: `frontend/src/theme/base.css:52-58` already sets
`html, body, #app { height: 100%; margin: 0; overflow: hidden }`, and Tailwind preflight already
zeroes body padding. The rules are the same rules. So `mount()` is used **unchanged** — SPEC's "no
reimplementation" is served, and the anticipated conflict does not arise in this particular host.
§14 OQ1 flags it anyway, because the comment is an explicit warning from the package's authors and a
human should agree before we rely on the coincidence.

`mount()` adds `.kv-mount-root` to the container (`main.ts:86`), which needs a sized parent — the
tab body already provides one, the same way `RepoDiffView.vue`'s `.monaco-host` does.

## 8. Mounting, lifecycle and persistence

`RepoGraphView.vue` becomes a mount host, modelled on `RepoDiffView.vue`:

```ts
onMounted(async () => {
  handle = mount(container.value!, {
    transport: gitTransportFor(repoId),   // one per repo workspace, cached
    viewState: new TabViewStateStore(props.tab.id),
    host: 'kira',
    view: 'graph',                        // never 'review' — §9
    hostConnectionState: 'connected',
  });
});
onUnmounted(() => handle?.unmount());
```

**One transport per repo workspace, not per mount.** Two repo workspaces open ⇒ two
`gitsession.Conn`s ⇒ independent repo holds, which is what `handlers.go:67-71` is built for. Cached
in a module-level `Map<codeRepoId, Transport>`, disposed when the workspace closes
(`state/workspace.ts`'s existing close path, beside C6's `codeWorkspaceCloseWorkspace`).

**Tab switching unmounts.** C5's tab views unmount on switch (`RepoDiffView.vue:113`), and a cold
remount would re-walk the graph and lose scroll and selection. That is precisely what `ViewStateStore`
exists for — VS Code hits the same problem because its webview is destroyed on hide
(`webview/main.ts:61-77`). So `repoGraphTabStateSchema` (`packages/shared/domain/tabs.ts:245`) grows
from `z.object({})` to hold `PersistedViewState` (`git-ui/src/state/viewState.ts:43-64`: `version: 6`,
`repoId`, `loadedRows`, `detailOpen`, `scrollRow`, `selectedSha`, `columnWidths`, `dateFormat`,
`detailWidth`, `fileListMode`, four search toggles, `searchOpen`), and `TabViewStateStore` reads and
writes it through `patchTabState`.

`git-ui` already ships `parsePersistedViewState` (`index.ts:32`) for exactly this validation, so the
zod schema stays a permissive passthrough (`z.unknown().nullable().default(null)`) and
`parsePersistedViewState` is the sole validator — one implementation of the version-6 shape, not two.

**The layout worker.** `createRealWorker` (`graph/layoutClient.ts:73-76`) is Vite's documented
`new Worker(new URL('./layout.worker.ts', import.meta.url), {type: 'module'})`. The native frontend
is a Vite build and already ships Monaco's `editor.worker` (C5/C6), so this should build and run
without the `workerFactory` fallback the VS Code webview needs (`layoutClient.ts:28-36`). It is a
real environmental risk and §15 step 6 checks it in a live window.

**Bundle.** `slickgrid@5.20.0`, `flatbuffers`, `@vscode/codicons` and `@floating-ui/dom` are already
root dependencies. New to the native bundle: `seti-icons` and the `git-ui`/`git-ipc`/`git-core`/
`kira-ui` workspace sources. `git-ui` publishes `main: ./src/index.ts`, so Vite compiles it from
source like `@shared` — no build step, but its `.vue` files now typecheck under the native project
too (`typecheck:web`, `vue-tsc`), which `typecheck:git` already does separately.

## 9. The C11 boundary

Already clean. `mount()`'s `view` option (`main.ts:32`) picks the root: `'graph'` → `AppRoot`,
`'review'` → `ReviewView.vue` (`:76-80`).

Verified reachability: the only importers of `components/review/` or `state/review*.ts` outside those
directories are `main.ts:5-6` (the `'review'` branch) and `index.ts:17-18` (type re-exports).
**`App.vue` imports no review component.** So `view: 'graph'` excludes the whole layer —
`ReviewView.vue` (1228 lines), `ReviewCommitRow.vue`, `ReviewFilesPane.vue`, `ReviewCommentsPane.vue`,
`BaseSelector.vue`, and `state/review.ts`/`reviewComments.ts`/`reviewFiles.ts` — with no
tree-shaking assumption needed.

C10's only obligations at this seam, both in §4.3's table: hide the "Review branch changes" ref-menu
item (`buildRefMenu:219,227`, handled `App.vue:736`), and leave `review.*` out of the layer-1
allowlist. C11 restores the item, adds its own methods to the allowlist, and decides where the panel
lives — SPEC leaves that open and C10 does not pre-empt it.

## 10. Implementation steps

**S1 — `blobFrame.ts`.** Move `BLOB_FRAME_DISCRIMINANT`, `isBlobMarker`, `substituteBlob`,
`substituteBlobRoot`, `MalformedBlobFrameError` out of `socketChannel.ts:60-130`; add
`parseBlobFrameBody`. Rewire `socketChannel.ts:179-200` to call it. No behaviour change — verify
with `bun test packages/git-ipc/src`.

**S2 — `streamChannel.ts`** (§3.4) and its `index.ts` exports.

**S3 — Contract.** `HostKind` gains `'kira'` (`contract.ts:16`); `capabilities` gains
`write: boolean` (`:1479-1494`). Add `write: true` to `proxyHandlers.ts:228-237` and to the harness's
own `app.init`, so both existing hosts are unchanged in behaviour. `tsgo -p packages/git-ipc` and
`tsgo -p apps/kira-studio-vscode` catch every site.

**Do not bump `CONTRACT_VERSION`.** It is 35 on both sides (`validate.ts:126`,
`internal/gitrpc/contract.go:135`, asserted by `gitrpc/stash_test.go:48`). Neither field S3 adds
crosses the Go wire: `host` and `capabilities` are composed entirely host-side, and the server's own
`app.init` result is only `{contractVersion, serverVersion, git}` (`proxyHandlers.ts:51-55`,
`handlers.go:258-264`). Bumping it would break the handshake with every already-installed copy of
the extension for a change the server never sees.

**S4 — `internal/bridge/gitstream.go`.** §3.3 plus §4.2's allowlist.

**S5 — `RegisterGitStream` and `main.go`.** `shell/app.go` beside `:126`; hoist `gitRouter` at
`main.go:143-160`; register at `:493`. `go build ./... && go test ./internal/...` — `layering_test.go`
picks up the new file automatically.

**S6 — Read-only menu builders.** `buildReadOnlyRowMenu`, `buildReadOnlyRefMenu`,
`buildReadOnlyStashMenu` in `rowMenuModel.ts`, beside `buildReviewRowMenu`. Each returns the read
items only. Their selection sites: `App.vue`'s menu computeds, `StashList.vue:62`,
`GlobalStashList.vue:52`, `TagList.vue`.

**S7 — `write` capability threading.** The `v-if`s in §4.3's table across `AppToolbar.vue`,
`UndoButton.vue`, `WorktreeList.vue`, `StackList.vue`, `RepoSettingsDialog.vue` and `App.vue`'s
dialog block. Same prop-drilling shape as the five existing capabilities.

S6 and S7 are the only `packages/git-ui` edits and are both purely additive — the VS Code extension
keeps every affordance because it reports `write: true`.

**S8 — Shared vocabulary.** `repoDiffTabStateSchema`'s four fields; `repoGraphTabStateSchema`'s
passthrough; `defaultRepoDiffTabState` gains the nulls.

**S9 — `frontend/package.json`** gains `@kira/git-ui`, `@kira/git-ipc`, `@kira/git-core`,
`@kira/kira-ui` as `workspace:*`.

**S10 — `theme/vscode-bridge.css`** (§7), imported from the native entry beside `kui-bridge.css`.

**S11 — `repo/git/hostHandlers.ts`** (§5), including the two identity mappers (§5.1).

**S12 — `repo/git/transport.ts`** (§3.5) and the per-workspace cache.

**S13 — `repo/git/viewStateStore.ts`** (§8).

**S14 — `RepoGraphView.vue`** replaced wholesale (§8). Fix the stale "C9" comments here and at
`tabViews.ts:34`.

**S15 — `openRepoCommitDiffTab`** in `state/repoTabs.ts` (§6.1).

**S16 — `RepoDiffView.vue`'s revision branch** (§6.1).

**S17 — Workspace lifecycle**: dispose the cached transport in `state/workspace.ts`'s close path.

**S18 — Docs** (§12).

**S19 — Tests** (§11), in three parts with deliberate ordering:
- **S19a — `internal/bridge/gitstream_test.go`.** Lands with S4, not at the end. The allowlist is the
  phase's safety boundary; it should never exist untested for the length of a phase.
- **S19b — `streamChannel.test.ts`.** Lands with S2.
- **S19c — the UI case plus the `mockStreamBrowser.js` name-aware factory.** Last, and the one piece
  §11 flags as deferrable to a follow-up commit if the harness work overruns.

Sequencing: S1→S2→S19b (channel), S3 independent, S4→S19a→S5 (Go, needs nothing above). S8 gates
S14-S16. S11 needs S3. S12 needs S2 and S11. S14 needs S10, S12, S13. S15 before S16. S6/S7 are
independent of everything else and can land any time after S3. S19c last.

## 11. Testing

CLAUDE.md's bar: a dedicated test only for genuinely hard logic. Applied honestly, this phase earns
three, and the read-only boundary is the one that would be negligent to leave uncovered.

**`internal/bridge/gitstream_test.go` — yes.** A safety boundary whose failure mode is silent data
loss in a user's repository. Two cases: (1) every method in `readOnlyMethods` reaches the inner
handler; (2) a table of the write methods from §4.1 — `op.run`, `remote.run`, `undo.run`,
`worktree.prepare`, `stack.restack`, `settings.setGitPath`, `review.mark`, `credential.provide` —
each returns `E_READ_ONLY` **and never calls the inner handler** (asserted with a spy that fails the
test if invoked). Plus one case asserting an *unknown* method is refused, which is what pins the
allowlist-not-denylist property against a future contract addition.

**`packages/git-ipc/src/streamChannel.test.ts` — yes.** Frame decoding with two body shapes and a
`$blob` substitution. `socketChannel.test.ts` exists for the same reason; this is the same logic over
a different framing and can regress independently. Cases: a plain JSON frame; a blob frame with the
marker nested inside a payload; a blob frame whose header length runs past the body; a header with
no marker; a header with two.

**`rowMenuModel.test.ts` — extend, don't add a file.** Three cases asserting the read-only builders
emit no item whose id maps to an `OpRequest` kind. It already covers the five existing builders
(`rowMenuModel.test.ts`, 187 lines).

**Everything else — no.** The transport split is a two-arm lookup. `hostHandlers` are thin
compositions over calls that already have their own tests, except the identity mappers — which are
two `Array.find`s, and whose real protection is that they return `undefined` rather than guessing.
The theme bridge is CSS. `TabViewStateStore` delegates validation to `parsePersistedViewState`, which
`viewState.test.ts` already covers. `openRepoCommitDiffTab`'s dedupe is a four-field comparison.

**One UI case, in `tests/ui/repo-workspace.spec.ts` — with a harness prerequisite that is most of the
work.** The case itself is small: seed the git stream, assert the pinned tab renders SlickGrid rows
and that the toolbar has no Fetch/Push/Pull button. Its value is the real mount under WebKit — the
layout worker, SlickGrid, and the token bridge — which neither typecheck nor a Go test reaches.

The prerequisite is not small. `tests/ui/support/mockStreamBrowser.js:164` installs
`g._wails.streamFactory = () => { … }` — **no name argument, one singleton socket**, because until
now there has been exactly one stream. Supporting a second means making the factory name-aware and
giving the git stream its own socket and its own frame vocabulary (the engine stream's frames are
FlatBuffers pages; the git stream's are `rpcstream` envelopes with an optional `0x00` blob body —
an unrelated encoding). That file is deliberately plain, uncompiled JavaScript injected as raw text,
for the `keepNames`/`__name` reason its own header documents at length, so it cannot import the
`git-ipc` encoders the way `mockStream.ts` imports the page builders.

Budget S19 accordingly, and treat this ordering as load-bearing: **the Go test (S19a) and the
`streamChannel` test land first and gate the phase; the UI case (S19c) is the last thing in the
phase.** If the harness work turns out larger than the estimate, the honest outcome is to land C10
with steps 1-7 of §15 green and the UI case deferred to its own follow-up commit — not to weaken the
two tests that actually guard correctness. Say so plainly if that happens rather than quietly
dropping the case.

## 12. Documentation to update

- `docs/ARCHITECTURE.md`: a new "Git graph in the native workspace (C10)" subsection — the second
  Wails stream and why it carries no handshake, the read-only allowlist as the load-bearing boundary,
  the three repo identities (§5.1), the revision-pair diff tab, and the `--vscode-*` bridge.
- The Stack table: `@kira/git-ui`, `@kira/git-ipc`, `@kira/git-core`, `@kira/kira-ui` and `seti-icons`
  are now native-bundle dependencies. Record the measured `bun run build` delta.
- "Known open items": add **"the native graph and the VS Code extension hold independent
  `gitsession.Conn`s over the same repository"** — correct by design (per-connection holds), but it
  means a repository can be open twice in one process with two watchers, the same shape C6 already
  recorded for `codeindex`.
- `docs/v1.5/mcp-repo-map-issues.md`: log what dogfooding turns up, per CLAUDE.md. Navigating
  `git-ui`'s 120-file surface with `find_references`/`outline_file` over raw HTTP/JSON-RPC is the
  expected working mode for the implementation pass.

## 13. Explicitly out of scope

- The review layer, in full (§9). C11.
- Any write to the repository, by any route (§4).
- `editor.goToFile` and `editor.openRangeDiff` — both throw (§5).
- A historical-blob *file* viewer. `GoToFileOutcome`'s `virtualBlob` arm (`contract.ts:196-201`)
  has no native equivalent; C10 opens historical content only as one side of a diff.
- Multi-diff "open all changes" as a single editor — N tabs instead (§6.1).
- The graph's own repo picker. `RepoPicker.vue`/`NoRepositoryPanel.vue` are not mounted: the
  workspace already knows which repository it is, and a second picker inside a per-repo tab would be
  a way to make the tab disagree with its own workspace.
- Reusing `git.sock` from the native app, now or later (§3.2).
- Any change to the VS Code extension's behaviour. S3 and S6/S7 touch shared code; both keep
  `write: true` there.

## 14. Open questions for a human

**OQ1 — `mount()` versus a new embedded entry point.** §7 concludes `mount()` is safe here because
the native document already establishes the identical height chain. But `app-shell.css`'s own comment
explicitly anticipates that a host mounting into a region "needs a different entry point — not a flag
here". I read that as written against a host *without* the height chain, which this one has. A human
should confirm before we depend on the coincidence; the alternative is a `mountEmbedded()` export
sharing everything but the `app-shell.css` import, which is ~15 lines and removes the question
permanently.

**OQ2 — Hidden everywhere, or disabled-with-a-reason somewhere.** §4.3 hides uniformly. A user
arriving from the VS Code extension may reasonably wonder where Push went. A one-line note in the
toolbar ("Read-only view — use the VS Code extension to make changes") would answer it once without
a row of dead buttons. I lean toward adding that note and keeping everything else hidden, but it is
product copy and a product decision.

**OQ3 — `repoSettings.set`.** §4.4 allows it, because it writes only Kira's SQLite and holds genuine
read-side controls. The counter-argument is that "read-only" is easiest to reason about when the
allowlist contains nothing whose name is `set`. If a human prefers the stricter line, the cost is
that graph scope and page size become unchangeable from the native surface.

**OQ4 — `hostConnectionState`.** `mount()` requires it (`main.ts:54`) to seed
`ConnectionBanner.vue`. Natively there is no socket to be disconnected from: the stream is up or the
app is gone. Passing `'connected'` unconditionally renders no banner, which is right, but it means a
Wails stream that *does* drop (a renderer reload) shows nothing. Wiring `socket.onclose` into it is
maybe 10 lines. Worth it, or is a dropped renderer stream already a reload?

## 15. Verification

1. `bun run typecheck` — all five projects. `typecheck:web` now compiles `git-ui`'s `.vue` files
   under the native project as well, which is the step most likely to surface a real mismatch from S3.
2. `bun run lint` — includes `scripts/check-tokens.sh`, which enforces that only
   `vscode-tokens.css` holds colour literals. The new `vscode-bridge.css` maps names to `--kira-*`
   tokens and introduces no literal; if the checker's file allowlist is path-based it needs the new
   file added, and that is a lint-config edit, not an exception.
3. `bun run build` — records the bundle delta for §12.
4. `go build ./...`, `go test ./internal/...` — includes `gitstream_test.go` and `layering_test.go`
   over the new file.
5. `bun run test:unit` — the `git-ipc` and `git-ui` suites both run here.
6. `bun run test:ui` for `repo-workspace.spec.ts` plus the existing tabs/mode/smoke specs.
7. **Manual recipe, substituting for the unavailable GUI.** `bun run dev` (`wails3 task dev`), then
   in the DevTools console of a window with a repository imported:
   - Open the repo workspace. The pinned first tab must render commit rows, not the `EmptyState`.
     A blank grid with a console `Worker` error is the layout-worker risk from §8 — the fallback is
     Vite's `?worker&inline` on the same import, still exactly one worker.
   - `getComputedStyle(document.documentElement).getPropertyValue('--kv-app-bg')` must return Kira's
     background, not `#1e1e1e`. `#1e1e1e` means `vscode-bridge.css` did not load or loaded after
     `vscode-tokens.css`.
   - Right-click a commit row: the menu must contain Copy SHA and Copy commit message and nothing
     else. Right-click a branch badge: Copy only. A stash row: Show changes only.
   - The toolbar must show Refresh, search and the settings gear — and no Fetch, Pull, Push,
     Force-push, Stash or Undo.
   - Click a file in the detail pane: a new diff tab opens showing that commit against its parent,
     titled with both short shas. Click the same file on a *different* commit: a second tab, not a
     replacement — that is §6.1's dedupe key working.
   - Open a second repository. Both graphs must load independently, and closing one must not blank
     the other (per-workspace transports, §8).
   - **The backstop check, which is the one that matters.** From the console, reach past the UI
     entirely and issue a write directly on the stream. It must reject with `E_READ_ONLY`, and
     `git status`/`git reflog` in the repository must be unchanged afterwards:
     ```js
     await __kiraGitTransport.request('op.run',
       { repoId: '<git repoId>', op: { kind: 'branchCreate', name: 'c10-probe',
         startPoint: 'HEAD', checkout: false, track: undefined } });
     ```
     (`__kiraGitTransport` behind `__KIRA_DEBUG_HOOKS__`, the same convention `port.ts`'s existing
     hooks use — debug-only, compiled out of the packaged build.)
     Repeat for `remote.run` and `undo.run`. A success here means §4.2 layer 1 is not wired, and
     nothing else in this phase matters until it is.
8. Dogfooding pass: with `bun run mcp:repo-map` running, open this repository in the native
   workspace and read its own history in the graph.
