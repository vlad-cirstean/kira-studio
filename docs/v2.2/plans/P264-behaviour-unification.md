# P264 plan: behaviour unification and modularisation

Ask (SPEC row P264, requirements line): the same behaviour is implemented ad hoc in many places.
Inventory it across both apps, mobile and every package, extract one shared composable or primitive
per behaviour into the shared packages, migrate callers, add guards. 3 parallel streams (A, B, C),
zero-overlap ownership, chunks of <=25 files, 3 worktrees off one base, disk staged. Seed list is a
start; this plan hunts for more (§1.24-§1.33). P132 reka nested-splitter hang: decide root-cause or
one implementation (§2.8). Every decision below is final; no sign-off list.

Base: `v2.0` at `3715267eb` (P263 close-out). Builds on P262/P263 looks (`check-ui-primitives.sh`
U1-U38, `ARCHITECTURE.md` "One UI language", "Element families"). P263 §5.4 parked every behaviour
here. Copy, wording and i18n stay P265's: this plan changes no user-visible string except where a
decision unifies a formatter's output (§2.18) or a confirm's button tone/focus (§2.3).

Steps, strictly in order:

1. **Foundation** (one sequential Sonnet implementer, `v2.0` main checkout): shared composables and
   primitives, repo-wide mechanical edits, resize end to end (P132 decision), guards U39-U63 with
   per-stream allowlists, unit tests, reference migrations (§3).
2. **Streams A, B, C** (three Sonnet implementers, three worktrees off the foundation tip,
   concurrent): per-site migration, chunk after chunk (§4).
3. **Close-out** (one sequential Sonnet implementer after all three land): findings, legacy
   deletion, guard fold-in, docs, flaky tests, result (§5.5).

Method: 20 `codegraph_explore` calls on the behaviour owners and their callers (`copyText`,
`useClipboard`, list/tree `onKeydown`/`onTreeKeydown`/`onRowKeydown`, `useContextMenuStore`,
`RowContextMenu`/`MenuSections`/`useRowMenu`/`menuModel`, `useConfirmDialogStore`,
`AdeConfirmDialog`, mobile `ConfirmDialog`, `createPendingSlot`, `usePendingDecision`,
`InlineRenameInput`, `useCommitField`, `useEditBuffer`, `createLayoutStore`, `ViewStateStore`,
`useStorage`, `toCodedError`, `ListState`/`InlineState`/`UnavailableState`, `WorkbenchShell`,
`DockResizeHandle`, `ResizableHandle`, `KuiColumnResizeHandle`, `AdePanelResizeHandle`,
`SHORTCUTS`/`shortcutFor`/`registerCommand`, `useVirtualRows`, `computeFloatPosition`,
`createLatestRequest`, `useLiveRegion`, `useTextPrompt`, ADE `onMutate` sites), then `grep -P`
counts over `apps/kira-studio/frontend/src` (S), `apps/kira-space/frontend/src` (K),
`apps/kira-space/frontend/mobile` (M), `packages/workbench/src` (W), `packages/git-ui/src` (G),
`packages/docker-ui/src` (D), `packages/kira-ui/src` (U), `packages/theme/src` (T),
`packages/shared` (X). Counts are hits/files, specs and tests excluded.

## 1. Inventory

### 1.1 List and tree keyboard navigation

- **11 hand-rolled navigators**, 5 semantics:
  - WAI-ARIA tree, full: `S/project/ProjectTree.vue:163` (`onArrowNavigation`: Up/Down/Home/End,
    Right expands or enters first child, Left collapses or goes to parent, virtual-aware
    `selectAndFocus`).
  - Tree, partial: `S/api/CollectionsTree.vue:120` (Left/Right only expand/collapse, never move to
    parent/child), `G/components/FileTree.vue:312` (same, plus ContextMenu/Shift+F10 menu),
    `G/components/review/ReviewView.vue:686` + `ReviewCommitRow.vue:83` (rows vs expand split
    across two files).
  - Roving list: `W/components/OpLogPanel.vue:123` (Up/Down only, no Home/End), `G/BranchPicker.vue`
    (`enabledNeighbour`/`firstEnabled` in `G/lib/menuModel.ts`, wraps, skips disabled, Up from
    first row returns to filter), git `StackList`/`StashRows`/`TagList`/`WorktreeList` roving
    tabindex.
  - Combobox: `G/components/SearchBox.vue:190`, `W/components/AutocompleteField.vue` (wrap, IME
    guard only in SearchBox).
  - Grid engines (out of family): SlickGrid (`S/views/grid/SlickGridHost.vue:1893`,
    `ConsoleSlickGrid`), git `G/components/gridKeyboard.ts` + `CommitGrid`, `S/views/shared/
    DateTimePicker.vue` calendar.
- **Listboxes/trees with no arrow keys** (role set, only Enter/Space or nothing): `role="listbox|
  tree"` 26 tags in 20 files, 14 with no navigation: S `BrowseView`, `CallHistoryList`,
  `ResponseHistoryList`, `KeyValuePane`, `DocumentView`/`DocumentRow`, `ConsoleResultGrid`,
  `StreamView`, `SavedListMenu`; K `RepoFileTree`/`RepoTreeRow` (roving tabindex, Enter/Space only),
  `RepoSearchView`/`RepoSearchRow`, `GitPanel`, `ReposDialog`; D `VirtualList` (+ 4 list rows with
  `@keydown.enter` only), `ContainerTable`. Memory list (`W/memory/MemoryPanel.vue:102`) is plain
  `<button>`s, no listbox.
- Row activation by hand (`onRowKeydown`, `@keydown.enter/space(.self)`): 42 files. Roving tabindex
  ternaries 11 files.
- Type-ahead: only the panel "type to search" redirect (`W/util/panelSearch.ts`
  `usePanelHeaderSearch`, 5 panels: ProjectPanel, CollectionsPanel, GitPanel, AutomationsPanel,
  DockerPanel). MemoryPanel has a search field but no redirect. No first-letter type-ahead in any
  list.

### 1.2 Context menus

- Two renderers on reka `DropdownMenu` with a 0x0 point trigger: workbench singleton
  `W/components/ContextMenu.vue` + store `W/state/contextMenu.ts` (`openContextMenu` 26 callers in
  17 files, `MenuItem` model with `shortcut`/`hint`/`checked`/submenus) and git-ui
  `G/components/RowContextMenu.vue` (`v-if` per consumer, `MenuSection` model from
  `G/lib/menuModel.ts`, 12 mounts in 7 files, `useRowMenu` 2 callers) rendering
  `G/components/MenuSections.vue` (also used by `AppToolbar` push menu, `PullStrategyPicker`).
- Divergences: focus return on close only in git (`onCloseAutoFocus` restores the invoker; the
  workbench menu returns focus to nothing); `prioritize-position` flip only in git; keyboard open
  (ContextMenu key, Shift+F10) only in `FileTree`, `gridKeyboard`, `AdeTaskCard`
  (`@keydown.shift.f10`/`.context-menu`); right-click selects the row only in git review
  (`focus-row`) — Studio trees, Space repo tree, OpLog, Automations open the menu without selecting.
- `@contextmenu` sites: 34 in 29 files. Long-press: 0 (mobile has no context menus).

### 1.3 Confirm-before-act flows

- Imperative store: `W/state/confirmDialog.ts` + `W/components/ConfirmDialog.vue` (title "Confirm",
  Cancel + `dialog-danger`/`dialog-primary`, label default Delete/Continue). 26 `.confirmDialog(`
  calls in 22 files (S 17, K 7, W 2). Labels in use: Delete, Discard ×2, Forget, Move back, Move on,
  Regenerate, Remove ×3, Revoke, Start, Trust. 4 calls pass `danger: false`.
- Prop-driven copies: `K/ade/v2/AdeConfirmDialog.vue` (async `run`, busy, inline error, always
  `dialog-primary` even for "Force push", "Abort rebase", "Stop and take over"), 4 users;
  `M/components/ConfirmDialog.vue` (touch `h-11`, busy, error, always primary), 2 users.
- Content-rich confirms: git `ResetDialog`, `RevertDialog`, `CherryPickDialog`, `ForcePushDialog`
  via `G/state/pendingSlot.ts` (`createPendingSlot`, 7 slots in `ops.ts`); docker
  `RecreateConfirmDialog`; `W/automations/schedule/ScheduleConfirmDialog.vue`; memory
  `ImportConfirmDialog`.
- Default focus: reka focuses the first tabbable (the header close button) everywhere except
  `usePendingDecision` (focuses Deny) and git `App.vue:908` (focuses Cancel). A destructive confirm
  reached by Enter therefore lands on Close, not Cancel, in the store dialog.

### 1.4 Inline rename and in-place edit

- `W/components/InlineRenameInput.vue` (Enter/blur commit, Esc cancel, select-all, empty or
  unchanged = cancel, `settled` guard): 2 users (`S/api/CollectionRow.vue`, `W/automations/
  AutomationsPanel.vue`).
- `K/repo/useCommitField.ts` (commit on blur/Enter, push-safe while dirty, error kept): 3 callers
  (`RepoConfigForm` ×4 fields, `RepoEnvRow` ×2).
- Hand-rolled, no Esc cancel, no IME guard: `K/ade/v2/backlog/AdeBacklogRow.vue:45`,
  `AdeBacklogPanel.vue:51`, `K/ade/v2/panel/AdeTaskTab.vue:63`, `S/views/stream/StreamView.vue`
  (visibility timeout field).
- Prompt-dialog rename (`W/prompt/useTextPrompt.ts` + `TextPromptDialog.vue`, non-portaled by
  design): `K/repo/GitPanel.vue` (repo rows), `S/views/console/ConsoleSavedMenu.vue`,
  `S/views/shared/FilterHistoryMenu.vue`.
- Double-click: 12 sites; opens (tree rows, Browse, docker logs), promotes a preview tab
  (`TabStrip`), never edits.

### 1.5 Persisted UI state

- Three tiers in use: Go-backed app-wide layout (`W/state/createLayoutStore.ts`, panel widths,
  dock height, debounced 150ms, broadcast); per-tab `state_json` (column widths, scroll row,
  `tabsStore.patch*TabState`, saved 1000ms debounced); browser storage.
- Browser storage, 3 APIs, 2 key schemes: `useLocalStorage` 13 sites, `useStorage` 3, raw
  `localStorage.*` 4 (`W/automations/AutomationsPanel.vue:93-97` legacy-key migration by hand).
  Keys `kira.<module>.<name>` everywhere except `kira-mobile-terminal-font`
  (`M/screens/TerminalScreen.vue:36`). Same key bound twice (`kira.automations.runsOpen` in
  `RunsSection` and `RunsStatusItem`). No value validation on read (a corrupt value reaches the
  component).
- git-ui `ViewStateStore` (`G/state/viewState.ts`, versioned, shape-checked) backed by the repo-graph
  tab's state in Space; review uses `NullViewStateStore`.

### 1.6 Clipboard and Copied feedback

- `W/util/clipboard.ts` `copyText`/`copyOrReportError`/`copyOrReportErrorLazy` (rejects on denial;
  VueUse declined in its own comment): 96 hits in 30 files (S 20, K 4, W 4, D 4).
- VueUse `useClipboard` (swallows the rejection the util exists to surface): 6 sites (K
  `AdeSessionId`, `AdeBranchPanel`, `AdeLinkRow`, `AdeWorkflowEditor`, `useTaskMenu`; W
  `ClaudeCodeMcpSection`).
- Hand-rolled `copied` flag + `setTimeout(1500)`: `K/ade/v2/panel/AdeRunOutcome.vue:110`,
  `W/automations/runs/RunOutcomeBlock.vue:29`.
- git-ui: host port `clipboard.write` via `G/state/clipboardActions.ts` with "Copied <what>"
  live-region text. Raw `navigator.clipboard`: `S/views/grid/SlickGridHost.vue:1855` (paste read),
  `S/views/shared/slick/scrollTrace.ts` (dev trace).
- Feedback: icon swap to `check` (3) or label swap to "Copied" (4), 1500ms; most copy menu items
  give none.

### 1.7 Virtualized lists

- Shared `W/util/virtualRows.ts` `useVirtualRows` (TanStack) and `treeVirtualRows.ts`
  `useTreeVirtualRows` (sticky band, `revealKey`): 12 callers.
- Direct `useVirtualizer`: `S/views/shared/keyvalue/KeyValuePane.vue`,
  `S/views/grpcrequest/ResponsePane.vue`, `W/memory/import/ImportJobDetail.vue`.
- Row height: `useRowHeight()` everywhere except `W/components/OpLogPanel.vue:103` (fixed 18) and
  git review (measured, `COLLAPSED_ROW_ESTIMATE 44`).
- Scroll-to-selection: `scrollToIndex` 7 call sites with 3 focus-after-render recipes (ProjectTree
  `revealKey`+`nextTick`+`querySelector`, CollectionsTree same, ReviewView `pendingFocus` watch).

### 1.8 Resize and drag handles

| Mechanism | Sites | Size unit | Keys | Release | Persist |
|---|---|---|---|---|---|
| reka `SplitterGroup` (`ResizablePanelGroup`/`ResizablePanel`/`ResizableHandle`) | shell project panel `W/components/WorkbenchShell.vue:112`; Studio in-view splitters `KeyValuePane`, `HttpRequestView`, `GrpcRequestView`, `BrowseView`, `DataView`, `StreamView`, `ConsoleView` (+ `CellEditorDock` px panel); `K/ade/v2/workflows/AdeWorkflowGraph.vue:301` (% 66/34) | % or px | reka % step, shell recomputes 10px | `mouseup` only, `useDragReleaseFallback` replays | layout store / tab state / none |
| VueUse `useDraggable` | `W/components/DockResizeHandle.vue` (dock), `K/ade/v2/panel/AdePanelResizeHandle.vue` (AdePanel, AdeReviewWindow ×2) | px | 10px, Home/End | pointerup + fallback | layout store / `useStorage` / debounced 400ms commit |
| Pointer capture by hand | `U/KuiColumnResizeHandle.vue` (git `CommitGrid` ×3 columns, git `App.vue:1812` detail pane, `StreamView` ×4 columns) | px | 10px, Home/End, `reverse` | `pointerup`/`pointercancel`/`lostpointercapture` | viewState / tab state |
| SlickGrid header resizer | Studio grids | px | none | library | tab state |

- Nesting today: shell horizontal group contains each Studio view's vertical group (different
  components, same render tree); `CellEditorDock` is a `size-unit="px"` panel beside SlickGrid,
  the shape P132 recorded as hazard (2).
- reka-specific workarounds in tree: `WorkbenchShell` ping-pong guard (`lastEmittedProjectWidth`),
  %-to-px keyboard step (`keyboardResizeBy` from `useElementSize`), `ResizableHandle`
  `hitAreaMargins` identity memo (re-registration orphaned a drag), `useDragReleaseFallback`
  (reka 2.10.5 ends a drag only on window `mouseup`).
- P132 (`ARCHITECTURE.md` "The Operations dock is a full-width flex sibling…"): outer-vertical
  nesting hung the render process on a tree-row click, non-deterministic, never root-caused; a px
  panel re-ran reka's pixel-layout recompute on every ResizeObserver tick and fought SlickGrid.

### 1.9 Scroll-into-view and focus management

- `scrollIntoView` 6 sites (S `FieldRowsTable`, `VariableSetView`, `FiltersDialog`; K
  `RepoFileView`, `AdeWorktreeSetup`; W `TabStrip`) with 3 different `block` values.
- Log follow-tail, 3 copies: `K/ade/v2/panel/AdeRunLog.vue:28`, `W/automations/runs/RunLog.vue:21`
  (VueUse `arrivedState.bottom`), `D/components/LogsView.vue:62-86` (own `atBottom` 8px threshold,
  Follow toggle).
- `.focus()` calls 61 in 35 files; mount focus 6 recipes (`onMounted`+`nextTick`, `open-auto-focus`
  handler ×4, `SearchField.focus()`, `useTemplateRef` + `$el.focus()`). Biome forbids `autofocus`.
- Focus return after an imperatively opened surface: git `RowContextMenu` only; workbench
  `ContextMenu`, `ConfirmDialog` store host and `TextPromptDialog` restore nothing (reka returns to
  the 0x0 trigger or body).

### 1.10 Loading, empty and error states of bridge data

- `queryClient` (`W/state/queryClient.ts`, `retry: false`, `refetchOnWindowFocus: false`); mobile
  builds its own (`M/main.ts:16`, `retry: 1`, refocus/reconnect on). Per-query overrides restating
  the default: `retry: false` 12, `staleTime: Infinity|Number.POSITIVE_INFINITY` 32 (push-invalidated
  data, the de-facto default), `staleTime: 0` 13.
- Client access, 2 styles: explicit `queryClient` argument (memory, automations, prompts, ADE) vs
  `useQueryClient()` injection (docker).
- Hand-rendered pending/error/empty in templates: 25 files (K 2, M 3, W 13, G 1, D 6) with three
  shapes: `Empty` + `Spinner` (MemoryPanel), `InlineState` (P263), docker `ListState` (skeleton rows,
  "Could not load", Retry). Retry button: docker only.
- Error text: `err instanceof Error ? err.message : String(err)` 176 hits in 124 files (S 70/34,
  K 53/41, M 4/4, W 16/12, G 30/20, D 2/2); no shared helper. `toCodedError` (`W/bridge/
  codedError.ts`) already unwraps every bridge error into `message` + `code`.
- Async action wrappers, 4 copies: `W/util/useBusyAction.ts` (2 users),
  `S/workbench/settings/useActionError.ts` (1 user), `attempt()` in `ConsoleSavedMenu`, `guarded()`
  in `AutomationsPanel`; plus hand-rolled `busy/pending/saving/loading = ref(false)` in 17 files.

### 1.11 Keyboard shortcuts and hints

- One binding table `X/domain/shortcuts.ts` `SHORTCUTS` (30 ids, mac overrides), matcher
  `W/shortcuts/keys.ts` (`shortcutFor`, `formatShortcut`), active-view registry
  `W/shortcuts/commands.ts` (`registerCommand` 22 callers), menu dispatch `runMenuShortcut`.
- Outside it: `@keydown.meta.enter` + `@keydown.ctrl.enter` pairs ×4 (`ScriptDialog`,
  `ScheduleConfirmDialog`, `RunScriptDialog`, `K/views/repo/ReviewThread.vue`; on macOS both fire,
  unlike `matchesShortcut`'s other-platform-modifier rejection); VueUse `onKeyStroke` ×2
  (`AdeReviewCompose`, `AdeWorkflowGraph`); `K/ade/v2/workflows/useSaveShortcut.ts` (Cmd/Ctrl+S by
  hand); window `keydown` for `view.find` in `K/workbench/WorkbenchShell.vue:30`; raw
  `metaKey/ctrlKey` reads in 12 files (engine hosts among them: MonacoHost, SlickGridHost,
  ConsoleSlickGrid, CellEditorView, gridKeyboard, git App).
- Hints: P263 `Kbd` + `TooltipIconButton kbd`; menus print `formatShortcut(id)`.
- No conflict check: `tree.copyName` and `grid.copy` share Cmd+C by scope, nothing states scopes.

### 1.12 Toasts and error reporting

- No toast system (P92; P263 §2.5 kept it). Action errors render in place: `Alert strip`,
  `FieldError`, dialog `Alert`, git `FailureBanner`, OpLog for long-running ops.
- Silent swallows: empty `catch {}` / `.catch(() => {})` 31 in 22 files (S 7/6, K 5/3, M 1, W 3/2,
  G 1, D 14/9); `console.error`/`warn`-only in UI code 37 in 22 files.

### 1.13 Debounce, throttle, poll and timer values

- Search/filter input: 150ms (S ×5), 200 (`W/memory/MemoryPanel.vue:31`, git `TAIL_DEBOUNCE_MS`).
- Parse/validate previews: 150 (`CredentialPastePanel`), 250 (`ScheduleConfirmDialog`,
  `ScheduleFields`, `RunScriptDialog`), 300 (`COOKIES_FETCH_DEBOUNCE_MS`), 400 (`ImportCurlDialog`,
  `EditRawRequestDialog`).
- Persistence writes: 150 (layout, mode), 400 (ADE panel width), 600 (`AdeNotesEditor`), 1000
  (tabs).
- Copied feedback 1500 (×7). Hover 400 (theme tooltip, `AutocompleteField` `HOVER_DELAY_MS`).
- Polls: `refetchInterval` 4 (docker 5s, Claude usage 60s, app update, schedule); clock tickers:
  `useIntervalFn` 15 in 10 files, `setInterval` (`S/state/runState.ts`), `useNow` 2.
- `setTimeout` by hand 18 in 15 files.

### 1.14 Drag-and-drop reordering

- `W/util/useSortableReorder.ts` (vue-draggable-plus, forceFallback, id mirror) + `moveId`: 6
  users (TabStrip, ColumnsMenu, VariableSetView, EnvironmentsView, mobile BacklogScreen; `moveId` in
  `K/state/coderepos.ts`).
- Direct vue-draggable-plus: `K/ade/v2/workflows/AdeWorkflowGraph.vue` (`VueDraggable` stage chips),
  `K/ade/v2/plan/AdeDayBand.vue` (cross-band board drop, `sort: false`, pointer-resolved target).
- Keyboard reorder: none anywhere.

### 1.15 Selection models

- Single-select rows: every list/tree; selection state lives in each module's store
  (`treeStore.selected`, `collectionsStore.selected`, git `SelectionState`, docker `ui.select`,
  memory `selectedId`), focus (`activeKey`) separate only in roving lists.
- Multi-select: grid engines only (SlickGrid `S/views/shared/slick/selection.ts`, git CommitGrid
  range via `gridKeyboard`) and the HTTP history compare pair. No shift/ctrl-click multi-select in
  lists.

### 1.16 Undo/redo

- Domain-only: Monaco (`MonacoHost` routes Cmd+Z/Shift+Cmd+Z), git undo slot (`ops.undoSlot`,
  `UndoButton`), grid staged edits (discard/revert). No generic mechanism; none needed.

### 1.17 Form dirty state and unsaved-changes prompts

- Dirty tracking: `SettingsShell` draft (no prompt by design, P17 D5), `useEditBuffer` (cell and
  document editors), HTTP/gRPC request `isDirty` (tab marker), ADE workflow drafts
  (`adeWorkflowsUi.ts` prompt "Discard unsaved workflow changes?"), `useCommitField`, docker edit
  draft (`editDiff.ts`), git `RepoSettingsDialog` draft-vs-base diff.
- Prompts: ADE workflows only (via the confirm store). Consistent with the P17 D5 rule; no gap.

### 1.18 Date, number and size formatting

- Bytes: `W/util/format.ts` `formatBytes` ("842 bytes", "1.2 KB", always one decimal) vs
  `D/lib/format.ts` `formatSize` ("341 MB", one decimal under 100, B/KB/MB/GB/TB).
- Relative time, 5 forms: `formatRelative` (W, "5m ago", "yesterday"), VueUse `useTimeAgo` +
  `K/ade/v2/ago.ts` options (8 K + mobile, "5m ago", no "yesterday"), docker `useTimeAgo` defaults
  ("5 minutes ago"), git `formatRelativeDate` (`G/components/dateFormat.ts`), `Intl.
  RelativeTimeFormat` (`K/workbench/settings/MobileAccessPane.vue:31`), cell editor
  `timestamp.ts relativeTime` (data inspection, both directions).
- Durations, 6 copies: `formatElapsed` ×2 (`K/ade/v2/board/actions.ts:253`,
  `W/automations/runs/runText.ts:23`), `formatDuration` ×3 (`OpLogPanel`, `importFormat.ts`,
  `StreamView` with its own `plural`), `TimelinePane formatMs`, `ScriptProgress format`.
- Counts: `toLocaleString` 35 in 16 S files, `Intl.NumberFormat` in git `LoadMoreButton`,
  `liveAnnouncements formatCount`; `plural` ×2 (`StreamView`, `ImportReportStrip`).
- Date-times: `toLocaleString()` (docker `formatCreated`, `dateOrDash`), OpLog `HH:mm:ss.SSS`,
  `scheduleText clockText` (timezone-aware), cell editor UTC/local pair.

### 1.19 Empty values, truncation and ellipsis

- Missing-value placeholders: `'—'` 13 (S, K, W, T `RunState`), docker `'-'`, `'(none)'`
  (`StreamView` key), `NULL` badge (grid data, not a placeholder).
- Truncation: `truncate`/`text-ellipsis`/`line-clamp` 277 hits; full text on hover via `Tooltip`
  (P263 replaced native `title` at 21 sites, always-on even when the text fits), `AttributeTooltip`
  (`data-kira-tip`, DOM-cheap, 16 files incl. virtual rows), truncated-cell tooltips in KeyValuePane
  and DocumentRow (data truncation, not overflow).

### 1.20 Hover delay and tooltips

- Theme `TooltipProvider` owns 400ms/300ms skip (P263). Exceptions: `AutocompleteField`
  `HOVER_DELAY_MS 400` hover-info popup (own timer), git `SearchResults` `@mouseenter` highlight.

### 1.21 Pagination, capped lists, load more

- Engine paging: Studio data views (page size `SecondaryTabs` + keyset/offset via the page
  protocol), git graph `LoadMoreButton` (stream chunks).
- Capped lists: git `ShowMoreButton` + `REF_LIST_SECTION_CAP` (ref lists, stashes, worktrees),
  git `FileTree` `FILE_TREE_ROW_CAP`/`capRows`, Studio `filterTree.ts FILTER_ROW_CAP 500`.
- "Show all rows" (search filter on) in 4 Studio views: `SlickGridHost:2727`, `KeyValuePane:1050`,
  `StreamView:1113`, `DocumentView:1038`, each its own markup over `usePageSearchFilterStore`.

### 1.22 Async button pending and disabled

- `:disabled` bound to a pending flag: 57 in 45 files; spinner inside the button by hand
  (`UnavailableState` Retry, docker actions, git `RefreshButton`); `useMutation().isPending` vs local
  refs mixed in the same files. No `Button` pending state.

### 1.23 Optimistic updates and push application

- Snapshot/patch/rollback block copied 5 times: `K/ade/v2/queries.ts` ×4 (`useUpdateTask`,
  `useMoveBacklogItem`, …) and `M/state/useAdeWrites.ts:47`, same `cancelQueries` → `getQueryData`
  → `setQueryData` → rollback → invalidate shape.
- `setQueryData` for push application 38 in 13 files (fine, not optimistic).

### 1.24 Polling and refetch intervals (seed) — see §1.13. Push-subscribe pattern
`W/state/hydrateThenSubscribe.ts` 27 hits in 9 files vs ad hoc `control.on*Changed` subscriptions
29 in 20 files (stores and composables subscribe and invalidate by hand).

### 1.25 Hunted: find bars (Enter/Shift+Enter next/prev, Esc close, debounced query)

4 copies: `S/views/shared/page/SearchToolbar.vue`, `S/views/stream/StreamSearchToolbar.vue`,
`S/views/shared/ResponseFindBar.vue`, git `SearchBox.vue` (two-stage Esc, permanent U17 exemption).
Same `onKeydown` body ×3; debounce 150 ×2, none ×1.

### 1.26 Hunted: point-anchored floating panels

`S/views/grid/FkPreviewPopover.vue` (own `computeFloatPosition` + `onClickOutside` + capture-phase
Escape + backdrop), `W/components/AutocompleteField.vue` hover/suggest popups (caret-anchored).
Both use `U/floatingPosition.ts` through `W/util/floatingPosition.ts`; every other floating surface
is reka (`Popover`, `DropdownMenu`, `Tooltip`).

### 1.27 Hunted: latest-request race guards

`G/state/latestRequest.ts` `createLatestRequest` (abort + identity check), used by git
`DetailState`/`WorkingDetailState`; hand-rolled generation counters 51 in 23 files (G 14 files repo
switch generations; K `blameStatus`, `coderepos`, `reviewDecorations`; S `useResponseBody`,
`kiraSlickGrid`; W `AutocompleteField`).

### 1.28 Hunted: live-region announcements

`G/components/useLiveRegion.ts` (clear-then-set re-announce) used by git only; elsewhere async
outcomes (copy, save, load) announce nothing.

### 1.29 Hunted: text filtering and sorting

`.toLowerCase().includes(` filters 49 in 28 files (S 36/17); `localeCompare`/`Intl.Collator` 26 in
14 files with mixed `numeric`/`sensitivity` options; `X/domain/tree-filter.ts` for trees only.

### 1.30 Hunted: IME composition guard on Enter

`isComposing` checked in 7 files (SearchBox, TextPromptDialog, panelSearch, ProjectTree,
CollectionsTree, SearchField, AutocompleteField); every other Enter-commit (`InlineRenameInput`,
ADE inline edits, `RepoConfigForm`, `ToolsField`, `McpServerTools`, `AdeCaptureBox`, dialog submit
pairs) commits mid-composition.

### 1.31 Hunted: optimistic/ad hoc reorder ids — covered by §1.14 `moveId`.

### 1.32 Hunted: duplicate positioning helpers

`W/util/floatingPosition.ts` is a re-export shim over `U/floatingPosition.ts` for one consumer;
`U/index.ts` exports it plus `KuiColumnResizeHandle` only.

### 1.33 Mobile (`M/`, 25 files)

Own `QueryClient` (§1.10), own `ConfirmDialog` (§1.3), `kira-mobile-terminal-font` key (§1.5),
`useTimeAgo` + ADE options (§1.18), optimistic block (§1.23), `useSortableReorder` (BacklogScreen),
SSE push via `installAdeReadSignals`, `useDebounceFn` refit (TerminalScreen), no context menus, no
keyboard navigation (touch), `CodedError` checks inline.

Totals: guard simulation (§3 U39-U63) hits 276 files outside foundation (A 93, B 101, C 82);
after the foundation's mechanical edits (U39, U45) 218 remain (A 79, B 77, C 62), plus ~20 caller
files each stream adds (row components, menus, specs).

## 2. Decisions (final)

Placement rule: composables live in `packages/workbench/src/behaviour/` (new; every package and both
apps already import `@workbench`, mobile included); components with a look live in
`packages/theme/src/components` (no TanStack, no workbench import) or `packages/workbench/src/
components` (when they need stores or TanStack). Existing behaviour files in `W/util/` move into
`behaviour/` (`clipboard`, `format`, `virtualRows`, `treeVirtualRows`, `useSortableReorder` →
`sortableReorder`, `panelSearch`, `usePendingDecision` → `pendingDecision`, `useBusyAction` →
`asyncAction`); `util/` keeps non-behaviour helpers (`collectionMenu`, `rowHeight`, `wheelScroll`,
`window`).

### 2.1 List and tree keyboard navigation

- **One composable `useListNavigation`** (`behaviour/listNavigation.ts`), hand-written on VueUse
  `useEventListener`. Why: reka `Listbox`/`Tree` own the item DOM, expansion state and their own
  virtualizer; our rows are store-driven, lazily expanded over IPC, virtualized by `useVirtualRows`
  with a sticky ancestor band, and every row testid must stay (named requirement).
- Contract: `{ container, items(), key(item), isDisabled?, activeKey (Ref), onSelect?, onOpen?,
  onMenu?(item, rect), tree?: { depth, isExpanded, hasChildren, expand, collapse }, typeahead?:
  (item) => string, scrollToIndex?, rowSelector(key) }` → `{ activeKey, tabindexFor(key), focusKey }`.
- Keys, one set for every list and tree: Up/Down move (skip disabled, no wrap); Home/End;
  Enter = open (primary action, same as double-click); Space = select; ContextMenu key and
  Shift+F10 = `onMenu` at the row's rect; tree Right = expand, else first child; tree Left =
  collapse, else parent (ProjectTree semantics, WAI-ARIA). Ignored inside inputs, with
  Ctrl/Cmd/Alt, and while `isComposing`.
- Type-ahead: first-letter buffer, `TIMING.typeahead` (500ms) reset, cycles matches; on only for
  lists without a panel search field. Panels with a search field keep `usePanelHeaderSearch`'s type
  to search redirect (no double handling: the composable skips printable keys when
  `typeahead` is unset).
- Virtual lists: `focusKey` calls `scrollToIndex`, then focuses the row once rendered
  (`ReviewView`'s `pendingFocus` watch with `flush: 'post'`, generalized).
- One roving tab stop per list; `activeKey` follows the selection when the selection changes from
  outside (click, reveal).
- Every `role="listbox"|"tree"` container binds it (14 lists gain arrows/Home/End; new UI-only
  behaviour, §3.6 specs). Grid engines (SlickGrid, git `gridKeyboard`/CommitGrid, DateTimePicker
  calendar) and comboboxes (`SearchBox`, `AutocompleteField`) keep their own handlers (named
  exemptions: cell/combobox semantics differ from list semantics).
- Board cards (`AdeTaskCard`, `AdeBranchRow`, `AdeBacklogRow`, `AdeAllSessionRow`) are buttons, not
  list rows: keep Enter/Space activation, gain `menu.open` through `useShortcut` (§2.11).
- `G/lib/menuModel.ts` `enabledNeighbour`/`firstEnabled` fold into the composable; BranchPicker's
  "Up from first row returns to the filter" becomes option `onExitTop`.

### 2.2 Context menus

- **One store, one renderer**: `W/state/contextMenu.ts` + `W/components/ContextMenu.vue`. git-ui's
  `RowContextMenu.vue` and `useRowMenu.ts` are deleted; `MenuSection[]` producers keep their model
  and pass through `sectionsToMenuItems(sections, onSelect)` (new, `G/lib/menuModel.ts`).
  `MenuSections.vue` stays only as the renderer for trigger-anchored dropdowns (`AppToolbar` push
  menu, `PullStrategyPicker`) and takes workbench `MenuItem` items. Why: same anatomy rendered
  twice (P263 §1.8), git's focus return and flip fix belong to every menu.
- Store gains: invoker capture and focus return on close (restore if connected, else
  `onRestoreFocus` callback), `openContextMenuFor(el, items)` (keyboard open at the element's
  bottom-left), `prioritize-position` on the content (git's P131 flip fix).
- Rules: right-click on a row selects and focuses it, then opens the menu (VS Code); right-click on
  empty space opens the background menu with no selection change; Esc or outside click closes;
  ContextMenu key / Shift+F10 opens the focused row's menu (via §2.1 `onMenu`); a menu item's
  printed shortcut comes only from `shortcut: ShortcutId`.
- Long-press: none (mobile has no menus; adding one is a feature, not unification).

### 2.3 Confirm-before-act

- **One API**: `useConfirmDialogStore().confirm({ message, title?, confirmLabel, tone, run? })`
  returning `Promise<boolean>`; `tone: 'danger' | 'primary'` (no default: every call states it);
  `run` (optional async) keeps the dialog open with busy state and inline `Alert` error until it
  resolves (AdeConfirmDialog's semantics). The old `confirmDialog(message, {danger, confirmLabel})`
  signature is replaced in foundation (26 calls, mechanical).
- **One component pair**: `W/components/ConfirmDialogView.vue` (presentational: title, message,
  confirm label, tone, busy, error, `touch` prop for the 44px mobile buttons) rendered by the store
  host `W/components/ConfirmDialog.vue`, by mobile screens directly, and by the 4 ADE dialogs.
  `AdeConfirmDialog.vue` and `M/components/ConfirmDialog.vue` are deleted.
- Look and focus: danger → `dialog-danger` confirm button and initial focus on Cancel; primary →
  `dialog-primary` and initial focus on the confirm button. Force push, Abort rebase, Stop and take
  over, mobile "move/start" confirms become `danger` where they discard or overwrite work
  (Force push, Abort rebase, Stop and take over) and stay `primary` otherwise.
- Content-rich confirms (git pending slots, docker Recreate, schedule, memory import) keep their
  dialogs and adopt the focus rule through `DialogContent destructive` (theme: on
  `open-auto-focus`, focus the element marked `data-dialog-dismiss`); git `App.vue:908`'s
  hand-written Cancel focus moves to it. `createPendingSlot` stays git state (it is the dialog
  queue, not the dialog).
- Wording stays as is (P265 owns copy); title default "Confirm" unchanged.

### 2.4 Inline rename and in-place edit

- **One primitive `InlineEditInput`** (`W/components/InlineEditInput.vue`, renamed from
  `InlineRenameInput`) over **one composable `useInlineEdit`** (`behaviour/inlineEdit.ts`, merges
  `InlineRenameInput`'s logic and `useCommitField`): Enter and blur commit, Esc cancels and
  restores, IME-safe, select-all on mount (`selectOnFocus` option), empty or unchanged = cancel,
  async commit keeps the field and shows the error on rejection, a push never overwrites unsaved
  text (useCommitField's rule).
- Rule: a row name in a list or tree renames inline (Collections, Automations, Space repo rows in
  `GitPanel`, ADE backlog/task titles); a name inside a menu or popover renames through
  `useTextPrompt` (saved queries, filter history), unchanged. `GitPanel` repo rename moves from the
  prompt to inline (§5.1).
- Settings-like fields that commit on blur (`RepoConfigForm`, `RepoEnvRow`, StreamView visibility
  timeout) use `useInlineEdit` without the inline look.

### 2.5 Persisted UI state

- **One composable `usePersistedState<T>(key, default, { schema?, migrateFrom? })`**
  (`behaviour/persisted.ts`) over VueUse `useLocalStorage`: zod-validated read (invalid or wrong
  shape → default, no crash), one-time legacy-key migration (replaces AutomationsPanel's hand code
  and the mobile font key), one shared ref per key (module-level cache, fixes the double
  `runsOpen` binding).
- Key scheme `kira.<module>.<name>` (each app and mobile is its own origin, so no app segment);
  mobile font becomes `kira.mobileTerminal.fontSize` with `migrateFrom: 'kira-mobile-terminal-font'`.
- Tier rule, unchanged but now stated: app-wide panel geometry in the Go layout store; per-tab
  view state in tab `state_json`; per-device conveniences (collapsed groups, last tab, dismissed
  banners, ADE review widths, docker disk cache) in `usePersistedState`. git `ViewStateStore` stays
  (versioned per-tab contract, the right tier).

### 2.6 Clipboard and Copied feedback

- **One composable `useCopy()`** (`behaviour/clipboard.ts`): `copy(text, { what? })` →
  `Promise<boolean>`, `copied` (`TIMING.copiedFeedback`, VueUse `useTimeoutFn`), `error`
  (`errorText`), announces "Copied <what>" through `useLiveRegion` (§2.27). Built on `copyText`;
  VueUse `useClipboard` declined (named: it swallows `writeText` rejection, which `copyText` exists
  to surface).
- Feedback rule: icon buttons swap to `check` with tooltip "Copied"; text buttons swap label to
  "Copied"; menu items announce only (the menu closes).
- git-ui keeps its host port `clipboard.write` (named: git-ui's host contract routes every effect
  through its bridge, `hostHandlers.ts`), formatted with `errorText`. Grid paste reads
  (`SlickGridHost` `readText`) and the dev scroll trace are named exemptions.

### 2.7 Virtualized lists

- Every virtual list goes through `useVirtualRows`/`useTreeVirtualRows`; direct `useVirtualizer`
  is guarded (3 sites migrate). Row height from `useRowHeight()` unless rows are measured (git
  review, documents expanded rows) or fixed by design (OpLog 18px log lines, named).
- Scroll-to-selection and focus-after-render belong to §2.1's `focusKey`; `revealKey` stays the
  tree variant (sticky inset).

### 2.8 Resize and drag handles (P132 decision)

- **Decision: one implementation, not a root-cause.** Retire reka `SplitterGroup` from the app;
  every pane split and every column handle uses **`usePaneResize` + `ResizeHandle`**
  (`packages/theme/src/components/ui/resizable/`), built on VueUse `useDraggable` (the library),
  the shape `DockResizeHandle`/`AdePanelResizeHandle` already prove. Why: the P132 hang is a
  non-deterministic race inside third-party reka 2.10.5 layout code, unreproducible on demand; a
  root-cause would end in patching vendored reka with no upstream guarantee, and the
  `sizeUnit="px"`/ResizeObserver feedback loop, the `mouseup`-only drag end, the %-only keyboard
  step and the `hitAreaMargins` re-registration are four more reka hazards the app works around
  today. Library rule: reka fails the named requirement "px-sized panes, nested in any direction,
  stable beside a virtualized grid"; VueUse `useDraggable` meets it, the rest is clamp arithmetic.
- `usePaneResize({ size: Ref<number>, min, max, axis, unit: 'px' | 'percent', container?,
  direction: 'normal' | 'reverse', step = RESIZE_KEY_STEP })` → `{ handleProps, dragging }`;
  emits `live` (every move, for preview) and `commit` (pointerup, keyboard step, Home/End) and
  `cancel` (pointercancel, lost capture, unmount mid-drag: KuiColumnResizeHandle's F10/F14 fixes).
  `percent` measures the container with `useElementSize` (AdeWorkflowGraph 66/34, min 35/22).
- `ResizeHandle.vue`: `role="separator"`, `aria-orientation/valuenow/min/max`, `tabindex=0`,
  `resizeHandleVariants` (P263 look unchanged), `data-state="drag"`. Layout is plain flex: the
  resized pane gets `flex: 0 0 <size>`, the other `flex: 1`.
- Persistence stays with the caller's tier (§2.5) on `commit`; no debounce (commit happens once on
  release; ADE's 400ms debounce goes).
- Deleted: `ResizablePanelGroup`, `ResizablePanel`, `ResizableHandle` (reka wrappers),
  `useDragReleaseFallback` (if `useDraggable`'s pointer capture makes it dead: the foundation
  proves it with `panel-resize.spec.ts`; kept only if a release is still lost, with the spec named
  in its comment), `DockResizeHandle`, `AdePanelResizeHandle`, `U/KuiColumnResizeHandle.vue`,
  `WorkbenchShell`'s ping-pong guard and `keyboardResizeBy` computation.
- SlickGrid's own header resizer stays (library internal, P263).

### 2.9 Scroll-into-view and focus management

- `behaviour/focus.ts`: `revealElement(el)` (`scrollIntoView({ block: 'nearest', inline:
  'nearest' })`, the one block value; FiltersDialog's `center` becomes `nearest`), `useFocusOnMount
  (target, { select? })` (VueUse `useFocus` initial value; replaces 6 mount-focus recipes),
  `useFocusReturn()` (capture `document.activeElement` on open, restore on close if still
  connected) used by the context menu store, the confirm store host and `TextPromptDialog`.
- Dialog initial focus: reka default (first tabbable) unless `DialogContent destructive` (§2.3) or
  an `open-auto-focus` handler naming a field (form dialogs focus their first field: ScriptDialog,
  BaseSelector, BranchPicker keep theirs through `useFocusOnMount`-equivalent handlers).
- `behaviour/followTail.ts` `useFollowTail(el, trigger, { follow?: Ref<boolean> })`: sticks to the
  bottom while the reader is at the bottom (VueUse `useScroll` `arrivedState.bottom`, 8px
  tolerance), stops when they scroll up, optional explicit Follow toggle (docker). Replaces 3
  copies.

### 2.10 Loading, empty and error states of bridge data

- **One query client factory** `createQueryClient({ remote })` (`W/state/queryClient.ts`): desktop
  (`remote: false`) `retry: false`, `refetchOnWindowFocus: false`, `staleTime: Infinity` (data is
  push-invalidated; `staleTime: 0` only where a query must refetch on mount, named per site); mobile
  (`remote: true`) `retry: 1`, refocus and reconnect refetch, `staleTime: Infinity`. Overrides that
  restate a default are removed (guard).
- Client access: `useQueryClient()` injection in components and composables; an explicit
  `queryClient` import only in code that runs outside setup (Pinia store bodies, module-level
  signal installers), named per file.
- **One component `QueryState`** (`W/components/QueryState.vue`): props `query` (TanStack result),
  `isEmpty?(data)`, `variant: 'pane' | 'inline'`; slots `default` (data), `empty`, `loading`,
  `error`. `pane`: `Empty` + `Spinner` loading, `Empty` + `errorText` + Retry (`refetch`) error;
  `inline`: `InlineState` lines. Docker `ListState` keeps its skeleton rows as the `pane` loading
  slot default when `skeleton` is set (the only known-layout list, P263 §2.6).
- **Error text**: `errorText(err: unknown): string` in `W/bridge/codedError.ts`
  (`toCodedError(err).message`); the 176-site idiom is replaced repo-wide in foundation.
- **Async actions**: `useAsyncAction(fn)` (`behaviour/asyncAction.ts`) → `{ run, pending, error }`,
  error via `errorText`; replaces `useBusyAction`, `useActionError`, `attempt`, `guarded` and local
  pending refs. Bridge writes with a cache effect use `useMutation` (`isPending`) instead.

### 2.11 Keyboard shortcuts and hints

- Every chord lives in `SHORTCUTS`; new ids: `form.submit` (Cmd/Ctrl+Enter), `form.save`
  (Cmd/Ctrl+S), `menu.open` (Shift+F10; the ContextMenu key is matched alongside). Each binding
  gains `scope: 'global' | 'view' | 'tree' | 'grid' | 'form' | 'editor'`.
- **One local-handler composable `useShortcut(target, ids, handler, { when? })`**
  (`W/shortcuts/useShortcut.ts`) on VueUse `useEventListener` + `shortcutFor`, skips
  `isComposing`, `preventDefault` on match. Replaces the 4 `@keydown.meta/ctrl.enter` pairs,
  `onKeyStroke` ×2, `useSaveShortcut`, Space's window `view.find` listener, AdeTaskCard's
  `.shift.f10`/`.context-menu`.
- Global chords stay Go menu accelerators + `registerCommand`. Engine hosts (Monaco, SlickGrid,
  git grid, xterm) keep raw modifier reads (named exemptions).
- Conflict rule: no two bindings share a chord inside one scope or between `global` and any scope;
  a unit test enforces it (§3.5).
- Hints: `Kbd` / `TooltipIconButton kbd` / menu shortcut text always from `formatShortcut(id)`.

### 2.12 Toasts and error reporting

- No toast system (P92 and P263 stand). A user action's error renders next to the action
  (`useAsyncAction().error` → `Alert strip` in views, `FieldError` in forms, `Alert` in dialogs);
  a background or push failure goes to the OpLog/StatusBar the module already has.
- An empty `catch` carries a one-line reason comment or surfaces the error; `console.error` stays
  only beside a surfaced error or in non-UI glue (guard U61 flags comment-less empty catches).

### 2.13 Debounce, throttle, poll and timer values

- **One table `TIMING`** (`behaviour/timing.ts`): `search 150`, `preview 250` (parse/validate
  previews), `persist 150` (UI-state writes), `autosave 600` (notes), `tabsSave 1000` (named: whole
  tab state serialisation), `copiedFeedback 1500`, `typeahead 500`, `reannounce 100`,
  `hoverInfo 400`, `pollFast 5000`, `pollSlow 60000`, `clockTick 1000`, `clockTickSlow 30000`.
  Changes: memory search 200 → 150, git search tail 200 → 150, cookies 300 → 250, curl import and
  raw request 400 → 250, credential paste 150 → 250, ADE panel width 400 → none (commit on
  release), Claude usage `useNow` 30s and Mobile access 60s keep `clockTickSlow`/`pollSlow`.
- Timers via VueUse only (`useDebounceFn`, `refDebounced`, `useTimeoutFn`, `useIntervalFn`,
  `useNow`); raw `setTimeout`/`setInterval` in app code is guarded (bridge transport timeouts and
  test helpers named).

### 2.14 Drag-and-drop reordering

- `useSortableReorder` (`behaviour/sortableReorder.ts`) for every same-list reorder;
  `AdeWorkflowGraph`'s `VueDraggable` stage chips migrate to it. `AdeDayBand` stays on
  vue-draggable-plus directly (named: cross-band board drop with a pointer-resolved target, not a
  list reorder). Keyboard reorder is a feature, not added.

### 2.15 Selection models

- Lists and trees are single-select with a separate roving `activeKey` (§2.1); selection state
  stays in each module's store. Right-click selects (§2.2). Multi-select stays in the grid engines
  and the history compare pair. No shift/ctrl-click added.

### 2.16 Undo/redo

- No shared mechanism; domain undo (Monaco, git undo slot, grid staged edits) stays. Inventory
  only.

### 2.17 Form dirty state and unsaved prompts

- Rule stated, no new composable: a surface prompts on leave only when leaving loses work that no
  draft or push restores (ADE workflow editors); settings drafts, request tabs and inline edits do
  not (P17 D5). The ADE prompt moves to the §2.3 API (`tone: 'danger'`, label Discard).

### 2.18 Date, number and size formatting

- **One module `behaviour/format.ts`** (from `W/util/format.ts`): `formatBytes` (docker algorithm:
  B/KB/MB/GB/TB, 1024 steps, one decimal under 100, none above, carry at 1024),
  `formatPercent`, `formatCount` (`Intl.NumberFormat`), `formatDuration(ms)` (`< 1 s` "N ms",
  `< 60 s` "N.N s", else "Xm Ys", "Xh Ym"), `formatElapsed(ms)` (live clock `m:ss` / `h:mm:ss`),
  `formatRelative(at)` ("just now", "5m ago", "3h ago", "2d ago"; "yesterday" goes),
  `formatDateTime(at)` (one `Intl.DateTimeFormat` medium date + short time), `formatClockTime`
  (OpLog `HH:mm:ss.SSS`), `plural(n, noun)`, `displayValue(v)` (§2.19).
- `useRelativeTime(at)` = VueUse `useTimeAgo` with options derived from `formatRelative` (replaces
  `ade/v2/ago.ts`, docker defaults, MobileAccessPane's `Intl.RelativeTimeFormat`).
- Named exemptions: cell editor `timestamp.ts` (data inspection, both directions, exact UTC/local),
  `scheduleText clockText` (timezone-explicit), git commit date column absolute format (user setting).

### 2.19 Empty values and truncation

- Missing value placeholder `—` everywhere (`displayValue(v)`; docker `-` → `—`).
- **One primitive `TruncatedText`** (`packages/theme/src/components/TruncatedText.vue`): `truncate`
  span that shows a Tooltip with the full text only while it overflows (VueUse
  `useResizeObserver`, `scrollWidth > clientWidth`). Replaces the always-on reveal Tooltips P263
  converted from `title` (ReposDialog, RepoConfigForm, AdeReviewSync, ImportFileRow,
  RepoMultiDiffView, EditField, EditInPlaceSection). Virtual rows keep `AttributeTooltip` (named:
  DOM-cheap per row). Data-truncation badges (KeyValuePane, DocumentRow) stay.

### 2.20 Hover delay

- Theme provider owns tooltip delay (P263). `AutocompleteField` hover info uses `TIMING.hoverInfo`.

### 2.21 Pagination and capped lists

- Engine paging unchanged. **One capped-list pair**: `useCappedList(rows, step)`
  (`behaviour/cappedList.ts`) + `ShowMoreButton` (moved to `W/components/`); git ref lists,
  `FileTree` cap and Studio `filterTree` cap adopt it.
- **One "Show all rows" notice**: `S/views/shared/page/SearchFilterNotice.vue` (Studio-only data
  views, over `usePageSearchFilterStore`; it lives with the Studio page search code, the only
  consumer) for the 4 views.

### 2.22 Async button pending

- Theme `Button` gains `pending` (disabled, `aria-busy`, leading `Spinner` replaces the icon slot).
  Bound to `useAsyncAction().pending` or `mutation.isPending`. Hand spinners in buttons go.

### 2.23 Optimistic updates

- **One helper `optimisticUpdate(qc, key, patch)`** (`behaviour/optimistic.ts`) returning
  `{ onMutate, onError, onSettled }` (cancel, snapshot, patch, rollback, invalidate). The 5 copies
  migrate; desktop and mobile ADE share the same patch functions (`withTaskPatch`,
  `withMovedItem`) already.

### 2.24 Polling and push

- Polls only through `refetchInterval: TIMING.*`; clock ticks through `useNow({ interval })`.
- Push subscriptions: `hydrateThenSubscribe` for stores; composables subscribe with
  `tryOnScopeDispose(control.onX(...))` and invalidate a key (memory's pattern). No new helper.

### 2.25 Find bars

- **One composable `useFindBar({ next, prev, close, query, onQuery })`**
  (`behaviour/findBar.ts`): Enter next, Shift+Enter prev, Esc close (IME-safe), query debounced
  `TIMING.search`. The 3 Studio bars migrate; git `SearchBox` keeps its two-stage Esc (U17
  exemption stands) but uses the same debounce constant.

### 2.26 Point-anchored floating panels

- **One primitive `PointPopover`** (`W/components/PointPopover.vue`): reka `Popover` with a
  `PopoverAnchor :reference` virtual point (the ContextMenu 0x0 trick for popovers), reka owns
  outside-click, Escape and focus. `FkPreviewPopover` migrates. `AutocompleteField` keeps
  floating-ui (named: caret-anchored popups that must never take focus from the input);
  `W/util/floatingPosition.ts` shim goes, AutocompleteField imports `@kira/kira-ui` directly.

### 2.27 Latest-request guard and live region

- `createLatestRequest` moves to `behaviour/latest.ts` (cancellation predicate parameter instead
  of git's `TransportError` import); git state keeps its repo-switch generation counters (named:
  they guard store resets across a repo switch, not a single request). Non-git hand-rolled request
  sequencing (K `blameStatus`, `coderepos`, `reviewDecorations`; S `useResponseBody`; W
  `AutocompleteField`) migrates.
- `useLiveRegion` moves to `behaviour/liveRegion.ts`; `useCopy` and `QueryState` error announce
  through one app-level polite region mounted by both shells (git keeps its own region inside
  git-ui's root, same composable).

### 2.28 Text filtering and sorting

- `behaviour/match.ts`: `matchesQuery(text, query)` (trimmed, case-insensitive substring, the
  current semantics) and `compareNatural` (one `Intl.Collator(undefined, { numeric: true,
  sensitivity: 'base' })`). Sites migrate; tree filtering stays `X/domain/tree-filter.ts`.

### 2.29 Mobile equivalents

| Behaviour | Mobile |
|---|---|
| Query client | `createQueryClient({ remote: true })` |
| Confirm | `ConfirmDialogView touch` |
| Persisted | `usePersistedState`, migrated font key |
| Relative time | `useRelativeTime` |
| Optimistic | `optimisticUpdate` |
| Error text | `errorText` |
| Reorder | `useSortableReorder` (unchanged) |
| Keyboard nav, menus, shortcuts | none (touch) |

## 3. Foundation (step 1, sequential, before any worktree)

One Sonnet implementer on `v2.0`, main checkout. Owns every file in the first table for the whole
phase; streams never edit them (findings go to the stream's findings file, fixed in close-out).

### 3.1 New and changed shared files

| File | Change |
|---|---|
| `W/behaviour/listNavigation.ts` (new) | §2.1 |
| `W/behaviour/persisted.ts` (new) | §2.5 |
| `W/behaviour/clipboard.ts` (moved from `util/`) | `copyText` family + `useCopy` §2.6 |
| `W/behaviour/virtualRows.ts`, `treeVirtualRows.ts` (moved) | unchanged API |
| `W/behaviour/focus.ts` (new) | `revealElement`, `useFocusOnMount`, `useFocusReturn` §2.9 |
| `W/behaviour/followTail.ts` (new) | §2.9 |
| `W/behaviour/asyncAction.ts` (from `util/useBusyAction.ts`) | `useAsyncAction` §2.10 |
| `W/behaviour/timing.ts` (new) | `TIMING` §2.13 |
| `W/behaviour/sortableReorder.ts` (moved) | unchanged API |
| `W/behaviour/format.ts` (moved from `util/format.ts`) | §2.18, `useRelativeTime` |
| `W/behaviour/inlineEdit.ts` (new) | §2.4 |
| `W/behaviour/optimistic.ts` (new) | §2.23 |
| `W/behaviour/findBar.ts` (new) | §2.25 |
| `W/behaviour/latest.ts` (from `G/state/latestRequest.ts`) | §2.27 |
| `W/behaviour/liveRegion.ts` (from `G/components/useLiveRegion.ts`) | §2.27 |
| `W/behaviour/match.ts` (new) | §2.28 |
| `W/behaviour/cappedList.ts` (new) | §2.21 |
| `W/behaviour/panelSearch.ts`, `pendingDecision.ts` (moved) | unchanged API |
| `W/bridge/codedError.ts` | `errorText` |
| `W/state/queryClient.ts` | `createQueryClient`, desktop instance |
| `W/state/contextMenu.ts`, `W/components/ContextMenu.vue` | §2.2 focus return, keyboard open, flip |
| `W/state/confirmDialog.ts`, `W/components/ConfirmDialog.vue`, `W/components/ConfirmDialogView.vue` (new) | §2.3 |
| `W/components/InlineEditInput.vue` (renamed from `InlineRenameInput.vue`) | §2.4 |
| `W/components/QueryState.vue` (new) | §2.10 |
| `W/components/PointPopover.vue` (new) | §2.26 |
| `W/components/ShowMoreButton.vue` (moved from git-ui) | §2.21 |
| `W/components/WorkbenchShell.vue`, delete `DockResizeHandle.vue` | §2.8 |
| `W/prompt/TextPromptDialog.vue` | `useFocusReturn`, `useFocusOnMount` |
| `W/shortcuts/useShortcut.ts` (new), `keys.ts` | §2.11 |
| `X/domain/shortcuts.ts` | `form.submit`, `form.save`, `menu.open`, `scope` |
| `T/components/ui/resizable/{index.ts,ResizeHandle.vue,usePaneResize.ts,paneResizeMath.ts}` | §2.8; delete reka wrappers |
| `T/components/ui/button/{Button.vue,index.ts}` | `pending` §2.22 |
| `T/components/ui/dialog/DialogContent.vue` | `destructive` initial focus §2.3 |
| `T/components/TruncatedText.vue` (new) | §2.19 |
| `U/index.ts`, delete `U/KuiColumnResizeHandle.vue` | §2.8 |
| `G/lib/menuModel.ts` | `sectionsToMenuItems`; `enabledNeighbour`/`firstEnabled` stay until C moves BranchPicker, close-out deletes them |
| `scripts/check-ui-primitives.sh` | U39-U63, allowlist reading restored (P263 `66259e6ce` format) |
| `scripts/ui-primitives-allowlist/stream-{a,b,c}.txt` (new) | every file failing a new guard at foundation tip, split by §4.1 |
| `package.json` | `test:unit` adds `packages/theme/src` |
| `docs/ARCHITECTURE.md` "UI architecture" | "Behaviour (P264)" paragraph; P132 dock paragraph rewritten (close-out finalises) |

### 3.2 Early mechanical edits in stream-owned files (before worktrees, so no conflict)

Each limited to the named change, typecheck green per commit:

1. Import moves: every `@workbench/util/{clipboard,format,virtualRows,treeVirtualRows,
   useSortableReorder,panelSearch,usePendingDecision,useBusyAction,floatingPosition}` and
   `G/state/latestRequest`, `G/components/useLiveRegion`, `G/components/ShowMoreButton` import
   rewritten to the new path (`sed` + `biome check --write` for import order). `useBusyAction` →
   `useAsyncAction` at its 2 call sites.
2. `errorText`: the 176-site idiom replaced repo-wide (`sed -E` over the exact expression, import
   added, `biome check --write`). Mobile included.
3. Confirm API: the 26 `.confirmDialog(message, { danger, confirmLabel })` calls rewritten to
   `.confirm({ message, confirmLabel, tone })` (danger default true → `tone: 'danger'`; the 4
   `danger: false` → `'primary'`; missing labels get the old defaults Delete/Continue).
4. Resize end to end (§2.8), all callers: `WorkbenchShell` (project panel, dock), Studio
   `KeyValuePane`, `HttpRequestView`, `GrpcRequestView`, `BrowseView`, `DataView`, `StreamView`
   (pane + 4 columns), `ConsoleView`, `CellEditorDock`; Space `AdePanel`, `AdeReviewWindow`
   (persisted widths through `usePersistedState`), `AdeWorkflowGraph` (percent); git `App.vue`
   detail pane, `CommitGrid` 3 columns. Testids and `aria-label`s of every handle unchanged.
5. `DialogContent destructive` + `data-dialog-dismiss` on the cancel button of git
   `ResetDialog`/`ForcePushDialog`/`RevertDialog`/`CherryPickDialog`, docker
   `RecreateConfirmDialog`; git `App.vue:908` hand focus removed.

### 3.3 Guards (`check-ui-primitives.sh`, same mechanics and scan dirs as U1-U38)

Kind `v` = `.vue`, `vt` = `.vue` + `.ts`, `s` = side panels, `w` = whole-file condition. Built-in
exempt paths are the owning `behaviour/`/theme files; every other exemption is a named
`PERMANENT` line with a reason. `packages/workbench/src/testing/` is a built-in exempt dir.

- U39 (vt) `instanceof Error \? …\.message : String\(` (use `errorText`).
- U40 (vt) `@keydown\.(meta|ctrl|alt|shift)`, `@keydown\.context-menu`, `onKeyStroke\(` (use
  `useShortcut`).
- U41 (vt) `\.(metaKey|ctrlKey)\b` outside `keys.ts`/`useShortcut.ts` (engine hosts named:
  MonacoHost, SlickGridHost, ConsoleSlickGrid, CellEditorView, gridKeyboard, git `App.vue`).
- U42 (vt) `useClipboard\(|navigator\.clipboard` (use `useCopy`/`copyText`).
- U43 (vt) `useStorage\(|useLocalStorage\(|localStorage\.|sessionStorage` (use
  `usePersistedState`).
- U44 (vt) `useVirtualizer\(` (use `useVirtualRows`).
- U45 (vt) `<(ResizablePanelGroup|ResizablePanel|ResizableHandle|KuiColumnResizeHandle|
  DockResizeHandle|AdePanelResizeHandle)\b`, `setPointerCapture`, `useDraggable` imported from
  `@vueuse/core` (use `ResizeHandle`/`usePaneResize`).
- U46 (vt) numeric literal as the delay of `useDebounceFn|refDebounced|watchDebounced|
  useThrottleFn|useIntervalFn|useTimeoutFn`, `refetchInterval:\s*\d`, `copiedDuring`,
  `\bsetTimeout\(|\bsetInterval\(` (use `TIMING` + VueUse; bridge `port.ts` timeout named).
- U47 (vt) `'ArrowDown'|'ArrowUp'` outside `listNavigation.ts` (named: gridKeyboard, AutocompleteField,
  SearchBox, DateTimePicker); (w) `role="(listbox|tree)"` in a file without `useListNavigation`.
- U48 (v) `<RowContextMenu\b|useRowMenu\(` (use the context menu store).
- U49 (v) `<AdeConfirmDialog\b|window\.confirm|import ConfirmDialog from '\.\./components/` (use
  the confirm store or `ConfirmDialogView`).
- U50 (v) an `<input|Input|InputGroupInput` tag carrying both `@blur` and `@keydown.enter`;
  `useCommitField\(` (use `InlineEditInput`/`useInlineEdit`).
- U51 (vt) `const (busy|pending|saving|loading|submitting|running|deleting|retrying|copying)\s*=
  \s*ref\((true|false)\)` (use `useAsyncAction` or `mutation.isPending`).
- U52 (vt) `toLocaleString\(|toLocaleDateString|toLocaleTimeString|Intl\.(NumberFormat|
  DateTimeFormat|RelativeTimeFormat)|useTimeAgo\(|function (plural|formatDuration|formatElapsed|
  formatSize|formatTime|formatMs)\b` outside `behaviour/format.ts` (named: celleditor
  `timestamp.ts`, `scheduleText.ts`, git `dateFormat.ts` absolute column).
- U53 (vt) `new QueryClient` outside `queryClient.ts`; `retry:\s*false`,
  `refetchOnWindowFocus:\s*false`, `staleTime:\s*(Infinity|Number\.POSITIVE_INFINITY)` in query
  options; `, queryClient\)` in a component or composable (stores named).
- U54 (v) `v-(else-)?if="[^"]*\.(isLoading|isError)\b` (use `QueryState`).
- U55 (vt) `onMutate:` outside `optimistic.ts` (use `optimisticUpdate`).
- U56 (vt) `localeCompare\(|new Intl\.Collator|\.toLowerCase\(\)\.includes\(` (use
  `matchesQuery`/`compareNatural`).
- U57 (vt) `scrollTop = \w+(\.value)?\.scrollHeight|scrollIntoView\(` (use `useFollowTail`/
  `revealElement`).
- U58 (vt) `computeFloatPosition|pointReference` (use `PointPopover`; AutocompleteField named).
- U59 (vt) `(\?\?|\|\|) '—'|return '—'|'-' :` placeholder literals (use `displayValue`).
- U60 (vt) `from 'vue-draggable-plus'` (use `useSortableReorder`; AdeDayBand named).
- U61 (vt) `catch\s*(\(\w*\))?\s*\{\s*\}`, `\.catch\(\(\)\s*=>\s*(\{\s*\}|undefined)\)` with no
  comment inside (reason comment or surface the error).
- U62 (vt) `\.focus\(\)` and `nextTick\([^)]*\.focus` outside `focus.ts`, `listNavigation.ts`,
  theme primitives (`SearchField`, `InputGroupAddon`) (named engine hosts: MonacoHost, CommitGrid,
  slick `editor.ts`, AutocompleteField).
- U63 (s) a side-panel file with `<SearchField` and no `usePanelHeaderSearch` (type to search in
  every searchable panel; MemoryPanel gains it).

Allowlist format (P263): `path` (file exempt from U39+ while unmigrated) or `permanent U<n> path #
reason`. A stream edits only its own list; stale entries fail, so lists only shrink. U39 and U45
have no stream entries (foundation clears them).

### 3.4 Reference migrations (foundation proves each primitive once, in a file it then owns)

- `useListNavigation`: `S/project/ProjectTree.vue` (tree) and `W/components/OpLogPanel.vue`
  (list). Both move to the foundation table for the phase.
- `useCopy`: proven in `W/components/OpLogPanel.vue`'s copy items (`W/components/opLog.ts`, also
  foundation's for the phase).
- `QueryState`, `useAsyncAction`, `useInlineEdit`, `usePersistedState`, `optimisticUpdate`: proven
  by unit tests (§3.5) and the first stream chunk using each; no extra foundation file.

### 3.5 Tests (CLAUDE.md bar)

Unit (bun, next to code):

- `listNavigation.spec.ts`: tree Left/Right parent/child rules, disabled skipping at both ends,
  type-ahead buffer reset and cycling, virtual pending focus ordering. A decision structure too
  large to hold in your head.
- `paneResizeMath.spec.ts` (theme): clamp, reverse direction, percent ↔ px at container resize,
  keyboard step at bounds, cancel restores. Boundary arithmetic.
- `format.spec.ts`: `formatBytes` carry at 1023.95 KB → "1.0 MB", 99.95 rounding switch,
  `formatDuration` unit boundaries. Rounding edges.
- `shortcuts-conflicts.spec.ts`: no duplicate chord per scope and vs global, both platforms.
  Guards a table with platform overrides.

No unit test for `usePersistedState`, `useCopy`, `useAsyncAction`, `optimisticUpdate`,
`useFollowTail`, `QueryState`, `ConfirmDialogView`, `TruncatedText`, `PointPopover`: thin
wrappers (bar).

New UI-only behaviour (no backend change, so no flow test; UI spec per surface):

- Studio `tests/ui/list-keyboard.spec.ts`: arrows/Home/End/Enter on Browse, HTTP history, gRPC
  history, KeyValuePane, Documents, Stream; type-ahead on SavedListMenu; right-click selects a
  project tree row; Shift+F10 opens the row menu; focus returns to the row after Esc.
- Space `tests/ui/list-keyboard.spec.ts`: repo tree arrows + Left/Right, repo search list,
  GitPanel repo list, ReposDialog, Memory list; MemoryPanel type to search.
- Studio `tests/ui/confirm-focus.spec.ts`: a danger confirm opens with Cancel focused, Enter
  cancels; a primary confirm focuses the confirm button.
- Docker list arrows in Studio `docker-*.spec.ts` (C extends).
- Existing specs cover the rest: `panel-resize`, `tree` (P132 gate), `slick-grid` resize,
  `ade-v2-panel`, `ade-v2-review*`, `repo-graph-*` detail resize, `stream-*` columns,
  `ade-v2-workflows` (stage chips, unsaved prompt), `settings-*`, `docker-*`, `automations-*`,
  mobile project.

### 3.6 Foundation commits (Conventional Commits, each hook-green)

1. `refactor(workbench): behaviour/ module, util moves, errorText repo-wide`
2. `feat(workbench): list navigation, focus, follow-tail, find bar composables`
3. `feat(workbench): context menu focus return and keyboard open; one confirm API`
4. `feat(workbench): persisted state, copy, async action, timing, format, match, optimistic, capped list`
5. `feat(theme): Button pending, DialogContent destructive focus, TruncatedText`
6. `refactor!: one pane resize implementation, reka splitter retired (P132)` (§3.2 item 4)
7. `feat(workbench): QueryState, createQueryClient, InlineEditInput, PointPopover, useShortcut`
8. `chore(lint): guards U39-U63, per-stream allowlists, ARCHITECTURE paragraph`
9. `test: list navigation, pane resize, format, shortcut conflicts; new UI specs`
10. visual baselines (only if a handle moved a pixel; expected none)
11. `docs(v2.2): P264 foundation result` (what landed, allowlist counts, deviations)

Verify: `bun run typecheck`, `bun run lint`, `bun run test:unit`, `bun run test:ui:studio`,
`bun run test:ui:space`, `bun run test:ui:space-mobile`, `bun run test:visual:studio` and
`:space` (expected unchanged: §2.8 keeps the P263 handle look). P132 gate: `tree.spec.ts`,
`panel-resize.spec.ts`, `slick-grid.spec.ts` resize tests and `data-view.spec.ts`
`--repeat-each=10` with the dock open, under 6 CPU burners (P263 close-out method), 0 hangs.
Handle pixel check as P263 (shell, dock, ADE panel: 2px, same colours rest/hover/drag).

## 4. Streams (step 2)

Three named streams, worktrees off the **foundation tip** (same base commit for all three):
`/home/user/kira-p264-a` (branch `p264-a`), `/home/user/kira-p264-b` (`p264-b`),
`/home/user/kira-p264-c` (`p264-c`). One Sonnet implementer per stream, chunks in the order below,
one commit per chunk (more when a chunk splits into logical groups), each hook-green. Each chunk
removes its files from the stream's allowlist (or turns a line into `permanent …` with a reason).
Per site the implementer applies §2 exactly; a compliant file needs no edit. Discovery inside a
file (what a handler does, its callers, its specs) uses `codegraph_explore` first.

### 4.1 Ownership (zero overlap)

| Stream | Owns | Files |
|---|---|---|
| Foundation (done before) | §3.1 table, §3.2 early edits, §3.4 reference files | ~60 |
| A: Kira Studio | `apps/kira-studio/frontend/src/**` (minus foundation files), `apps/kira-studio/tests/**` except C's below, `scripts/ui-primitives-allowlist/stream-a.txt`, `docs/v2.2/plans/P264-stream-a-findings.md` | 84 |
| B: Kira Space + mobile + memory | `apps/kira-space/frontend/src/**`, `apps/kira-space/frontend/mobile/**` (minus foundation files), `packages/workbench/src/memory/**`, `apps/kira-space/tests/**` except C's below, `scripts/ui-primitives-allowlist/stream-b.txt`, `docs/v2.2/plans/P264-stream-b-findings.md` | 89 |
| C: shared modules (git, Docker, Automations, workbench chrome) | `packages/git-ui/src/**`, `packages/docker-ui/src/**`, `packages/workbench/src/**` except `memory/**`, `behaviour/**` and foundation files; specs: Studio `tests/ui/{docker-*,automations-*}.spec.ts`, Studio visual `automations-module.spec.ts` + snapshots; Space `tests/ui/{automations-*,repo-graph-*,repo-commit-*,repo-branch-picker,repo-floating-geometry,repo-review-interaction}.spec.ts`, Space visual `git-module.spec.ts` + snapshots; `scripts/ui-primitives-allowlist/stream-c.txt`, `docs/v2.2/plans/P264-stream-c-findings.md` | 70 |

`packages/theme/**`, `packages/kira-ui/**`, `packages/shared/**`, `packages/workbench/src/
behaviour/**`, `scripts/check-ui-primitives.sh`, `package.json`, `docs/ARCHITECTURE.md`,
`docs/v2.2/SPEC.md` belong to foundation/close-out only. Spec support helpers: Studio
`tests/ui/support/**` A, Space `tests/ui/support/**` B; a helper C needs changed → C's findings file.

**No ordering dependency between streams**: all three consume only foundation primitives; no
source file, spec, PNG or allowlist is shared; each visual spec file and snapshot directory has one
owner. git-ui's `RowContextMenu.vue`/`useRowMenu.ts`/`MenuSections.vue` are C's; Space mounts git-ui
through its public entry only. Any needed change in another stream's or foundation's file goes to
the findings file and is fixed in close-out.

### 4.2 Chunks

Paths: `S/` `apps/kira-studio/frontend/src/`, `K/` `apps/kira-space/frontend/src/`, `M/`
`apps/kira-space/frontend/mobile/`, `p/` `packages/`. Behaviours per file come from the guard hits
plus the row components a list's navigation needs.

Stream A order: A1 API, A2 project + Studio workbench, A3 data views + stream, A4 HTTP/gRPC +
shared views, A5 sweep.

#### A1 (19 files)
`S/api/CollectionRow.vue`, `S/api/CollectionsPanel.vue`, `S/api/CollectionsTree.vue`, `S/api/DynamicValuesDialog.vue`, `S/api/EditRawRequestDialog.vue`, `S/api/EnvironmentsView.vue`, `S/api/ImportCurlDialog.vue`, `S/api/ImportReportStrip.vue`, `S/api/SaveRequestDialog.vue`, `S/api/VariableRow.vue`, `S/api/VariableSetView.vue`, `S/api/VariablesOverviewPanel.vue`, `S/api/state/apiQueries.ts`, `S/api/state/collections.ts`, `S/api/state/history.ts`, `S/api/state/revealExpiry.ts`, `S/api/state/variableCompletion.ts`, `S/api/state/variables.ts`, `S/api/reveal.ts`

#### A2 (21 files)
`S/App.vue`, `S/bridge/port.ts` (permanent U46 line: transport timeout), `S/editor/MonacoHost.vue` (permanent U41/U62: editor host), `S/project/ConnectionDialog.vue`, `S/project/FiltersDialog.vue`, `S/project/TreeRow.vue`, `S/project/credentialPaste/CredentialPastePanel.vue`, `S/project/filterTree.ts`, `S/project/menus.ts`, `S/project/state/tree.ts`, `S/state/runState.ts`, `S/state/schemas.ts`, `S/workbench/DbMcpApprovalDialog.vue`, `S/workbench/GenerateDataDialog.vue`, `S/workbench/UploadObjectDialog.vue`, `S/workbench/panels/OperationsPanel.vue`, `S/workbench/settings/AdvancedPane.vue`, `S/workbench/settings/ApiPane.vue`, `S/workbench/settings/CachePane.vue`, `S/workbench/settings/DatabaseMcpPane.vue`, `S/workbench/settings/useActionError.ts` (deleted)

#### A3 (22 files)
`S/views/browse/BrowseView.vue`, `S/views/console/ConsoleResultGrid.vue`, `S/views/console/ConsoleSavedMenu.vue`, `S/views/console/ConsoleSlickGrid.vue` (permanent U41: grid engine), `S/views/console/ConsoleView.vue`, `S/views/console/ExplainResultView.vue`, `S/views/console/planIssues.ts`, `S/views/console/planParsers/postgres.ts`, `S/views/definition/DefinitionView.vue`, `S/views/documents/DocumentView.vue`, `S/views/shared/document/DocumentRow.vue`, `S/views/grid/DataToolbar.vue`, `S/views/grid/DataView.vue`, `S/views/grid/FkPreviewPopover.vue`, `S/views/grid/PreviewCommandPanel.vue`, `S/views/grid/SlickGridHost.vue` (permanent U41/U42: grid engine, paste read), `S/views/grid/slick/editor.ts`, `S/views/stream/StreamComposeMessage.vue`, `S/views/stream/StreamSearchToolbar.vue`, `S/views/stream/StreamView.vue`, `S/views/stream/search.ts`, `S/views/shared/page/SearchFilterNotice.vue` (new)

#### A4 (22 files)
`S/views/grpcrequest/CallHistoryList.vue`, `S/views/grpcrequest/GrpcRequestView.vue`, `S/views/grpcrequest/ResponsePane.vue`, `S/views/grpcrequest/SchemaBrowser.vue`, `S/views/grpcrequest/schemaQuery.ts`, `S/views/httprequest/CookiesPane.vue`, `S/views/httprequest/HttpRequestView.vue`, `S/views/httprequest/ResponseDiffDialog.vue`, `S/views/httprequest/ResponseHistoryList.vue`, `S/views/httprequest/ResponsePane.vue`, `S/views/httprequest/TimelinePane.vue`, `S/views/httprequest/cookies.ts`, `S/views/shared/FilterHistoryMenu.vue`, `S/views/shared/ResponseFindBar.vue`, `S/views/shared/SavedListMenu.vue`, `S/views/shared/celleditor/CellEditorView.vue` (permanent U41: editor host), `S/views/shared/celleditor/TimestampPane.vue`, `S/views/shared/celleditor/timestamp.ts` (permanent U52), `S/views/shared/fields/FieldRowsTable.vue`, `S/views/shared/keyvalue/KeyValuePane.vue`, `S/views/shared/page/SearchToolbar.vue`, `S/views/shared/slick/scrollTrace.ts` (permanent U42/U61: dev trace)

#### A5 (sweep, no new files)
Run `check-ui-primitives.sh` with only `permanent` lines in `stream-a.txt` to list any Studio file
the guards hit that no chunk named (fix in this commit, record in the result). List-keyboard specs: extend `apps/kira-studio/tests/ui/list-keyboard.spec.ts` for every list the
stream binds (Browse, HTTP/gRPC history, KeyValuePane, Documents, Stream, SavedListMenu type-ahead).
Keyboard pass by
hand in the running app: project tree, collections, every history list, Browse, KeyValue,
Documents, Stream, Console results; right-click selection; confirm focus; a resize of every
Studio splitter and the dock.

Stream B order: B1 repo + Space workbench, B2 ADE plan/board/backlog, B3 ADE panel/review/run/
sessions/workflows, B4 memory + mobile, B5 sweep.

#### B1 (22 files)
`K/App.vue`, `K/repo/GitPanel.vue`, `K/repo/RepoConfigForm.vue`, `K/repo/RepoEnvRow.vue`, `K/repo/RepoFileTree.vue`, `K/repo/RepoTreeRow.vue`, `K/repo/RepoSearchView.vue`, `K/repo/RepoSearchRow.vue`, `K/repo/ReposDialog.vue`, `K/repo/useCommitField.ts` (deleted), `K/repo/state/fileTree.ts`, `K/repo/state/repoHeads.ts`, `K/repo/state/reposQueries.ts`, `K/repo/state/worktrees.ts`, `K/state/claudeUsage.ts`, `K/state/coderepos.ts`, `K/state/workspace.ts`, `K/views/repo/RepoDiffView.vue`, `K/views/repo/RepoFileView.vue`, `K/views/repo/ReviewThread.vue`, `K/workbench/WorkbenchShell.vue`, `K/workbench/settings/MobileAccessPane.vue`

#### B2 (23 files)
`K/ade/v2/AdeAbortRebaseDialog.vue`, `K/ade/v2/AdeAddPopover.vue`, `K/ade/v2/AdeCandidateRow.vue`, `K/ade/v2/AdeForcePushDialog.vue`, `K/ade/v2/ago.ts` (deleted), `K/ade/v2/backlog/AdeBacklogPage.vue`, `K/ade/v2/backlog/AdeBacklogPanel.vue`, `K/ade/v2/backlog/AdeBacklogRow.vue`, `K/ade/v2/board/actions.ts`, `K/ade/v2/board/rebaseActions.ts`, `K/ade/v2/board/timeline.ts`, `K/ade/v2/dialog/mobileLaunch.ts`, `K/ade/v2/needs/AdeAllSessionRow.vue`, `K/ade/v2/needs/useNeedsAction.ts`, `K/ade/v2/plan/AdeDayBand.vue` (permanent U60), `K/ade/v2/plan/AdePlanView.vue`, `K/ade/v2/plan/AdeRepoChip.vue`, `K/ade/v2/plan/AdeTaskCard.vue`, `K/ade/v2/plan/AdeBranchRow.vue`, `K/ade/v2/plan/useTaskMenu.ts`, `K/ade/v2/queries.ts`, `K/ade/v2/readQueries.ts`, `K/ade/v2/state/adeBoardUi.ts`

#### B3 (22 files)
`K/ade/v2/AdeConfirmDialog.vue` (deleted, last), `K/ade/v2/notes/AdeNotesEditor.vue`, `K/ade/v2/panel/AdeBranchPanel.vue`, `K/ade/v2/panel/AdeLinkRow.vue`, `K/ade/v2/panel/AdeRunLog.vue`, `K/ade/v2/panel/AdeRunOutcome.vue`, `K/ade/v2/panel/AdeTaskTab.vue`, `K/ade/v2/panel/AdeWorktreeSetup.vue`, `K/ade/v2/review/AdeReviewCompose.vue`, `K/ade/v2/run/AdeRunDialog.vue`, `K/ade/v2/run/useTaskAction.ts`, `K/ade/v2/sessions/AdeHeadlessPane.vue`, `K/ade/v2/sessions/AdeSessionId.vue`, `K/ade/v2/sessions/AdeStoppedRow.vue`, `K/ade/v2/sessions/AdeTakeOverDialog.vue`, `K/ade/v2/sessions/AdeTuiPane.vue`, `K/ade/v2/state/adeWorkflowsUi.ts`, `K/ade/v2/workflows/AdeWorkflowEditor.vue`, `K/ade/v2/workflows/AdeWorkflowGraph.vue`, `K/ade/v2/workflows/AdeWorkflowYaml.vue`, `K/ade/v2/workflows/useSaveShortcut.ts` (deleted), `K/workbench/ClaudeUsageItem.vue`

#### B4 (22 files)
`p/workbench/src/memory/AddMemoryDialog.vue`, `p/workbench/src/memory/MemoryPanel.vue`, `p/workbench/src/memory/MemoryStart.vue`, `p/workbench/src/memory/import/ImportConfirmDialog.vue`, `p/workbench/src/memory/import/ImportFileRow.vue`, `p/workbench/src/memory/import/ImportJobDetail.vue`, `p/workbench/src/memory/import/importFormat.ts`, `p/workbench/src/memory/import/importQueries.ts`, `p/workbench/src/memory/queries.ts`, `p/workbench/src/memory/settings/ClaudeCodeMcpSection.vue`, `p/workbench/src/memory/settings/SemanticModelSection.vue`, `M/main.ts`, `M/api/events.ts`, `M/components/ConfirmDialog.vue` (deleted), `M/screens/BacklogScreen.vue`, `M/screens/NeedsScreen.vue`, `M/screens/PlanScreen.vue`, `M/screens/PlanTaskCard.vue`, `M/screens/TerminalScreen.vue`, `M/state/useAdeWrites.ts`, `M/state/useAgentsModel.ts`, `M/terminal/useRemoteTerminal.ts`

`AdeConfirmDialog.vue` (B3) and `M/components/ConfirmDialog.vue` (B4) are deleted by B in the chunk
that moves their last caller; foundation deletes nothing a stream still imports.

#### B5 (sweep, no new files)
Empty `stream-b.txt` check as A5; extend the Space `list-keyboard.spec.ts` for every list the
stream binds (repo tree, repo search list, GitPanel repo list, ReposDialog, Memory list); keyboard pass: repo tree, repo search, GitPanel, ReposDialog,
Memory list; ADE inline edits with Esc; ADE confirms (Force push danger focus); review window and
ADE panel resize; mobile screens (confirm touch buttons, font key migration).

Stream C order: C1 git components, C2 git state + Docker, C3 Automations + workbench chrome, C4
sweep.

#### C1 (24 files)
`p/git-ui/src/App.vue` (permanent U41: document Esc chain), `p/git-ui/src/components/AppToolbar.vue`, `p/git-ui/src/components/BranchPicker.vue`, `p/git-ui/src/components/CommitGrid.vue` (permanent U62: grid engine focus), `p/git-ui/src/components/FileTree.vue`, `p/git-ui/src/components/LoadMoreButton.vue`, `p/git-ui/src/components/MenuSections.vue`, `p/git-ui/src/components/PullStrategyPicker.vue`, `p/git-ui/src/components/RowContextMenu.vue` (deleted), `p/git-ui/src/components/SearchBox.vue` (permanent U47: combobox), `p/git-ui/src/components/SearchResults.vue`, `p/git-ui/src/components/StackList.vue`, `p/git-ui/src/components/StashList.vue`, `p/git-ui/src/components/StashRows.vue`, `p/git-ui/src/components/TagList.vue`, `p/git-ui/src/components/WorktreeList.vue`, `p/git-ui/src/components/useRowMenu.ts` (deleted), `p/git-ui/src/components/fileTreeModel.ts`, `p/git-ui/src/components/gridKeyboard.ts` (permanent U41/U47: grid engine), `p/git-ui/src/components/pickerModel.ts`, `p/git-ui/src/components/refListModel.ts`, `p/git-ui/src/components/review/BaseSelector.vue`, `p/git-ui/src/components/review/ReviewCommitRow.vue`, `p/git-ui/src/components/review/ReviewView.vue`

#### C2 (23 files)
`p/git-ui/src/graph/layoutClient.ts`, `p/git-ui/src/graph/rowSvg.ts`, `p/git-ui/src/state/graphView.ts`, `p/git-ui/src/state/liveAnnouncements.ts`, `p/git-ui/src/state/pr.ts`, `p/git-ui/src/state/search.ts`, `p/docker-ui/src/components/ContainerDetail.vue`, `p/docker-ui/src/components/ContainerList.vue`, `p/docker-ui/src/components/ContainerOverview.vue`, `p/docker-ui/src/components/ContainerSizeSection.vue`, `p/docker-ui/src/components/ContainerTable.vue`, `p/docker-ui/src/components/EngineDiskSection.vue`, `p/docker-ui/src/components/EngineOverview.vue`, `p/docker-ui/src/components/ImageList.vue`, `p/docker-ui/src/components/ListState.vue`, `p/docker-ui/src/components/LogsView.vue`, `p/docker-ui/src/components/NetworkList.vue`, `p/docker-ui/src/components/ResourceDetail.vue`, `p/docker-ui/src/components/VirtualList.vue`, `p/docker-ui/src/components/VolumeList.vue`, `p/docker-ui/src/lib/format.ts`, `p/docker-ui/src/queries.ts`, `p/docker-ui/src/state/useStatsSubscription.ts`

#### C3 (23 files)
`p/workbench/src/automations/AutomationsPanel.vue`, `p/workbench/src/automations/ScriptDialog.vue`, `p/workbench/src/automations/run/RunScriptDialog.vue`, `p/workbench/src/automations/runs/RunLog.vue`, `p/workbench/src/automations/runs/RunOutcomeBlock.vue`, `p/workbench/src/automations/runs/RunsSection.vue`, `p/workbench/src/automations/runs/RunsStatusItem.vue`, `p/workbench/src/automations/runs/runText.ts`, `p/workbench/src/automations/runs/runsQueries.ts`, `p/workbench/src/automations/schedule/ScheduleConfirmDialog.vue`, `p/workbench/src/automations/schedule/ScheduleFields.vue`, `p/workbench/src/automations/schedule/scheduleQueries.ts`, `p/workbench/src/automations/schedule/scheduleText.ts` (permanent U52), `p/workbench/src/automations/smart/McpServerTools.vue`, `p/workbench/src/automations/smart/McpToolsField.vue`, `p/workbench/src/components/AutocompleteField.vue` (permanent U41/U47/U58/U62: caret combobox), `p/workbench/src/components/TabStrip.vue`, `p/workbench/src/components/UpdateDialog.vue`, `p/workbench/src/prompts/PromptHost.vue`, `p/workbench/src/prompts/promptsQueries.ts`, `p/workbench/src/settings/fields/NotifyPromptsField.vue`, `p/workbench/src/state/createAppUpdateStore.ts`, `p/workbench/src/state/createTabsStore.ts` (`TIMING.tabsSave`)

`T/components/ScriptProgress.vue` is theme (foundation): its timer and duration format move in
foundation commit 4.

#### C4 (sweep, no new files)
Empty `stream-c.txt` check as A5; extend a list-keyboard spec for every list the stream binds
(git file tree, branch picker, review list, docker lists); keyboard pass: git file tree, branch picker, review list,
docker lists; git menus (focus return, flip); Automations inline rename; OpLog list; resize of git
detail pane and commit grid columns.

Sizes: A 84 files (19/21/22/22 + sweep), B 89 (22/23/22/22 + sweep), C 70 (24/23/23 + sweep).
Every chunk <=25. `S/project/ProjectTree.vue` and `W/components/OpLogPanel.vue` are foundation
reference files (§3.4), in no stream.

### 4.3 Verification per stream

- Per commit (pre-commit hook): `bun run typecheck`, `bun run lint` (includes
  `check-ui-primitives.sh` with the stream's allowlist).
- Per chunk: UI specs covering the chunk's testids (grep the changed files' `data-testid` values in
  `apps/<app>/tests/ui`): `bun run build:test:studio && npx playwright test
  --config=apps/kira-studio/playwright.config.ts --project=ui <specs>` (Space: `build:test:space`,
  Space config). C runs both apps' configs for its specs. Unit: `bun run test:unit`.
- Stream end, once: A `bun run test:ui:studio` minus C's specs; B `bun run test:ui:space` minus C's
  specs, then `bun run test:ui:space-mobile`; C its own Studio and Space specs. Then its own visual
  PNGs (`test:visual:update:<app>` with `--grep` limited to its own snapshots, inspect each diff,
  re-run without update clean). Expected visual change: none except formatter output (§5.1).
- A stream is done when its allowlist holds only `permanent` lines and every check above is green.

### 4.4 Disk and worktrees (3.6 GB free at plan time)

Each worktree needs its own `node_modules` (Bun hardlinks from its cache), Wails bindings and
`frontend/dist`; never symlink `node_modules` (DEV_ENVIRONMENT). P263 ran three at ~3.7 GB free
after installs. Staged by measurement:

1. Before: `git worktree list`; `/home/user/kira-v22-base` (`v2.2-fixes`) is not P264's, leave it
   unless the user removes it. `df -h /home/user`.
2. Create A: `git worktree add -b p264-a /home/user/kira-p264-a <foundation-tip>`, then in it
   `sh scripts/prepare-worktree.sh` and `sh scripts/codegraph-setup.sh`. `df`.
3. Create B the same way only with >= 2.0 GB free; `df`.
4. Create C the same way only with >= 1.5 GB free after B. If short: C waits; the first stream to
   finish lands (§5.6), its worktree is removed (`git worktree remove`), then C is created off the
   same foundation tip (never off the moved `v2.0`; C rebases at landing like the others). C has
   no dependency on A or B, so the wait changes only wall-clock time.
5. Keep >= 1.0 GB free while streams run; a stream that needs space prunes its own
   `test-results/` and `playwright-report/`, never another worktree's.
6. Playwright browsers and the Go build cache are shared (`~/.cache`).
7. Clean-up after landing: `git worktree remove` each, `git worktree prune`,
   `git branch -d p264-a p264-b p264-c`.
8. A stopped stream resumes from its last commit in its worktree; never recreate it.

## 5. Risks, scope, guarantees, landing

### 5.1 Behaviour-neutral guarantee and accepted shifts

No Go, IPC, bridge contract or store schema change; persisted keys keep their values (one migrated
key). Testids, accessible names and labels stay. Accepted shifts, each from a §2 decision:

- 14 listboxes/trees gain Up/Down/Home/End/Enter/Space/Shift+F10 (§2.1); collections and git file
  tree gain move-to-parent/child on Left/Right; lists without search gain type-ahead; MemoryPanel
  gains type to search.
- Right-click selects the row before the menu opens (§2.2); every context menu returns focus to its
  invoker; workbench menus flip before shifting.
- Danger confirms open with Cancel focused; Force push, Abort rebase, Stop and take over render
  `dialog-danger` (§2.3).
- ADE inline edits and GitPanel repo rename: Esc cancels; GitPanel repo rename is inline (§2.4).
- Formatter output (§2.18): byte sizes drop the forced decimal ("341 MB", "842 B" instead of
  "842 bytes"), "yesterday" becomes "1d ago", docker "5 minutes ago" becomes "5m ago", durations
  share one format, `-` becomes `—`.
- Timing values (§2.13): memory/git search 150ms, previews 250ms, ADE panel width commits on release.
- Resize (§2.8): identical look, step and bounds; percent splits keep their ratio on container
  resize; px panes keep px.
- Copy feedback everywhere (§2.6): menu copies announce "Copied …" through the live region.

### 5.2 Testids stable

None renamed. Specs change only for a §5.1 effect: role/keyboard specs (new), formatter text
assertions (`docker-*`, `ops-*`, `ade-*`, `memory-*` sizes and ages), confirm specs that relied on
Enter hitting the old first focus, GitPanel rename spec (prompt → inline), resize specs that read
reka's `data-panel-size`/`aria-valuenow` percentages (now px, or percent for AdeWorkflowGraph).

### 5.3 Risks

- **Retiring reka Splitter touches 15 files and every pane:** done once in foundation with the
  P132 gate under load before any worktree exists; streams never touch resize.
- `errorText` sed across 124 files: the expression is exact; typecheck catches a wrong variable
  name; one commit, reviewed by diff stat.
- `useListNavigation` on virtual lists: focus lost when a row unmounts. `focusKey` re-focuses after
  render; `pinned` (useVirtualRows) keeps the active row mounted.
- Type-ahead vs global single-key shortcuts: none exist (all shortcuts carry a modifier or are
  F-keys/Delete/Enter), and the composable ignores events with modifiers.
- Right-click selection triggers a selection side effect (opening a preview tab in some trees):
  rows whose selection opens something select without opening on right-click (`onSelect` gets
  `{ reason: 'menu' }`).
- Context menu focus return into a virtual row that scrolled away: `onRestoreFocus` falls back to
  the list's `focusKey`.
- Mobile `QueryClient` defaults: `staleTime: Infinity` explicit now (was default 0 with SSE
  invalidation); SSE already invalidates every read, and reconnect/refocus refetch stays on.
- Rebase conflicts: none expected (zero overlap); a real conflict means ownership was wrong: stop,
  fix ownership, never merge PNGs (re-record after rebase).
- Disk: §4.4.

### 5.4 Out of scope

Copy and wording (P265); new features (keyboard reorder, multi-select in lists, long-press menus,
toast system, generic undo, unsaved prompts beyond the ADE rule); SlickGrid/CommitGrid/Monaco/xterm
internals beyond the named hooks; Go; looks (P262/P263, unchanged).

### 5.5 Close-out (step 3, sequential, after all three streams land)

On the landed `v2.0`:

1. Fix every item in the three findings files; delete the files once fixed.
2. Delete legacy left for the streams: old `confirmDialog(message, opts)` overload if kept,
   `G/lib/menuModel.ts` `enabledNeighbour`/`firstEnabled` if unused, any re-export shim from §3.2's
   import moves.
3. Move `permanent` allowlist lines into `check-ui-primitives.sh` as named exemptions with reasons;
   delete `scripts/ui-primitives-allowlist/`.
4. **Flaky tests, root-caused (none skipped, none `--no-verify`):** the P263-open `ui-timing`
   budgets (`budgets.spec.ts` console keystroke p50, scroll frame time; `perf.spec.ts` p95 scroll)
   fail on this runner and passed on a faster one. Root cause: absolute millisecond budgets on a
   runner of unknown speed. Fix: a calibration probe at spec start (a fixed in-page workload timed
   against its reference duration recorded with the budgets in `docs/PERF.md`) scales every budget
   by `max(1, measured / reference)`, capped at 2x; a real regression still fails, a slow runner no
   longer does. Then run `test:ui:studio`, `test:ui:space`, `test:ui:space-mobile`,
   `test:visual:*` twice under 6 CPU burners and 8 workers (P263 method); every failure gets a
   root cause and a fix commit, each re-verified `--repeat-each=16`.
5. `docs/ARCHITECTURE.md`: "Behaviour (P264)" paragraph final (one line per §2 rule and the owning
   composable), P132 dock paragraph rewritten (reka Splitter retired, one resize implementation),
   `KuiColumnResizeHandle` and `ResizableHandle` mentions updated; "Known open items" unchanged
   unless a finding is genuinely open. `docs/DEV_ENVIRONMENT.md` only if the calibration adds a
   knob.
6. Plan "Close-out result"; SPEC P264 result section and row Done.
7. Full `typecheck`, `lint`, `test:unit`, `test:ui:studio`, `test:ui:space`,
   `test:ui:space-mobile`, `test:visual:studio`, `test:visual:space`, `test:flows:studio`,
   `test:flows:space` green.

### 5.6 Landing

1. Foundation commits on `v2.0` (main checkout), hook-green, verified, "Foundation result"
   written. Plain push in the background (`git push origin v2.0`); no PR.
2. Worktrees A, B, C off the foundation tip (§4.4); streams run concurrently.
3. Each stream done (§4.3) → in its worktree `git rebase v2.0` (any order), re-run lint/typecheck
   and its own visual check, then in the main checkout `git merge --ff-only p264-<x>`. Plain
   background push after each.
4. Close-out (§5.5) on `v2.0`, push, remove worktrees (§4.4 step 7).

## 6. Verification checklist (orchestrator greps, after close-out)

Scope `D="apps/kira-studio/frontend/src apps/kira-space/frontend/src apps/kira-space/frontend/mobile packages/workbench/src packages/git-ui/src packages/docker-ui/src packages/kira-ui/src"`.

- `sh scripts/check-ui-primitives.sh` exits 0; `scripts/ui-primitives-allowlist/` gone.
- `grep -rnP 'instanceof Error \? \w+(\.\w+)?\.message : String\(' --include=*.vue --include=*.ts $D` → 0;
  `grep -rln 'errorText(' $D` ≥ 120 files.
- `grep -rnP '<(ResizablePanelGroup|ResizablePanel|ResizableHandle|KuiColumnResizeHandle|DockResizeHandle|AdePanelResizeHandle)\b' --include=*.vue $D packages/theme/src` → 0;
  `grep -rn 'SplitterGroup\|SplitterResizeHandle' packages apps --include=*.vue --include=*.ts` → 0;
  `grep -rln '<ResizeHandle\|usePaneResize(' $D` covers `WorkbenchShell.vue`, `AdePanel.vue`,
  `AdeReviewWindow.vue`, `AdeWorkflowGraph.vue`, git `App.vue`, `CommitGrid.vue`, `StreamView.vue`,
  and the 7 Studio views.
- `grep -rnP "'ArrowDown'" --include=*.vue --include=*.ts $D` → only `behaviour/listNavigation.ts`
  and the named exemptions; every file with `role="listbox"` or `role="tree"` contains
  `useListNavigation` (`for f in $(grep -rlP 'role="(listbox|tree)"' $D); do grep -L useListNavigation $f; done` → empty).
- `grep -rn '<RowContextMenu\|useRowMenu' $D` → 0; `ls packages/git-ui/src/components/RowContextMenu.vue` → absent.
- `grep -rn '<AdeConfirmDialog\|window.confirm' $D` → 0; `M/components/ConfirmDialog.vue`,
  `K/ade/v2/AdeConfirmDialog.vue` absent; `grep -rln 'ConfirmDialogView' $D` ≥ 6 files.
- `grep -rnP 'useClipboard\(|navigator\.clipboard' $D` → only named exemptions; `grep -rln 'useCopy(' $D` ≥ 8.
- `grep -rnP 'useStorage\(|useLocalStorage\(|localStorage\.' $D` → only `behaviour/persisted.ts`;
  `grep -rln 'usePersistedState(' $D` ≥ 11.
- `grep -rn 'useVirtualizer(' $D` → only `behaviour/virtualRows.ts`.
- `grep -rnP '(useDebounceFn|refDebounced|useIntervalFn|useTimeoutFn)\([^;]*,\s*\d{2,}' $D` → 0;
  `grep -rnP '\bset(Timeout|Interval)\(' --include=*.vue --include=*.ts $D` → named exemptions only.
- `grep -rnP '@keydown\.(meta|ctrl|alt|shift)|onKeyStroke\(' $D` → 0; `grep -rln 'useShortcut(' $D` ≥ 8.
- `grep -rnP 'new QueryClient' $D` → only `state/queryClient.ts`; `grep -rnP 'retry:\s*false' $D --include=*.ts --include=*.vue` → only `queryClient.ts`.
- `grep -rnP 'v-(else-)?if="[^"]*\.(isLoading|isError)\b' --include=*.vue $D` → 0; `grep -rln '<QueryState' $D` ≥ 20.
- `grep -rn 'onMutate:' $D` → only `behaviour/optimistic.ts`.
- `grep -rnP 'useTimeAgo\(|Intl\.RelativeTimeFormat|function formatSize|function formatElapsed' $D` → only `behaviour/format.ts` and named exemptions.
- `grep -rnP "from 'vue-draggable-plus'" $D` → `sortableReorder.ts`, `AdeDayBand.vue`.
- `grep -rnP 'const (busy|pending|saving|loading|submitting|running|deleting|retrying|copying)\s*=\s*ref\(' $D` → 0; `grep -rn ' pending' packages/theme/src/components/ui/button/Button.vue` present.
- Unit specs present and green: `listNavigation.spec.ts`, `paneResizeMath.spec.ts`,
  `format.spec.ts`, `shortcuts-conflicts.spec.ts`; UI specs `list-keyboard.spec.ts` (both apps),
  `confirm-focus.spec.ts`.
- `git diff --stat <foundation-base>..HEAD -- '*.go'` → empty.
- `ui-timing` project green twice under load; every `visual` project green on both apps.
