# P108 Part 19 — review plan: `git-ui` components

Chunk B7, stream B position 7 (pre-plan §5.18). Parts 13-18 landed first. One Opus reviewer runs
this plan and reports findings. It fixes nothing. One Sonnet fixer then lands one commit per
finding. Tree surveyed: `d0436aa`.

Paths repo-relative. `PF` = `apps/kira-space/frontend/src`. `vscode` = `apps/kira-space-vscode`.
`GC` = `packages/git-core/src`. `GU` = `packages/git-ui/src`. `B6` = Part 18 (`git-core`, `GU/{state,
graph,bridge}`, closed). `B1` = Part 13 (`kira-ui`, `workbench`, `theme`, closed). `B8` = Part 20
(`PF/**`, `vscode/**`, next, not yet reviewed).

## 0. Method

- **`codegraph_explore`**, seven survey calls made while writing this plan: `App.vue` repo-open
  flow (`handleRepoOpened`, `applyRepoIdToStates`, `handleReconnect`, `graphView.reset`/
  `openStream`, `OpsState.setRepoId`); `App.vue` bootstrap and teardown (`bootstrap`,
  `retryBootstrap`, `RepoState`, `NoRepositoryPanel`, `gitBlockedCopy`); `ReviewView.vue`
  bootstrap and reconnect; `CommitGrid.vue` resize handles against `KuiColumnResizeHandle`,
  `scrollToRow`, `handleChunkLayout`; `main.ts` `mount` against its three host callers; review
  components (`resumeSession`, `onUiAction`, `ReviewCommitRow`, `ReviewSessionState.setBase`/
  `expand`); dialogs against `createPendingSlot` and `BranchPicker`/`NoRepositoryPanel`. The
  reviewer makes more calls for blast radius; the review is discovery, so it uses
  `codegraph_explore` too (`ToolSearch "codegraph"` first).
- **`git grep` of import lines** decides the exact caller set (§2). CodeGraph's TS resolution
  over-links (pre-plan §0): a query for `App.vue` returns both apps' unrelated `App.vue` roots.
- **Part 18's fixes are the baseline, not a re-review target.** B6 landed F1-F12 on top of
  `4863cf1`. F1's code (`GraphViewState.#loadGeneration`, `reset()` aborting `#loadController`)
  sits inside commit `bc2abf1`, whose message is a Studio `grpcclient` fix (a shared-checkout
  mix-up). Read it there. F2 (`cf3822b`) is the one B6 fix that edited this chunk's own files:
  `App.vue` (`applyRepoIdToStates`, `handleReconnect`) and `ReviewView.vue` (`handleReconnect`).
  Review those two as new code.
- **Parallel-race sweep.** For each B6 race fix, ask whether a component keeps its own copy of the
  same shape that the state-layer fix cannot see: local refs or dialog targets surviving a repo
  switch (F6's parallel), an `await` whose continuation writes without re-checking identity (F1/F5/
  F8's parallel), a fire-and-forget `async` handler with no `catch` (F10's parallel).
- **Real probes** (scratch dir, `bun test` or a Playwright run of the vscode webview/Kira Space
  suites) only where a claim rests on runtime ordering: the persisted-selection restore against the
  first chunk's `generation` bump, two overlapping `handleRepoOpened` calls, a drag interrupted by
  `detailOpen` flipping.

## 1. Own file set

Production 19,797 lines, tests 1,250 (`wc -l`, `.gitkeep` excluded). `.vue` alone is 15,638.

- **Roots:** `GU/App.vue` (2,114 lines, was 1,700+ at pre-plan time), `GU/main.ts` (`mount`,
  `MountOptions`, `MountHandle`, global CSS imports).
- **`GU/components/`** top level:
  - Grid: `CommitGrid.vue` (1,696), `columns.ts`, `gridKeyboard.ts`, `rowAccessibility.ts`,
    `refBadges.ts`, `searchHighlight.ts`, `linkify.ts`, `dateFormat.ts`, `countFormat.ts`.
  - Toolbar and pickers: `AppToolbar.vue`, `BranchPicker.vue`, `pickerModel.ts`,
    `refListModel.ts`, `TagList.vue`, `StashList.vue`, `StashRows.vue`, `GlobalStashList.vue`,
    `stashListModel.ts`, `StackList.vue`, `stackListModel.ts`, `WorktreeList.vue`,
    `PullStrategyPicker.vue`, `pullStrategyModel.ts`, `RefreshButton.vue`, `UndoButton.vue`,
    `LoadMoreButton.vue`.
  - Search: `SearchBox.vue`, `SearchResults.vue`, `searchResultsModel.ts`, `searchListboxId.ts`.
  - Detail: `DetailPane.vue`, `CommitMeta.vue`, `FileTree.vue`, `fileTreeModel.ts`,
    `StashDetailPane.vue`, `WorkingDetailPane.vue`, `UncommittedChangesStrip.vue`.
  - Menus: `RowContextMenu.vue`, `rowMenuModel.ts`, `useRowMenu.ts`.
  - Content states: `NoRepositoryPanel.vue`, `EmptyRepositoryPanel.vue`, `GitBlockedPanel.vue`,
    `gitBlockedCopy.ts`, `ConnectionBanner.vue`, `ConflictBanner.vue`.
  - Tests: `countFormat`, `dateFormat`, `fileTreeModel`, `pickerModel`, `refBadges`,
    `rowMenuModel`, `stackListModel`, `stashListModel` (`.test.ts`).
- **`GU/components/dialogs/`**: `BranchDialog`, `CheckoutDialog`, `CherryPickDialog`,
  `ForcePushDialog`, `PostCheckoutPullDialog`, `PullDialog`, `RenameRefDialog`,
  `RepoSettingsDialog`, `ResetDialog`, `RevertDialog`, `StackDialog`, `StashDialog`, `TagDialog`,
  `WorktreeDialog` (`.vue`), `tagDialogModel.ts`.
- **`GU/components/review/`**: `ReviewView.vue` (1,279, the second mount root), `BaseSelector.vue`,
  `ReviewCommentsPane.vue`, `ReviewCommitRow.vue`, `ReviewFilesPane.vue`.
- **`GU/icons/`**: `index.ts` (`ACTION_ICONS`, `STATE_ICONS`, `PICKER_TAB_ICONS`),
  `setiFileIcon.ts` (the package's second public entry, `@kira/git-ui/icons`), `codicon.css`,
  `setiFileIcon.test.ts`.
- **`GU/theme/`**: `readTokens.ts` (`TokenReader`, `rowHeightPx`, exported from `GU/index.ts`),
  `app-shell.css`, `density.css`, `kira-structure.css`, `kui-bridge.css`, `vscode-tokens.css`.
- **`GU/testing/fakeTransport.ts`**: test-only `Transport` fake, imported by seven `state/*.test.ts`.
- **`packages/git-ui/vite.config.ts`**: the VS Code webview bundle (`scripts/build-vscode.ts`).

Tests are read only where they pin a contract the review questions.

## 2. One hop: callers

From import lines, production only.

- **`PF/views/repo/RepoGraphView.vue`**: `mount(..., { view: 'graph', host: 'kira',
  hostConnectionState: { kind: 'connected' } })`, `TabViewStateStore`, `pendingUiAction` from
  `takePendingBlameReveal`. KeepAlive: `onDeactivated`/`onActivated` call `setVisible`;
  `onUnmounted` calls `unmount()`. Several repo workspaces' graphs can be mounted in one document
  at once.
- **`PF/repo/RepoReviewView.vue`**: `mount(..., { view: 'review', target, NullViewStateStore })`,
  kept alive with `v-show` by `GitPanel.vue`; `unmount()` only on workspace close.
- **`PF/repo/git/{gitUiModule,viewStateStore}.ts`**, **`PF/repo/state/repoHeads.ts`**,
  **`PF/repo/fileIcon.ts`**: lazy `loadGitUi()`, `parsePersistedViewState`,
  `setiIconFor` via `@kira/git-ui/icons` (this chunk's `setiFileIcon.ts`).
- **`vscode/src/webview/main.ts`**: `mount` for both views, `VsCodeApiViewStateStore`
  (`getState`/`setState`), `KIRA_REPO` seeding of a v8 blob, `bootstrap.connectionState` as the
  live seed. The only host where `BridgeClient.onReconnect` can fire (native hard-codes
  `'connected'` and has no `connection.changed` source).
- **`scripts/build-vscode.ts`**: runs `vite.config.ts`.

`PF` and `vscode` are Part 20's own files. Treat their on-disk state as the caller contract.

## 3. One hop: callees

- **B6 (closed):** every `GU/state/*` class `App.vue`/`ReviewView.vue` construct, `BridgeClient`
  (`init`, `on`, `onReconnect`, `connectionState`, `hostConnection`, `dispose`),
  `GraphViewState` (`openStream`, `reset`, `revealSha`, `rebuildOrder`, `onChunkLayout`, `plan`,
  `layout`, `generation`), `GraphOrderState`, `SelectionState`, `createPendingSlot`/`PendingSlot`
  (F6 `abandon`), `retryBootstrap`, `viewState.ts`, `graphVisibility.ts`, `graph/{geometry,
  graphColumn,hitTest}.ts`. Treat as correct, except where a component relies on a guarantee B6
  never made, or duplicates a race B6 fixed only at the state layer.
- **B1 (closed):** `@kira/kira-ui` `KuiColumnResizeHandle` (P105), `KuiDialog`, `KuiButton`,
  `KuiSelect`, `KuiSegmented`, `KuiSearchInput`, `KuiTextInput`, `KuiPopoverPanel`, `KuiTooltip`/
  `vKuiTooltip`/`initTooltips`, `computeFloatPosition`/`pointReference`,
  `@kira/kira-ui/theme/controls.css`. `workbench` is not imported by this chunk's own files
  (pre-plan listed it; `git grep` finds only B6's state tests importing `@workbench/testing`).
  Check caller-side use only.
- **`@kira/git-ipc` types** (B5, closed): `EventPayload`, `UiActionKind`, `HostKind`,
  `StashEntry`, `ReviewSessionSnapshot`, `Transport`.
- **Libraries:** `slickgrid` 5.20 (`enableHtmlRendering: false`, `invalidateRowHeights`,
  `setColumns`, `scrollRowIntoView`), `@vueuse/core` (`onClickOutside`, `useEventListener`),
  `vue`, `seti-icons`, `@vscode/codicons`, `vite`/`@vitejs/plugin-vue`.

## 4. Edge cases to weight

1. **`App.vue` bootstrap ordering.** `bootstrap()` sets `repoState` before the persisted restore
   and the candidate loop, so `NoRepositoryPanel` renders and can emit `repo-opened` while the
   loop is still awaiting `repo.open`. Two `handleRepoOpened` calls then interleave. The
   persistence `watch` is registered only after `await graphView.openStream(...)` resolves:
   confirm `graph.stream` always ends (`gitrpc/graph.go` `handleGraphStream`), and that no user
   change made during that window is lost. `persisted.selectedSha` goes into
   `pendingSelectionSha`, but `watch(graphView.generation)` overwrites `pendingSelectionSha` with
   the (still null) `selection.sha`. Does the first chunk of a fresh stream bump `generation` and
   silently drop the restored selection? Probe it.
2. **Bootstrap retry and unmount mid-bootstrap.** `retryBootstrap` re-runs `bootstrap()` whole:
   a second `SettingsState`/`RepoState` replaces the first without `dispose()` (leaked
   `repo.changed`/settings subscriptions) when the first attempt failed after `repoState` was set.
   `pendingUiAction` runs only on the first attempt's `.then`, never after a retry. In
   `ReviewView.vue`, `bootstrap()` subscribes `review.target`/`ui.action`/`onReconnect` midway: a
   failure after that point plus a retry double-subscribes and orphans the first unsubscribers.
   Unmount (tab closed, workspace closed) while `bridge.init()` is pending: `onBeforeUnmount`
   runs first, then the continuation constructs states, subscribes and opens a stream on a
   disposed bridge. Check what `BridgeClient`/`Transport` do with calls after `dispose()`.
3. **F2 reconnect handlers (new code, `cf3822b`).** `App.vue` `handleReconnect` runs
   `handleRepoOpened`, which clears the selection and `pendingSelectionSha`: a reconnect loses the
   user's selection and scroll, unlike a refresh. It then calls `applyRepoIdToStates`; when
   `repo.open` returns a different `repoId`, the `activeRepo` watch fires too (double fan-out). No
   generation guard: a reconnect racing a user repo switch, or two quick reconnect edges, can land
   the older `repo.open` last. `ReviewView.vue` `handleReconnect` awaits `applyTarget` then
   `setBase`: a `review.target` push or a user base change in between gets overwritten by the
   captured `overrideBase`. Neither handler catches a rejection (`void handleReconnect()`).
4. **Component state that survives a repo switch (F6's parallel).** F6 abandons `OpsState` slots
   only. `App.vue` owns eleven more dialog/menu refs: `contextMenuState` (a store row index),
   `tagDialogState`, `branchDialogState`, `renameRefDialogState`, `stashBranchTarget`,
   `stashCreateOpen`, `globalStashSaveOpen`/`globalStashSaveSourceEntry`,
   `repoSettingsDialogOpen`, `worktreeCreateRequest`, `stackDialogTarget`. None is cleared in
   `handleRepoOpened` or `applyRepoIdToStates`. A dialog opened on repo A, confirmed after a
   worktree switch or `revealCommitInGraph` to repo B, runs against B with A's ref name, stash
   entry or start point. Same question for component-local state: `BranchPicker.vue` (open panel,
   active tab, row menus), `RepoSettingsDialog.vue` draft (saved to the new repo?), `SearchBox.vue`
   query, `FileTree.vue` expansion, `StashDialog.vue` `includeUntracked` (seeded from
   `props.includeUntrackedDefault` before repo settings load).
5. **Awaited continuations without an identity re-check (F1/F5/F8's parallel).**
   `revealAndSelectSha`: `revealController` is never aborted by `handleRepoOpened`; after
   `revealSha` returns `'found'`, `rowOfSha`/`selection.select`/`scrollToRow` run against whatever
   repo is current. `CommitGrid.scrollToRow` awaits `rebuildOrder()` then scrolls against the new
   plan; `containingDisplayRow(row)` for a row outside the plan returns `-1` into `groupKeyAt`.
   `revealCommitInGraph` and `handleSwitchWorktree` await `repo.open` then `handleRepoOpened` with
   no latest-wins: two overlapping calls resolve in either order (the last *resolved* wins, not
   the last *clicked*). Dialog pre-flight watches (`StashDialog` `previewToken`, `ResetDialog`,
   `CheckoutDialog`, `WorktreeDialog`, `StackDialog`, `TagDialog`, `CherryPickDialog`,
   `RevertDialog`, `BaseSelector`): each needs latest-wins and a repo guard, not just one of them.
6. **Fire-and-forget `async` handlers (F10's parallel).** Sweep every `void x()` and every `async`
   `@click`/`@submit` handler in components: `StashDialog` `submitBranch`/`submitSave` (a
   rejection leaves the dialog open and surfaces nowhere), `NoRepositoryPanel.openCandidate`
   (no in-flight guard, so a double click opens twice), `ReviewCommitRow.revealInGraph`,
   `openWorkingDiff`, `revealCommitInGraph`, `handleSwitchWorktree`, `RepoSettingsDialog` save,
   `watch(searchState.activeHit)`. Each rejection is an unhandled promise rejection in the webview.
7. **P105 resize handles (watch item).** `CommitGrid.vue`'s three `KuiColumnResizeHandle`s bind
   only `@update:value`; `change` is ignored. Every `pointermove` runs `setColumnWidth` (full
   `setColumns()`, which rebuilds every row's DOM) and emits `update:columnWidths`, which reaches
   the persistence `watch` and `viewState.write` (`vscode` `setState`, Kira Space tab-store patch)
   once per pixel. Pre-P105 `startDrag` did the same, so decide regression vs pre-existing, but it
   is real either way. Check against the old hand-rolled code (`git show ea43945`): min/max per
   column, step 8, pointer capture in the Wails WebKit webview, `e.stopPropagation()` on
   `pointerdown` against VueUse `onClickOutside` (context menu, `BranchPicker`), and the author/
   date handles unmounting mid-drag when `detailOpen` flips (window listeners on a detached
   element; does `lostpointercapture` still reach `window`?). The detail-pane handle in `App.vue`
   (`startDetailResize`) was not migrated: `mousedown`/`mouseup` only, no `pointercancel`/blur, no
   cleanup on unmount, so it has the exact leak `KuiColumnResizeHandle` F14 fixed. P105 made it a
   focusable `<hr>`; confirm the CSS reset holds in both WebKit and Chromium.
8. **Duplicate DOM ids across mounts.** Kira Space mounts one graph per repo workspace in one
   document (KeepAlive keeps them alive). `SEARCH_LISTBOX_ID` is the constant `'kv-search-listbox'`
   (`aria-controls`/`aria-activedescendant`). Five static `id="..."` attributes exist too:
   `RepoSettingsDialog.vue`'s four `repo-settings-*` label targets and `WorktreeDialog.vue`'s
   `kv-worktree-branches` datalist. Two mounts with the search row open (or a dialog left open in
   a backgrounded mount) make each ambiguous: `<label for>`, `list=` and `aria-*` resolve to the
   first match in the document, which may be the hidden mount.
9. **Global CSS side effects of `main.ts`.** The lazy git-ui chunk injects `app-shell.css`
   (`html, body { height: 100%; overflow: hidden; margin: 0 }`) and `:root` token blocks
   (`vscode-tokens.css`, `density.css`, `kui-bridge.css`, `kira-structure.css`) into Kira Space's
   own document the first time a graph mounts, and never removes them. Check for any
   `:root` custom property whose name Kira Space's own theme also defines, and whether the
   `body` rule changes Kira Space layout. Excluded: the already-known `vscode-bridge.css`
   specificity tie (Known open items).
10. **Grid rendering and escaping.** `enableHtmlRendering: false` means formatters return
    elements. Confirm every formatter path in `columns.ts` (message, author, date, graph,
    collapsed placeholder), `refBadges.ts`, and `searchHighlight.ts` builds DOM with
    `textContent`, never a string SlickGrid would parse. `searchHighlight.ts` with a regex that
    matches the empty string or overlapping ranges. `linkify.ts` `URL_PATTERN` is `https?:` only:
    check trailing punctuation and parentheses, and that a click goes through the host's
    `openExternal` capability, never in-webview navigation.
11. **Display row vs store row.** Part 18 left this for here. `gridKeyboard.ts`, `hitTest.laneAt`
    callers, `handleClick`, the context-menu row, `focusGrid`, `getViewportTop`/`scrollToTopRow`
    (auto-refresh viewport restore), and the selection watcher each translate between coordinate
    systems. Find any site that passes a store row where a display row is expected (or the
    reverse), and any that can target a row hidden in a collapsed group (`displayRowOf` `-1`).
12. **`graphVisible` deferral in `CommitGrid.vue`.** Four generation watchers set
    `pendingRebuildOnVisible` while hidden. The `plan` watcher (`grid?.invalidate()`), the
    `selection.row` watcher, the `dateFormat` watcher and `handleChunkLayout` run regardless.
    `scheduleResize` returns early while hidden but leaves `lastRebuiltWidth` stale: on re-show
    with an unchanged host width it skips the rebuild. Confirm columns and row heights are right
    after a hide, a detail-pane toggle while hidden, and a re-show.
13. **`ReviewView.vue` and review components.** `ReviewCommitRow` builds its context menu from
    `props.expansion?.actions.capabilities.clipboard` and copies through `props.expansion?.actions`:
    on a never-expanded row the Copy items are missing or no-op, although P75 added
    `props.actions` for exactly this. `resumeSession` against a `review.target` push that lands
    mid-await. `onUiAction('toggleFileReviewed')` reads `files` for the current target, not the
    one the palette command meant. `BaseSelector` async list vs `setBase` in flight. Known open
    items exclude native `review.session` expiry and `pendingReviewTargetByCodeRepoId`.
14. **Content states.** `App.vue`'s `v-if` chain across `bootError`, `GitBlockedPanel`,
    `NoRepositoryPanel`, `EmptyRepositoryPanel`, the grid, and `ConnectionBanner`/
    `ConflictBanner`. A `repo.open` returning `gitUnavailable` mid-session (git removed, path
    changed): does the grid stay up over a blocked git? An unborn repository (no commits) with a
    stash or a worktree. `gitBlockedCopy.ts` for every `BlockedGitStatus` kind in the contract.
15. **Teardown completeness.** `onBeforeUnmount` in `App.vue` disposes ten states; check that
    `detailState`, `selection`, `graphOrder`, `actions` and `revealController` need nothing, and
    that every `bridge.on`/`onReconnect`/`document`/`window` listener and `requestAnimationFrame`
    in every component is released (`RowContextMenu`, `SearchBox`, `BranchPicker`, `FileTree`,
    `CommitMeta`, `TokenReader.watch()`). `main.ts` `unmount()` against a later remount into the
    same container.
16. **Icons, theme reader, test fake.** `setiIconFor` on dotfiles, no extension, multi-dot
    (`.d.ts`, `.test.ts`), upper case, and a path with directories (it is a public entry, so
    `PF/repo/fileIcon.ts`'s inputs count). `TokenReader` change detection when the host theme
    flips (VS Code body class, Kira Space `data-theme`). `fakeTransport.ts`: does its stream and
    event behaviour match `Transport`'s contract closely enough that the seven state tests it
    backs prove what they claim? It must not ship: confirm `GU/index.ts` and `main.ts` never reach
    it.
17. **`vite.config.ts`.** `root` is the repo root and `outDir` is `vscode/dist/ui` with
    `emptyOutDir: true`. Confirm the build cannot empty anything outside `dist/ui`, the manifest
    names what `vscode/src/html.ts` reads, and Kira Space's own frontend build does not depend on
    this config.

## 5. Watch items from pre-plan §5.18

- **`App.vue` at 2,114 lines** (1,700+ at pre-plan time), bootstrap and content states: items 1-6,
  14, 15. F2 added 60 lines here after Part 18's own review.
- **P105's `CommitGrid.vue` column handles and the detail-pane handle**: item 7. Diff baseline
  `ea43945` (column handles) and `10e08b2` (`<hr>` detail handle).
- **`components` churn 871**: `git log --oneline -- GU/components` since P104's tail;
  P107 I2-21 (`StashRows`, `useRowMenu`) and I2-39 (`AppToolbar` binding dedupe) extractions: check
  each kept every original caller's guards and props.
- **Parallel races to Part 18 F1/F5/F6/F8/F9/F10**: items 3-6, 13. This chunk is the direct
  consumer of every one of those fixes.
- **Added while surveying:** multiple mounts in one Kira Space document (items 8, 9) and the
  public `@kira/git-ui/icons` entry (item 16).

## 6. Out of scope

- **B6's own files** (`GU/{state,graph,bridge}/**`, `GU/{index.ts,graphVisibility.ts}`,
  `git-core/**`). Closed. A needed change there is reported here, with the state class named,
  when a component-side fix alone cannot close it.
- **B1's own files** (`kira-ui`, `workbench`, `theme`). Closed. `KuiColumnResizeHandle` internals
  are read only to judge `CommitGrid.vue`'s use of them.
- **Part 20's own files** (`PF/**`, `vscode/**`). Read as callers. Same stream (B), so a fixer may
  edit them under pre-plan §3.3.
- **Known open items** in `docs/ARCHITECTURE.md`: the `vscode-bridge.css` specificity tie, native
  `review.session` expiry, the `pendingReviewTargetByCodeRepoId` leak, `loadComments`'
  swallowed error, the comment-reload fan-out.
- **P111's pull-strategy wire change** (`PullStrategyPicker.vue` only names the overlap).
- **Style nits and library-rule conformance on their own.** Findings must be real bugs:
  correctness, races, stale or stuck state, leaks, error handling, contract mismatches,
  accessibility breakage with a user-visible effect. A hand-rolled listener or observer where
  VueUse exists is a finding only when it carries a real defect (item 7's detail handle).
