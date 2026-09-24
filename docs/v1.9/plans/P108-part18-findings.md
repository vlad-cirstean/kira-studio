# P108 Part 18 review findings — git-core and git-ui logic

Review of `packages/git-core/**`, `packages/git-ui/src/{bridge,graph,state}` and `index.ts`,
`graphVisibility.ts`, `shims-vue.d.ts`, against plan
`docs/v1.9/plans/P108-part18-git-core-git-ui-logic.md`. Review only; fixer lands one commit per
finding. Line numbers are at commit `4863cf1`.

## F1 — Repo switch during load re-opens old repo's graph stream

- `packages/git-ui/src/state/graphView.ts:350-354` (`reset`), `:301-331` (`#runLoad`),
  `:155-160` (`openStream`); caller `packages/git-ui/src/App.vue:267-276` (`handleRepoOpened`).
- `reset()` clears layout, packed state and auto-refresh timer. It never aborts `#loadController`
  and never waits for an in-flight `#runLoad`. `loading` stays `'loadingMore'`/`'refreshing'`.
- `#runLoad` captured repo A's id. Its `finally` calls `openStream(A, this.loadedRows.value)`
  unconditionally. `openStream` sets `#repoId = A` and aborts repo B's freshly opened stream.
- Result: repo B's graph gets replaced by repo A rows resumed from B's row count, or (if A was
  closed on the host) `openStream` rejects with not-held, `#repoId` stays A and B shows nothing.
  `graph.status` for A also lands in B's packed state.
- Reachable: start `loadAll()` (Alt-click) or `revealSha` on a large history, or let an
  auto-refresh (`#runAutoRefresh`, triggered by `repo.changed`) be in flight, then switch repo
  via picker or worktree switch.
- Fix: `reset()` aborts `#loadController` and bumps a load generation. `#runLoad` captures the
  generation (or checks `this.#repoId === repoId`) before its resync, skips `openStream`/
  `graph.status` when superseded, and only sets `loading = 'idle'` when it still owns the
  load. `loadAll`'s `finally` (line 229) must clear `#loadController` only when it is still its
  own controller, same as `loadMore`/`revealSha`.

## F2 — No recovery after host reconnect

- `packages/git-ui/src/bridge/client.ts` (`hostConnection` from `connection.changed`);
  `apps/kira-space-vscode/src/extension.ts:617-628`; every `state/*.ts` class.
- After the vscode host reconnects to a restarted (or re-dialled) Kira Space, the new server
  `Conn` holds no repo. Every request with the old `repoId` gets `ErrRepoNotHeld`
  ("repository is not open on this connection"). `graph.stream` is dead. Status, refs, graph
  rows and review state stay frozen on stale data.
- Only `ConnectionBanner` reads `hostConnection`. No state class, `App.vue` or `ReviewView`
  re-opens the repo on the `connected` edge. Extension side only resets reviewMarking/
  blameWidget memos and forwards the state.
- Fix: watch `hostConnection` for a non-connected to `connected` transition (in `App.vue` and
  `ReviewView`, or one hook on `BridgeClient`). On that edge re-issue `repo.open` for the
  current path, then run the same fan-out `handleRepoOpened` does (`setRepoId` on every state,
  `graphView.reset()` + `openStream`), and for review re-run `setTarget` on the current
  branch/base.

## F3 — `OpsState.runRestack` skips undo/inProgress/status reconcile and repo guard

- `packages/git-ui/src/state/ops.ts:1161-1177`; compare `#applyResult` `:1732-1748`.
- `RestackResult` (`packages/git-ipc/src/contract.ts:755-764`) carries `undo`, `head` and
  `inProgress`. `runRestack` applies only `head` via `#refs.applyHead`.
- `undoSlot` keeps the previous op's snapshot: Undo button shows wrong label, and clicking it
  sends a superseded id, which the server answers NotFound ("This undo is no longer
  available."). The restack's own undo never appears. A restack that stops on conflict leaves
  `statusSummary.inProgress` null until a `repo.changed` round trip, so conflict UI gating
  (`canRun`) is briefly wrong.
- Also no `this.#repoId === repoId` check: a restack that finishes after a repo switch writes
  repo A's head into repo B's `RefsState`.
- Fix: capture `repoId` at entry and route the result through the same reconcile as
  `#applyResult` (head, inProgress, `undo ?? null`), guarded on repo identity.

## F4 — `undoSlot` refreshed only on repo switch

- `packages/git-ui/src/state/ops.ts:330-331`, `:348-354`, `:302-305`.
- `refreshUndo` runs only from `setRepoId`. Server undo slot is per `RepoEntry`, shared by all
  surfaces (vscode webview, native app, review view, a second webview on same repo). An op run
  from another surface replaces the slot; this surface keeps showing its old slot and gets
  NotFound on click.
- Fix: in the `repo.changed` handler call `refreshUndo()` alongside `refreshStatus()`, with the
  same latest-wins guard as F5.

## F5 — Out-of-order replies within one repo overwrite newer state

- `packages/git-ui/src/state/ops.ts:340-354` (`refreshStatus`, `refreshUndo`);
  `stack.ts:88-101` (`reload`); `refs.ts`, `worktrees.ts`, `stash.ts` (`reload`/
  `reloadGlobal`); `repoSettings.ts` (`reload` vs `set` result and `repoSettings.changed`).
- Server runs one goroutine per request (`apps/kira-space/internal/rpcstream/session.go:313`),
  so replies arrive in any order. Each of these guards only on `repoId`, never on request
  order. Two `repo.changed` events in quick succession (commit then checkout) can resolve with
  the older snapshot last; that snapshot then stays until the next event.
- `detail`/`working`/`reviewFiles`/`reviewComments` already use `createLatestRequest`/
  `runLatest`; these do not.
- Fix: give each reload its own `createLatestRequest` (or a per-method sequence counter) and
  apply a reply only when it is still the latest issued for that method. For
  `RepoSettingsState`, bump the same sequence on `set` and on applying a
  `repoSettings.changed` snapshot so an older `reload` reply cannot overwrite either.

## F6 — Pending confirm dialogs survive repo switch; `busy` stays stuck

- `packages/git-ui/src/state/ops.ts:317-332` (`setRepoId`); asks at `:470`, `:611`, `:694`,
  `:925`, `:1608`; `packages/git-ui/src/state/pendingSlot.ts`.
- `runCheckout`, `#runPreflighted`, `runReset`, `#runStashPopLike` set `busy = true` then await
  a slot `ask()`. `setRepoId` resets remote/worktree fields but never resolves pending slots,
  `#resolvePull` or `#resolvePostCheckoutPull`.
- After a switch the repo-A dialog stays open over repo B, and `busy` stays true (every op
  button disabled) until the user dismisses it. Confirming does nothing (post-ask repo guard
  returns), which reads as a silent failure.
- Fix: add `abandon()` (or `cancel(value)`) to `PendingSlot` that clears `pending` and resolves
  the stored promise with the slot's cancel value. Call it for every slot and pending pull
  prompt in `setRepoId` (and `dispose`).

## F7 — Worktree prepare output unbounded, O(n²) append

- `packages/git-ui/src/state/ops.ts:310-314`; server side
  `apps/kira-space/internal/gitprepare/output.go`.
- Server caps only its retained transcript (500 lines / 256 KiB). The live `worktree.progress`
  stream forwards every line (batches of 64 lines / 8 KiB per 100ms) for up to
  `PrepareTimeout` (15 minutes). Client appends with a full array spread per batch, no cap.
- A chatty prepare script (`npm install` verbose, a build) produces hundreds of thousands of
  lines: memory grows without bound and each batch copies the whole array, plus the rendering
  component re-renders the full list.
- Fix: cap client-side to the same bound as the server's retained transcript (last 500 lines),
  trimming from the front; append into a `shallowRef` array in place and `triggerRef`, or
  keep a ring buffer.

## F8 — `ReviewSessionState.#checkForChange` race reverts user's base choice

- `packages/git-ui/src/state/review.ts:395-416`; `acknowledgeStaleReview` `:251-264`;
  `setBase` `:198-213`; `swapBaseAndBranch` `:164-173`.
- The check captures `repoId`, `branch` and `current = resolution`, then awaits
  `review.resolveBase` with the base at call time. After the await it re-checks only `repoId`
  and `branch`.
- Sequence: `refsChanged` starts a check with base `main`; user calls `setBase('develop')`,
  which lands first; the check returns the `main` resolution, compares it with its captured
  (old `main`) `current`, finds a difference if `main` moved, sets `staleReview = true` and
  `#pendingResolution` to the `main` result. Clicking the stale banner silently switches the
  review back to `main`. `swapBaseAndBranch` (awaits `setTarget` then `setBase`) opens the same
  window.
- The check also has no abort controller, so `#abortAll` does not cancel it.
- Fix: capture a session token (increment on every `setTarget`/`setBase`/swap/dispose) and the
  `resolution` object identity at start; after the await drop the result unless both still
  match. Give the check an `AbortController` included in `#abortAll`.

## F9 — `PrState` warm-up keeps running against the new repo; stale results survive clear

- `packages/git-ui/src/state/pr.ts:218-235` (`ensureSnapshot`), `:241-275` (`resolveBranch`).
- `ensureSnapshot`'s worker pool keeps draining its `toFetch` list after `setRepoId`.
  `resolveBranch` reads `this.#repoId` fresh, so repo A's branch names get resolved against
  repo B: wasted `gh`/GitHub REST calls (rate limit) and, where names coincide, a PR badge for
  a branch the user never asked about.
- `resolveBranch`'s `finally` deletes `branch` from `#branchRequests` even when a newer request
  for the same name (new repo, or after a `refsChanged` clear) owns the marker, allowing a
  duplicate concurrent fetch.
- A request in flight across a `refsChanged` clear (same repo) repopulates `byBranch` with the
  pre-change PR record, since only `repoId` is checked.
- Fix: keep a clear generation bumped by `setRepoId` and the `refsChanged` clear. Capture
  `(repoId, generation)` in `ensureSnapshot` and `resolveBranch`; workers stop when it changes;
  `resolveBranch` drops its result and skips the `finally` delete when superseded (or track
  in-flight requests in a per-generation set replaced on clear).

## F10 — Event-driven reloads produce unhandled rejections

- `packages/git-ui/src/state/ops.ts:304`; `stack.ts:61-65`, `:125`; `graphView.ts:365-368`
  (`void this.#runAutoRefresh()`, which calls `refresh()` and rethrows); same `void
  this.reload()` shape in `refs.ts`, `worktrees.ts`, `stash.ts`, `repoSettings.ts`.
- Any request failure (disconnect, host `Error('connection: not connected to Kira Space')`,
  not-held repo per F2, git error) becomes an unhandled promise rejection in the webview. No
  state surfaces it; the view silently keeps stale data.
- Fix: wrap each event-triggered reload in a catch that logs once (`console.error` with a class
  prefix, same as `graphView`'s `graph.status` catch) and, where the class has an error ref,
  sets it. Keep user-initiated calls rethrowing.

## Checked, nothing real

- Edge 4, async `onChunk` rejection: `packages/git-ipc/src/rpc.ts:221-236` awaits `onChunk`
  inside try/catch; both vscode and native transports use `createRpcClient`. Not reachable.
- Plan/layout desync, out-of-range read: grid length is `plan.length`
  (`graph/columns.ts:472`) and `graphColumn.ts` `readSlice` guards `row >= layout.rowCount`.
  Only a transient visual lag until the worker result lands; no crash.
- `#applyChunk` listener range vs plan rows: `CommitGrid.vue` `handleChunkLayout` ignores the
  range and invalidates all row heights. Harmless.
- `reviewFiles.mark` ranges (edge 11): no production caller passes `ranges`
  (`ReviewView.vue:243`, `ReviewFilesPane.vue:86` both whole-file).
- `git-core/src/model/reviewRanges.ts` helpers always return normalized, clamped ranges or
  `undefined`; vscode and native callers bail on empty.
- `stack.progress` append by spread: bounded by stack branch count.
- `BridgeClient` `connection.changed` subscription: `dispose()` disposes the owned transport,
  which drops every handler. No leak.
- `InProgressOperation`, `InProgressKind`, `DiffHunk`, `DiffLine` git-core copies match
  `contract.ts` field by field.
