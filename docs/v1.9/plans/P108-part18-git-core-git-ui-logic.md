# P108 Part 18 — review plan: `git-core` and `git-ui` logic

Chunk B6, stream B position 6 (pre-plan §5.17). Parts 13-17 landed first. One Opus reviewer runs
this plan and reports findings. It fixes nothing. One Sonnet fixer then lands one commit per
finding. Tree surveyed: `1dbffa5`.

Paths repo-relative. `PF` = `apps/kira-space/frontend/src`. `vscode` = `apps/kira-space-vscode`.
`GC` = `packages/git-core/src`. `GU` = `packages/git-ui/src`. `B5` = Part 17 (`gitrpc`, `gitsock`,
`git-ipc`, closed). `B4` = Part 16 (`gitsession`, closed). `B7` = Part 19 (`git-ui` components,
next, not yet reviewed).

## 0. Method

- **`codegraph_explore`**, six survey calls made while writing this plan: `BridgeClient`
  (`request` has 67 callers, `stream` 3: `graphView.ts`, `review.ts`); graph order and visibility
  (`GraphViewState.openStream`/`loadMore`/`#runLoad`/`#rebuildLayout`/`#applyChunk`,
  `GraphOrderState`, `buildRowPlan`, `LayoutStore`, `createLayoutClient`, `graphVisibility.ts`);
  review session (`ReviewSessionState`, `ReviewFilesState.mark`, `reviewRanges.ts`, server-side
  `MarkFile` nil-vs-empty ranges); ops (`OpsState` `#runSimple`/`#runRemote`/`#runPreflighted`/
  `undo`/`runRestack`, `createPendingSlot`, `createLatestRequest`/`runLatest`); search/PR/stack
  (`buildCommitHits`, `PrState.ensureSnapshot`, `StackState.reload`/`runRestack`); store memory
  (`CommitStore`, `ShaTable`, `Interner`). The reviewer makes more calls for blast radius; the
  review is discovery, so it uses `codegraph_explore` too (`ToolSearch "codegraph"` first).
- **`git grep` of import lines** for the exact importer set (§2). CodeGraph's TS resolution
  over-links (pre-plan §0): it showed Studio views calling `App.vue`'s `searchState`, which is a
  name collision. Import lines decide.
- **Read the host side of every event and stream.** Every `bridge.on(...)` subscriber and every
  `bridge.stream(...)` caller is read against the B5 contract (`packages/git-ipc/src/contract.ts`,
  `rpc.ts`, `transport.ts`) for what it may receive, in what order, and how it ends.
- **Structural-copy parity.** `GC` never imports `@kira/git-ipc` (B3 rule; `git-core`'s
  `package.json` has no dependencies). It keeps structural copies instead (`model/review.ts`
  `LineRange`, `model/remote.ts`, `settings/schema.ts` `HostKind`, `worktree/label.ts`,
  `model/operation.ts` in-progress kinds, `testing/packedChunk.ts`). Diff each copy field by field
  against `contract.ts`. TypeScript only catches drift where a caller passes one into the other.
- **Real probes** (scratch dir, `bun test`) only where a claim rests on runtime ordering: the
  layout-worker round trip against a plan rebuild, out-of-order `status.get` replies, a stream
  `onChunk` returning a rejected promise.
- **B5 hand-off re-verified.** Part 17 F2 (`rpc.ts` catches a throwing `onChunk`) and F3
  (`streamChannel.ts` reacts to its own stream closing) are read for what they do *not* cover on
  this side: an `async` `onChunk` that returns a rejected promise instead of throwing.

## 1. Own file set

Production 13,619 lines, tests 6,007 (`wc -l`, `.ts` only).

- **`packages/git-core/`** (pure TS, no runtime dependencies): `package.json`, `tsconfig.json`,
  `testdata/searchConformance.json`, and `src/`:
  - `index.ts`
  - `detail/find.ts`
  - `graph/{colors,edges,lanes,layout,rowPlan,stashRows,types}.ts`
  - `model/{commit,conflict,diff,operation,ref,remote,repo,review,reviewRanges,stash,status,tag}.ts`
  - `ports/{browser,clipboard,credentialPrompt,disposable,editorIntegration,fileWatcher,logger,processRunner,storage,theme,windows,workspaceRoots}.ts`
  - `preflight/{reset,tag,types}.ts`
  - `search/{differentialRunner,matcher,query}.ts`
  - `settings/schema.ts`
  - `store/{commitStore,intern,shaTable}.ts`
  - `testing/packedChunk.ts`
  - `util/{assert,dateFormat,nfcPath,nulSplit,typed}.ts`
  - `worktree/label.ts`
  - tests: `graph/{lanes,rowPlan}.test.ts`,
    `model/{diff,operation,review,reviewRanges,status,tag}.test.ts`,
    `preflight/{reset,tag}.test.ts`, `search/{conformance,matcher,query}.test.ts`,
    `settings/schema.test.ts`, `store/{intern,shaTable}.test.ts`,
    `util/{dateFormat,nfcPath,nulSplit}.test.ts`.
- **`packages/git-ui/src/bridge/client.ts`**: `BridgeClient`.
- **`packages/git-ui/src/graph/`**: `geometry.ts`, `graphColumn.ts`, `hitTest.ts`,
  `layout.worker.ts`, `layoutClient.ts`, `layoutStore.ts`, `palette.ts`, `rowSvg.ts`. Tests:
  `layoutStore.test.ts`, `rowSvg.test.ts`.
- **`packages/git-ui/src/state/`**: `bootstrap.ts`, `clipboardActions.ts`, `detail.ts`,
  `detailActions.ts`, `graphOrder.ts`, `graphView.ts`, `latestRequest.ts`,
  `liveAnnouncements.ts`, `ops.ts` (1,755 lines), `packedStream.ts`, `pendingSlot.ts`, `pr.ts`,
  `refs.ts`, `repo.ts`, `repoSettings.ts`, `review.ts`, `reviewComments.ts`, `reviewFiles.ts`,
  `search.ts`, `selection.ts`, `settings.ts`, `stack.ts`, `stash.ts`, `viewState.ts`,
  `working.ts`, `worktrees.ts`. Tests: `buildCommitHits`, `ops`, `pr`, `repoSettings`,
  `reviewFiles`, `stack`, `viewState`, `working` (`.test.ts`).
- **Loose files:** `GU/index.ts` (the package's public surface), `GU/graphVisibility.ts`
  (`GRAPH_VISIBLE_KEY`, `useGraphVisible`), `GU/shims-vue.d.ts` (type-only `*.vue` shim).

Tests are read only where they pin a contract the review questions. `.gitkeep` files ignored.

## 2. One hop: callers

From import lines, production only.

- **`GU/App.vue`** and **`GU/components/**`** (B7, next, not yet reviewed). `App.vue`
  constructs `BridgeClient`, `GraphViewState`, `GraphOrderState` and every `state/` class, wires
  `setRepoId` fan-out, and feeds `GraphOrderState.setTips` from `RefsState`/`StashState`.
  `components/review/ReviewView.vue` constructs its own `BridgeClient` and
  `ReviewSessionState`/`ReviewFilesState`/`ReviewCommentsState`. `CommitGrid.vue` reads
  `graphView.plan`/`layout`/`generation`, calls `rebuildOrder()`, `createGraphFormatter`,
  `useGraphVisible()`. B7 files are ordinary downstream consumers here: read them only to learn
  how this chunk's API is called. A bug whose fix lands in a component is still a finding here
  when this chunk's contract invites it.
- **`GU/main.ts`** (B7): `mount()` and `MountOptions` (`hostConnectionState`, transport, view
  state store), `GRAPH_VISIBLE_KEY` provision.
- **`PF/views/repo/RepoGraphView.vue`**, **`PF/repo/RepoReviewView.vue`**: `mount` from
  `@kira/git-ui`, KeepAlive backgrounding (`graphVisibility.ts`'s only real provider),
  `hostConnectionState: { kind: 'connected' }` hard-coded for the native surface.
- **`PF/repo/git/{viewStateStore,hostHandlers}.ts`**, **`PF/repo/fileIcon.ts`**,
  **`PF/repo/state/worktrees.ts`**, **`PF/views/repo/{blameLine,reviewDecorations}.ts`**:
  `ViewStateStore`/`PersistedViewState`/`parsePersistedViewState`, `findChangeInDetail`,
  `worktreeLabel`, `formatRelativeDate`/`formatAbsoluteDate`, `mapLineAcrossDiff`, and the range
  helpers (`selectionToRange`, `clampRanges`, `normalizeRanges`, `coverage`, `hunkChangeBlock`)
  that feed `review.mark`/`review.comment.add` (`reviewDecorations.ts:437`, `:499`).
- **`vscode/src`**: `webview/main.ts` (`mount`, the reconnecting host's `connectionState`);
  `ports/*.ts` implement `GC/ports` (`Browser`, `Clipboard`, `CredentialPrompt`,
  `EditorIntegration`, `Logger`, `Windows`, `WorkspaceRoots`, `Disposable`); `extension.ts`
  (`coerceSettings`, `repoSettingKeys`, `SETTINGS`, `nfcPath`); `reviewMarking.ts:490`
  (range helpers into `review.mark`); `reviewComments.ts:164` (`review.comment.add`);
  `proxyHandlers.ts` and `goToFile.ts`/`diffToolbar.ts`/`blameState.ts`/`blameWidget.ts`
  (`findChangeInDetail`, `mapLineAcrossDiff`, `DocumentRef`, `FileChange`); `connection.ts`.
- **Tests that pin this chunk's contract**: `vscode/tests/interaction/support/*`,
  `apps/kira-space/tests/ui/support/graphStreamFixture.ts`.

`PF` and `vscode` are Part 20's own files. Treat their on-disk state as the caller contract.

## 3. One hop: callees

- **`@kira/git-ipc`** (B5, closed): `Transport`, `TransportError` (codes `cancelled`,
  `contract-mismatch`, `transport-closed`, `handler-error`), `contract.ts` types
  (`ParamsOf`/`ResultOf`/`EventPayload`/`StreamChunkOf`), `graphChunkCodec.ts` packed chunks.
  Treat as correct, except where this chunk passes it something its contract never promised to
  accept, or relies on a guarantee it never made (event/response ordering, one `onChunk` at a
  time, `stream()` settling on disconnect).
- **B4/B5 server semantics this chunk depends on**, read, not re-reviewed: `graph.stream`
  restart-at-zero and `resumeThroughRow`; `graph.loadMore`/`graph.refresh`/`graph.status`;
  `review.mark` treats omitted `ranges` as whole-file and `[]` as a no-op ranged mark
  (`gitsession/incremental.go`, `ranges == nil`); Part 17 F7's `1 <= start <= end` check;
  `repo.changed` kinds; `remote.run`/`op.run`/`undo.run`/`stack.restack` result shapes.
- **`GC` internal ports**: interfaces only. `GC` itself depends on nothing at runtime (`node:path`
  and `node:crypto` appear only in tests). `ProcessRunner`, `FileWatcher` and `Theme` have no
  implementer or consumer outside `GC`; confirm with `git grep`, and treat an unused port as a
  finding only if something dead ships or misleads a caller.
- **Workers:** `GU/graph/layout.worker.ts` runs `GC/graph/layout.ts` `layoutAppend` off the main
  thread; `createMainThreadWorker` is the fallback.
- **`vue`** (`shallowRef`, `watch`, `markRaw`, `inject`), **`slickgrid`** (type-only `Formatter`
  in `graphColumn.ts`), **`@kira/kira-ui`** not imported by this set.

## 4. Edge cases to weight

1. **`BridgeClient` error surfaces.** `init()` memo clears on rejection, but `connectionState`
   never returns from `'error'` to `'connecting'` on retry. `dispose()` sets `'connecting'`, not a
   terminal state. The `connection.changed` subscription is never unsubscribed (safe only if
   `transport.dispose()` drops handlers). Which callers branch on `TransportError.code` and which
   treat every rejection alike? `vscode`'s `ConnectionManager.request` rejects a plain `Error`
   (`'connection: not connected to Kira Space'`), never a `TransportError`; it reaches the
   webview through `proxyHandlers.ts`, so confirm what shape arrives there. Check each
   `instanceof TransportError && code === 'cancelled'` site for a `handler-error` or
   `transport-closed` it mishandles.
2. **Unhandled rejections from fire-and-forget calls.** Sweep every `void this.x()` and every
   `bridge.on` handler calling an async method: `OpsState.refreshStatus`/`refreshUndo`,
   `StackState.reload`, `WorktreeState.reload`, `RepoSettingsState.reload`,
   `GraphViewState.#runAutoRefresh` (calls `refresh()`, which rethrows), `reviewFiles`
   `#openInEditor`, `PrState` debounced `#requestCommit`. A disconnect produces one rejection per
   subscriber per event. Check whether state is left latched (`loading`, `restacking`, `pending`,
   `autoRefreshing`).
3. **Disconnect and reconnect mid-session.** `vscode`'s host reconnects to a restarted Kira Space.
   The server's new `Conn` has no repo holds and no walk. Does any `state/` class react to
   `connection.changed` going `connected` again, or does every later request against the old
   `repoId` fail and leave stale rows and status on screen forever? An in-flight
   `graph.stream`/`request` at disconnect time: does its promise settle (B5 F3 covers the native
   stream channel), and does `GraphViewState.loading` return to `'idle'`?
4. **Stream `onChunk` is async.** `graphView.openStream` passes `(chunk) => this.#applyChunk(chunk)`,
   which returns a promise. B5 F2 catches a *throw*, not a rejected promise. `#applyChunk` awaits
   `#rebuildLayout()`; a worker error or post-dispose `submit()` rejects with a non-stale `Error`
   that nobody awaits. Chunks also do not wait for each other: two chunks' `#rebuildLayout` calls
   interleave, relying on `LayoutClient.reset()`'s stale marking. Confirm the last chunk's
   layout always lands, and that `onCorrupted`'s nested `openStream(repoId, 0)` cannot recurse or
   run against a disposed instance.
5. **Plan and layout out of step (graph order/visibility).** `#rebuildLayout` sets `plan.value`
   synchronously, then awaits the worker before `layout.clear()`/`append()`. In that window
   `graphColumn.ts`'s `readSlice` pairs the *new* plan with the *old* layout: when a collapse
   shrinks the plan, `row < layout.rowCount` but `row >= plan.length` reaches `plan.entryAt`'s
   out-of-range assert; otherwise the old lanes render against new commits. Same question for
   `hitTest.ts`, `gridKeyboard.ts` and selection: can a row hidden inside a collapsed group stay
   selected, keyboard-reachable, or the target of `revealSha`/a search hit whose display row is
   `-1`? `containingDisplayRow` vs `displayRowOf` at each caller.
6. **`graphVisibility.ts` deferral.** A backgrounded KeepAlive mount defers the rebuild on a
   generation bump. Verify the deferred rebuild always runs on re-show (one missed flip leaves a
   stale grid), and that events and streams still arrive while hidden, so `store` and `plan`
   keep moving under a grid that no longer matches them.
7. **Load/refresh state machine.** `loadMore`/`loadAll`/`revealSha`/`refresh`/auto-refresh share
   `loading` and `#loadController`. `loadAll`'s `finally` clears `#loadController`
   unconditionally, unlike its siblings. In `#runLoad`, a failing `openStream` inside the
   `finally` masks the original error. `openStream` sets `#repoId` before aborting the old
   stream; a `repo.changed` for the new repo can then schedule auto-refresh against a half-reset
   store. `reset()` vs an in-flight stream from the previous repo: can a late chunk for repo A
   land in repo B's store (`#applyChunk` checks no `repoId`)?
8. **Same-repo out-of-order responses.** Most `reload()`/`refreshStatus()` guard only on
   `repoId`, not latest-wins. Two `status.get` calls for one repo (a `repo.changed` burst, or
   `#applyResult` then an event) can resolve out of order, so an older snapshot overwrites a
   newer one. The worst case: a pre-op `status.get` lands after `op.run`'s result and restores
   the pre-op `head`/`inProgress`. Same for `stack.list`, `worktree.list`, `repoSettings.get`
   racing `repoSettings.set`'s response or a `repoSettings.changed` event.
9. **Ops that fail partway (Parts 14-16 hardened the server side).** Does every mutating path
   reconcile `head`, `inProgress` and `undoSlot` the way `#applyResult` does? `runRestack`
   applies `head` only: `RestackResult.undo` and a paused restack's in-progress rebase wait on
   `repo.changed`, and `refreshUndo` runs only from `setRepoId`. `#runRemote` returns early on a
   repo switch without applying. `#runPreflighted` holds `busy` across `PendingSlot.ask`: a repo
   switch or unmount with the dialog open leaves the promise pending forever
   (`pendingSlot.ts` documents a second `ask()` doing the same), so `busy` stays true. Is
   `canRun`/`busy` ever optimistic in a way the server's answer never corrects?
10. **Review session state.** `ReviewSessionState.setTarget`/`setBase`/`swapBaseAndBranch`/
    `acknowledgeStaleReview`/`clearTarget` each abort and reset; check no path skips
    `#resolveController`/`#streamController`/`#loadController` or leaves `phase` wrong after a
    rejected `#resolve`. `swapBaseAndBranch` runs two awaited retargets; a `refsChanged` in
    between. `#checkForChange` racing `setTarget`. Expansion `DetailState`s disposed on every
    reset (leak otherwise). `ReviewFilesState.pending`/`markError` across `setTarget` (G30 #6
    fixed one arm).
11. **Client-built review ranges (Part 17 F7 hand-off).** Server now rejects `start < 1` and
    `end < start`. Does any client path build a range the server will reject, and rely on that
    rejection instead of validating? Trace `selectionToRange` (reversed selection, `line` 0, a
    column-0 end), `clampRanges` with `lineCount` 0, `hunkChangeBlock` on a pure deletion, and
    `reviewFiles.mark(path, reviewed, ranges)`, which passes caller ranges through unvalidated.
    The nil-vs-empty distinction: a caller that means "nothing" but sends `ranges: undefined`
    marks the **whole file**. `coverage()` requires pre-normalized input; check every caller.
12. **Search and PR state across a generation bump.** `CommitHit.row` is a store row. After a
    refresh resets the store, do stale hits get recomputed before `next()`/`previous()` or
    `revealSha` use them? `buildCommitHits` overlap counting (a recent fix) against a tail hit
    whose sha loads mid-search. `PrState.ensureSnapshot` worker pool vs `setRepoId` mid-pool;
    `#branchRequests` cleanup on error.
13. **`git-core` graph algorithms.** `rowPlan.ts` `assignRowRanks`/`collapseBuckets` with
    duplicate tip shas, a tip not loaded yet, zero tips, `MIN_COLLAPSIBLE` boundary (3 vs 4
    members), and the `other` group. `lanes.ts`/`edges.ts` patching across a page boundary
    (`patchTarget`, `resolvedParentSlots`), octopus merges, a parent loaded after its child's
    page. `LayoutStore.append`'s contiguity assert against a full relayout.
    `CommitStore.layoutInput` consumes `#resolvedSinceLastLayoutInput`: a stale-dropped submit
    loses those slots unless every rebuild is a fresh pass.
14. **`git-core` store and parsing.** `ShaTable` width detection (40 vs 64 hex), `clear()`
    resetting width so a SHA-1 repo followed by a SHA-256 repo works, rehash growth, `rowOfHex`
    on a malformed or short hex. `appendPacked` against an untrusted chunk shape (B5 says trusted
    peer; check only the asserts). `nulSplit`, `dateFormat` clamped timestamps, `query.ts`/
    `matcher.ts` regex compile (catastrophic patterns, whole-word with non-ASCII,
    case-folding), `differentialRunner.ts` budget.
15. **Settings schema parity.** `settings/schema.ts` `coerceSettings`/`repoSettingKeys` against
    Go's `PI/storage/model/gitreposettings.go` `Validate` for the seven `source: 'repo'` keys:
    enum members, min/max, string-array shape. A value TS accepts and Go rejects (or the
    reverse) surfaces as a save error or a silent default.
16. **Memory in long-lived state (large repos).** `#rebuildLayout` re-lays-out every row per
    chunk: O(n²) over a streamed history, and each `submit` structured-clones the full
    `parentOffsets`/`parentRows` (no transfer list). `worktreePrepareOutput` and
    `StackState.progress` grow by array spread per event, unbounded. `PrState.byBranch`,
    `#noBranchPr`, review `#expansions`, `Interner` values across refreshes: each should be
    cleared or bounded on `setRepoId`/reset. Every class with `bridge.on` has a `dispose()` that
    unsubscribes; check `App.vue`/`ReviewView.vue` call them.
17. **P111 overlap (named only).** `OpsState.previewPullStrategy` and the `strategy` field sent
    through `#runRemote` to `remote.run`. P111 owns the pull-strategy wire change. A finding here
    only names the overlap.

## 5. Watch items from pre-plan §5.17

- **`BridgeClient`**: 61 callers at pre-plan time; 67 `request` call sites and 3 `stream` call
  sites now (§0). Items 1-4 above.
- **Review session state**: `review.ts`, `reviewFiles.ts`, `reviewComments.ts`,
  `GC/model/{review,reviewRanges}.ts`. Items 10-11.
- **Graph order/visibility**: `graphOrder.ts`, `graphView.ts`, `graphVisibility.ts`,
  `GC/graph/rowPlan.ts`, `GU/graph/{layoutClient,layoutStore,graphColumn}.ts`. Items 4-7, 13.
- **`git-ui/state` churn 1,066** (P104 tail through P107). P107 I2-22/I2-23/I2-27 extracted
  `runLatest`, `createPendingSlot` and `FakeTransport`. Check each extraction kept every original
  caller's guard (`stillCurrent` identity, `setLoading` only when current).
- **Added while surveying:** `ops.ts` at 1,755 lines is the largest single file (items 8-9).
  `GC`'s structural copies of `git-ipc` types (§0) have no compile-time link to the contract.

## 6. Out of scope

- **Generated code.** `packages/git-ipc/src/generated` is excluded (prep-plan §6). No file in
  this chunk's own set imports it; `packedStream.ts` reaches it only through `graphChunkCodec.ts`
  (B5, closed).
- **B7's own files.** `GU/components/**`, `GU/App.vue`, `GU/main.ts`, `GU/{icons,theme,testing}/**`,
  `GU/vite.config.ts`. Read only as callers (§2). Part 19 reviews them next. A fix that must land
  there is still reported here, with the component named.
- **B5 internals.** `gitrpc`, `gitsock`, `git-ipc` (`rpc.ts`, `socketChannel.ts`,
  `streamChannel.ts`, `validate.ts`, codecs). Treat as correct except at the exact contract
  boundary. A needed change there is reported with the contract change named as the fix
  direction.
- **Part 20's own files.** `PF/**`, `vscode/**`. Read as callers. Same stream (B), so a fixer may
  edit them under pre-plan §3.3.
- **P111's pull-strategy wire change itself.**
- **Style nits.** Findings must be real bugs: correctness, races, stale or stuck state, leaks,
  error handling, contract mismatches.
