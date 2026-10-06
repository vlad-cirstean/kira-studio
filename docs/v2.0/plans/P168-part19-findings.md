# P168 Part 19 findings: `git-ui` components

Plan: `P168-part19-git-ui-components.md`. Base `1e2b327`; plan commit `d9d3b35`; HEAD reviewed
`d9d3b35` (branch `p168-stream-b`). Reviewer reports only; fixes nothing.

Status: all 8 blocks done.

## Checks (block 1, §1.1)

1. VS Code webview suite: `bun run build:vscode` (exit 0, bundle checks passed), then whole config
   `node node_modules/.bin/playwright test --config=apps/kira-space-vscode/playwright.config.ts`:
   **60 passed** (37 s; 12 interaction specs + 1 layout spec, every named spec included).
2. Space UI: `bun run build:test:space` (exit 0), then `--project=ui repo-workspace
   repo-graph-lifecycle ade-v2-review`: **30 passed** (34 s).
3. F1 lane-repaint probe (scratch spec, `fakeGraphHost` `branchOrder`, not committed): expand the
   collapsed group, toggle collapse off and on, fire `repo.changed` (auto-refresh). A
   `MutationObserver` saw rows with an empty graph SVG mid-rebuild (`blankSeen 1`), then every row
   repainted with lanes after each step. **Pass, verified.** Code path: every `plan` write sits in
   `#rebuildLayout`/`#resetLayout`; `#drainLayoutRebuilds` and `rebuildOrder` call listeners after
   each relayout, a superseded relayout's listener call is followed by the winner's, and
   `handleChunkLayout` calls `invalidateRowHeights()`, which in SlickGrid 5.20 sets
   `rowHeightsDirty` and calls `invalidate()` (full re-render, `slick.grid.ts:6392`).
4. F16 live-region probe (same harness, `ui.action` `revertSelected` with no selection, twice):
   region text log `"Select a commit first."` then `""` + `"Select a commit first."` at task 81 /
   frame 20 for both, then the same pair at task 154 / frame 39. **DOM half verified: clear and set
   land in one task and one frame, with no paint between.** Screen-reader half: see F2.

## Findings

### F1. Review view live region still drops a repeated identical message (F16 not applied there)

- Severity: medium. Code-read (`App.vue`'s fix verified in §1.1 item 4; `ReviewView.vue` has none).
- Where: `packages/git-ui/src/components/review/ReviewView.vue:753-760` (own `liveAnnouncement`,
  plain assignment), plus direct writes at `:127`, `:322`, `:417`, `:421`, `:771-783`;
  `packages/git-ui/src/state/review.ts:84` (`announcement` is a `shallowRef`, not
  `createAnnouncementRef`).
- Scenario: VS Code review sidebar, Space review sidebar or ADE review window. Run palette
  "Toggle file reviewed" with no file open twice: the second `'Open a file in the Files tab
  first.'` assigns the same string, Vue does not re-render, the screen reader stays silent. Same
  for copying a SHA twice (`ReviewSessionState.announcement` shallowRef: equal text does not even
  trigger the watcher) and for a repeated `reportAsyncError` text.
- Fix: move `announce()` out of `App.vue` into one own composable (e.g.
  `GU/components/useLiveRegion.ts`, carrying F2's fix) and use it in both `App.vue` and
  `ReviewView.vue` for every write. Switch `ReviewSessionState.announcement` to
  `createAnnouncementRef()` and watch it with `{ deep: true }`.
- `needs-other-part-file: packages/git-ui/src/state/review.ts (Part 18)`.

### F2. `announce()` clears and sets in one task, so a repeat may still not be spoken

- Severity: medium. DOM half verified (§1.1 item 4); screen-reader half code-read.
- Where: `packages/git-ui/src/App.vue:1036-1041`.
- Scenario: VS Code webview (Chromium). Fetch fails twice with the same text. `announce` writes
  `''`, then on `nextTick` the old text. Both writes land in the same task and frame. Chromium
  and WebKit batch accessibility-tree updates per lifecycle/frame, so the serialized text node
  goes from `X` to `X`: no net change, no live-region event. The F16 fix therefore relies on the
  intermediate empty string being observed, which nothing guarantees.
- Fix: make each announcement's DOM text differ in one write. Alternate a trailing ` ` on
  every call (or toggle between two sibling regions). Alternatively clear, then set after a short
  delay with VueUse `useTimeoutFn` (about 100 ms), cancelled on unmount. Put it in F1's shared
  composable.

### F3. Five form dialogs (seven submit paths) close after a failed op and lose the input

- Severity: medium (raised from low in block 6, when the pattern turned out to span every
  form dialog but one). Code-read.
- Where: each awaits an `OpResult` and emits close regardless:
  `components/dialogs/StashDialog.vue:105-117` (create), `:175-181` (`submitBranch`), `:220-225`
  (`submitSave`); `BranchDialog.vue:52-58`; `RenameRefDialog.vue:51-52`; `TagDialog.vue:59-65`;
  `StackDialog.vue:67-68` (set parent). Only `WorktreeDialog.vue:157-163` stays open on
  `!result.ok`.
- Scenario: Space graph tab. "Create branch from stash" (or New branch, Rename, New tag), type a
  name that another surface created a moment ago, or submit while another op holds `busy`. The
  op resolves `{ ok: false }` (since Part 18 `4b4b5a0` it also resolves on busy, no repo and
  transport rejection). The dialog closes anyway, the typed name or tag message is gone, and a
  sighted user sees no failure (F4).
- Fix: `const result = await props.ops.<op>(...); if (!result.ok) return;` before each close
  emit, matching `WorktreeDialog`. Optionally show the failure text inline in the dialog.

### F4. Op failures and an unrecoverable graph stream reach only an `sr-only` region

- Severity: medium. DESIGN-DECISION. Code-read.
- Where: `packages/git-ui/src/App.vue:1713-1722` (the only sink for `opsState.announcement`,
  `detailState.announcement`, `graphView.announcement`, `reportAsyncError`); no visible notice or
  toast exists in `GU` (`git grep -n toast packages/git-ui/src` hits only a comment). The graph's
  `onUnrecoverable` (`state/graphView.ts:547-549`) likewise only sets the announcement.
- Scenario: any host. Push rejected (`NonFastForward`), checkout refused, fetch auth failure, or a
  corrupted stream after one re-open: a sighted user sees the spinner stop and nothing else. The
  grid stays half-loaded with no error state and no retry hint (Refresh works, but nothing says
  so). VS Code shows no `showErrorMessage` for these either (`extension.ts` covers only repo open
  and connection).
- Decision needed: a visible failure surface for the graph mount (inline banner or toast, shared
  with the live region), and whether the graph needs an error state with retry for
  `onUnrecoverable`. No fix proposed.

### F5. Manual refresh, Load more and Load all reject silently

- Severity: medium. Code-read.
- Where: `packages/git-ui/src/components/RefreshButton.vue:57-60` (`doRefresh` awaits
  `graphView.refresh()` with no catch); `App.vue:245` and `:1147` (`toolbarRef.value?.refresh()`,
  promise dropped; reached from F5/Ctrl+R via `CommitGrid` `refresh` emit and the palette);
  `AppToolbar.vue:259`; `LoadMoreButton.vue:44,46` (`void graphView.loadAll()` /
  `void graphView.loadMore()`). `GraphViewState.#runLoad` rethrows every non-`cancelled` error
  (`state/graphView.ts:326`), and only `#runAutoRefresh` catches it.
- Scenario: any host. The git process fails or the socket drops while the user presses F5 or
  "Load 500 more". `loading` returns to `idle`, the spinner stops, the rejection is unhandled
  (`main.ts` sets no `app.config.errorHandler`), and nothing is announced. P108 F10's rule
  ("every fire-and-forget call routes its rejection through `reportAsyncError`") is not met here.
- Fix: give `AppToolbar`/`RefreshButton`/`LoadMoreButton` a `reportError: (err, prefix) => void`
  prop bound to `App.vue`'s `reportAsyncError`, and catch in `doRefresh`/`handlePress`
  (`"Couldn't refresh"`, `"Couldn't load more history"`). `App.vue:245`/`:1147` then need no
  catch of their own.

### F6. Persistence watcher is registered only after a fully successful bootstrap, outside setup

- Severity: medium. Code-read.
- Where: `packages/git-ui/src/App.vue:1380-1435` (`watch(...)` at the end of `async bootstrap()`,
  after several `await`s); `App.vue:1747-1763` (boot-error banner); `handleReconnect`
  (`:506-522`) never clears `bootError`.
- Scenario 1: Space graph tab, persisted repo. `repo.open` succeeds, `graphView.openStream`
  rejects once (transient git or transport error). `bootError` shows the banner; the watcher at
  `:1380` is never registered. A later reconnect (`handleReconnect`) reopens the stream and the
  graph works, but the banner still says "Kira Space isn't reachable" and no column width,
  scroll row, selection or search toggle is persisted for the life of the mount (only a manual
  Retry that succeeds arms it).
- Scenario 2: the watcher is created after an `await`, so it is not bound to the component's
  effect scope and is never stopped on unmount (Vue only auto-stops watchers created
  synchronously in setup). It holds every watched ref and keeps calling `viewState.write` if any
  of them changes after teardown.
- Fix: register the watcher synchronously in setup, guarded by a `persistenceArmed` flag that
  `bootstrap()` sets once `lastPersisted` is loaded (right after `props.viewState.read()`), so a
  later failure still persists user changes. Clear `bootError` in `handleRepoOpened` (or after a
  successful `handleReconnect`), since an open that succeeded disproves the banner.

### F7. VS Code-only copy renders in Kira Space

- Severity: low. Code-read.
- Where: `packages/git-ui/src/components/NoRepositoryPanel.vue:93-96` ("follows the folders open
  in this VS Code window… File → Open Folder"); `components/gitBlockedCopy.ts:46-53` ("set
  kiraSpace.git.path", a VS Code setting id); `App.vue:1736`, `:1753` and
  `components/review/ReviewView.vue:813` ("Kira Space isn't reachable — …" for any bootstrap
  failure).
- Scenario: Space mounts the graph with `host: 'kira'` (`PF/views/repo/RepoGraphView.vue`).
  (a) The workspace record is gone or its root stops being a repository: `repo.list` returns no
  candidate (`PF/repo/git/hostHandlers.ts:224-228`) and the panel tells a Space user to use VS
  Code's File menu. (b) Git missing: the panel names `kiraSpace.git.path`, but Space's setting is
  Settings → Git → "Git executable path" (`GitPane.vue:150`). (c) `openStream` fails on a git
  error inside Kira Space itself: the banner says Kira Space is not reachable.
- Fix: branch the three strings on `props.host` (pass `host` to `NoRepositoryPanel` and
  `GitBlockedPanel`; give `gitBlockedCopy` a host argument). For (c) use neutral copy
  ("Couldn't load the repository — …") in both hosts; keep "isn't reachable" for the
  `ConnectionBanner`, which only VS Code drives.

### F8. Grid has no Tab stop once the selected row scrolls out of the rendered range

- Severity: medium. Verified (scratch probe, `fakeGraphHost` `manyRows`, 300 rows).
- Where: `packages/git-ui/src/components/CommitGrid.vue:719-736` (`applyAccessibility`:
  `tabbableRow` is the selected display row, else row 0, and only rows inside the rendered range
  get `tabIndex` set).
- Scenario: VS Code webview or Space. Click row 2, scroll the grid to the bottom with the wheel.
  Rendered rows are 262-299; none carries `tabindex="0"` (probe: the only `[tabindex="0"]` nodes
  under `commit-grid` are the three `KuiColumnResizeHandle`s). Tab from the toolbar lands on the
  resize handles and then leaves the grid. A keyboard user cannot reach any row until the
  selection is scrolled back into view by other means. The same holds with nothing selected once
  row 0 is scrolled away, and when the selected commit is hidden in a collapsed group.
- Fix: when `tabbableRow` is outside `[range.startRow, range.endRow]` (or not rendered), give
  `tabIndex = 0` to the first rendered row at or below the viewport top instead, so exactly one
  rendered row is always tabbable. Add a VS Code interaction assertion (Part 23 file).
- `needs-other-part-file: apps/kira-space-vscode/tests/interaction/graph-columns.spec.ts (Part 23)`
  for the guard (or a new spec beside it).

### F9. Every row-height index rebuild materializes every loaded commit twice

- Severity: medium. Verified for cost (scratch bun probe, not committed: two `commitAt` calls per
  row over a 50,000-row store took 139-191 ms); call path code-read.
- Where: `packages/git-ui/src/components/CommitGrid.vue:868-882` (no `rowHeightProvider`, so
  SlickGrid's default is used); `components/columns.ts:423-432` (`rowHasBadges` calls
  `store.commitAt(row).sha`) and `:471-476` (`getItem` is `store.commitAt`). SlickGrid 5.20
  `ensureRowPositionIndexer` (`slick.grid.ts:6356-6383`) calls
  `provider(grid, row, this.getDataItem(row))` for every row, so each rebuild runs `getItem`
  (one full `commitAt`: hex SHA, parent SHAs, two identities, subject, decorations) and
  `getItemMetadata` (a second `commitAt` for every undecorated row once `prsFor` is wired, which
  `CommitGrid` always does).
- Scenario: Space or VS Code, 200k-commit repo. The index rebuilds on every `invalidateRowHeights`
  (each relayout landing in `handleChunkLayout`, each coalesced PR resolution in
  `scheduleAncestryRebuild`, each token change) and on every row-count change. At the measured
  rate that is several hundred ms of main-thread work per rebuild, repeated while history
  streams in and while PRs resolve: input and scroll stall.
- Fix: pass `rowHeightProvider: (_grid, row) => rowMetadata(deps, row)?.height` (no data item),
  and make `rowHasBadges` read `store.shaAt(row)` instead of `commitAt(row).sha`. Optionally
  short-circuit rows with no decoration when `prByAncestry`/`bySha` are empty.

### F10. Grid PR badge buttons are Tab stops that Enter cannot activate

- Severity: medium. Code-read.
- Where: `packages/git-ui/src/components/refBadges.ts:288-293` (`<button data-pr-number>` with
  default tab order, built inside SlickGrid rows when `openExternalCapability`);
  `gridKeyboard.ts:76-86` (Enter is claimed for `toggleDetail` with `preventDefault()`).
- Scenario: Space (`openExternal: true`) or VS Code with PRs resolved. `prForCommit` answers for
  every commit reachable from a PR head (`state/pr.ts:397-402`), so many rendered rows carry a
  badge. Each is a native Tab stop inside the roving-tabindex grid: Tab walks through every
  rendered badge instead of leaving the grid. On a focused badge, Enter bubbles to the canvas
  listener, toggles the detail pane and cancels the button's activation; Space opens the PR. The
  focus also snaps back to the row div on the next re-render (`applyAccessibility`'s
  `focusedRowIndex` restore). G21 D5 removed the in-row SHA button for the same class of reason.
- Fix: set `badge.tabIndex = -1` on the grid's PR button (keyboard users reach the PR through
  the detail pane's PR row and the context menu); keep it a `<button>` for pointer clicks.

### F11. F1's lane gate does not cover lane colour or fork-stub hit testing

- Severity: low. Code-read.
- Where: `packages/git-ui/src/components/CommitGrid.vue:341-342` (`colorOf` checks only
  `row < layout.rowCount`) and `:531` (`handleForkStubClick` compares against
  `layout.laneOf(displayRow)`); both read `layout` while `graphView.layoutCurrent` is false.
- Scenario: grouped mode, expand a group. For one worker round trip the plan has moved rows but
  `layout` is still keyed by the old plan. The graph cell is blank (F1, verified), yet the message
  cell's HEAD/lane badge tint (`buildRefBadges(..., laneCtx.colorOf(row))`) comes from whichever
  commit sat at that display row before, and a click in the graph cell tests a stale lane (or a
  row past the old `layout.rowCount`, where `#locateRow` has no chunk).
- Fix: gate both on `props.graphView.layoutCurrent` (return `undefined` / `false`), matching
  `readSlice`.

### F12. Enter on a picker row's inner button also fires the row's main action (checkout)

- Severity: medium. Code-read.
- Where: `packages/git-ui/src/components/BranchPicker.vue:263-300` (`onRowsKeydown`, bound on the
  rows scroll container at `:304`): `Enter` resolves the row from `event.target.closest(...)` and
  calls `.kv-branch-row-main.click()` without checking that the target is the row itself and
  without `preventDefault()`.
- Scenario: VS Code (write) or Space. Open the branch picker, Tab to a non-HEAD branch's "More
  actions" button (`RowActionsButton`) or its `#123` PR badge, press Enter. The native button
  activation opens the menu (or the PR), and the handler also clicks the row's main button:
  `checkoutBranch` runs, closes the picker and starts `runCheckout`. A clean preflight switches
  branch with no dialog. Same in the Tags tab (`TagList.vue:121`, tag checkout) and Stashes tab
  (`StashRows.vue:104`, select). Enter on the main button itself activates it twice (handler plus
  native), relying on `OpsState.busy` to drop the second.
- Fix: in `onRowsKeydown`, handle `Enter` only when `event.target === rowEl` (the roving-tabindex
  row div), and `preventDefault()` when it does.

### F13. PR badge `<button>` nested inside the branch row's main `<button>`

- Severity: low. Code-read.
- Where: `packages/git-ui/src/components/BranchPicker.vue:698-725` (`<button
  class="kv-branch-row-main">` contains `<button class="kv-badge-pr" @click.stop>` at `:711-716`).
- Scenario: any host with `openExternal` and a branch with a PR. Interactive content inside a
  `<button>` is invalid HTML; assistive tech flattens the outer button's name to include "#123"
  and may not expose the inner one (axe `nested-interactive`). Keyboard focus order enters the
  inner button from the outer one, and Enter on it also hits F12.
- Fix: render the badge as a sibling of the main button inside the row div (as `StackList.vue`
  does, where the main element is a `div`), keeping `@click.stop`.

### F14. Fetch, Pull and Push target the alphabetically first remote, not the branch's upstream

- Severity: medium. Code-read.
- Where: `packages/git-ui/src/components/AppToolbar.vue:143-144` (`defaultRemote` =
  `remoteNamesFrom(...)[0]`, sorted by name, `rowMenuModel.ts:430-437`), used by `doFetch`,
  `doPush`, `doForcePush` (`:184-204`) and passed to `PullStrategyPicker` as `remote` (`:349-354`,
  `runPull(props.remote, ...)`).
- Scenario: repo with remotes `fork` and `origin`; local `main` tracks `origin/main`
  (`RefRow.upstream === 'origin/main'`). Push sends `main` to `fork` (and `wouldSetUpstream` may
  repoint tracking there); Pull merges `fork/main`; Fetch never updates `origin`. The tooltip says
  "Push to fork", but nothing else warns. The file comment assumes one remote per repo; the data
  needed to do better is already loaded (`RefRow.upstream` for the current branch).
- Fix: derive the remote from the current branch's `upstream` (text before the first `/` that
  matches a known remote name), falling back to `origin` when present, then to the first name.
  Use it for push/pull; fetch the same remote (or every known remote).

### F15. Context-menu focus return targets a grid row node that a re-render already replaced

- Severity: low. Code-read.
- Where: `packages/git-ui/src/components/RowContextMenu.vue:41-50` (captures
  `document.activeElement` at mount, refocuses it on close).
- Scenario: graph grid, Shift+F10 on a row while history is still streaming or PRs are
  resolving. `handleChunkLayout`/`scheduleAncestryRebuild` (`CommitGrid.vue:637-639`,
  `:656-658`) recreate every rendered row's DOM node while the menu is open. Escape calls
  `invoker.focus()` on the detached node, focus falls to `body`, and `focusedRowIndex` was already
  cleared by the `focusin` on the menu item, so nothing restores it. The keyboard user loses
  their place.
- Fix: on close, if `invoker?.isConnected` is false, emit a `restore-focus` (or accept a
  `restoreFocus` callback prop) and let `App.vue` call `commitGridRef.value?.focusGrid()` for the
  three grid menus.

### F16. Search box acts on Enter and Escape during IME composition

- Severity: low. Code-read.
- Where: `packages/git-ui/src/components/SearchBox.vue` `onKeydown` (Enter and Escape branches, no
  `event.isComposing` check).
- Scenario: a Japanese/Chinese/Korean IME user types a query and presses Enter to commit the
  composition. Chromium delivers that keydown with `key: 'Enter'`, `isComposing: true`: the
  handler `preventDefault()`s it and calls `search.next()` (reveals and selects a commit) or
  selects the highlighted option. Escape to cancel a composition clears the whole query.
- Fix: return early when `event.isComposing || event.keyCode === 229`.

### F17. Invalid-regex alert re-announces on every keystroke

- Severity: low. Code-read (message format checked in Node).
- Where: `packages/git-ui/src/components/SearchBox.vue:316-324` (`role="alert"`, text
  `search.error`); the message comes from `RegExp`'s own text minus the prefix
  (`packages/git-core/src/search/query.ts:85-90`), e.g. `/a(/: Unterminated group`, then
  `/ab(/: Unterminated group`. It embeds the compiled source (including the whole-word lookaround
  wrapper), so it changes with every character typed.
- Scenario: regex mode, typing `foo(bar` one key at a time: each keystroke while the group is open
  changes an assertive region's text, so the screen reader interrupts the user's own typing echo
  each time.
- Fix: strip the `/source/: ` part so the text only changes when the error kind changes, and use
  `aria-live="polite"` (or keep `alert` but only for a changed error kind).

### F18. Pull-strategy preview has no supersede guard and an unhandled rejection

- Severity: low. Code-read.
- Where: `packages/git-ui/src/components/PullStrategyPicker.vue:95-105` (`onOpenChange`), `:107-112`.
- Scenario: open the Pull menu on branch A (slow `remote.pullPreflight`), close it, check out B,
  reopen. B's answer lands, then A's late answer overwrites `preview`, so "Follow your
  configuration" describes A's strategy for B. A rejected preflight (disconnect) rejects the
  async `@update:open` handler with nothing catching it.
- Fix: capture the branch (or a counter) before the await and drop a result that no longer
  matches `props.branch`; catch and show no detail on failure.

### F19. `lib/menuModel.ts` keeps a test-only helper and stale doc comments

- Severity: low. Code-read (`git grep` per symbol).
- Where: `packages/git-ui/src/lib/menuModel.ts:1-10` (module doc still describes "the ARIA-menu
  keyboard-roving-focus logic" of `RowContextMenu.vue`, which reka now owns), `:37-41`
  (`flattenItems`: doc says "every enabled item" but returns all; only `menuModel.test.ts` calls
  it). `enabledNeighbour`/`firstEnabled` are live (`BranchPicker.vue:231-291`). Grouped with
  candidate 18: `components/searchResultsModel.ts:52-53` doc comment runs past 100 columns.
- Also stale: `packages/git-ui/vite.config.ts:26-27` says the prefixed root scans
  "packages/git-ui and packages/kira-ui"; `theme/tailwind.css:34` has only `@source "../"` (its
  own header says the kira-ui line is gone).
- Fix: delete `flattenItems` and its test cases, reword the module doc to "roving-focus helpers
  for `BranchPicker.vue`'s row list", rewrap `searchResultsModel.ts:52-55`, drop "and
  packages/kira-ui" from the vite comment.

### F20. Review "reviewed" checkbox cannot be toggled from the keyboard

- Severity: medium. Verified (scratch probe on `fakeReviewHost`, `/review` with a target).
- Where: `packages/git-ui/src/components/FileTree.vue:586` and `:714`
  (`@keydown.space.prevent="onRowClick(index)"` on the treeitem/option row) around the reka
  `Checkbox` at `:615-626` / `:743-754`; `onKeydown` (`:346-355`) claims Enter for the row.
- Scenario: VS Code review sidebar, Space review sidebar or ADE window, Files pane. Tab to a
  file's checkbox (it is a native tab stop) and press Space: the keydown bubbles to the row, whose
  `.prevent` cancels the button activation, so no click reaches the checkbox (probe: `" "`
  defaultPrevented, 0 clicks on `[role=checkbox]`, no mark) and the row opens the file instead.
  Enter goes to the tree handler and pins the file. Mouse click works. Space and the ADE window
  have no palette route (`toggleFileReviewed` is a VS Code `ui.action`), so a keyboard user there
  cannot mark a file reviewed at all.
- Fix: in the row's Space handler, return when `event.target` is not the row itself (or put
  `@keydown.space.stop` on the `Checkbox`), and optionally map `x`/Space-on-row to
  `toggleReviewed` when `reviewStates` is set. Add a keyboard case to
  `review-interaction.spec.ts`.
- `needs-other-part-file: apps/kira-space-vscode/tests/interaction/review-interaction.spec.ts
  (Part 23)` for the guard.

### F21. Opening a file from the detail, stash or working-tree pane fails silently

- Severity: medium. Code-read.
- Where: `packages/git-ui/src/components/DetailPane.vue:51-60` and `StashDetailPane.vue:41-50`
  (`void props.actions.openInEditor(...)`; `createDetailActions.openInEditor` awaits
  `editor.openDiff` with no catch, `state/detailActions.ts:105-117`);
  `WorkingDetailPane.vue:22-31` (`void props.openFile(...)` into `App.vue:1544-1553`
  `openWorkingDiff`, no catch).
- Scenario: Space graph tab. Click a file in a commit whose change the host cannot resolve
  (`hostHandlers.ts` throws "`<path>` is not one of commit `<sha>`'s changed files", or the
  transport drops). The rejection is unhandled, nothing is announced, and the click looks dead.
  The same class was fixed for `goToFile`, `openAllChanges`, `openPullRequest` and `openLink`
  (each announces), but not for the primary file-open action.
- Fix: catch in the three `onOpenFile` handlers and call `actions.announce("Couldn't open
  <path> — <message>")`, skipping `transport-closed`; `App.vue`'s `openWorkingDiff` likewise.

### F22. File tree structure: no keyboard route to the row menu, invalid tree children, duplicate ids

- Severity: low. Code-read.
- Where: `packages/git-ui/src/components/FileTree.vue:310-359` (`onKeydown` has no
  `ContextMenu`/`Shift+F10` case, and rows have no actions button), `:674-692`/`:805-823`
  (`Button` and `RowContextMenu` rendered inside `role="tree"`/`role="listbox"`), `:212-213`
  (`rowId(index)` = `kv-file-tree-row-<n>`, the same in every instance).
- Scenario: (a) "Copy path" and "Go to file" exist only in the right-click menu (G21 D11 made it
  the one copy-path affordance), so keyboard users cannot reach either. (b) A tree/listbox may
  only own treeitems/options; the "Show all N files" button sits inside it (axe
  `aria-required-children`). (c) The review view mounts one tree per expanded commit plus the
  Files pane, so `kv-file-tree-row-0` repeats in one document.
- Fix: handle `ContextMenu` and `Shift+F10` in `onKeydown` (open the menu at the focused row's
  rect, as `CommitGrid.openMenuFromKeyboard` does); move the button and menu outside the
  `role` container; prefix row ids with a `useId()` value.

### F23. Uncommitted-changes strip reads the display-row layout with a store row

- Severity: low. Code-read.
- Where: `packages/git-ui/src/components/UncommittedChangesStrip.vue:72-102` (`headRow` scans
  store rows, then `layout.laneOf(row)`/`colorOf(row)`), `:104-107` (comment says the gutter must
  match the grid's graph column, but it uses `graphColumnWidth(laneCount)` while the grid uses the
  user-set `widths.graph` since P92 item 1).
- Scenario: grouped mode (default on). `layout` is keyed by display row (`graphColumn.ts:30-32`).
  When HEAD's tip is not the newest commit, its store row differs from its display row (group 0
  is always row 0), so the dashed working-tree node takes the lane and colour of whichever commit
  sits at that display row. During a relayout it also reads a layout that lags the plan (F11).
  After a user resizes the graph column, the strip's label no longer lines up with the message
  column.
- Fix: map through `graphView.plan.value.displayRowOf(headRow)` (skip when `-1`), gate on
  `layoutCurrent`, and pass the grid's `columnWidths.graph` in as the gutter width (or drop the
  claim from the comment).

### F24. Repository settings: unvalidated page size, silent failed save, stale draft reverts

- Severity: low. Code-read.
- Where: `packages/git-ui/src/components/dialogs/RepoSettingsDialog.vue` `onPageSizeChange`
  (`Number(value)`: an emptied field is `0`, `min`/`max` on the `<Input type="number">` are not
  enforced outside a form submit), `save()` (awaits `repoSettingsState.set`, which rethrows the
  `repoSettings.set` rejection, `state/repoSettings.ts:105-112`; no catch, no error text), and
  the `open` watch (draft copied once at open; `repoSettings.changed` while open does not refresh
  it).
- Scenario: (a) Clear the page-size field and Save: `0` is sent; a server-side rejection leaves
  the dialog open with no message and an unhandled rejection. (b) Dialog open in VS Code; the
  same repo's stash default is changed from Space; the user changes only the date format and
  saves: `draft['kiraSpace.stash.includeUntracked']` (old) differs from `current` (new), so the
  patch silently writes the old value back.
- Fix: clamp/validate page size against `SETTINGS[...].minimum/maximum` and disable Save on an
  invalid value; catch in `save()` and render the error in the dialog; build the patch against
  the snapshot the draft was taken from (keep `draftBase`), so only fields the user edited are
  sent.

### F25. Confirm dialogs opt out of a description, so destructive advisories are not announced

- Severity: low. Code-read.
- Where: every `components/dialogs/*.vue` passes `:aria-describedby="undefined"` to
  `DialogContent` (e.g. `ResetDialog.vue:82`, `ForcePushDialog.vue:87`, `CheckoutDialog.vue:75`,
  `StashDialog.vue:267`); `@theme/components/ui/dialog` exports `DialogDescription`.
- Scenario: screen-reader user opens Reset (hard) or Force push. Focus moves into the dialog and
  only the title ("Move main to abc1234 — …") is announced; "3 commits will leave main" or the
  overwrite warning is read only if the user explores the body.
- Fix: wrap each dialog's first advisory paragraph in `DialogDescription` (drop the explicit
  `undefined`) for the confirm dialogs (Checkout, Revert, Reset, Cherry-pick, Force push, Pull,
  Post-checkout pull, Stash pop).

### F26. Review view's error phase offers no retry

- Severity: low. Code-read.
- Where: `packages/git-ui/src/components/review/ReviewView.vue:1015-1017` (`phase === 'error'`
  renders only "Couldn't compare — <message>"); reached from `ReviewSessionState.#failStream`
  (`state/review.ts:417-421`, including Part 18 F8's `onUnrecoverable`) and resolve failures.
- Scenario: ADE review window or a review sidebar; `review.resolveBase` or the range stream fails
  once (transport blip, corrupted chunk after its one re-open). The pane shows the error text and
  nothing to act on; re-picking the same base in `BaseSelector` or pressing Back and choosing the
  branch again works, but nothing says so.
- Fix: add a Retry button that calls `applyTarget(repoId, branch)` with the current override base
  restored (the same sequence `handleReconnect` runs).

### F27. Base picker silently hides branches past 50 and says "No matching branches" while loading

- Severity: low. Code-read.
- Where: `packages/git-ui/src/components/review/BaseSelector.vue` (`sections` from
  `buildRefListSections`, which caps each section at `REF_LIST_SECTION_CAP` = 50,
  `components/refListModel.ts:58`; the template renders only `.visible` and never `hiddenCount`;
  the empty-state div shows whenever both visible lists are empty).
- Scenario: repo with 300 local branches; open the base picker: the first 50 by name show, with
  no "N more" row, so a base like `release/2026` looks absent unless the user types a filter. In
  a cold ADE window the picker can open before `refs.list` lands and reports "No matching
  branches".
- Fix: render `ShowMoreButton`/a "N more — type to filter" row from `hiddenCount`, and show
  "Loading branches…" until `refsState` has loaded once.

### F28. Comments pane: listbox semantics wrong, and Enter on Delete also opens the file

- Severity: low. Code-read.
- Where: `packages/git-ui/src/components/review/ReviewCommentsPane.vue:112-152` (`role="listbox"`
  holding path header divs and `role="option"` rows that are each `tabindex="0"` with a fixed
  `aria-selected="false"`; a `TooltipIconButton` Delete inside each option; option
  `@keydown.enter` emits `select-comment`; the warning glyph has `aria-label` on a role-less
  `span`).
- Scenario: keyboard user in the Comments pane. Every comment is its own Tab stop (a listbox
  should be one), non-option children break the listbox contract, the warning label is not
  exposed, and pressing Enter on a comment's Delete button deletes it and also opens its file
  (the keydown bubbles to the option's Enter handler; `@click.stop` stops only the click).
- Fix: use a plain list (`role="list"`/`listitem`, or `ul`/`li`) with an explicit "Open"
  button per comment, or keep the option rows but move Delete outside them and guard the Enter
  handler with `event.target === event.currentTarget`; give the glyph `role="img"`.

### F29. Raw DOM listeners, observers and timers where VueUse is the rule

- Severity: low. Code-read.
- Where: `packages/git-ui/src/App.vue:1669-1681` (`document.addEventListener('keydown')`, raw
  `ResizeObserver` plus manual rAF throttle and teardown); `components/review/ReviewView.vue:743-745`
  and `:487` (`document` keydown, removed by hand in `onBeforeUnmount`);
  `components/CommitGrid.vue:954`, `:959`, `:961-962` (`contextmenu` on `host`, `document`
  `focusin`, `ResizeObserver`); `components/ConnectionBanner.vue:36-63` (`setTimeout` grace timer).
  CLAUDE.md: event-listener wiring, resize observers and timers come from VueUse.
- Scenario: no runtime defect found (each has matching teardown today). The cost is the one this
  rule exists for: every new listener repeats the manual add/remove pairing, and a missed
  `removeEventListener` leaks a handler per mount in Space's long-lived document.
- Fix: `useEventListener(document, 'keydown', …)`, `useEventListener(host, 'contextmenu', …)`,
  `useEventListener(document, 'focusin', …)`, `useResizeObserver(rootEl/host, …)`,
  `useTimeoutFn` for the grace timer. SlickGrid's own `grid.onKeyDown`/`onClick` subscriptions
  stay (library event API, not DOM wiring). One-shot `requestAnimationFrame` perf marks may stay.

## Candidate fates (§9)

- 1 (lanes blank after layout lands): dropped. Probe passed for expand, toggle and refresh;
  every `plan` path ends in a listener call (§1.1 item 3).
- 2 (`announce` TDZ): dropped. The three watches at `App.vue:528-542` are default `pre` flush and
  not `immediate`; no setup-time code calls `announce` or `reportAsyncError` synchronously, and
  `liveAnnouncement` is never written directly outside `announce`.
- 3: reported as F1.
- 4: reported as F3 (with F4 for the visibility half).
- 5 (`mount()` leaks into the Space document): dropped. Space's `packages/theme/src/base.css:33-39`
  already sets `html, body { height: 100%; margin: 0; overflow: hidden }`, so the four `kv:`
  classes are no-ops there; the hoisted `:root` rules define only `--kv-*` names, which Space does
  not use; own Tailwind layers are `kv`-prefixed.
- 6 (`SEARCH_LISTBOX_ID` duplicated): dropped. KeepAlive is gone (known open item), Space renders
  one tab view at a time (`TAB_VIEWS`, no split groups), the review sidebar mounts `ReviewView`
  (no `SearchBox`) and the ADE window is its own document. At most one `SearchBox` per document
  today.
- 7 (second persistence watcher on retry): dropped as stated. The watcher registers only after
  every `await` succeeded, and a successful run hides Retry, so it registers at most once. The
  related defects (never registered after a partial failure, not stopped on unmount) are F6.
- 8 (`RowContextMenu` focus return to a rebuilt row): reported as F15. reka's `FocusScope`
  moves focus only after `nextTick`, so `onMounted` captures the real invoker; the defect is the
  invoker being replaced while the menu is open.
- 9 (`lib/menuModel.ts` dead): partly. `flattenItems` is test-only; `enabledNeighbour` and
  `firstEnabled` are live in `BranchPicker.vue`. Reported as F19.
- 10 (two polite regions double-read): dropped. The toolbar's region is the `v-if`'d
  "Restacking…" chip (`AppToolbar.vue:313-322`), which never carries the same text as `App.vue`'s
  region (that one announces the restack result afterwards).
- 11 (`TokenReader.watch()` layout thrash): dropped. The observer watches only `class`/`style`
  on `html` and `body` (not the subtree), and each callback does one `getComputedStyle` plus
  three probe reads; probes are `body` children, so reading them cannot re-trigger it. The
  realistic trigger rate in Space (reka scroll-lock on dialog open/close) is a handful per user
  action.
- 12 (row heights after PR data arrives): dropped. `scheduleAncestryRebuild`
  (`CommitGrid.vue:623-641`) calls `invalidateRowHeights()` after `pr.generation` and row-count
  changes; stack decoration never changes row height. (The cost of that rebuild is F9.)
- 13 (`linkify.ts`): dropped. Only `https?://` matches, segments become a `<button>` calling the
  host's `onOpenExternal` or inert text, never an `<a href>`; it runs in Vue-rendered
  `CommitMeta`, not a SlickGrid formatter, so listeners die with their nodes.
- 14 (`ReviewCommentsPane` listbox children): reported as F28.
- 15 (undeclared runtime dependencies): dropped. `clsx`, `tailwind-merge`,
  `class-variance-authority`, `@lucide/vue` and `reka-ui` are pinned in the root `package.json`
  (`:108-134`), the repo's home for shared UI libraries (`packages/theme` declares none of them
  either); resolution is deterministic, not a hoisting accident.
- 16 (`crypto.subtle` outside a secure context): dropped. Every real origin is a secure context:
  `vscode-webview://` (VS Code), Wails' localhost origin (Space), `http://127.0.0.1` (Playwright
  harnesses) and `http://localhost` (Vite dev) are all potentially trustworthy.
- 17 (unprefixed classes missing from one host root): dropped, verified. Every static unprefixed
  class in own `.vue`/`.ts` files, plus the dynamic ones (`ml-auto`, `animate-spin`, the
  `badgeClass.ts` arbitrary-value tokens), has a matching selector in both the built VS Code
  webview CSS and Space's `build:test` CSS (scratch script over `dist/**/assets/*.css`).
- 18 (comment over 100 columns, `searchResultsModel.ts:52-53`): held for grouping with a comment
  finding.

Block 1 other checks: `f1ce795` notice renders as plain text inside the results popover (not the
`role="alert"` error div, which only shows `search.error`); `unsupportedPattern` takes precedence
over `tailError`; no defect. `e3145b1`: a queued second click on an unreviewed box computes the
same `reviewed: true` from server state and is dropped as an identical repeat, so the box ends
checked, which matches what the user saw (box still unchecked) when clicking again; no defect.
`7d42bde`: `collapsedMessageText` falls back to branch-less wording when `labelFor` returns
`undefined` for the `other` group; no defect. `ebe3c02`: construction order holds (`searchState`
after `createRepoStates`), `RepoSettingsDialog` gets the same `repoSettingsState` `opsState`
holds; dispose checked in block 2.

## Coverage

- Block 1: done (four own-file commits, §6.1 consumers, §1.1 items 1-4).
- Block 2: done. Reviewed `App.vue` (setup, state wiring, `applyRepoIdToStates` incl. menu/dialog
  ref closing, `handleReconnect`, `runUiAction`, `bootstrap`, breakpoints, document keydown
  guard, `onClickOutside`, unmount teardown, template content-state chain), `main.ts`,
  `MountRoot.vue`, `NoRepositoryPanel`, `EmptyRepositoryPanel`, `GitBlockedPanel`,
  `gitBlockedCopy.ts`, `ConnectionBanner` (grace timer cleared on unmount), `ConflictBanner`
  (busy flags in `try/finally` still correct after `4b4b5a0`), `UndoButton`, `RefreshButton`.
  Content states are mutually exclusive through the `v-if` chain. `onBeforeUnmount` does not call
  `detailState.dispose()`; `bridge.dispose()` rejects its pending request with
  `transport-closed` anyway, so no finding.
- Block 3: done. Reviewed `CommitGrid.vue` (script in full; template; `<style>` selectors: every
  rule targets SlickGrid-built DOM or formatter output, plus the `.kv-badge*` kind colours that
  `badgeClass.ts` documents as staying there), `columns.ts`, `gridKeyboard.ts`,
  `rowAccessibility.ts`, `refBadges.ts` (DOM construction), `linkify.ts`, `searchHighlight.ts`
  (zero-width matches skipped, `matchAll` advances), `dateFormat.ts`, `LoadMoreButton`,
  `ShowMoreButton`, `theme/readTokens.ts`. Skimmed `countFormat.ts`, `badgeClass.ts` (trivial).
  Lifecycle: `onBeforeUnmount` disconnects the observer, cancels both rAFs, unsubscribes layout and
  tokens, removes probes and listeners, destroys the grid; no callback outlives it.
- Block 4: done. Reviewed `AppToolbar` (script, template: Fetch/Push/Stash buttons carry visible
  text, so they have names), `BranchPicker` (keyboard, open/close and focus handling, branch and
  remote rows), `RowContextMenu`, `MenuSections`, `useRowMenu.ts`, `lib/menuModel.ts`,
  `SearchBox`, `SearchResults`, `searchResultsModel.ts`, `searchListboxId.ts`,
  `PullStrategyPicker`, `RowActionsButton`. Skimmed with reason (logic covered by their unit
  specs, rows follow the `BranchPicker` pattern already reviewed): `pickerModel.ts`, `TagList`,
  `StackList`, `stackListModel.ts`, `StashList`, `StashRows`, `GlobalStashList`,
  `stashListModel.ts`, `WorktreeList`, `refListModel.ts`, `RefSectionHeader`,
  `pullStrategyModel.ts`, `rowMenuModel.ts` (gating table, tested). Stash ops pass the rendered
  `StashEntry` (server re-verifies `stash@{N}`). `MenuSections` ids: one menu renders at a time
  per section list, so `${item.id}-reason` does not collide.
- Block 5: done. Reviewed `FileTree.vue` (script and both templates), `CommitMeta.vue` (actions,
  PR row and link handling announce on failure; no `<style>` remains), `DetailPane`,
  `StashDetailPane`, `WorkingDetailPane`, `UncommittedChangesStrip`,
  `openAllChangesAnnounced.ts`. Skimmed with reason: `fileTreeModel.ts` (`capRows`, tested),
  `icons/setiFileIcon.ts` (tested; mask URLs, no `v-html`), `icons/index.ts` (constants),
  `icons/codicon.css` (font import). `FILE_TREE_ROW_CAP` plus "Show all" bounds a 50k-file
  commit; the cap announcement fires once per boundary crossing.
- Block 6: done. Reviewed `ForcePushDialog`, `RepoSettingsDialog`, `TagDialog`,
  `tagDialogModel.ts` (annotated-preserve rule correct; message newlines pass through), `ResetDialog`
  (template head), the submit/close paths of all 16 dialogs (grep plus read), `PendingSlot` use:
  every op that sets `busy` does so before `ask()` (checkout, reset, revert, cherry-pick, stash
  pop), so a second invocation returns early; `#runForcePush` does not set `busy` during the
  dialog, but a second `ask()` there only orphans the first Promise (no state latched). Skimmed with
  reason (same `v-if`/`:open` shell and preflight rendering as the read ones, no new logic):
  `CheckoutDialog`, `RevertDialog`, `CherryPickDialog`, `PullDialog`, `PostCheckoutPullDialog`,
  `BranchDialog`, `RenameRefDialog`, `StackDialog`, `WorktreeDialog` (beyond the result check and
  digest), `StashDialog` preview tokens, `PreflightPrediction`.
- Block 7: done. Reviewed `ReviewView.vue` (setup, `applyTarget` token checks on every
  post-await write in `handleReconnect`/`resumeSession`, bootstrap retry disposal, actions bundle,
  document Escape handler with the instance-root guard, live region, content-state template),
  `BaseSelector`, `ReviewFilesPane` (filter toggle, `nothingToReview`, `onToggleReviewed`),
  `ReviewCommentsPane`. Skimmed with reason: `ReviewCommitRow.vue` (treeitem row with roving
  tabindex; `revealInGraph` and `transport-closed` handling read, nothing new), the review row
  keyboard cursor and `REVIEW_ROW_RENDER_CAP` (guarded by `review-commit-list-cap.spec.ts`, which
  passed).
- Block 8: done. Reviewed `theme/vscode-tokens.css` (dark, light and high-contrast blocks),
  `theme/density.css`, `theme/kira-structure.css` (colourless), `theme/tailwind.css`,
  `lib/cn.ts` (prefix-only merge; unprefixed tokens pass through untouched), `lib/rowVariants.ts`,
  `vite.config.ts`, `package.json`, `tsconfig.json`, `testing/fakeTransport.ts` (used by 9 state
  specs); host roots `VS/webview/tailwind.css` and `PF/styles.css` (read). All 53 `.vue` files
  use `<script setup lang="ts">` only. `bun run lint` (biome, token, theme-class, ADE colour and
  class-conflict checks) and `bun run typecheck:git` ran green in the pre-commit hook on every
  findings commit. Own unit specs: 114 pass, 0 fail. Tests against the bar: the 10 specs drive
  current code; `menuModel.test` partly guards dead `flattenItems` (F19); `countFormat.test`,
  `dateFormat.test`, `refBadges.test` read as restated bodies but the bar is forward-only and no
  fix here touches them.

## Totals

29 findings: high 0, medium 13 (F1, F2, F3, F4, F5, F6, F8, F9, F10, F12, F14, F20, F21), low 16
(F7, F11, F13, F15, F16, F17, F18, F19, F22, F23, F24, F25, F26, F27, F28, F29). DESIGN-DECISION:
F4. `needs-other-part-file`: F1 (`GU/state/review.ts`, Part 18), F8 and F20 (VS Code
interaction specs, Part 23); all Stream B, so nothing routes to `P168-routed-from-streamB.md`.

Coverage: every one of the 101 owned files was reviewed or skimmed with a stated reason in the
block notes above; none was left unread.
