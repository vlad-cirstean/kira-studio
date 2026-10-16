# P108 Part 19 — git-ui components review findings

Scope: `packages/git-ui/src/components/**`, `App.vue`, `main.ts`, `icons/`, `theme/`, `testing/`,
`vite.config.ts`. Plan: `P108-part19-git-ui-components.md`. Review only; fixer applies each finding
as its own commit. Items already in `docs/ARCHITECTURE.md` Known open items are not re-reported.

## F1 — `CommitGrid` row translation asserts when plan lags store (verified)

Sites:
- `packages/git-ui/src/components/CommitGrid.vue:947` (`initialScrollRow` on mount)
- `CommitGrid.vue:714` (`applyAccessibility`, runs from SlickGrid `onRendered`)
- `CommitGrid.vue:966` (selection watcher)
- `CommitGrid.vue:1128-1133` (`scrollToRow`)
- `CommitGrid.vue:1142`, `:1167` (`scrollToTopRow`, keyboard menu anchor)

Bug: every site calls `plan().displayRowOf(storeRow)` unguarded. `RowPlan.displayRowOf` asserts
`row < storeLength` and throws `AssertionError` in production.

Reachable two ways:
1. Cold boot with persisted state. The grid mounts before the first chunk lands, so the plan is still
   `identityRowPlan(0)`. `displayRowOf(initialScrollRow)` throws even for `scrollRow: 0`.
2. Plan lag. `GraphViewState.#applyChunk` sets `loadedRows` before its awaited
   `#packed.applyChunk` continuation rebuilds `plan`. Pre-flush watchers keyed on `loadedRows` read a
   stale plan. That includes App's pending-selection watcher (`App.vue:304`, `void scrollToRow`) and
   the grid's selection watcher.
   After a restart-at-zero refresh, the stale plan still covers the old length, so it maps rows wrong
   instead of throwing. `scrollToRow` can then `toggleGroup` the wrong group.

Probe: Playwright plus `buildFakeGraphHostInitScript` with a persisted `getState`. It logged 3 console
`AssertionError: RowPlan.displayRowOf(0): out of range` plus 1 uncaught pageerror, from
`onRendered` → `applyAccessibility`.

Fix:
- Make translation range-tolerant: a store row at or beyond `plan().storeLength` yields -1, and
  callers skip.
- Defer `initialScrollRow` and `scrollToRow` until a plan covering the row lands, via a watch on
  `plan`.
- In `scrollToRow`, re-read the plan after `await rebuildOrder()` and bail if the row is no longer
  covered.
- Alternative at the state layer: publish `loadedRows` and `plan` together, so no watcher sees one
  without the other.

## F2 — Graph/stash context menus act on whatever commit now sits at the stored row

Sites:
- `packages/git-ui/src/App.vue:606` (`contextMenuState {row,x,y}`)
- `App.vue:628-685` (`commitMenuSections`/`onCommitMenuSelect` do `graphView.store.commitAt(state.row)` at select time)
- `App.vue:694-744` (`stashContextMenuState`, `stashEntryForContextMenu`)

Bug: the menu stores a store row and resolves the commit only when an item is picked.

Reachable: an auto-refresh (refsChanged → restart at 0), a repo switch, or a reconnect can land
while the menu is open. The row index then names a different commit or stash. The chosen action
runs against it: reset, revert, cherry-pick, checkout detached, create branch/tag/worktree, copy,
stash apply/pop/drop/branch. Reset and stash drop are destructive. `commitAt` can also assert out of
range after a shrink.

Fix:
- Capture the sha, decorations and stash entry into the menu state when it opens.
- Act on the captured values.
- Close both menus on `graphView.generation` change and on repo switch.

## F3 — Dialog/menu refs survive a repo switch

Site: `App.vue:607-611`, `752-790`, `867`, plus `refContextMenuState` and `forceDeleteRefCandidate`
(watch at `:877`). These refs are:
- `tagDialogState`, `branchDialogState`
- `stashBranchTarget`, `stashCreateOpen`
- `globalStashSaveOpen`, `globalStashSaveSourceEntry`
- `repoSettingsDialogOpen`
- `worktreeCreateRequest`
- `stackDialogTarget`
- `renameRefDialogState`
- `refContextMenuState`, `forceDeleteRefCandidate`

Bug: `handleRepoOpened` (`:267`) resets selection and graph but none of these refs.

Reachable: a worktree switch, reveal-in-graph, a candidate pick or a reconnect with a dialog open.
Each dialog then submits against the new repo's ops state with the old repo's sha, ref name or
stash entry. Example: force-delete a branch of the same name in the other repo.

Fix: clear every one of these refs in `handleRepoOpened` (or in the `activeRepo` `repoId` watch at
`:439-453`).

## F4 — Overlapping repo opens are last-response-wins

Sites:
- `App.vue:796` `handleSwitchWorktree`
- `App.vue:536` `revealCommitInGraph`
- `App.vue:464` `handleReconnect`
- `NoRepositoryPanel.vue:24` `openCandidate` (no in-flight guard)
- `App.vue:1292-1303` bootstrap candidate loop

Bug: each path does `await repo.open(...)` then `handleRepoOpened`, with no token check.
`RepoState.open` sets `activeRepo` on every ok result, so the slowest response wins. The UI can
show repo A while the stream belongs to repo B.

Reachable:
- Two quick worktree switches.
- A reveal-in-graph ui.action during a switch.
- A user pick in `NoRepositoryPanel` while the bootstrap candidate loop keeps opening candidates;
  the loop never checks `activeRepo` and overrides the user's pick.
- `revealCommitInGraph` loses the race, then `revealAndSelectSha` (`:516`) pages repo B's entire
  history hunting repo A's sha.

Fix:
- Add one open-sequence counter in App: each open path takes a token and bails after every await if
  it is stale.
- Stop the candidate loop once `activeRepo` is set.
- Abort `revealController` in `handleRepoOpened`.
- Disable candidates in `NoRepositoryPanel` while an open is in flight.

## F5 — Graph reconnect wipes selection and scroll

Site: `App.vue:464-476` → `handleRepoOpened` (`:267-276`).

Bug: the F2 reconnect path re-runs `handleRepoOpened`, which sets `pendingSelectionSha = null` and
runs `selection.clear()` before the reset.

Reachable: any socket drop and recovery (host reload, network blip). The user loses the selected
commit and open detail, and the grid jumps to the top. A plain refresh preserves both, via
`watch(graphView.generation)` at `:289-305`.

Fix: in `handleReconnect`, capture `selection.sha` and pass it into the reopen, so
`pendingSelectionSha` is set after the reset. Guard with F4's token.

No finding for reconnect double fan-out: `repoId` is the gitDir (`gitclient/repo.go:237`), so
reconnect re-opens the same id and `applyRepoIdToStates` does not double-seed.

## F6 — `ReviewView` applies stale follow-up writes after awaits

Sites:
- `packages/git-ui/src/components/review/ReviewView.vue:123-134` `handleReconnect`
- `ReviewView.vue:178-194` `resumeSession`
- `ReviewView.vue:160-163` `bootstrap`

Bug:
- `handleReconnect` captures `overrideBase`, awaits `applyTarget`, then calls `setBase(overrideBase)`.
  `ReviewSessionState.setBase` targets the *current* repo and branch.
- `resumeSession` checks `branch` only before `applyTarget`. It then applies `setBase`, `setPane`,
  `listMode`, `filter` and `diffMode` after awaits with no re-check.
- `bootstrap` sets `repoId.value = list.activeRepoId` after the `repo.list` await.

Reachable:
- A `review.target` push, or a user base pick in `BaseSelector` (`:830`), during the await: the old
  override base or pane lands on the new target.
- A `review.target` push during `repo.list` in a multi-root window: `repoId` is overwritten with the
  active repo, while `review` holds the pushed repo and branch. Later `persistSession` and
  `refsState` then use the wrong repo.

Fix:
- Capture an identity (`repoId`+`branch`, or a monotonically bumped target token set by
  `applyTarget`).
- Re-check it before each follow-up write, and skip if changed.
- In `bootstrap`, only set `repoId` when no target arrived during the await.

## F7 — Bootstrap retry leaks subscriptions/states; App retry drops `pendingUiAction`

Sites:
- `ReviewView.vue:136-154`: states and three subscriptions are created before `repo.list`.
- `App.vue:1187-1189` `retryBootstrap`.
- `App.vue:1219-1223`: new `SettingsState`/`RepoState` on each run.
- `App.vue:1175-1180`: `pendingUiAction` runs only on the first `onMounted` success.

Bug:
- In ReviewView, a failure after subscribing (e.g. `repo.list` rejects) followed by Retry
  re-subscribes. `review.target`, `ui.action` and `onReconnect` then fire twice. The earlier
  unsubscribe handles and state objects are orphaned and never disposed.
- In App, retry creates fresh `SettingsState`/`RepoState` without disposing the prior ones. Their
  event subscriptions stay live.
- If the first bootstrap failed, a pending ui action from the host (e.g. reveal commit) is silently
  dropped after a successful retry.

Fix:
- Dispose prior states and unsubscribe prior handlers at the start of each bootstrap run, or
  subscribe only after the last await succeeds.
- Run `pendingUiAction` from a single success path shared by mount and retry, once.

No finding for unmount mid-bootstrap: `bridge.dispose()` rejects the pending `init`, and the
chain stops.

## F8 — Bootstrap failure after `repoState` is set shows misleading empty-state with no Retry

Sites:
- `App.vue:1665-1676`: full-panel error only when `!repoState`.
- `App.vue:1715`: `boot-error-banner` only in the graph `v-else` branch.
- `NoRepositoryPanel.vue:42-43`.

Bug: `repoState` is assigned at `:1223`, before persisted `repo.open`, the candidate loop and
`openStream`. A rejection there with no active repo sets `bootError`. The template then renders
`NoRepositoryPanel`, which says "None of them is a Git repository", with no error and no Retry.
The unborn-head branch (`:1678-1690`) also never shows the banner.

Reachable: host transport drops or times out during `repo.open` on cold boot.

Fix: render the `boot-error-banner` (or the full error panel) above the `repoState` sub-branches
whenever `bootError` is set. Give `NoRepositoryPanel` distinct copy when `refreshList` failed.

## F9 — Review row copy menu broken on never-expanded rows

Site: `ReviewCommitRow.vue:107-118`.

Bug: `menuSections` reads `props.expansion?.actions.capabilities.clipboard`, and `onMenuSelect`
returns early when `!props.expansion?.actions`. The row already receives `props.actions`
(`:37`, required).

Reachable: right-click any review row not yet expanded. Copy SHA and Copy message are disabled or
no-op.

Fix: build the menu from `props.actions.capabilities.clipboard` and call `props.actions.copy`.

## F10 — Unhandled async rejections

No `app.config.errorHandler` is set in `main.ts`, so a `void promise` rejection surfaces only as an
unhandled rejection. The user gets no feedback.

Sites:
- `App.vue:475` `void handleReconnect()`
- `App.vue:565` `void revealAndSelectSha` (search activeHit watcher)
- `App.vue:1095` `void revealCommitInGraph` (`runUiAction`)
- `App.vue:625` `void actions.value?.openPullRequest`
- `App.vue:304` `void commitGridRef.value?.scrollToRow`
- `NoRepositoryPanel.vue:21` `void props.repoState.refreshList()`
- `ReviewView.vue:207` `void persistSession()`
- `ReviewView.vue:145`, `:153` `void applyTarget` / `void handleReconnect`
- `ReviewCommitRow.vue:173` `void exp.actions.openInEditor`
- `ReviewCommitRow.vue:158` `revealInGraph` and `NoRepositoryPanel.vue:24` `openCandidate`: template
  handlers, which Vue catches, but still silent.

Reachable: any transport close, timeout or host error on those calls. After `dispose` they reject
with `transport-closed`.

Fix: catch at each site. Route the error to the existing surface: the announcement or live region,
`bootError`, or the row's error state (as `openAllChanges` at `ReviewCommitRow.vue:132-152` already
does). Ignore `transport-closed` after unmount.

## F11 — Detail-pane resize handle can stick in drag mode

Site: `App.vue:1546-1560` `startDetailResize`. This is pre-existing, not a P105 regression; P105
touched only the column handles.

Bug: drag uses `window` `mousemove`/`mouseup` only. There is no pointer capture, no
`pointercancel`/`blur` handling, no `buttons === 0` check, and no removal on unmount.

Reachable: release the mouse outside the webview iframe (VS Code) or outside the browser window. No
`mouseup` arrives, so the pane keeps resizing on every later mouse move until the next click.
Unmount mid-drag leaks both listeners.

Fix: switch to pointer events with `setPointerCapture`, the same shape as `KuiColumnResizeHandle`.
End the drag on `pointerup`/`pointercancel`/`lostpointercapture`, and remove the listeners in
`onBeforeUnmount`. Or use VueUse `useEventListener` with a stop handle.

## F12 — Document-wide handlers act across every mount in Kira Space

Sites:
- `App.vue:1508-1511`, `:1599` (document `keydown`)
- `App.vue:1517-1522` (`onClickOutside` target via `document.querySelector('[data-testid="detail-region"]')`)
- `ReviewView.vue:669-677` (document `keydown`)

Bug: Kira Space mounts several git-ui apps into one document: one per graph tab, kept alive by
`KeepAlive` while hidden, plus the review sidebar kept with `v-show`.
- Every graph instance handles `/`, Ctrl/Cmd+F and Escape document-wide. `graphVisible` is never
  consulted.
  - Ctrl+F anywhere in Kira Space is `preventDefault`ed and opens search in hidden graph tabs too.
  - Escape closes the detail pane in all graphs and collapses review rows.
- `onClickOutside` resolves the first `detail-region` in the document, which may belong to another
  mount. The overlay drawer then closes on clicks inside itself, or never closes.

Reachable: Kira Space with two or more graph tabs opened, or one graph tab plus the Git panel's
review segment.

Fix:
- Skip keydown handling unless the event target is inside this app's root, or this graph is
  visible (`GRAPH_VISIBLE_KEY`) and focus is not in another mount.
- Use a template ref for the detail region instead of `document.querySelector`.

## Examined, nothing real

- `vite.config.ts`: `emptyOutDir: true` is scoped to `apps/kira-space-vscode/dist/ui`. Fine.
- `testing/fakeTransport.ts`: imported only by `*.test.ts`. It is not reachable from `index.ts` or
  `main.ts`, so it stays out of the bundle.
- `icons/` entry (`./icons` export, `setiFileIcon.ts`): fine.
- `theme/app-shell.css` global `html, body` rules: documented as intentional (G16 D1/D2). Kira
  Space's own document sets no conflicting rules. The `:root` token tie is already a known open
  item.
- Rendering and link escaping: no `v-html`/`innerHTML` sink in the package. SlickGrid runs with
  `enableHtmlRendering: false`. `linkify.ts` matches only `https?://` and builds DOM text nodes.
- `GitBlockedPanel`/`gitBlockedCopy.ts`: all three blocked kinds are covered.
- `EmptyRepositoryPanel`, `BaseSelector`: fine.
- `CommitGrid` re-show after hidden: generation watchers defer and catch up (`:1003-1081`). The
  `detailOpen` watcher's `rebuildColumns` while hidden and `scheduleResize`'s early return were
  examined. No broken re-show state was confirmed, so no finding.
