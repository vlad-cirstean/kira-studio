# P168 Part 19: review plan, `git-ui` components

Chunk B6, Stream B position 6 of 10 (pre-plan `P168-prep-plan.md` §5.18). One Opus reviewer runs
this plan and reports findings. It fixes nothing. One Sonnet fixer follows (§10).
Tree surveyed: `1e2b327` (`p168-stream-b`, on `v2.0` with Part 18 fixes landed and its findings
file dropped).

Paths repo-relative. `GU` = `packages/git-ui/src`, `GC` = `packages/git-core/src`, `IPC` =
`packages/git-ipc/src`, `PF` = `apps/kira-space/frontend/src`, `VS` = `apps/kira-space-vscode/src`,
`PT` = `packages/theme/src` (`@theme`), `KU` = `packages/kira-ui/src`. Line numbers are as of
`1e2b327`; re-read before citing.

SPEC row and orchestrator agree on this file name (`P168-part19-git-ui-components.md`).

## 0. Gates waived, and the routing tag

User decision for this stream: gates G0 and G1 (pre-plan §3.2) stay **waived**; G2 (Part 9, shared
frontend base) stays waived for Stream B as in Parts 17-18. Part 9 is not yet reviewed (no plan
file). SPEC dependency "Logic (Part 18) settled" holds: Part 18's fixes (`ebe3c02..e67e75f`) and
findings-file drop (`1e2b327`) are on this branch.

- **Unlike Part 18, this chunk's production code leans on Part 9.** 138 imports of
  `@theme/components/**` (shadcn-vue on reka-ui: button 32, dialog 15, tooltip 13, label 11, input
  11, `TooltipIconButton.vue` 11, checkbox 9, radio-group 5, input-group 5, `AttributeTooltip.vue`
  5, toggle-group 4, popover 4, native-select 4, dropdown-menu 4, textarea 2, badge 2), plus
  `@theme/CodiconIcon.vue` 5, `@theme/lib/utils` 1, `@kira/kira-ui` `KuiColumnResizeHandle` 2
  (`App.vue:19`, `CommitGrid.vue:19`). Read them as **unreviewed callees**: verify the contract this
  chunk relies on (focus trap, Escape, focus return, `aria-*` pass-through, disabled-trigger
  tooltips), do not assume it holds.
- **Any finding whose fix needs a file owned by another Part** carries
  `needs-other-part-file: <path> (Part N)`. The orchestrator routes it.
  - Stream A file (Parts 2-9, incl. `PT`, `packages/{workbench,kira-ui,shared}`) or Stream C file
    (Parts 10-13): the Stream B fixer never edits it. The orchestrator appends it to
    `docs/v2.0/plans/P168-routed-from-streamB.md` (same entry shape as its Part 17 F2 entry).
  - Stream B file (Parts 14-18 closed, 20-23 later): same stream, sequential. The fixer may edit it
    when a Part 19 fix requires it and names each such file in the commit body. The tag still
    names it. Typical: `GU/state/**`, `GU/graph/**` (Part 18), `IPC/**` (Part 17),
    `PF/repo/**`, `PF/views/repo/**` (Part 22), `PF/ade/**` (Part 21), `VS/**` and
    `apps/kira-space-vscode/tests/**` (Part 23).

Routed files: `P168-routed-from-streamA.md`, `-from-streamB.md`, `-from-streamC.md` and
`P168-routed-to-stream-a.md` hold **no item for Part 19** (checked at `1e2b327`: Stream A items
are Studio/shared, Stream B's one item is Part 17 F2 for Part 8, Stream C's are Part 10 Go items,
`-to-stream-a` is Part 14 F4).

## 1. Method for the reviewer

- **`codegraph_explore` first, mandatory.** Call `mcp__codegraph__codegraph_explore` with
  `projectPath=/home/user/kira-studio-streamB` before any Read/Grep on a symbol, call-path or
  blast-radius question. If the tool is not listed, load it with `ToolSearch "codegraph"`. The
  orchestrator greps the run's tool log for real calls. Index present at planning
  (`.codegraph/codegraph.db`; results matched disk for every Part 18 fixer change checked). If a
  result disagrees with disk, run `sh scripts/codegraph-setup.sh` in the worktree. Seeds per block
  (§10):
  1. Part 18 fixer deltas: `createRepoStates`, `createAnnouncementRef`, App.vue `announce`,
     `reportAsyncError`, `GraphViewState.layoutCurrent`, `createGraphFormatter`, `readSlice`,
     `buildSearchResultsModel` (`tailError`), `SearchState.tailError`,
     `OpsState.#announceRejection`, `#failedResult`, `ReviewFilesState.mark`/`#runMark`,
     `PackedStreamState` `onUnrecoverable`,
     `ReviewSessionState.#failStream`, `OTHER_GROUP_KEY`.
  2. Shell and bootstrap: `mount`, `MountHandle`, `MountOptions`, `MountRoot`, App.vue `bootstrap`,
     `retryBootstrap`, `onBootstrapSuccess`, `applyRepoIdToStates`, `handleRepoOpened`,
     `handleReconnect`, `runUiAction`, `collapseIfNarrowWithNoSelection`, breakpoint observer,
     `onDocumentKeydown`, `onBeforeUnmount` (`App.vue:1678`), `NoRepositoryPanel`,
     `EmptyRepositoryPanel`, `GitBlockedPanel`, `gitBlockedCopy`, `ConnectionBanner`,
     `ConflictBanner`.
  3. Commit grid: `CommitGrid` (`handleClick`, `handleKeyDown`, `handleContextMenu`,
     `handleChunkLayout`, `scheduleResize`, `scrollToRow`, `scrollToTopRow`, `focusGrid`,
     `applyInitialScroll`, `updateHandlePositions`, `minWidthFor`, `remeasureDateWidth`),
     `handleGridKeyDown`, `buildColumns`, `createCommitDataView`, `rowMetadata`,
     `messageFormatter`, `composeRowLabel`, `buildRefBadges`, `buildPrBadge`, `splitHighlights`,
     `TokenReader`, `rowHeightPx`, `compactRowHeightPx`, `measureAbsoluteDateWidth`, `linkify`.
  4. Toolbar, pickers, lists, search: `AppToolbar`, `BranchPicker`, `pickerModel`, `TagList`,
     `StackList`, `stackListModel`, `StashList`, `StashRows`, `GlobalStashList`,
     `stashListModel`, `WorktreeList`, `refListModel`, `PullStrategyPicker`, `pullStrategyModel`,
     `UndoButton`, `RefreshButton`, `LoadMoreButton`, `ShowMoreButton`, `SearchBox`,
     `SearchResults`, `buildSearchResultsModel`, `searchHighlight`, `SEARCH_LISTBOX_ID`,
     `useRowMenu`, `RowContextMenu`, `MenuSections`, `rowMenuModel` (`buildRowMenu`,
     `buildRefMenu`, `buildStashMenu`, `buildReviewRowMenu`, `buildFileRowMenu`),
     `lib/menuModel` (`flattenItems`, `enabledNeighbour`, `firstEnabled`).
  5. Detail and file tree: `DetailPane`, `CommitMeta`, `FileTree`, `fileTreeModel` (`capRows`),
     `WorkingDetailPane`, `UncommittedChangesStrip`, `StashDetailPane`,
     `openAllChangesAnnounced`, `setiIconFor`, `ACTION_ICONS`.
  6. Dialogs: every `components/dialogs/*.vue`, `PreflightPrediction`, `tagDialogModel`,
     `validateRefName` call sites, `OpsState` `resolve*Dialog`, `createPendingSlot`.
  7. Review view: `ReviewView` (`applyTarget`, `handleReconnect`, `bootstrap`, `onUiAction`,
     `onDocumentKeydown`, live region at `:753`/`:802`), `BaseSelector`, `ReviewCommitRow`,
     `ReviewFilesPane`, `ReviewCommentsPane`.
  8. Theme and build: `theme/{tailwind,vscode-tokens,density,kira-structure}.css`,
     `icons/codicon.css`, `lib/{cn,rowVariants}.ts`, `badgeClass.ts`, `vite.config.ts`,
     `package.json`, `tsconfig.json`; host roots `VS/webview/tailwind.css`, `PF/styles.css`
     (read).
- **CodeGraph over-links TS names.** `mount`, `App`, `bootstrap`, `open`, `close`, `dispose`,
  `columns.ts`, `main.ts`, `state`, `formatter` collide with Studio, Space `frontend`, the P165
  prototype (`apps/kira-studio/frontend/proto/**`, excluded) and Go. Confirm every cross-package
  claim with `git grep` of real import lines (`from '@kira/git-ui'`, `'@kira/git-ui/icons'`,
  `import('@kira/git-ui')`, relative `'../state/'`, `'@theme/...'`). §4 and §5 were verified that
  way.
- **Probes.** Logic claims: throwaway `.test.ts` under `GU/components` (bun, `@workbench/testing/
  unit/async`), deleted before the findings commit, never committed. UI claims (focus, keyboard,
  live region, layout, theming): a scratch Playwright spec in the session scratchpad run against
  the built webview (`VS` `tests/support/webviewServer.ts` harness) or Space's `build:test`
  output, never committed. Prefer a probe over prose for every focus, ordering, race or
  virtualization claim. Mark each claim "verified" or "code-read".
- **Checks** (baseline at `1e2b327`):
  - `bun test packages/git-ui/src/components packages/git-ui/src/icons packages/git-ui/src/lib`:
    114 pass, 0 fail, 10 files, 0.5 s.
  - `bun run typecheck:git` (git-ipc, git-core, vscode, git-ui, kira-ui): clean, 16 s.
  - `bunx biome check` over the 101 own paths: 100 files checked, clean.
  - Not run at planning (required for the reviewer, §1.1): `bun run test:webview`,
    `bun run test:ui:space`. Space `visual` project holds only `settings.spec.ts` (no git-ui
    surface); skip it. Never run any `test:visual:update:*` here (sandbox font drift,
    `docs/DEV_ENVIRONMENT.md`).
  - If a finding touches a caller: `bun run typecheck:space-web`, `bun test` over the touched
    `apps/kira-space/tests/unit` spec. If deps or bindings fail a check:
    `bun install --frozen-lockfile` and `bun run setup`. A red check is a finding.
  - Run Playwright through `node node_modules/.bin/playwright` (the global binary reports "No
    tests found", `docs/DEV_ENVIRONMENT.md`). Space `ui` uses WebKit: `scripts/prepare-ui-tests.sh`
    installs it if missing.

### 1.1 Required checks the Part 18 fixer left open

The Part 18 fixer ran unit tests and typecheck only. These are **required** in block 1, before any
other block, recorded in the findings file with pass/fail and the one decisive line on failure:

1. **VS Code webview suite (targeted).** `bun run build:vscode`, then
   `node node_modules/.bin/playwright test --config=apps/kira-space-vscode/playwright.config.ts`
   with at least: `webview-layout` (`tests/layout/webview-layout.spec.ts`) and, in
   `webview-interaction`, `graph-branch-order` (collapse/expand: F1 path), `graph-columns`,
   `graph-context-menu-refresh`, `graph-dialog-reconnect`, `graph-initial-scroll-row`,
   `branch-picker`, `file-tree-open`, `review-interaction` (asserts `live-announcements`),
   `review-target-race`, `review-commit-list-cap`. Run the whole config if time allows (12
   interaction specs, 1 layout spec).
2. **Space UI (targeted).** `bun run build:test:space`, then
   `node node_modules/.bin/playwright test --config=apps/kira-space/playwright.config.ts
   --project=ui repo-workspace repo-graph-lifecycle ade-v2-review`.
3. **F1 formatter change (`2362bbd`) has no browser test.** Probe: grouped mode (collapse on),
   load a history, toggle a group or trigger a refresh; assert graph cells render with no lanes
   while `layoutCurrent` is false and **repaint with lanes once the layout lands** (§6.3). A
   formatter that blanks lanes but is never re-invoked leaves the column empty.
4. **F16 live-region change (`444ba37`) has no browser test.** Probe: fire the same failing op
   twice (fake transport rejecting `remote.run`, or `Select a commit first.` twice via palette
   `revertSelected`); observe the `App.vue:1718` region's text through a `MutationObserver`.
   Assert the text goes `''` then the message each time, and that two different messages in one
   tick leave the second. Note whether the clear and set land in one task (no paint between),
   and judge against how screen readers consume `role="status"` (code-read is acceptable for the
   screen-reader half; the DOM half must be verified).

## 2. Ownership re-run (pre-plan §8) and drift

Re-ran the §8 script verbatim at `1e2b327`.

**Part 19: 101 files (unchanged), 19,897 to 19,889 code lines, tests 1,314 (unchanged).** The -8
is the four Part 18 fixer commits that edited own files (+39/-47, §7). No other commit since
`f40cd35` touches a Part 19 file (`git log f40cd35..HEAD` over the 101 paths).

Drift elsewhere (from `f40cd35`, and since Part 18's plan at `c9e3647`):
- Part 18: 126 files (count unchanged: `repoStates.ts`, `repoStates.test.ts`,
  `graphColumn.test.ts`, `graphOrder.test.ts` added; `stashRows.ts`, `nulSplit.ts`,
  `nulSplit.test.ts`, `review.test.ts` deleted), 20,843 to 20,429 (tests 6,705 to 6,498).
- Part 15: 98 to 100 files, 15,176 to 15,661 (Part 15 fixes, then Part 18 F11 `9986f9d`).
- Part 16: 19,286 (53 files). Part 17: 23,653 (85). Parts 20-23 unchanged since Part 18's plan
  (20,312 / 17,327 / 19,849 / 10,475).
- Stream A/C fixes on `v2.0` since Part 18's plan: Part 6 96 files 15,148; Part 7 91 files
  17,173; Part 8 16,364.
- Totals: streams A 258,723, B 183,156; 2,903 owned, 0 orphans, 3,545 tracked (docs 489).
- Script label: `[A]` printed for Parts `<= 13`; Parts 10-13 are Stream C (carried from Part 10).

## 3. Own file set (101 files)

89 production files (18,575 lines: 53 `.vue` 14,137, 31 `.ts` 3,837, 5 `.css` 601), 10 test files
(1,314), plus `package.json` (33) and `tsconfig.json` (24), not counted as code.

- **Shell (4, 2,277):** `App.vue` 2,061, `main.ts` 149, `MountRoot.vue` 16, `vite.config.ts` 51.
- **Graph grid (`components/`, 6, 2,549):** `CommitGrid.vue` 1,727 (incl. a global `<style>`
  block `:1313-1727`), `columns.ts` 477, `gridKeyboard.ts` 140, `rowAccessibility.ts` 46,
  `linkify.ts` 104, `dateFormat.ts` 55 (+ `countFormat.ts` 26, `badgeClass.ts` 14, listed below).
- **Toolbar, pickers, lists, search (`components/`):** `BranchPicker.vue` 867, `AppToolbar.vue`
  502, `SearchBox.vue` 338, `pickerModel.ts` 337, `refBadges.ts` 330, `WorktreeList.vue` 216,
  `StackList.vue` 198, `PullStrategyPicker.vue` 166, `SearchResults.vue` 164,
  `searchResultsModel.ts` 164, `TagList.vue` 158, `refListModel.ts` 147, `stackListModel.ts` 143,
  `StashRows.vue` 142, `StashList.vue` 131, `GlobalStashList.vue` 118, `RefreshButton.vue` 89,
  `stashListModel.ts` 88, `LoadMoreButton.vue` 87, `RowContextMenu.vue` 79, `UndoButton.vue` 66,
  `MenuSections.vue` 48, `useRowMenu.ts` 38, `searchHighlight.ts` 37, `pullStrategyModel.ts` 28,
  `countFormat.ts` 26, `ShowMoreButton.vue` 23, `RefSectionHeader.vue` 18, `badgeClass.ts` 14,
  `RowActionsButton.vue` 11, `searchListboxId.ts` 5.
- **Detail, file tree, banners and panels (`components/`):** `FileTree.vue` 827, `CommitMeta.vue`
  452, `rowMenuModel.ts` 437, `fileTreeModel.ts` 267, `ConflictBanner.vue` 187,
  `UncommittedChangesStrip.vue` 170, `NoRepositoryPanel.vue` 115, `DetailPane.vue` 98,
  `ConnectionBanner.vue` 96, `StashDetailPane.vue` 96, `WorkingDetailPane.vue` 74,
  `gitBlockedCopy.ts` 64, `GitBlockedPanel.vue` 35, `EmptyRepositoryPanel.vue` 30,
  `openAllChangesAnnounced.ts` 26.
- **Dialogs (`components/dialogs/`, 16, 2,796):** `StashDialog` 445, `WorktreeDialog` 443,
  `RepoSettingsDialog` 363, `StackDialog` 222, `ResetDialog` 204, `CherryPickDialog` 166,
  `ForcePushDialog` 159, `CheckoutDialog` 125, `RevertDialog` 124, `TagDialog` 123,
  `BranchDialog` 95, `RenameRefDialog` 84, `tagDialogModel.ts` 73, `PullDialog` 65,
  `PostCheckoutPullDialog` 58, `PreflightPrediction` 47.
- **Review (`components/review/`, 5, 2,009):** `ReviewView.vue` 1,149, `ReviewCommitRow.vue` 301,
  `ReviewFilesPane.vue` 202, `BaseSelector.vue` 185, `ReviewCommentsPane.vue` 172.
- **Icons, lib, theme, testing (13):** `icons/setiFileIcon.ts` 120, `icons/index.ts` 54,
  `icons/codicon.css` 15; `lib/menuModel.ts` 67, `lib/cn.ts` 61, `lib/rowVariants.ts` 32;
  `theme/vscode-tokens.css` 304, `theme/readTokens.ts` 201, `theme/tailwind.css` 151,
  `theme/kira-structure.css` 105, `theme/density.css` 26; `testing/fakeTransport.ts` 56.
- **Tests (10, 1,314):** `pickerModel.test` 333, `rowMenuModel.test` 305, `stackListModel.test`
  195, `stashListModel.test` 119, `fileTreeModel.test` 97, `setiFileIcon.test` 87,
  `menuModel.test` 64, `refBadges.test` 61, `countFormat.test` 36, `dateFormat.test` 17.
  **No test drives any `.vue` file in-package;** component behaviour is guarded only by the VS
  Code webview Playwright suite (Part 23 owns it) and Space `tests/ui` (Parts 21-22).

## 4. One hop: callers (git grep of import lines)

- **`@kira/git-ui` package entry and `./icons` export** (`package.json` `exports`: `.` to
  `GU/index.ts`, `./icons` to `GU/icons/setiFileIcon.ts`). Part 19 symbols reached through it:
  `mount`, `MountHandle`, `MountOptions` (`main.ts`), `ACTION_ICONS`, `IconAction`
  (`icons/index.ts`), `TokenReader` and token types (`theme/readTokens.ts`).
  - **Space `PF` (Part 22):** `repo/git/gitUiModule.ts:8,21` (`typeof import('@kira/git-ui')`,
    memoized lazy `import()`, rejection not cached), `views/repo/RepoGraphView.vue:31`
    (`MountHandle`; `mountGraph` with `TabViewStateStore`; `setVisible` on
    `onActivated`/`onDeactivated` `:102-103`; `unmount` `:94`), `repo/RepoReviewView.vue:9`
    (`MountHandle`; `mountReview` with `NullViewStateStore`; `unmount` `:57`),
    `repo/git/viewStateStore.ts:20` (types, Part 18), `repo/fileIcon.ts:10` (`setiIconFor`).
  - **Space ADE (Part 21):** `ade/v2/review/AdeReviewFiles.vue:2` (`MountHandle`; `mount` at
    `:27` with `view: 'review'`, `reviewFilter`, `onReviewMarked`; `unmount` `:48`).
  - **VS Code (Part 23):** `webview/main.ts:14-22` (`mount`, `NullViewStateStore`,
    `parsePersistedViewState`, `DEFAULT_COLUMN_WIDTHS`, `DEFAULT_DETAIL_WIDTH`, types); built by
    this chunk's `vite.config.ts` into `VS/../dist/ui` and read by `VS/html.ts`/
    `VS/webviewDocument.ts` (manifest, CSP: `script-src 'nonce-…'`, `worker-src ${cspSource}
    blob:` for `view === 'graph'` only, `:70-77`).
  - **Test callers (other Parts):** VS Code `tests/interaction/support/{commitMetaHarness.entry,
    fakeGraphHost,fakeReviewHost}.ts` and the 12 interaction + 1 layout specs; Space
    `tests/ui/{repo-workspace,repo-graph-lifecycle,ade-v2-review}.spec.ts`,
    `tests/perf/graph-scroll.spec.ts`. A changed `MountOptions` field or `data-testid` breaks
    these.
- **Inverted import, Part 18 to Part 19:** `GU/state/liveAnnouncements.ts` and `GU/state/ops.ts`
  import `stashLabel`/`originLabel` from `components/stashListModel.ts`. A change to that model's
  exports reaches Part 18.
- **Drift from pre-plan §5.18:** callers add ADE `AdeReviewFiles.vue` (Part 21), `fileIcon.ts`
  (`./icons`), `viewStateStore.ts`, and both apps' Playwright support. `GU/index.ts` is Part 18,
  so every external caller reaches this chunk through a Part 18 file.

## 5. One hop: callees

- **Part 18 (closed), relative imports from own files:** `state/ops` 24, `state/detailActions`
  12, `state/{stash,detail}` 7 each, `state/{viewState,refs,graphView}` 6 each,
  `state/{worktrees,search,pr}` 5 each, `state/{stack,repo}` 4 each, `state/review` 3,
  `bridge/client` 3, `state/{working,settings,selection,reviewFiles,reviewComments,
  liveAnnouncements,graphOrder,bootstrap}` 2 each, `graph/{rowSvg,palette,geometry}` 2 each,
  `state/{repoStates,repoSettings,clipboardActions}`, `graph/{hitTest,graphColumn}`,
  `graphVisibility.ts` 1 each. `App.vue:132-170` constructs the graph mount's state set (via
  `createRepoStates` since `ebe3c02`); `ReviewView.vue:76-87,181-187` the review set.
- **Part 17 (closed): `@kira/git-ipc`** 50 imports (contract types; `TransportError` in
  `App.vue:18`, `ReviewView.vue:32`, `NoRepositoryPanel.vue:12`, `ReviewCommitRow.vue:18`).
  **`@kira/git-core`** 26 imports (`SETTINGS`, `validateRefName`, model types, `CommitStore`,
  `RowPlan`, date helpers).
- **Part 9 (unreviewed, waived):** `@theme/components/**` 138, `@theme/CodiconIcon.vue` 5,
  `@theme/lib/utils` 1, `@kira/kira-ui` 2 (§0); `@workbench/testing/unit/async` (tests).
- **External:** `vue` 3.5.42, `slickgrid` 5.20.0 (`SlickGrid` runtime in `CommitGrid.vue`, types
  in `columns.ts`), `@vueuse/core` 15.0.0 (3: `onClickOutside` `App.vue:22`, `useEventListener`
  `BranchPicker.vue:27`, `ReviewCommitRow.vue:20`), `seti-icons`, `@vscode/codicons`, `clsx`,
  `tailwind-merge`, `class-variance-authority` (`lib/`), `@lucide/vue` (`FileTree.vue:23`).
  **Not declared in `GU/../package.json`:** `clsx`, `tailwind-merge`, `class-variance-authority`,
  `@lucide/vue`, `reka-ui` (via `@theme`); they resolve through workspace hoisting. Judge.
- **Not used:** Pinia, TanStack Query (see §6.10).

## 6. Edge cases and failure modes to weight

Freeform: any kind of issue or bug counts. Weight edge cases. This chunk is every pixel and
keystroke of the git panel in three hosts: Space graph tab and review sidebar, the ADE review
window (same `mount`, `view: 'review'`), and the VS Code webview. Items marked "suspect" were seen
during planning but not verified; confirm or drop each, never report unverified.

### 6.1 Part 18 fixer commits in own files: unreviewed new code, verify first

Four commits since `f40cd35` edited Part 19 files. No reviewer has read them.

- **`ebe3c02` (F13, `App.vue` +7/-24):** six constructions replaced by
  `createRepoStates(bridge)` (`App.vue:149`). Check construction order still satisfies every
  later consumer in `App.vue` (`searchState` takes `refsState`/`prState`, `:165`); `dispose()` of
  each returned state at `App.vue:1678`; `repoSettingsState.setRepoId` timing vs the first
  checkout (autoStash read before the snapshot lands falls back to what?). `RepoSettingsDialog.vue`
  still writes the same instance `OpsState` reads.
- **`2362bbd` (F1, `CommitGrid.vue` +1):** `() => props.graphView.layoutCurrent` passed to
  `createGraphFormatter` (`CommitGrid.vue:186-194`). `layoutCurrent` is a plain getter
  (`graphView.ts:449-451`), not reactive. **Suspect:** nothing invalidates rows when it flips
  back to true; the repaint relies on `onChunkLayout` listeners (`CommitGrid.vue:964`,
  `handleChunkLayout`) and `rebuildOrder`'s listener call (`graphView.ts:526-530`). Check every
  path that sets `plan` (`#rebuildLayout`, `#resetLayout`, repo switch, refresh restart-at-zero,
  collapse toggle, `setCollapseEnabled`) ends with a listener call covering every visible row.
  Also: hit-testing (`laneAt`, `handleLeftGraph`) and keyboard while lanes are blank.
- **`444ba37` (F16, `App.vue` +20/-20):** `announce()` (`App.vue:1036-1041`) clears then sets on
  `nextTick`; three `watch(..., announce, { deep: true })` on `createAnnouncementRef` refs
  (`:528-542`). Check: `announce` is hoisted but closes over `const liveAnnouncement`
  (`:1033`), so a call before `:1033` runs (a synchronous announcement during setup) throws a TDZ
  `ReferenceError`; two announcements in one tick (only the last survives, by design?); a pending
  `nextTick` after unmount; an empty-string announcement from a state class. **Seen:**
  `ReviewView.vue:753-760` keeps its own `liveAnnouncement` with plain assignment (`:127`), so the
  review view, ADE review window and VS Code review sidebar still drop a repeated identical
  message; `ReviewSessionState.announcement` is not a `createAnnouncementRef`. Confirm, judge
  whether F16's fix was meant to cover it.
- **`f1ce795` (F10, `SearchBox.vue` +1, `searchResultsModel.ts` +10/-3):** `tailError` threads
  into `buildSearchResultsModel` (`:147-155`); notice text `Search of unloaded history failed —
  <message>` carries a raw server/transport message into UI and the `role="alert"`
  (`SearchBox.vue:318`); precedence when both `unsupportedPattern` and `tailError` apply; the
  doc comment at `searchResultsModel.ts:52-55` now runs past 100 columns (style only).

Part 18-owned changes this chunk consumes (Part 18 reviewed the logic, not the UI use):
- **`4b4b5a0` (F14/F15):** every `OpsState` op now announces a rejection and resolves;
  `runStashPush` returns a failed `OpResult` on no repo/busy; `runRestack` returns `undefined`
  on busy. Check Part 19 callers: `try/finally` busy flags in `ConflictBanner.vue:40-80` (still
  correct), dialogs that close on any resolve (`StashDialog.vue:176-181,220-225` close after a
  failed `runStashBranch`/`runGlobalStashSave`; `WorktreeDialog.vue:157-163` stays open on
  `!result.ok`), any caller that relied on a throw to keep a dialog open or show an inline error;
  `void opsState.*` in `App.vue:1113-1200`. Failure text now appends `remoteMessage` (hook output,
  multi-line?) into the live region and any visible toast.
- **`e3145b1` (F9):** `ReviewFilesState.mark` queues; `FileTree.vue:615-622,743-750` checkboxes
  stay enabled. Check checkbox state while a queued mark is pending (`reviewCheckboxState` reads
  server state only, so a ticked box snaps back until its turn), and `ReviewFilesPane.vue:117-121`
  `onToggleReviewed` computing `!isReviewed` from stale state when two clicks queue on one path.
- **`f5ec5ac` (F8):** `onUnrecoverable` puts `GraphViewState.announcement` /
  `ReviewSessionState.#failStream` into an error state. Check `App.vue` and `ReviewView.vue` render
  a recoverable error (retry affordance) rather than an empty grid or a spinner.
- **`7d42bde` (F7), `OTHER_GROUP_KEY`:** collapse/expand state now survives restarts; check
  `CommitGrid` placeholder rows and `collapsedMessageText` labels for the `other` group.
- **`f7646de` (F4):** main-thread layout fallback; check `CommitGrid` stays responsive (a 200k-row
  layout on the main thread blocks input) and that the VS Code CSP still lets the real worker load
  (`worker-src ${cspSource} blob:`, graph view only).

### 6.2 Shell, bootstrap and content states (pre-plan watch)

- `mount()` (`main.ts:89-149`): adds `kv:h-full kv:m-0 kv:p-0 kv:overflow-hidden` to `html` and
  `body` permanently (`:133-134`). In the VS Code webview it owns the document; **in Space it is a
  guest** in the host's own document (graph tab, review sidebar, ADE window). Suspect: those
  classes and the global CSS imported at `:11-16` (`vscode-tokens.css` 304 lines, `density.css`,
  `kira-structure.css` hoisted to `:root`) leak into the Space shell after the first repo mount.
  Check against `ARCHITECTURE.md`'s `vscode-bridge.css` open item (do not re-report that tie).
- Several `mount()`s live in one Space document at once (two graph tabs, review sidebar, ADE
  window): any module-level state in own files (caches, `document` listeners, ids from
  `searchListboxId.ts` — one constant `SEARCH_LISTBOX_ID` shared by every mounted `SearchBox`:
  duplicate DOM ids with two graph tabs?), `document.addEventListener('keydown')` in both
  `App.vue:1670` and `ReviewView.vue:744` (P108 F12 instance-root guard: verify it holds for every
  handler), `focusin` in `CommitGrid.vue:959`.
- `bootstrap()` (`App.vue:1282-1436`): retry path (P108 F7) disposes `repoState`/`settingsState`;
  the persistence `watch` at `:1380-1435` is registered **inside** `bootstrap`, so a retry after
  a partial run registers a second watcher? `persisted.repoId` open failure falls through to the
  candidate loop; `openStream` rejection inside bootstrap surfaces as `bootError`.
- Content states: loading, `bootError` + retry, no repository (`NoRepositoryPanel`), empty repo
  (`EmptyRepositoryPanel`), git blocked (`GitBlockedPanel`, `gitBlockedCopy.ts`), disconnected
  (`ConnectionBanner` grace timer `:36-52`), conflict in progress (`ConflictBanner`). Each
  reachable, mutually exclusive, and announced once; transitions on reconnect and repo switch.
- `applyRepoIdToStates` (`:456-493`) closes every menu/dialog ref on a repo switch (P108 F2/F3).
  Check refs added since (`RepoSettingsDialog`, push/force-push menus in `AppToolbar`,
  `PullStrategyPicker` open state, `BranchPicker` popover, `SearchBox` open results) are covered.
- `handleReconnect` (`:506-521`) and `ReviewView.handleReconnect` (`:150-166`) against a
  reconnect during bootstrap; `onBootstrapSuccess`'s `pendingUiAction` firing once.

### 6.3 Commit grid: virtualization, canvas rendering, keyboard, a11y (pre-plan watch)

- SlickGrid lifecycle: construction in `onMounted`, teardown at `CommitGrid.vue:1159`
  (`grid.destroy`, `ResizeObserver`, `focusin` listener, `onChunkLayout` and token unsubscribes,
  `resizeRaf`/`scrollRaf` cancel). A rAF or token-change callback after destroy.
- **Resize handles (pre-plan watch):** `KuiColumnResizeHandle` outside SlickGrid's container
  (`:1263-1265` comment); `minWidthFor`, `MIN_COLUMN_WIDTH` 40, `MAX_COLUMN_WIDTH` 600,
  `MIN_MESSAGE_WIDTH` 120, graph column width persisted (`columnWidths.graph`, viewState v8);
  narrow panel where the sum of minimums exceeds width; `detailOpen` compact reflow;
  `measureAbsoluteDateWidth` returning 0 (bun) or before fonts load; persisted widths from a
  wider monitor; RTL not in scope.
- Variable row height (`rowMetadata`, `expandedRowHeight`, badges): row heights change when PR
  data arrives (`prsFor`) after rows rendered; SlickGrid needs `invalidateAllRows` plus a height
  cache reset or rows overlap. `scrollToRow`/`containingDisplayRow` under collapsed groups;
  `applyInitialScroll` clamp (`:826-829`) against a persisted `scrollRow` past the loaded count
  (Part 18 left `scrollRow` bounds here).
- Formatters build DOM with `textContent` only (`columns.ts:161-162`, `enableHtmlRendering:
  false`). Verify every formatter and `linkify.ts` (anchors from commit messages: scheme allowlist,
  `javascript:`, `data:`, very long URLs, listener per button `:101` on every re-render) and
  `refBadges.ts` (`data-ref-name` from branch names with quotes or spaces).
- Search highlight (`splitHighlights`, `searchHighlight.ts`) against regex mode with zero-width
  matches, astral characters, a pattern that throws.
- Keyboard (`gridKeyboard.ts`, `handleKeyDown` `:585+`): claim-only `stopImmediatePropagation`,
  Tab not trapped, PageUp/PageDown/Home/End over collapsed rows, Enter/Space on a placeholder,
  Shift+F10/ContextMenu, F5/Ctrl+R vs the host's own reload (VS Code webview reload, Space
  window), `/`, Ctrl+F, Ctrl+Alt+F.
- Accessibility: roving tabindex on rows, removal of SlickGrid's own `[tabindex="0"]`
  (`:889-911`) re-applied after every re-render?; `composeRowLabel` content; `role="grid"`
  children rule (axe `aria-required-children`, the comment's own reason); focus ring visible in
  high-contrast themes; selected row announced.
- Large repo: `createCommitDataView.getItem` per render, `rowMetadata` per row per render
  (`decorationAt`, `prsFor`), `tokenReader.watch()` `MutationObserver` on `body`/`html`
  attributes (fires on every class change in Space's shell, each running `#readAll` with
  `getBoundingClientRect` and `getComputedStyle`: layout thrash per host class flip?). Space
  `tests/perf/graph-scroll.spec.ts` (Part 22) measures scroll; run it only if a finding needs it.
- `<style>` block (`:1313-1727`, global, unscoped): SlickGrid's imperative DOM is the stated
  reason (§6.10). With several grids in one Space document the rules are shared; check none is
  scoped to a single instance by accident (`#id` or a mount-specific class).

### 6.4 Row menus and context menus (pre-plan watch)

- `RowContextMenu.vue`: point-anchored `DropdownMenu` (P104 §5.2 pattern), mounted with `v-if`,
  starts open; captures `document.activeElement` in `onMounted` (`:43-45`) after the menu may
  already have moved focus? `invoker?.focus()` on a node removed by a re-render (graph rows are
  rebuilt by SlickGrid): focus falls to `body`, keyboard users lose place. Opening a second menu
  while one is open; menu open across a repo switch (P108 F2) or a grid refresh
  (`graph-context-menu-refresh.spec.ts`).
- `rowMenuModel.ts` (437, tested): enabled/disabled rules per capability (`clipboard`,
  `goToFile`, `openExternal`) and host (`E_UNKNOWN_METHOD` comment at `:200`); `disabledReason`
  rendered as `sr-only` text plus `aria-describedby` (`MenuSections.vue:31,43`): duplicate ids when
  two sections carry the same item id.
- `lib/menuModel.ts` `flattenItems`/`enabledNeighbour`/`firstEnabled`: reka now owns menu keyboard
  nav (`MenuSections.vue:2-5`). Live callers are `BranchPicker.vue:200` (comment) and tests;
  **suspect partly dead**. Confirm with `git grep` per symbol.
- `useRowMenu.openFromButton` positions from `getBoundingClientRect` at click; the panel then
  scrolls or the window resizes.

### 6.5 Toolbar, pickers, lists and search

- `AppToolbar.vue`: its own `role="status" aria-live="polite"` (`:315-316`) beside `App.vue`'s
  region: two polite regions announcing overlapping events (double reads?). Fetch/pull/push
  disabled states vs `busy`; push menu and force-push entry; remote progress text.
- `BranchPicker.vue` (867) and `pickerModel.ts` (tested): roving tabindex across tabs, filter
  input, 10k-branch repos (rendered without virtualization? `capRows`-style cap?), checkout from a
  remote branch, keyboard Delete, `useEventListener` scope.
- `TagList`, `StashList`/`StashRows`/`GlobalStashList`, `StackList`, `WorktreeList`: empty states,
  long names, a stale entry clicked after a refresh (index-addressed stash ops: P15 `stash@{N}`
  re-verification is server side; check the UI passes the entry it rendered).
- `PullStrategyPicker.vue`: preview request race (`previewPullStrategy` `:100`), open/close vs
  repo switch.
- `SearchBox.vue`/`SearchResults.vue`: ARIA combobox (`aria-activedescendant` on the input,
  `role="listbox"` results, options `tabindex="-1"`), shared `SEARCH_LISTBOX_ID` across mounts
  (§6.2), Escape/Enter/ArrowUp/ArrowDown, IME composition (`isComposing`), result count text vs
  `matchCount` exactness (Part 18 F10), `role="alert"` re-firing on every keystroke while a regex
  is invalid.

### 6.6 Detail pane and file tree

- `FileTree.vue` (827): `FILE_TREE_ROW_CAP` + "show more" (`capped`, `:184-186`) on a 50k-file
  commit; tree vs flat; filter; roving tabindex (`role="tree"` `:569`, treeitem levels,
  `aria-expanded`); checkbox column (review) with reka `Checkbox` `.stop` handling; context menu
  focus return (§6.4); `goToFile` outcome handling (`:442-450`).
- `CommitMeta.vue`: `linkify` on message bodies; PR badge and `openPullRequest`/`openExternalLink`
  error announcements (`:270-290`); co-author trailers; very long subjects.
- `UncommittedChangesStrip`, `WorkingDetailPane`, `StashDetailPane`, `DetailPane` drawer below
  the `wide` breakpoint (`collapseIfNarrowWithNoSelection`).
- `openAllChangesAnnounced.ts`, `setiFileIcon.ts` (tested) for names with no extension, dotfiles,
  uppercase extensions; `./icons` export consumed by Space `fileIcon.ts`.

### 6.7 Dialogs and focus traps

- Every dialog uses `@theme/components/ui/dialog` (reka `Dialog`): focus trap, Escape, initial
  focus, focus return to the invoker (a grid row rebuilt meanwhile, §6.4), `aria-describedby`
  (`ForcePushDialog.vue:87` passes `undefined` explicitly: check reka's warning and the
  description it drops). `v-if="pending"` plus `:open="active"` pattern: a close animation never
  runs, or a stale `pending` keeps the dialog mounted.
- Confirm dialogs over `PendingSlot` (Part 18): a second `ask()` before the first resolves leaves
  the first pending forever (documented). Find every UI path that can reach `ask()` twice
  (double-click, palette plus menu, Enter key repeat on a confirm button) and whether `busy` then
  sticks.
- Typed-confirmation (`ForcePushDialog` branch name, `understandPlain`), destructive variants,
  `RepoSettingsDialog` (363: write on change vs save, validation of numeric settings, a
  `repoSettings.changed` from another surface while open), `WorktreeDialog` path validation and
  `crypto.subtle.digest` (`:213-217`, secure-context only: VS Code `vscode-webview:` and Space's
  Wails origin both secure? a plain `http://` dev server is not). **Part 17 F5 (prepare script
  approval gate) is parked: do not re-report the approval design**, only a UI defect around it.
- `StashDialog` (445, four modes in one shell): mode switching while a preview request is in
  flight (`previewToken` guards), `validateRefName` vs server verdict disagreement.
- `tagDialogModel.ts` (73, untested): annotated vs lightweight, message with newlines.

### 6.8 Review view (pre-plan watch: base selection)

- `BaseSelector.vue`: reka modal `Popover` owns focus trap and Escape (`:54-56`);
  `onOpenAutoFocus` focuses the filter; `suggested` drops the current base; picking a base while
  `resolving`; `resolution.base === null`; `refsState` empty (refs not yet loaded) in a cold ADE
  window; remote vs local branch with the same short name; `reason` labels.
- `ReviewView.vue` (1,149): `applyTarget` sequence token (P108 F6), `handleReconnect` override
  restore, `review.target` push during bootstrap, `REVIEW_ROW_RENDER_CAP` (VS Code
  `review-commit-list-cap.spec.ts`), keyboard cursor and diff overlay (`:666+`), `role="tree"`
  (`:1065`), its own live region (§6.1 F16 gap), `onUiAction` palette toggle, retry.
- `ReviewFilesPane.vue` (P166 scope, `reviewFilter` toggle `Needs review | All`): `needsReview`
  count while a mark is queued; `nothingToReview` empty state; `onReviewMarked` host hook into ADE.
- `ReviewCommitRow.vue`: `revealInGraph` outcome, `transport-closed` skip (`:164,190`), row menu.
- `ReviewCommentsPane.vue`: `role="listbox"` with `tabindex="0"` children (`:115,132`): listbox
  children must be `option`s; Remove/Clear disabled on `pending` (Part 18 F6 fixed the latch).

### 6.9 Theming, tokens and host differences

- Two Tailwind roots render one component tree: own `kv:`-prefixed root (`theme/tailwind.css`,
  `source(none)` + `@source "../"`) and the host's unprefixed shadcn root (`VS/webview/
  tailwind.css:35-36` and `PF/styles.css:7` both `@source` `packages/git-ui/src`). Own files mix
  both (`MenuSections.vue` and `RowContextMenu.vue` use unprefixed `flex`, `size-4`, `fixed`).
  Check every unprefixed class used in own files exists in both host roots' theme (a token class
  defined only in Space's `workbench.css` silently drops in VS Code), and that `lib/cn.ts`
  (`extendTailwindMerge`, `prefix: 'kv'`) never merges a shadcn `props.class` incorrectly.
  `bun run lint` runs `check-theme-classes.sh` and `check-class-conflicts.ts`: run it.
- `vscode-tokens.css` (304) maps `--vscode-*` to `--kv-*`: VS Code high-contrast themes
  (`--vscode-contrastBorder`, `contrastActiveBorder`), light themes (ARCHITECTURE: Kira Space has
  no light theme; VS Code does), a token VS Code renamed or no longer emits.
- `readTokens.ts`: probes appended to `document.body` and never removed if `dispose()` is skipped;
  font-size zoom changes; `measureAbsoluteDateWidth` vs the actual font.
- Host differences to check per component: capabilities (`clipboard`, `goToFile`,
  `openExternal`, `runPrepareScript`) gating; `host: 'vscode' | 'space'` branches; keyboard
  shortcuts colliding with VS Code keybindings vs Space workbench shortcuts; `dateFormat` mount
  option (Space only); `setVisible` (Space only; KeepAlive dead per ARCHITECTURE, do not
  re-report); VS Code webview recreated on every hide (state via `getState`), Space tab remount
  via `TabViewStateStore`.

### 6.10 Conventions (`CLAUDE.md`)

- **`<script setup lang="ts">`:** all 53 own `.vue` files carry exactly one
  (`grep '<script' | grep -v 'setup lang="ts"'` hits only a comment at `App.vue:448`). No
  `defineComponent`, no Options API.
- **`<style>` blocks:** two files: `CommitGrid.vue:1313-1727` (global, SlickGrid DOM; named
  reason in its comment) and `CommitMeta.vue` (a comment says its `<style>` was deleted: confirm
  nothing remains). Judge each rule in `CommitGrid`'s block: SlickGrid-owned DOM may decline
  Tailwind; a rule styling Vue-rendered markup does not.
- **shadcn-vue:** component primitives come from `@theme/components/ui/*` (138 imports). Look for
  hand-rolled primitives left: native `<button>`/`<input>`/`<select>` styled by hand, the
  `role="listbox"` comment pane, custom popovers. `KuiColumnResizeHandle` (`@kira/kira-ui`) is the
  only `Kui*` left: P131 Part 3 removed the rest; judge against shadcn `resizable`.
- **VueUse:** 3 uses. Raw listeners/timers in own `.vue` files: `CommitGrid.vue:668,934`
  (`requestAnimationFrame`), `:954` (`contextmenu` on SlickGrid's host), `:959`
  (`document` `focusin`), `:961` (`ResizeObserver`); `ReviewView.vue:466` (rAF), `:744`
  (`document` `keydown`); `ConnectionBanner.vue:36-52` (`setTimeout`); `App.vue:1216,1624` (rAF),
  `:1670` (`document` `keydown`), `:1673` (`ResizeObserver`); `linkify.ts:101` (per-button
  `click`, plain DOM in a formatter: no Vue scope). Judge each against `useEventListener`,
  `useResizeObserver`, `useTimeoutFn`, `useRafFn`; a SlickGrid render-path or formatter site may
  decline with a named reason.
- **Pinia / TanStack Query:** none. `GU` state is plain classes per mount (P99 scoped
  `packages/git-ui` out; Part 18 kept it). Several independent roots per page, each with its own
  transport, is the stated constraint. Report a concrete defect only; a migration is a
  `design-decision`.
- Comments: very concise rule. Many component comments cite plan ids at length; report only a
  comment that is now false (stale behaviour, removed KeepAlive design is an open item, not a
  finding).
- Dependencies (§5): undeclared `clsx`, `tailwind-merge`, `class-variance-authority`,
  `@lucide/vue`, `reka-ui` in `package.json`; license check for any new one.

### 6.11 Tests against the `CLAUDE.md` bar

- Qualifying logic (pickers, row menus, stack/stash list models, file tree model, menu
  navigation): check each spec still drives current code. `menuModel.test` (64) may guard dead
  code (§6.4).
- Candidates to judge as restated bodies: `countFormat.test` 36, `dateFormat.test` 17,
  `refBadges.test` 61. The bar is forward-only; report only if a fix touches them.
- Gaps worth a guard only where a finding's fix needs one: F1 repaint (§1.1 item 3), F16 live
  region (§1.1 item 4). A UI guard belongs in the VS Code interaction suite (Part 23 file, tag it)
  or Space `tests/ui` (Part 22), not a new in-package harness.

### 6.12 Pre-plan watch items (§5.18)

`App.vue` bootstrap and content states (§6.2), commit grid resize handles (§6.3), row menus
(§6.4), review view base selection (§6.8).

## 7. Earlier changes Part 19 must handle

- **Part 18 fixer commits that edited own files (unreviewed, §6.1 verifies them first):**
  - `ebe3c02` `App.vue` (+7/-24): `createRepoStates`, `repoSettingsState` into `OpsState`.
  - `2362bbd` `components/CommitGrid.vue` (+1): `layoutCurrent` accessor into the formatter.
  - `444ba37` `App.vue` (+20/-20): `announce()` clear-then-set; deep watches on
    `createAnnouncementRef` refs.
  - `f1ce795` `components/SearchBox.vue` (+1), `components/searchResultsModel.ts` (+10/-3):
    `tailError` notice.
- **Part 18 fixer commits in Part 18 files this chunk consumes:** `4b4b5a0` (ops rejection
  announcements, failure text with `remoteMessage`/`message`, no throws on busy/no repo),
  `e3145b1` (mark queue), `f5ec5ac` (`onUnrecoverable`, bounded re-open), `7d42bde`
  (`OTHER_GROUP_KEY`, prune by tips), `f7646de` (worker fallback), `412c64b` (long-edge index),
  `89cd44b` (deleted `git-core` exports: typecheck green, so no own importer), `3b2a878`
  (comments `pending` reset), `9986f9d` (RE2 size caps answer `unsupportedPattern`: surfaces via
  the existing `tailNotice`), `e67e75f` (comments).
- **Part 17 (`git-ipc`):** `614f647` (`toWireError` keeps string `code`; `kind` dropped),
  `c83845d` (no per-method stream supersede). Part 18 checked every own `TransportError` site
  (candidate 1 dropped: webview cancel is local). Re-check only a new site.

## 8. What earlier fixes already changed (do not re-report)

- **P166/P167 scope (`git diff 743af03 f40cd35` on own paths: 4 files, +82/-7):**
  `CommitGrid.vue` (P162 `contain: layout paint` on `.grid-canvas`, user decision),
  `ReviewFilesPane.vue` (+48, `reviewFilter` toggle), `ReviewView.vue` (+15), `main.ts` (+20,
  `reviewFilter`/`onReviewMarked`). New code is in scope; report a real failure scenario only.
  `docs/v2.0/plans/P16{6,7}-code-review.md` are gone (fixed).
- **Parts 14-18 fixes:** only the four Part 18 commits in §7 edited own files. Part 18 findings
  F1-F18 are fixed (`ebe3c02..e67e75f`): do not re-report a fixed finding; a gap the fix left in
  this chunk's code is reportable (§6.1).
- **Parked design decisions, do not re-report:** Part 17 F5 (prepare script approval gate),
  Part 17 F7 (pairing identity), Part 17 F4 remainder (`commit.detail`/`refs.list` count caps with
  `truncated`), Part 18 F12 (JS non-`u` vs RE2 case folding and astral characters).
- **Earlier fixes in code (comments name them):** P108 F2/F3 (stale menus/dialogs on repo switch,
  `applyRepoIdToStates`), F4 (candidate loop vs user pick), F5 (reconnect keeps selection), F6
  (review target sequence), F7 (bootstrap retry disposes), F10 (`reportAsyncError`), F12
  (instance-root document handlers); P79 (`setVisible`), P93 (collapse), P94 (keyboard deps),
  P104/P131 (reka menus, popovers, dialogs), P105 (`TooltipDisabledTrigger`), P110 (`cn`,
  `kv:` prefix, height chain), G12 D6/D7, G16 D1/D2, G21 D5/D6, G23 D6, G24 D9, G26, G28, G30
  round 1, G34. Verify they hold; do not re-report them as new.
- **Known open items (`docs/ARCHITECTURE.md`), do not re-report:** graph tab KeepAlive
  persistence is dead code (`setVisible`, `onActivated`/`onDeactivated`, `graphVisibility.ts`);
  `vscode-bridge.css` `:root` tie with Monaco; native graph and VS Code hold independent
  `Conn`s; native `review.session.save/load` no expiry; no standalone merge/rebase; no full-stack
  Space tier; no light theme in Kira Space.

## 9. Unverified candidates

Leads from planning, **not findings**. Each needs a real scenario, a probe or a code read before
it is reported. Drop any that does not hold; say so in the coverage notes.

1. Graph lanes stay blank after the layout lands in some `plan` change path (`layoutCurrent` is
   not reactive; repaint depends on listener coverage) (§6.1, §1.1 item 3).
2. `announce()` TDZ: a synchronous announcement before `App.vue:1033` throws (§6.1).
3. `ReviewView.vue` live region still drops a repeated identical message (F16 not applied there)
   (§6.1).
4. Dialogs that close on a failed op now that `OpsState` resolves instead of throwing
   (`StashDialog` branch/save modes) (§6.1).
5. `mount()` leaks `kv:` classes on `html`/`body` and `:root` token CSS into the Space host
   document (§6.2).
6. `SEARCH_LISTBOX_ID` duplicated across two mounted graph tabs (duplicate DOM ids break
   `aria-activedescendant`) (§6.2, §6.5).
7. `bootstrap()` registers the persistence watcher inside the function; a retry after a partial
   run adds a second watcher (§6.2).
8. `RowContextMenu` focus return to a SlickGrid row node that was rebuilt (§6.4, §6.7).
9. `lib/menuModel.ts` navigation helpers are dead since reka owns menu keyboard nav (§6.4).
10. Two polite live regions in the graph mount (`App.vue:1718`, `AppToolbar.vue:315`) double-read
    (§6.5).
11. `TokenReader.watch()` re-reads layout-forcing probes on every host `class`/`style` mutation in
    Space (§6.3).
12. Row heights change when PR data arrives after render without a height-cache reset (§6.3).
13. `linkify.ts` scheme allowlist and per-render listeners (§6.3).
14. `ReviewCommentsPane` `role="listbox"` children are not `option`s (§6.8).
15. Undeclared runtime dependencies in `GU/../package.json` (§5, §6.10).
16. `crypto.subtle` in `WorktreeDialog` fails outside a secure context (§6.7).
17. Unprefixed utility classes in own files missing from one host's Tailwind theme (§6.9).
18. `searchResultsModel.ts:52-55` doc comment over 100 columns (style; report only grouped with
    another comment finding).

## 10. Rubric, order and outputs

- **One Opus reviewer**, freeform "any kind of issue or bug", edge cases weighted. Not three
  dimension reviewers (user deviation from `CLAUDE.md`'s recipe, P168 only).
- Reports only. Fixes nothing, edits no code.
- **Whole chunk, one pass, in this block order** (unreviewed Part 18 deltas and the required
  browser checks first, since later blocks judge UI behaviour against them). About 18.6k
  production lines plus 1.3k test lines; read the VS Code and Space Playwright specs where they
  are the sole guard of a claim.
  1. **Part 18 deltas and required checks:** §1.1 items 1-4; the four own-file commits (§7) and
     their consumers (§6.1).
  2. **Shell and bootstrap:** `App.vue`, `main.ts`, `MountRoot.vue`, `NoRepositoryPanel`,
     `EmptyRepositoryPanel`, `GitBlockedPanel`, `gitBlockedCopy.ts`, `ConnectionBanner`,
     `ConflictBanner`, `UndoButton`, `RefreshButton`. §6.2.
  3. **Commit grid:** `CommitGrid.vue`, `columns.ts`, `gridKeyboard.ts`, `rowAccessibility.ts`,
     `refBadges.ts`, `linkify.ts`, `dateFormat.ts`, `countFormat.ts`, `badgeClass.ts`,
     `LoadMoreButton`, `ShowMoreButton`, `theme/readTokens.ts`. §6.3.
  4. **Toolbar, pickers, lists, search, menus:** `AppToolbar`, `BranchPicker`, `pickerModel.ts`,
     `TagList`, `StackList`, `stackListModel.ts`, `StashList`, `StashRows`, `GlobalStashList`,
     `stashListModel.ts`, `WorktreeList`, `refListModel.ts`, `RefSectionHeader`,
     `PullStrategyPicker`, `pullStrategyModel.ts`, `SearchBox`, `SearchResults`,
     `searchResultsModel.ts`, `searchHighlight.ts`, `searchListboxId.ts`, `useRowMenu.ts`,
     `RowContextMenu`, `RowActionsButton`, `MenuSections`, `rowMenuModel.ts`, `lib/menuModel.ts`.
     §6.4, §6.5.
  5. **Detail and file tree:** `DetailPane`, `CommitMeta`, `FileTree`, `fileTreeModel.ts`,
     `WorkingDetailPane`, `UncommittedChangesStrip`, `StashDetailPane`,
     `openAllChangesAnnounced.ts`, `icons/*`. §6.6.
  6. **Dialogs:** `components/dialogs/*` (16). §6.7.
  7. **Review view:** `components/review/*` (5). §6.8.
  8. **Theme, build, conventions and tests:** `theme/*.css`, `lib/{cn,rowVariants}.ts`,
     `vite.config.ts`, `package.json`, `tsconfig.json`, `testing/fakeTransport.ts`; host Tailwind
     roots (read); `bun run lint`; 10 specs against the bar. §6.9, §6.10, §6.11.
- **Resumable:** write `docs/v2.0/plans/P168-part19-findings.md` as blocks finish, and commit it
  after **every** block (`docs(v2.0): P168 Part 19 findings, block <n>`; normal commit, hooks
  green, explicit `git add <path>`). An interrupted run reads the file, resumes at the first block
  not marked done, and never re-derives a committed block. Block 1's commit records the §1.1
  results even if no finding comes of them.
- Each finding: id (`F<n>`), severity (high/medium/low), `file:line` on the current tree, a
  concrete failure scenario (inputs, sequence, observed outcome, host), a proposed fix, "verified"
  or "code-read". Tag `needs-other-part-file: <path> (Part N)` when the fix needs another Part's
  file (§0). Tag `design-decision` when it needs one; the fixer turns it into its own `SPEC.md`
  phase.
- The findings file states base commit (`1e2b327`), HEAD reviewed, checks run and results (incl.
  §1.1), findings, the fate of each §9 candidate (reported as `F<n>` or dropped with reason), then
  coverage per block: reviewed, skimmed (with reason), not reached. No unexplained gap. A chunk
  with nothing real says so; never manufacture a finding.
- Final commit `docs(v2.0): P168 Part 19 findings`, before any fixer starts.
- Then one Sonnet fixer: one commit per group of related findings, naming `P168 Part 19`, under
  §0's routing (Stream B files editable when required, each named in the commit body; Stream A/C
  files never, routed by the orchestrator to `P168-routed-from-streamB.md`). A fix re-runs
  `bun test packages/git-ui/src`, `bun run typecheck:git`, `bun run lint`; plus
  `typecheck:space-web` when a Space caller changed; plus the targeted `test:webview` and Space
  `ui` specs from §1.1 that cover the touched component (a UI fix is not done on unit tests
  alone). It deletes the findings file when done. Chunk lands per pre-plan §3.4 before Part 20's
  plan starts.

## 11. Out of scope

- `GU/state/**`, `GU/graph/**`, `GU/bridge/**`, `GU/{index.ts,graphVisibility.ts,shims-vue.d.ts}`
  and `packages/git-core/**` (Part 18, closed): read where a component consumes them; a defect
  there is tagged.
- `git-ipc` internals (Part 17, closed): report only a Part 19-visible break, tagged.
- Part 9 internals (`PT`, `KU`, `packages/workbench`): contract only; a defect there is tagged
  (Stream A, routed).
- Space hosts (`PF/repo/**`, `PF/views/repo/**`, Part 22), ADE (`PF/ade/**`, Part 21), VS Code
  extension and its tests (Part 23): contract and test harness only.
- Parked decisions and known open items (§8).
- Generated code, docs, excluded files (pre-plan §6).
