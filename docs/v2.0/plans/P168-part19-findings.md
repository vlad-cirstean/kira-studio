# P168 Part 19 findings: `git-ui` components

Plan: `P168-part19-git-ui-components.md`. Base `1e2b327`; plan commit `d9d3b35`; HEAD reviewed
`d9d3b35` (branch `p168-stream-b`). Reviewer reports only; fixes nothing.

Status: blocks 1-4 done.

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

### F3. `StashDialog` branch and save modes close after a failed op and lose the input

- Severity: low. Code-read.
- Where: `packages/git-ui/src/components/dialogs/StashDialog.vue:175-181` (`submitBranch`),
  `:220-225` (`submitSave`). Contrast `WorktreeDialog.vue:157-163`, which stays open on
  `!result.ok`.
- Scenario: Space graph tab. "Create branch from stash", type a name another surface created a
  moment ago (preflight raced), submit. `runStashBranch` resolves `{ ok: false }` (since Part 18
  `4b4b5a0` it also resolves on busy/no repo/transport rejection). The dialog emits
  `close-branch` anyway; the typed name is gone and a sighted user sees no failure (F4).
- Fix: `const result = await props.ops.runStashBranch(...); if (!result.ok) return;` before the
  emit, same for `runGlobalStashSave`, matching `WorktreeDialog`.

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
  kiraSpace.git.path", a VS Code setting id); `App.vue:1736`, `:1753` ("Kira Space isn't
  reachable — …" for any bootstrap failure).
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
- Fix: delete `flattenItems` and its test cases, reword the module doc to "roving-focus helpers
  for `BranchPicker.vue`'s row list", rewrap `searchResultsModel.ts:52-55`.

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
- Blocks 5-8: not reached yet.
