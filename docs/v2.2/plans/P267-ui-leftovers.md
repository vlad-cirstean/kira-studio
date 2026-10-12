# P267 plan: UI leftover unification

Ask (SPEC row P267, orchestrator handover): unify every gap the four audits found
(`P267-audit-{ui-leftovers,exemptions,dim-visual,dim-behaviour}.md`, cited UL#n, EX, V#n, B#n).
Audits' recommended conventions are final; each "needs decision" item gets one choice plus a
one-line why below. Guards added. `packages/kira-ui` deleted (AutocompleteField moves to reka
Popover). `connectionsReorder` deleted. No sign-off list.

Base: `v2.0` at `ae1bb8648` (P266 close-out + P267 rows). Builds on P262/P263 looks (U1-U38), P264
behaviour (U39-U63), P265 catalog (U64-U71, C1-C11), P266 (U72-U82, N1-N7, G1-G4, named exemptions
only, `scripts/consistency-allowlist/` deleted, `noConsole` override list gone).

Steps, strictly in order:

1. **F0** (one Sonnet, main checkout): catalog seeds, PERMANENT block regrouped by owner (§4.1).
2. **F1, F2** (two Sonnets, concurrent, zero overlap): F1 theme primitives in the main checkout,
   F2 workbench behaviour in worktree `/home/user/kira-p267-f` (§4.2).
3. **F3** (one Sonnet, main checkout, after F1 and F2 land): cross-package wiring, `packages/kira-ui`
   deletion, script and Go guard fixes, ARCHITECTURE section (§4.3).
4. **Streams A, B, C** (three Sonnets, worktrees `/home/user/kira-p267-{a,b,c}` off the F3 tip,
   concurrent, staggered by disk): migrate chunk by chunk, write every planned spec (§5).
5. **Landing** (§6.1), **R** repo-wide sequential sweeps and new guards (§6.2), **T** one serial
   test-and-fix Sonnet (§6.3), **close-out** (§6.4).

Method: 23 `codegraph_explore` calls (SectionHeading/FieldLegend/FieldDescription/InlineState/
EmptyState; buttonVariants/Button pending/TooltipIconButton; Dialog/Popover/Dropdown/Tooltip/
CommandDialog z and shadow; AutocompleteField/computeFloatPosition/PointPopover/SearchBox;
shortcutFor/SHORTCUTS/useShortcut; ContextMenu/MenuItem/MenuSections/sectionsToMenuItems;
useListNavigation/openContextMenu; createTabsStore close path/pendingChanges; KindLookup/TabKindDef;
TIMING/useSortableReorder; format.ts/RunState/formatCount/Go s3 formatBytes; TruncatedText;
connectionsReorder; FilterHistoryMenu/ConsoleSavedMenu; LogLines/LogsView/ansi; highlight renderers;
find bars/useFindBar; useCappedList/capRows/useRowHeight; logWarn/fireAndForget/RepoScopedReload;
ScriptDialog/ConnectionDialog validation; inputVariants/InlineEditInput/rowVariants/usePaneResize;
reviewDecorations; DialogHeader/CheckoutDialog/RecreateConfirmDialog), then a scratch python
counter and greps over `S/` `apps/kira-studio/frontend/src`, `K/` `apps/kira-space/frontend/src`,
`M/` `apps/kira-space/frontend/mobile`, `W/` `packages/workbench/src`, `G/` `packages/git-ui/src`,
`D/` `packages/docker-ui/src`, `T/` `packages/theme/src`; Go under `apps/*/internal`, `ks/`
`apps/kira-studio/internal`, `kp/` `apps/kira-space/internal`, `in/` `internal`. Counts exclude
`*.spec.ts`. Multi-line tags counted with a quote-aware tag regex (python `re.S`).

## 1. Inventory (re-verified at `ae1bb8648`)

Already fixed since the audits (dropped): `noConsole` override block (P266 close-out: removed, every
`console.*` on `logWarn`/`logError`); G4 lines moved from stream files into
`internal/conventiontest` named exemptions (9); U82 `useAdeWrites.ts` moved into PERMANENT;
`scripts/consistency-allowlist/` deleted. Path corrections: `AdeShell.vue` is `K/ade/v2/shell/`,
`sessionView.ts` is `K/ade/v2/sessions/`, `runText.ts` is `W/automations/runs/`.

### 1.1 UI leftovers (UL)

| # | Item | Count now |
|---|---|---|
| UL1 | uppercase heading recipes outside `SectionHeading`/`FieldLegend`/`PanelHeader` | 22 hits (29 incl. primitives); U21 scans side panels only |
| UL2 | status-bar Button override `h-control-sm gap-1 px-1.5 text-kira-sm font-normal` | 5 files (`RunsStatusItem`, `AppMetricsItem`, `UpdateAvailableItem`, `ClaudeUsageItem`, Space `StatusBar`) + `EndpointChip` |
| UL3 | mobile Button `class="h-touch …"` | 14 in 6 files (`ReplySheet`, `KeyBar`, `NeedsScreen`, `PlanTaskCard`, `TerminalScreen`, `BacklogScreen`); `ConfirmDialogView.vue:72,83` `h-11` |
| UL4 | `variant="ghost"`/`'ghost'` outside `DialogHeader` | 20 in 15 files; button-toggles `AdeAllSessions:80,88`, `AdeNotesEditor:230`, `AdeAllSessionRow:69` |
| UL5 | `variant="link"` with class overrides | 20 overrides in 12 files; ADE fake links `AdeStoppedRow`, `AdeNeedsRow`; git `LINK_BUTTON_CLASS` |
| UL6 | match highlight renderers | 5 (`TreeRow`, `CollectionRow`, docker `LogsView`+`lib/ansi.ts splitMatches`, `RepoSearchRow`, `DocumentView` `bg-warn`) |
| UL7 | `<details>` | 8 in 5 files; raw chevrons `DocumentRow`, `DocumentTree`, `ExplainResultView`; `RepoMultiDiffView` chevron button |
| UL8 | pressed look restated | `SearchOptionToggles` ×3, `AppToolbar:432,441`, `ReposDialog:312,403` (no look), `KeyBar`, `AdeNotesEditor` |
| UL9 | elevation | §1.3 V3 |
| UL10 | hand-built picker triggers | `EnvironmentSelect`, `MethodSelect`, `CellEditorView` (`nativeSelectVariants` on `<button>`), `EndpointChip`, `AdeStageMover`, split chevron `PullStrategyPicker:167`, `AppToolbar:380`, `BaseSelector`, `BranchPicker` |
| UL11 | two menu renderers | `ContextMenu.vue` (workbench model) vs `MenuSections.vue` (git `menuModel`, 2 callers) |
| UL12 | find bars | `ResponseFindBar` (183), `SearchToolbar` (372), `StreamSearchToolbar` (158), docker `LogsView` bar |
| UL13 | hand-rolled sub-bars | ~15 (list in audit; `PreviewCommandPanel:67`, `StreamComposeMessage:55` copy `PanelHeader`) |
| UL14 | read-only KV grids | 13 in 12 files |
| UL15 | grid tables with own headers | `VariableSetView`, `ResponseDiffDialog`, `GenerateDataDialog`, `EngineDiskSection` |
| UL16 | `EmptyState class=` | 49 in 32 files, padding 14 in 10; `EmptyState` in popovers `VariableHistoryMenu`, `VariablesOverviewPanel`; docker `ListState.vue` pass-through |
| UL17 | hover-revealed row actions | 6 (`TabStrip`, `ConsoleView` no focus reveal, `AdeBranchRow`, `ReviewCommitRow`, `ContainerTable`, `ImageList`) |
| UL18 | operation failure as `FieldError` | ~23 in 22 files (audit list) |
| UL19 | off-scale density | `gap-2.5` ×9, `px-2.5` ×15, one-offs `gap-0.25/1.25/1.75/3.5` |
| UL20 | pane frame recipe | 14 in 8 files; Monaco box radius split; `pre` code blocks `DbMcpApprovalDialog:109`, `DatabaseMcpPane:146,205` |
| UL21-22 | grey roles, titles | §1.3 V1, V4 |
| UL23 | mobile chip rebuilds | `NeedsScreen:99`, `PlanTaskCard:46` |
| UL24 | `RunState` own spin ring, `'—'`, `min-w-[7ch]` | 1 file, 22 callers |
| UL25 | cursor | §1.3 V2 |
| UL26 | widths off scale | `max-w-[90vw]`/`[80vw]` 5, `h-[60vh]` 2, `ErrorPopover` `max-w-[calc(100vw-8px)]` + extra border |
| UL27 | explicit `queryClient` in `.vue` (multi-line) | 8 files (`ScriptDialog`, `McpToolsField`, `McpServerTools`, `ScheduleConfirmDialog`, `ScheduleFields`, `RunScriptDialog`, `ScriptRunView`, `CookiesPane`) |
| UL28 | dialog header icon / visible header description | icons 5 (`DataGripImportDialog`, `FiltersDialog`, `ConnectionDialog`, `ReposDialog`, `SettingsShell :icon`); descriptions in header 3 (`RecreateConfirmDialog`, `ReplySheet`, `ReposDialog`) |
| UL29 | two prose recipes | `RepoFileView` `.md-reading`, `AdeNotesEditor` PROSE |
| UL30 | `CommandShortcut` `tracking-widest` | 1 |

### 1.2 Exemptions (EX)

- `check-ui-primitives.sh` PERMANENT: 59 lines (lines 91-149). Unifiable per EX audit: combobox
  cluster (AutocompleteField U36/U41/U47/U58, SearchBox U17/U47, SearchResults U47), chords (U41
  ConsoleSlickGrid, SlickGridHost, CellEditorView, AdeNotesEditor, git App, gridKeyboard; U47
  EnvironmentsView, VariableRow), U40 AdeWorkflowGraph, U57 RepoFileView, U42 scrollTrace (reason
  false: `copyOrReportError` catches the sync throw), U42 SlickGridHost, U52 scheduleText, U9
  BacklogScreen/TerminalScreen/AdeBacklogRow, U36 InlineEditInput, U27 ContextMenu swatch, U31
  WorkbenchShell, U36 DbMcpApprovalDialog/DatabaseMcpPane/FiltersDialog/ExplainResultView, U37
  AppearancePane, U26 reviewDecorations (reason false: file already mounts Vue via `createApp`),
  U37 SlickGridHost nav button, U38 RepoFileView, U25/U11 LogsView (merge into `LogLines`).
  Stale: U62 `CommitGrid.vue` (only comments match).
- Built-in exempt column (3rd field), never stale-checked: 13 entries hit nothing (U34 `ansi.ts`,
  U35 `/git-ui/src/App.vue`, `CommitGrid.vue`, `ReviewThread.vue`, U39 `codedError.ts`, U40/U41
  `useShortcut.ts`, U73 `CodiconIcon.vue`/`Spinner.vue` (theme not scanned), U79 `openExternal.ts`,
  U80 `ShowMoreButton.vue`, U82 `/lib/sha.ts`, U58 `floatingPosition.ts` redundant with `/kira-ui/`);
  U34 `/setiFileIcon` matches no path.
- Adding `T/` (minus `components/ui`) to `DIRS` today yields 21 hits (scratch run): owners
  (`SecondaryTabs` U4, `SearchField` U17/U62, `Spinner`/`StatusDot` U23/U27, `InlineState` U25,
  `rowVariants` U37, `i18n/number.ts` U52, `icons.ts` U73, `EmptyState.vue` U74, `SwatchRadio` U28)
  and real gaps (`AttributeTooltip` U11, `NumberStepperInput`/`VarText` U12, `RunState` U23/U59,
  `ScriptProgress` U25, `VarText` U26, `SwatchRadio` U10/U35, `wrapSelection.ts` U41,
  `NumberStepperInput` U9).
- `scripts/copy/exemptions.ts`: 8; `GrpcMetadataTable` (vocabulary into api-core) and
  `button/index.ts` (checker skips cva variant keys) go.
- `internal/conventiontest` G4: 9 named; 8 are test tooling (`flowharness`, `flowtest`,
  `ipcfixture` packages).
- Suppressions: `biome-ignore lint/a11y/useFocusableInteractive` 11 in 8 files (`GitPanel`,
  `RepoSearchRow`, `ContainerList`, `ContainerTable`, `ImageList`, `NetworkList`, `VolumeList`,
  `FileTree`); `noExplicitAny` in `copy-coverage-docker-automations.spec.ts:20`,
  `copy-wording-docker-automations.spec.ts:40`, `docker-edit.spec.ts:38` (same contract JSON),
  `scripts/copy/sourceRules.ts:34`, `scripts/check-class-conflicts.ts:140` (compiler AST).

### 1.3 Visual dimensions (V)

| # | Item | Count now |
|---|---|---|
| V1 | `text-muted-foreground` / `text-subtle` | 545 / 264 hits; role split per audit |
| V2 | `cursor-pointer` / `cursor-default` / help+copy | 69 in 48 files / 38 / 2 (`ColumnsSection:97`, `UndoButton:52`); primitives `Switch`, `tabs/index.ts`, `native-select/index.ts`, `rowVariants` `menu`, `TreeTwisty`; dead `ReviewCommitRow:217` |
| V3 | `z-50` in primitives, stock `shadow-md` | 8 + Tooltip arrow; `PopoverContent:46` `shadow-md`; app drift `AdePlanView:327`, `ReviewCommentsPane:161`, git `App.vue` drawer `z-20` |
| V4 | `<h1-6>` | 27 in 18 files (Settings panes `GitPane`, `MobileAccessPane`, `RepoConfigForm`, `CookiesPane`, ADE empty lines at title size) |
| V5 | header icons, header descriptions, double emphasis | 5 / 3 / `CheckoutDialog:136-146` |
| V6 | `TruncatedText` importers / tooltip-wrapped truncate / three-class spelling | 0 / 33 in 24 files / 57 in 36 files |
| V7 | `dialog`/`dialog-primary` no hover; hover tone overrides; opacity-as-muted; readonly look; `writeDisabledReason` copies | 2 variants; 7 `hover:text-*` in 3 files (+ paired `text-ok hover:text-ok`); 10 in 7 files; 0; 2 |
| V8 | `Button :pending` / `:disabled` on busy flag / Spinner in Button / `InlineState loading` without delay | 1 / 61 in 47 files / 5 in 4 / 11 in 10; mobile text-only loading 3 |
| V9 | local formatters | `AppMetricsItem:24-25`, `AdeTaskCard:194`, `PlanTaskCard`, `RunState:32-35`, `ScriptProgress:34-42`, `KeyValuePane` `ttlText`, `TimelinePane` `formatHopMs`, `runText.ts` `costText`; Go `s3/read.go:20` |
| V10 | identifiers in UI font, 3 copy mechanisms | ~20 sites |
| V11 | sort | worktree orders 2; bare `.sort()` 4; no tie-break 6 |
| V12 | `t()` groups only `count`; unit spacing; MiB/GiB; "(n)" in labels | 1 file; 2 keys; 2 docker keys; 5 HTTP keys + `SearchResults:89` |
| V13 | icon size | non-scale `:size` 2 (theme), `:icon-size` 15 ×3 (`WorkbenchTitleBar`), unsized `CodiconIcon` 5 in 4 files, raw `codicon` spans 4 |
| V14 | counts | plain counts as `Badge count` 5; tab count pills 2; `tabular-nums` 2 uses; `CollectionRow` chip `tracking-wide` |
| V15 | tooltips | `AttributeTooltip` `font-semibold`; `TooltipArrow` `rounded-xs` |

### 1.4 Behaviour dimensions (B)

| # | Item | Count now |
|---|---|---|
| B1 | right-click without select | 10 handlers (`KeyValuePane:573`, `DocumentView:720`, `StreamView:214`, `ColumnsSection:38`, `OpLogPanel:151`, `AutomationsPanel:234` ×3, `ContainerList:193`, git `TagList`, `StashRows`, `BranchPicker` ×2); docker Enter vs double-click `ContainerTable:54,92`, `ContainerList:295` |
| B2 | drag | keyboard reorder 2/7 surfaces; no Esc cancel; `chosenClass` literal `AdeDayBand:57` |
| B4 | save chord | `form.save` bound 2 sites; `api.save` no chord; doc/cell/KV editors none |
| B5 | unsaved guard | tab close never asks; 25 form dialogs, 0 dirty guards |
| B6 | busy | = V8 |
| B7 | validation timing | 4 models (`ScriptDialog shown`, `ConnectionDialog fieldErrors`, docker `editDiff` live, `KeyValuePane nameRequired`) |
| B8 | persistence | raw `useLocalStorage<T>(` 5 (`K/repo/state/search.ts`, `K/state/workspace.ts`, `D/queries.ts`, `D/state/dockerUi.ts`, `W/automations/runs/runsQueries.ts`); memory-only trees `S/api/state/collections.ts:122`, `K/repo/state/fileTree.ts` |
| B9 | timers outside `TIMING` | 14 named consts + 3 inline (list §2.5 B9) |
| B10 | API naming | kebab emits 10; hand v-model 27 emits in 11 files; `*TestId` 14 in 4 files; `busy`/`loading` props 4; `hint` 2; `cancel`/`dismiss` emits 5; `pick` 3; slot `action` 1; `readOnly` 1 |
| B11 | server state in refs | `FilterHistoryMenu`, `ConsoleSavedMenu`, `StreamView` partitions |
| B13 | env vars | 20 `KIRA_*` names in Go with no `docs/*.md` mention |
| B14 | duplicate specs/helpers | automations specs ×4 pairs (diff 16/67/13/10 lines); `tid` ×6, `openPanel` ×6, `openDocker` ×4, `openHttpMode` ×3, `connectAndOpenGrid` ×3, `connectAndExpand` ×3, `installClipboardSpy` ×2 |
| B15 | log scopes | 13 non-camel scope strings + 5 `RepoScopedReload` PascalCase names |
| B16 | layout | `G/components/*.ts` 24; menu builder names 11 variants; `K/ade/state/` 1 file; `.vue` > 600 lines 19 |
| B17 | shortcuts | Browse dead hints (`menu.ts:35,102`); Delete chord split (`AdeWorkflowGraph:239`); Ctrl+R alias (`gridKeyboard.ts:96-105`); tree chords Studio-only; `ade.reviewCode` window keydown (`AdeShell`) |
| B18 | virtualization | fixed row heights 4 (`BrowseView:262`, grpc `ResponsePane:171`, `AdeChangesTab:34`, `ImportJobDetail:28`); cap mechanisms 3 (`useCappedList`, git `capRows`, `FILTER_ROW_CAP`); `AdeChangesTab` commits unbounded |
| side | `connectionsReorder` | TS wrapper `S/bridge/index.ts`, Go `ConnectionsService.Reorder`, `connections.Service.Reorder`, `ConnectionsRepo.Reorder`; callers only tests (`connections/service_test.go:1423`, `repos/connections_test.go:73,77`, `dbflow/sqlite_test.go:249`) and mock channel lists |

## 2. Decisions (final)

### 2.1 Primitives (theme, `T/`)

- **Button** (`ui/button/index.ts`): sizes `status` (`h-control-sm gap-1 px-1.5 text-kira-sm
  font-normal`), `touch` (`h-touch px-4 text-kira-touch`), `touch-icon` (`size-touch`), `inline`
  (`h-auto p-0`). `toolbar` gains `aria-pressed:bg-field aria-pressed:text-fg`. `dialog` gains
  `hover:bg-hover`, `dialog-primary` `hover:bg-primary/80`. `ghost` drops `dark:`; allowed only in
  `DialogHeader` close. `link` colour `text-primary`, cursor pointer. Why: one size per role, no
  per-site class.
- Touch: explicit `touch`/`touch-icon` sizes on mobile; `pointer-coarse:` only inside shared
  primitives (`DialogHeader`, resizable). Why: mobile screens know they are touch.
- **Input/Textarea** (`inputVariants`, textarea cva): sizes `touch`, appearance `inline` (bare until
  focus, `focus-visible` border); `read-only:bg-transparent read-only:border-border`.
- **Card** variant `list` (`rounded-kira-sm border p-1`, no fill). **CodeBlock.vue** (Card +
  `font-data text-kira-sm whitespace-pre-wrap break-all`). `paneFrame` class constant in
  `T/components/frames.ts`. Embedded Monaco box `rounded-kira-sm`. Why: an editor in a form is a
  field; fields use `-sm`.
- **KeyValueList.vue** (`<dl>`, `grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1`, `dt`
  `text-muted-foreground`). `tableHeadClass` exported from `ui/table` for grid tables.
- **Disclosure.vue** on shadcn-vue `Collapsible` (added with the shadcn-vue CLI into
  `T/components/ui/collapsible`), chevron 12 like `SectionHeading collapsible`. Rows keep
  `TreeTwisty`.
- **HighlightedText.vue**: props `parts: readonly {text, match}[]`, `current?`; match
  `rounded-kira-xs bg-search-match`, current `bg-search-match-current`. Callers compute parts with
  `splitMatches` (W). Why: theme cannot import workbench.
- **PickerTrigger.vue** (label, optional leading dot/icon slot, `chevron-down` 12, size `kira`/
  `kira-lg`) and **SplitButton.vue** (primary Button + chevron Button, shared border).
- `rowVariants.ts`: `rowActions` (`opacity-0 group-hover:opacity-100 group-focus-within:opacity-100`)
  and `rowMeta` (`text-kira-sm text-muted-foreground tabular-nums`) constants; `menu` layout
  `cursor-default`.
- **EmptyState**: default padding `p-6`, prop `fill?: boolean` (`h-full`), prop `loading?: boolean`
  (Spinner 24 media, shown after `SPINNER_DELAY`). **InlineState** `kind="loading"` waits
  `SPINNER_DELAY`. `T/timing.ts` exports `SPINNER_DELAY = 300`; W `TIMING.spinnerDelay` reads it.
  Popover empty lines use `InlineState`. Docker `ListState` inlined.
- **RunState**: running = `Spinner` 12; error = `StatusDot` error; idle = no mark; label via
  `displayValue`, `tabular-nums`, no `min-w-[7ch]`. Why: one spinner motion.
- **DialogContent** `dirty?: boolean`: while dirty, `pointer-down-outside` is prevented; Esc and the
  header X ask the discard confirm through an injected `confirmDiscard` (key in
  `T/components/ui/dialog/discard.ts`, provided by workbench `bootstrapShell` from the confirm store,
  catalog `common.discard.*`), then close via reka's dialog root context. Footer Cancel never asks.
  Why: theme cannot import the confirm store.
- **DialogHeader** loses `icon`. Visible `DialogDescription` lives in `DialogBody` (sr-only header
  description in `CommandDialog` stays).
- **CodiconIcon** `size: 12 | 13 | 16 | 24` required; `TooltipIconButton iconSize` same type;
  `TooltipIconButton` `tone?: 'ok' | 'error'`, `pressed` drives `aria-pressed` only (look from the
  `toolbar` cva). Sizes: 12 chips/steppers, 13 default, 16 mode tabs and title bar, 24 empty media.
- **Elevation**: Popover `z-(--kira-z-popover)` + `shadow-kira`; Dialog, overlay, CommandDialog
  `z-(--kira-z-dialog)` + `shadow-kira-dialog`; DropdownMenu (+Sub) `z-(--kira-z-menu)` +
  `shadow-kira`; Tooltip (+arrow) `z-(--kira-z-tooltip)`, no shadow; autocomplete 350
  `shadow-kira`; error popover `shadow-kira`; drawer `shadow-kira-dialog`. In-pane layers `z-1..3`.
  `TooltipArrow` `rounded-kira-xs`. `AttributeTooltip` title `font-medium`.
- **Prose**: one `.kira-prose` layer in `T/base.css` (em scale kept), used by `RepoFileView` and
  `AdeNotesEditor`.
- **Formatters move down**: `T/format.ts` holds `formatBytes`, `formatPercent`, `formatDuration`
  (adds sub-ms two decimals), `formatElapsed`, `formatCompactDuration` (new: `5s`, `2m`, `2m 5s`,
  ceil option for TTL), `formatCurrency(usd)` (new, `Intl.NumberFormat` currency USD),
  `formatZonedWeekdayClock` + `localTimezone` (new, for `scheduleText`), `displayValue`;
  `formatCount` stays in `T/i18n/number.ts`. `W/behaviour/format.ts` re-exports them and keeps the
  reactive ones. Go `s3.formatBytes` matches TS (no decimal at 100+).
- `t()` formats every numeric param with `formatCount`; plural still selected by `count`.
  Durations and ages: no space (`240ms`, `3.4s`); sizes keep a space (`1.2 KB`); percent none.
  Bytes `KB/MB/GB` on the 1024 base everywhere (docker `mib`/`gib` options become `MB`/`GB`).
- `ui/command/CommandShortcut.vue` drops `tracking-widest`.

### 2.2 Workbench (`W/`)

- **MenuItems.vue**: renders workbench `MenuItem[]` (item, submenu, separator, label) as
  DropdownMenu items; used by `ContextMenu.vue` and every anchored action dropdown. `MenuItem` gains
  `detail?: string` (second line). Disabled reason: hover tooltip plus `aria-describedby` sr text.
  git `MenuSections.vue` deleted; callers map through `sectionsToMenuItems`. Radio and checkbox
  pickers stay `DropdownMenuRadioGroup`. Swatch items use `colorMarkClass` mark `swatch` (new
  `MARK_SHAPE` entry, size-2.5).
- **FindBar.vue**: shell (`ViewToolbar bg-elevated`, `w-52` SearchField, `SearchOptionToggles`
  slot, count slot, prev/next, close) over `useFindBar`. Views supply matcher and count.
- **Identifier.vue** (in W, not T: copy needs `useCopy`): `font-data`, `TruncatedText`
  (`split="path"` for paths), `short` formatter prop (`shortSha`, docker `shortId`), `copyable` adds
  a trailing copy `TooltipIconButton` with check swap. Menus keep "Copy …" items.
- **TruncatedText** gains `split?: 'path'` (dir `truncate`, name `shrink-0`), ported from
  `RepoMultiDiffView:151`. Single-line overflow spelling is `truncate`.
- **LogLines.vue**: ANSI segments (`parseAnsi` moved to `W/lib/ansi.ts`, `anser` dep moves to
  workbench), `wrap` prop, per-line slot. Docker `LogsView` becomes toolbar + `LogLines`; run logs
  gain ANSI. Why: one log viewer.
- **AutocompleteField.vue** onto reka `Popover`/`PopoverContent` with a virtual caret anchor
  (`PointPopover` pattern) and `@open-auto-focus.prevent`; keyboard via `useActiveDescendant`.
  `packages/kira-ui` deleted. Ctrl+Space via `editor.suggest`.
- `behaviour/`: `useActiveDescendant` (ArrowUp/Down/Enter/Escape, `aria-activedescendant`),
  `useFormErrors(rules)` (error shows after first change or submit attempt; submit with errors
  reveals all, calls `onTab(tab)` for the first invalid field's tab, focuses it; returns
  `errorFor(field)`, `invalidAttrs(field)` = `aria-invalid` + `aria-describedby`),
  `splitMatches` (in `match.ts`), `revealElement(el, { block })`, `readClipboardText()`,
  `isEditableTarget(target)` (one test, replaces 4 copies), `useTreeShortcuts(nav, actions)` (binds
  `tree.*` ids once; also used for printed hints), `useSortableReorder` `keyboard: true` (Alt+Up/
  Down, Alt+Left/Right when horizontal, via `list.move*` ids) and Esc cancel (restore pre-drag
  order), `SORTABLE_CHOSEN_CLASS`, `useListNavigation(...).contextMenu(item, event, items,
  options)` (sets `activeKey`, `onSelect`, opens the store menu with `onRestoreFocus`).
- `shortcuts/`: `keys.ts` exports `isPrimaryModifier(e)` (Cmd on mac, Ctrl elsewhere); matcher
  honours literal `ctrl`. `useShortcut` gains `ignoreTextFields` (checked before `preventDefault`).
  `SHORTCUTS` (`packages/shared/domain/shortcuts.ts`) gains scope `list` with `list.moveUp`,
  `list.moveDown`, `list.moveLeft`, `list.moveRight` (Alt+arrow) and `editor.suggest`
  (`{ key: 'Space', ctrl: true }`). Refresh is F5 only.
- `TIMING` new keys: `pollHourly: 3_600_000`, `runTick: 200`, `reconnect: 3000`. Mapping in §2.5 B9.
- **Tabs** (`createTabsStore`): `KindLookup` and `TabKindDef` gain `isDirty?(tabId)`;
  `closeTab`/`closeOthers`/`closeToTheRight`/`closeAll` ask `confirm({ tone: 'danger',
  confirmLabel: common.discard })` when any closing tab is dirty, and become async. Studio: `data`
  dirty = pending grid changes; `document`/`keyvalue` dirty = edit buffer dirty.
- `lib/rowHeight.ts` exports `ROW_HEIGHT_PX: Record<RowDensity, number>`; `createSettingsStore`
  and `AppearancePane` use it.
- `testing/ui/`: `tid(page, id)`, `ContractJson` type in `contract.ts`; shared-module scenarios in
  `testing/ui/scenarios/<module>.ts`.
- `api-core`: `grpc/metadata.ts` `metadataValueCompletions` beside `headerValueCompletions`.
  `git-core`: `lib/worktreeOrder.ts` `orderWorktrees` (current, main, then `compareNatural(path)`).

### 2.3 Visual rules (apply in every touched file)

- Grey: `text-muted-foreground` = secondary content (row meta, KV keys, secondary labels and
  values, timestamps, counts, icons, `DialogDescription`, footer/bar status); `text-subtle` =
  tertiary chrome (section headings and legends, `FieldDescription`, empty and inline-state lines,
  placeholders, NULL markers, separators, row numbers); `text-disabled` absence markers. Hand hint
  `<p class="text-kira-sm text-…">` becomes `FieldDescription`; hand empty lines become
  `InlineState kind="empty"`/`EmptyState`.
- Cursor: `cursor-default` on every control and row; pointer only `Button variant="link"`,
  `linkify.ts` anchors, PR badge link (`badgeClass.ts`); `grab` on drag handles; `text` in fields;
  no `help`/`copy`.
- Titles: view/detail title `text-kira-lg font-medium text-fg` (`truncate` in bars, `line-clamp-2`
  in heads); section = `SectionHeading` (pane, panel, list, picker) or `FieldSet`+`FieldLegend`+
  `FieldDescription` (form, settings pane); nothing else.
- Dialog: one emphasised footer button (`CheckoutDialog`: stash path `dialog-primary`, discard
  `dialog`).
- States: tone on icon buttons via `tone`; muted via `text-muted-foreground`/`rowVariants muted`,
  never opacity (opacity only `disabled:opacity-50` and drag ghost); disabled-and-enableable
  controls explain why (icon `disabled-trigger`; labelled `TooltipDisabledTrigger`); pending uses
  `Button pending`, no tooltip. `writeDisabledReason` lives once in `S/views/shared/writeGate.ts`.
- Loading: one delay for every placeholder; mobile uses `QueryState` defaults.
- Counts in a tab, section or row = plain `rowMeta` (`SecondaryTabs count`, `SectionHeading count`);
  `Badge count` only for attention (needs you, unread, conflicts). Method chip `Badge chip` with
  fixed width, no tracking. No "(n)" in label text.
- Identifiers (ids, shas, branches, refs, paths) always `font-data`, through `Identifier` where
  shown as a value.
- Sort: every comparator ends on a stable key: names `compareNatural(name)` then id; recency
  `desc time`, then `compareNatural(name)`, then id. No bare `.sort()`.
- Density: scale `0.5, 1, 1.5, 2, 3, 4`; no `0.25/1.25/1.75/2.5/3.5` outside the P129 board
  canvas. Why: `gap-2` is used across every module, so it stays on the scale.
- Widths: dialogs use size variants only (TextPromptDialog uses `dialogContentSizeVariants`);
  popovers `w-56/80/96/120/auto`; tall dialogs `fixed-height`.
- Operation failure (dialog or pane action) = `Alert variant="error"` in the body; `FieldError`
  only under a field or as a one-line footer `#start` status. Two run logs show errors through
  `LogLines` `error`.

### 2.4 Exemption triage

- PERMANENT keeps only real requirements. Target after close-out (24 lines): U11 `LogLines.vue`
  (ANSI bold is log data), U34 `EngineIcon`, `OriginIcon`, `MobileQr`, U36+U37 `ConnectionDialog`
  radio tile, U37 `AdeTaskCard` (P129 board), U46 `bridge/port.ts`, `graph/layoutClient.ts`, U41+U62
  `MonacoHost`, U62 `slick/editor.ts`, `ConsoleView` (Monaco focus), `RepoFileView`, `RepoDiffView`,
  `AdeNotesEditor` (TipTap), `AutocompleteField` (caret restore), U52 `celleditor/timestamp.ts`, U47+
  U62 `FieldRowsTable`, U60 `AdeDayBand`, U47 `gridKeyboard.ts` (reason reworded: PageUp/PageDown
  over a streamed 100k-row store), U82 `useAdeWrites.ts`, U41 `T/wrapSelection.ts` (modifier-free
  typing guard, not a chord). New guards add entries only with a reason.
- Built-in exempt column becomes stale-checked: a name entry that exempts nothing fails; `/dir/`
  blankets opt out with a trailing `!` marker (`/behaviour/!`). 13 dead entries deleted; U34
  `/setiFileIcon` fixed to the real path or deleted.
- `scripts/copy/exemptions.ts` 8 → 6. Copy checker skips cva variant-object keys.
- `conventiontest`: G4 skips packages named `flowharness`, `flowtest`, `ipcfixture` (path rule);
  named exemption keeps only `gitsession/incremental.go`.
- `biome-ignore lint/a11y/useFocusableInteractive` ×11: rows bind `:tabindex="nav.tabindexFor(key)"`
  explicitly (or `v-bind="nav.rowProps(key)"`); the 13 `useKeyWithClickEvents` stay (roving
  tabindex). `ContractJson` replaces the 3 spec `any`s; `sourceRules.ts` and
  `check-class-conflicts.ts` use `@vue/compiler-core` `TemplateChildNode`/`ElementNode`/`NodeTypes`.

### 2.5 Behaviour rules

- **B1** A row's context-menu handler selects (or focuses, in focus-only lists) before opening,
  through `nav.contextMenu` where the list uses `useListNavigation`; grids and virtual lists
  without it select by their own selection call first. Docker: click selects, double-click and
  Enter open the same tab (`logs`).
- **B2** Grip handle when the row holds inputs or buttons; whole-item drag for chips and tabs.
  Every `useSortableReorder` caller passes `keyboard: true`. `AdePlanView dragOverDay` stays (board).
- **B4** Every explicit-Save surface inside a tab binds `form.save` with `useShortcut` (HTTP, gRPC,
  document edit, cell editor, KeyValue edit); dialogs keep `form.submit`; palette `api.save` shows
  `form.save`.
- **B5** Tab dirty guard + `DialogContent :dirty` on all 25 form dialogs (`CopyAsCurlDialog` is
  read-only output: named exemption) and `SettingsShell`. Quit keeps no guard (P266 §2.7): Known
  open item "Quit discards staged grid edits and dirty edit buffers".
- **B6** Async buttons bind `:pending` to `useAsyncAction().pending` or `mutation.isPending`;
  `:disabled` never carries a pending flag; busy flags come only from those two sources.
- **B7** `useFormErrors` in `ConnectionDialog`, `ScriptDialog`, `SaveRequestDialog`, `KeyValuePane`
  add/edit, docker `ContainerEditView` (was live from first render), git `TagDialog`/`BranchDialog`/
  `WorktreeDialog` where they validate. `SettingsShell` keeps live errors (draft UI). Every
  `FieldError` under a field pairs with `aria-invalid` + `aria-describedby` on the control. No guard
  (footer status `FieldError` makes a file-level regex wrong).
- **B8** In-memory trees persist expanded keys with `usePersistedState('kira.<module>.expanded',
  [])` (Studio collections tree, Space repo file tree); lazy IPC trees (Studio project tree) do not
  restore (ARCHITECTURE). Raw `useLocalStorage<T>` sites move to `usePersistedState`.
- **B9** Every debounce, poll, tick, UI delay is a `TIMING` key: `COOKIES_FETCH_DEBOUNCE_MS` →
  `preview`; `SCHEMA_DEBOUNCE_MS`, blame `DEBOUNCE_MS` → `search`; `WRITE_DEBOUNCE_MS` ×2,
  `MODE_WRITE_DEBOUNCE_MS`, `agentNotify` 150 → `persist`; `HOVER_DELAY_MS`, Monaco `hover.delay` →
  `hoverInfo`; git `pr.ts` 300, docker `RESUBSCRIBE_DEBOUNCE_MS` → `preview`; `POLL_MS` →
  `pollHourly`; `RUN_TICK_MS` → `runTick`; mobile reconnect → `reconnect`; `CAPTION_DELAY_MS` →
  `spinnerDelay`. Stay local with a one-line reason: `DAY_MS` ×2, `bridge/port.ts`
  `DEFAULT_TIMEOUT_MS`, `REVEAL_GRACE_WINDOW_MS`, `CHASE_QUIET_MS`, git `AUTO_REFRESH_*`,
  `LOADED_SCAN_*`, `RELEASE_RETRY_MS`.
- **B10** Emits camelCase; v-model is `defineModel` only; in-flight prop `pending`; secondary text
  prop `description`; testid props `…Testid`, root `testid`, families `testidPrefix`; dismiss emit
  `close`, choice emit `select`, action slot `actions`; `readonly` (DOM spelling).
- **B11** `FilterHistoryMenu`, `ConsoleSavedMenu`, `StreamView` partitions on `useQuery` +
  `useMutation` with invalidate.
- **B12** Reveal channel names unchanged. Why: audit rates it no-action; a wire rename for no user
  gain.
- **B13** `DEV_ENVIRONMENT.md` gains one `KIRA_*` table (every name in Go, purpose, who sets it).
- **B14** Shared-module scenarios in `W/testing/ui/scenarios/<module>.ts`; each app's spec passes
  its boot and fixtures. A helper used by 2+ specs lives in `support/` (or `W/testing/ui` across
  apps).
- **B15** Log scope = camelCase module id, optional `.sub`; background failures warn, user-visible
  feature failures error, info only for state transitions (TS and Go; Go documented, no re-level
  sweep). `RepoScopedReload` uses workbench `fireAndForget` with camel ids (`gitRefs`, `gitOps`,
  `gitStash`, `gitStack`, `gitWorktrees`).
- **B16** `components/` holds `.vue` only (git-ui's 24 `.ts` move to `G/lib/`); a feature with one
  store file uses `state.ts`, two or more `state/` (`K/ade/state/` → `K/ade/state.ts`); menu
  builders are one `menu.ts` per feature (`menus.ts` ×3, `menuItems.ts`, `resultMenu.ts`,
  `columnsMenu.ts`, `board/{task,day,fix}Menu.ts` renamed or merged). `.vue` over 600 lines is split,
  or named as an engine host or shell: `SlickGridHost`, `ConsoleSlickGrid`, `CommitGrid`,
  `MonacoHost` (engine hosts), git `App.vue` (shell). The 14 others split in this phase (§5.2).
- **B17** Every printed shortcut is bound on that surface; trees and lists with rename, delete or
  copy-name use `useTreeShortcuts`; Delete is `tree.delete` everywhere (workflow graph via
  `useShortcut … { ignoreTextFields: true }`); F5 only (git Ctrl+R dropped); global chords go
  through Go menu items in both apps (`ade.reviewCode` joins the Space menu with accelerator).
- **B18** Render cap 500 through `useCappedList` (step 500) for picker and tree sections, ref
  sections 50; `AdeChangesTab` commits virtualize; row height from `useRowHeight()` unless named
  fixed (OpLog 18, docker logs 18, measured document rows).
- **connectionsReorder**: delete (TS wrapper, mock channel entries, Go bridge method, service
  method, repo method, their tests and the dbflow step). Why: no spec row asked for user-ordered
  connections and the lazy project tree has no reorder UI; building it is a feature, not
  unification. `sqlitex.ReorderSortOrder` stays (variables).

## 3. Guards (land in R, §6.2)

`check-ui-primitives.sh` changes: `DIRS` += `packages/theme/src` (scan skips
`packages/theme/src/components/ui/`), `packages/kira-ui/src` removed (F3). Extended: U21 kind `v`
(built-in exempt `PanelHeader.vue` kept); U43 `use(?:Local)?Storage(?:<[^>]*>)?\(`; U46 adds `const \w*(?:DEBOUNCE|DELAY|
POLL|TICK|INTERVAL)\w*_MS\s*=\s*\d` and `(?:debounce|delay):\s*\d{2,}`; U47 accepts
`useActiveDescendant`; U51 `const \w*(?:[Bb]usy|[Pp]ending|[Ss]aving|[Ll]oading|[Ss]ubmitting|
[Rr]unning|[Dd]eleting)\s*=\s*ref`; U53 `,\s*queryClient\s*,?\s*\)` (vue); U76 adds `chosenClass:`;
U80 kind `vt` adds `capRows\(|_ROW_CAP\b`. U21 built-in exempts add `SectionHeading.vue`,
`FieldLegend.vue` (theme, now scanned; owners); `SavedListMenu.vue` moves its header onto `SectionHeading`
(A1). New (worklist regex = guard; streams run them as
worklists over owned dirs, §5.4):

| Id | Files | Flags |
|---|---|---|
| U83 | v | `variant="ghost"` or `'ghost'` |
| U84 | v | `<Button` class with `h-touch`, `size-touch`, `h-control-sm`, `h-auto p-0` (sizes own them) |
| U85 | v | `<EmptyState` class with `p-`, `px-`, `py-`, `h-full`, `flex-1` (use `fill`) |
| U86 | vt | `z-(\d{2,}|\[)` (tiers use the token ladder; in-pane `z-0..3`) |
| U87 | v | `<details\b` (use `Disclosure`) |
| U88 | vt | `(?:gap|gap-x|gap-y|p|px|py)-(?:0\.25|1\.25|1\.75|2\.5|3\.5)` (board files: named PERMANENT, reason P129) |
| U89 | vt | `cursor-pointer` outside `linkify.ts`, `badgeClass.ts`; `cursor-(?:help|copy)` |
| U90 | vt | `hover:text-(?:ok|error|warn|primary)`; `opacity-(?:40|60|70|75|80)` |
| U91 | vt | `overflow-hidden text-ellipsis whitespace-nowrap`; `<TooltipTrigger…>\s*<(span|div|button)…\btruncate\b` (use `TruncatedText`) |
| U92 | v | `<Button…:disabled="…(pending|isPending|busy|saving|loading|running|installing|committing)…"` (use `pending`); `<Spinner` inside `<Button>` |
| U93 | vt | `toFixed\(` outside `/theme/src/format.ts`; `\}\}%` |
| U94 | v | `<h[1-6]\b` without both `text-kira-lg` and `font-medium` in its class |
| U95 | v | `<p\b…class="…text-kira-sm…text-(?:muted-foreground|subtle)` (use `FieldDescription`) |
| U96 | v | file with `useListNavigation(` and `@contextmenu=` but no `.contextMenu(` |
| U97 | v | `defineEmits<\{[^}]*'[a-z]+-[a-z]`; `'update:modelValue'`; `\b\w+TestId\b` |
| U98 | vt | `rowHeight:\s*\(\)\s*=>\s*\d` or `const \w*ROW_HEIGHT\w*\s*=\s*\d` outside `rowHeight.ts` (fixed ones named) |
| U99 | vt | first arg of `logWarn(`/`logError(` or last arg of `fireAndForget(` not `'[a-z]+(?:[A-Z][a-z0-9]*)*(?:\.[a-z][A-Za-z0-9]*)?'` |
| U100 | v | `<DialogContent` file holding `<Input|<Textarea|<MonacoHost|<AutocompleteField|<NativeSelect` without `dirty` on `DialogContent` |
| U101 | v | `<Badge…variant="count"` outside attention owners (built-in: `AdeShell.vue`, `TabStrip.vue` and any attention site R confirms) |
| U102 | v | `shortSha\(|shortId\(` in a `.vue` (use `Identifier :short`) |
| U103 | vt | `\.sort\(\)` |

`check-theme-classes.sh`: stock `shadow-(?:sm|md|lg|xl|2xl)`. Typecheck enforces icon sizes and the
removed `DialogHeader icon`.

`check-conventions.ts` (+ `check-conventions.spec.ts` cases, the guard's own parser spec): N8 a
`function <name>`/`const <name> =` declared in 2+ spec files, or shadowing an export of
`tests/*/support/**` or `W/testing/ui/**`; N9 a non-spec `.ts` under a `components/` dir in
`packages/*/src` outside `components/ui`; N10 a `.vue` over 600 lines without a named exemption
(the 5 hosts); N11 every `shortcut: '<id>'` in a `menu.ts` has `<id>` referenced in a
`useShortcut`/`shortcutFor`/`useTreeShortcuts` call in the same feature dir, unless its scope is
`global`; N12 a `state/` dir with one non-spec file, or a menu-builder file not named `menu.ts`
under `apps/*/frontend/src` (`use*Menu.ts` composables excepted).

## 4. Foundation

Ownership (streams never edit these; needs go to the stream findings file): `T/**`, `W/{behaviour,
shortcuts,bridge,testing,lib,tabs}/**` except `W/testing/ui/scenarios/**` after F3,
`W/state/{createTabsStore,createSettingsStore}.ts`, `W/host.ts`, `W/bootstrapShell.ts`,
`W/components/{MenuItems,ContextMenu,FindBar,LogLines,AutocompleteField,SearchOptionToggles,
Identifier,QueryState,WorkbenchShell,PointPopover}.vue`, `W/package.json`, `packages/kira-ui/**`,
`packages/shared/domain/shortcuts.ts`, `p/api-core/src/grpc/metadata.ts`,
`p/git-core/src/lib/worktreeOrder.ts`, `internal/conventiontest/**`, `scripts/**` (streams may
only delete PERMANENT and `copy/exemptions.ts` lines naming their own files), `biome.json`,
`knip.json`, root `package.json`, `bun.lock`, `docs/ARCHITECTURE.md`, `docs/DEV_ENVIRONMENT.md`,
`docs/v2.2/SPEC.md`, this plan.

### 4.1 F0 (main checkout)

1. en.json seeds, one key each so writers merge cleanly: `common.discard.title`,
   `theme.disclosure.toggle.label`, `theme.identifier.copy.label`, `workbench.findBar.seed.label`,
   `format.currency.seed`. Streams and F1/F2 delete a seed when adding a real key in its object.
2. Regroup the PERMANENT heredoc by owner, in this order, each group under a `# <owner>` comment
   line: foundation, A (`apps/kira-studio`), B (`apps/kira-space`, `W/memory`), C (rest). No line
   changes. Why: a stream deletes only lines in its group; a rebase conflict there means "apply both
   deletions".
3. Commit `chore(p267): catalog seeds, exemptions grouped by owner`. Hook green.

### 4.2 F1, F2 (parallel, zero overlap)

| Task | Where | Owns (only these) |
|---|---|---|
| F1 theme | main checkout | `T/**` (en.json objects `theme`, `format`, `common.discard`); call-site edits forced by type changes: `DialogHeader icon` removal in `DataGripImportDialog`, `FiltersDialog`, `ConnectionDialog`, `ReposDialog`, `W/components/SettingsShell.vue`; icon-size fixes in `W/components/{WorkbenchTitleBar,TitleBarWindowActions}.vue`, `D/components/ExecView.vue`; unsized `CodiconIcon` in `S/views/httprequest/HttpRequestView.vue`, `G/components/{CommitMeta,SearchResults,FileTree}.vue` (size only) |
| F2 workbench | `/home/user/kira-p267-f` (branch `p267-f`) | the W foundation files above except `QueryState`, `WorkbenchShell`, `bootstrapShell`; `packages/shared/domain/shortcuts.ts`; `p/api-core/src/grpc/metadata.ts`; `p/git-core/src/lib/worktreeOrder.ts` (+ index export); `W/package.json`; en.json object `workbench.findBar`, `workbench.identifier` |

No ordering dependency: F1 touches no W foundation file (its forced edits are in files F2 does not
own); F2 consumes only theme APIs that exist today (`SearchField`, `TruncatedText`, dropdown
primitives, `TooltipIconButton`); `HighlightedText` takes parts (no `splitMatches` import);
`T/format.ts` is created by F1 and re-exported by F3.

**F1 theme.**

1. Button, Input/Textarea, Card `list`, `CodeBlock`, `frames.ts`, `KeyValueList`, `tableHeadClass`,
   Collapsible (shadcn-vue CLI) + `Disclosure`, `HighlightedText`, `PickerTrigger`, `SplitButton`,
   `rowActions`/`rowMeta`, `rowVariants menu` cursor, `Switch`/`tabs`/`native-select` cursor-default
   (`W/components/TreeTwisty` is C6's), `EmptyState`
   (`fill`, `loading`, `p-6`), `InlineState` delay, `T/timing.ts`, `RunState`, `ScriptProgress`
   (`formatCompactDuration`, `CodiconIcon`, `FieldError`), `DialogContent dirty` + `discard.ts` +
   `DialogHeader` X routing + `icon` removal, elevation and shadows (§2.1), `CommandShortcut`,
   `AttributeTooltip`, `TooltipArrow`, `.kira-prose` in `base.css`, `connColor` mark `swatch`,
   `CodiconIcon`/`TooltipIconButton` size types + `tone`, `TooltipIconButton pressed` via cva,
   `SearchField` returns early when `e.defaultPrevented` on Escape, `NumberStepperInput`,
   `VarText`, `SwatchRadio` (U10/U35 via `Label`/focus-ring), `T/format.ts` (§2.1), `t()` numeric
   params, `format.duration.*` spacing keys.
2. `usePaneResize`: while dragging, `document.documentElement` gets the axis resize cursor class
   (shell-wide), removed on end/abort.
3. Commits per group (`feat(theme): …`), `bun run typecheck`, `bun run lint` each.

**F2 workbench.**

1. `MenuItems.vue`, `ContextMenu.vue` on it (swatch via `colorMarkClass`), `MenuItem.detail`.
2. `FindBar.vue`; `SearchOptionToggles` uses `pressed`, `…Testid` prop spelling, `defineModel`.
3. `Identifier.vue`; `LogLines` (ANSI, `wrap`, slot), `W/lib/ansi.ts` (`anser` dep).
4. `AutocompleteField` onto reka Popover + `useActiveDescendant`, `editor.suggest`,
   `TIMING.hoverInfo`, `defineModel`; stays ≤ 600 lines (split helpers into `W/lib/` if needed).
5. `behaviour/*` additions (§2.2), `keys.ts`, `useShortcut`, `SHORTCUTS` ids, `TIMING` keys,
   `createTabsStore` dirty guard + `KindLookup`/`TabKindDef`/`host.ts` types, `ROW_HEIGHT_PX` +
   `createSettingsStore`, `testing/ui` `tid`/`ContractJson`, api-core `metadataValueCompletions`,
   git-core `orderWorktrees`. Go accelerators only for `global` ids (none new).
6. Commits per group, typecheck and lint each.

### 4.3 F3 (main checkout, after F1 and F2 land)

1. Land: in `/home/user/kira-p267-f` `git rebase v2.0`, main `git merge --ff-only p267-f`; remove
   the worktree (`git worktree remove`, `prune`, `branch -d`).
2. `W/behaviour/format.ts` re-exports `T/format.ts`; `format.spec.ts` moves to
   `T/format.spec.ts` (+ sub-ms, compact, currency boundary cases); `TIMING.spinnerDelay =
   SPINNER_DELAY`.
3. `QueryState` on `EmptyState loading`/`InlineState`; `bootstrapShell` provides `confirmDiscard`.
4. `WorkbenchShell`: drop the `dragging` cursor wiring; `ResizeHandle` drops the `dragging` emit.
5. Delete `packages/kira-ui` (workspace, `W/package.json` dep, root `typecheck:git` script's
   `packages/kira-ui/tsconfig.json` step, tsconfig paths, knip, mutation
   summarize text, `DIRS`, U58 `/kira-ui/` and `floatingPosition.ts` exempts, AutocompleteField
   U36/U41/U47/U58 PERMANENT lines, `ContextMenu` U27 line, `WorkbenchShell` U31 line).
6. Scripts: copy checker skips cva variant keys (drop `button/index.ts` exemption);
   `sourceRules.ts`, `check-class-conflicts.ts` compiler-core types; `conventiontest` G4 path rule
   (8 named lines go).
7. ARCHITECTURE: new "UI leftover conventions (P267)" under "Consistency conventions (P266)": §2
   rules, primitive list, guard list U83-U103 and N8-N12 (marked "lands in R"), the B8 tree-restore
   rule. Edit "Element families" grey roles.
8. Plan "Foundation result" section. Background push.

### 4.4 Foundation result

F0-F3 landed on `v2.0`, not pushed. F2 branch `p267-f` rebased onto `v2.0`, ff-merged, worktree removed.
F3 commits: `741b2ceeb` (format, spinner delay, QueryState, discard provider, dragging cursor,
`TruncatedText split`, `MenuItems` swatch), `38cb6cdd6` (`packages/kira-ui` deleted), `926984a45`
(copy guard cva skip, compiler-core types, G4 path rule). Docs and this section in the commit after.

Deviations from §4.3:

- `bootstrapShell` has no app instance (each `main.ts` builds its own `createApp`). It exports
  `provideShellServices(app)`, called by both `main.ts` after `app.use(pinia)`; the provider calls
  `useConfirmDialogStore().confirm` with `tone: 'danger'`.
- `T/format.ts` already held every formatter (F1); `W/behaviour/format.ts` re-exports by name
  (Biome `noReExportAll`) and keeps `useRelativeTime`. `packages/theme/tsconfig.json` added so
  `bun test` resolves `@theme/*` from `T/` specs.
- `QueryState` loading: `EmptyState fill loading` / `InlineState kind="loading"`; both delay
  themselves, so the `useTimeout` wiring is gone. A caller's `#loading` slot still shows at once.
- `allowImportingTsExtensions` stays in `apps/kira-studio/frontend/tsconfig.json` (theme and
  workbench import `.ts` specifiers); only the kira-ui rationale went.
- `@vue/compiler-core` 3.5.42 added to root devDependencies (types for the two guard scripts);
  `bun.lock` also re-hoisted `entities` 8.1.0 to 7.0.1 as a side effect.
- Remaining `theme.identifier.copy.label` seed deleted (duplicate of `workbench.identifier.copy.label`);
  `SEEDS` and its filter in `scripts/copy/check-catalog.ts` removed. Other `seed` keys in `en.json`
  (`core/space/studio seed placeholder`, `Seed`) are not P267 seeds; untouched.
- PERMANENT: U31 `WorkbenchShell` removed. AutocompleteField U36/U41/U47/U58 and `ContextMenu` U27
  lines were already gone from F2.

Handoffs for streams and R:

- `scripts/check-theme-classes.sh` keeps the `RepoFileView.vue` font-scale anchor: its `.md-reading`
  block still holds `text-[1.6em]` etc. Stream B drops the anchor when `RepoFileView` moves to
  `.kira-prose`. The `base.css` anchor stays (F1's `kira-prose` em scale).
- `anser` dep and `D/lib/ansi.ts` stay: `D/components/LogsView.vue` still imports `parseAnsi`,
  `splitMatches`. Stream C (C4) removes both with `LogsView` -> `LogLines`.
- Go `s3.formatBytes` (`ks/adapters/s3/read.go`) belongs to Stream A (A4); untouched.
- `TIMING.spinnerDelay` has no caller now (placeholders read `SPINNER_DELAY` directly); kept per §2.1.
- `Identifier split="path"` ignores `short` (tooltip and display come from `value`).

## 5. Streams

Three worktrees off the **F3 tip**: `/home/user/kira-p267-a` (branch `p267-a`), `-b`, `-c`. One
Sonnet per stream, chunks in order, one commit per chunk (`refactor(<scope>): <chunk>`), each
hook-green (`bun run lint`, `bun run typecheck`; `go vet ./...`, `bun run lint:go` and `go test` of
touched packages when Go changed). No UI, visual or flow suite. Discovery inside a file (callers,
specs asserting its text or testids) uses `codegraph_explore` first. Per file: apply every §2
decision that lands on it (one pass per file, not one pass per rule), delete its PERMANENT/copy
exemption lines when fixed, update owned specs whose testids or text changed.

### 5.1 Ownership (zero overlap)

| Stream | Source | en.json | Specs and tests | Notes file |
|---|---|---|---|---|
| A Kira Studio | `apps/kira-studio/frontend/src/**`, `apps/kira-studio/internal/**` | `studio`, `backend.studio` | `apps/kira-studio/tests/**` except C's | `docs/v2.2/plans/P267-stream-a-findings.md` |
| B Kira Space, mobile, memory | `apps/kira-space/frontend/{src,mobile}/**`, `apps/kira-space/internal/**`, `W/memory/**` | `space`, `mobile`, `memory`, `backend.space` | `apps/kira-space/tests/**` except C's | `P267-stream-b-findings.md` |
| C shared modules | `W/**` except `memory/**` and foundation files; `W/testing/ui/scenarios/**`; `G/**`; `D/**`; `p/git-core/**`, `p/api-core/**` except the two foundation files; `in/**` except `conventiontest` | `git`, `docker`, `automations`, `workbench` (except foundation objects), `backend.core` | Studio `tests/ui/{docker-*,automations-*,copy-*-docker-automations,list-keyboard-docker,prompts,update-dialog}.spec.ts`, visual `automations-module.spec.ts`; Space `tests/ui/{automations-*,repo-graph-*,repo-commit-*,repo-branch-picker,repo-floating-geometry,repo-review-interaction,list-keyboard-git,copy-wording-git,copy-coverage-git}.spec.ts`, visual `git-module.spec.ts`; package unit specs | `P267-stream-c-findings.md` |

Spec support: Studio `tests/ui/support/**` A; Space `tests/ui/support/**`, `tests/mobile/**` B; a
helper C needs → C findings (or `W/testing/ui`, foundation-owned until F3, C-owned after for
`scenarios/` only).

**No ordering dependency between streams**: each consumes only foundation APIs and catalog objects;
no source, spec, PNG or en.json object is shared. Space mounts git-ui through its public entry,
Studio mounts docker-ui through its context; C's `G/components/*.ts → G/lib/` move changes no
public export. Only shared text is the PERMANENT block and `copy/exemptions.ts` (owner groups, delete
only).

### 5.2 Chunks (≤ 25 files; a chunk that passes 25 with its specs commits as `<id>a`/`<id>b`)

Every chunk ends with the §5.4 worklist greps for its dirs at 0 (or a planned named exemption).

**Stream A** (order A1..A10):

- A1 shared views: `S/views/shared/{ResponseFindBar,page/SearchToolbar,FilterHistoryMenu,
  SavedListMenu,ResponseDiffDialog}.vue`, `S/views/stream/{StreamSearchToolbar,StreamView}.vue`
  (FindBar, HighlightedText, B11 queries, testid names, Table), `S/project/{TreeRow,ProjectTree}.vue`,
  `S/api/{CollectionRow,CollectionsTree}.vue` (HighlightedText, `useTreeShortcuts`, emit camelCase,
  chip, B8 expansion in `S/api/state/collections.ts`), `S/views/console/ConsoleSavedMenu.vue`,
  `S/views/shared/writeGate.ts` (new), `S/views/documents/DocumentView.vue`,
  `S/views/shared/keyvalue/KeyValuePane.vue` (writeGate, B1, B4, B7, Alert, ttl → `formatCompactDuration`).
- A2 grid and keyboard: `S/views/grid/{SlickGridHost,DataView,ColumnsMenu,FilterToolbar}.vue`,
  `S/views/console/{ConsoleSlickGrid,ConsoleView,ExplainResultView}.vue`,
  `S/views/shared/celleditor/CellEditorView.vue`, `S/views/shared/slick/{scrollTrace,gridHostShared}.ts`,
  `S/views/browse/{BrowseView.vue,menu.ts}`, `S/views/definition/{ColumnsSection,PropertiesSection,
  IndexesSection,ConstraintsSection,ValidationSection}.vue`, `S/api/{EnvironmentsView,VariableSetView,
  VariableRow}.vue` (chords, keyboard reorder, `readClipboardText`, nav button `buttonVariants`,
  `tableHeadClass`, `rowActions`, row height, SectionHeading).
- A3 dialogs: `S/project/{ConnectionDialog,SchemaDialog,DataGripImportDialog,FiltersDialog,
  ErrorPopover}.vue`, `S/api/{SaveRequestDialog,EditRawRequestDialog,ImportCurlDialog,
  CopyAsCurlDialog,DynamicValuesDialog,BulkVariablesEditor}.vue`, `S/workbench/{GenerateDataDialog,
  UploadObjectDialog,DbMcpApprovalDialog}.vue`, `S/workbench/settings/{DatabaseMcpPane,
  AppearancePane,ApiPane,AdvancedPane}.vue` (dirty, useFormErrors, Alert, CodeBlock, Card list,
  Table, fixed-height, `ROW_HEIGHT_PX`, FieldSet titles).
- A4 tabs, timers, persistence, Go: `S/state/{tabKinds,tabs,runState}.ts` (isDirty), `S/views/
  httprequest/{HttpRequestView,useResponseBody,CookiesPane,TimelinePane,ResponsePane,
  RequestBodyPane}.vue|ts`, `S/views/grpcrequest/{GrpcRequestView,ResponsePane,SchemaBrowser,
  GrpcMetadataTable,schemaQuery}.vue|ts`, `S/editor/MonacoHost.vue` (defineModel, `readonly`,
  hover `TIMING`), `S/project/filterTree.ts` + its view (`useCappedList`), `S/bridge/{index,
  apiControl}.ts` (connectionsReorder out), Go `ks/bridge/connections.go`,
  `ks/connections/{service,service_test}.go`, `ks/storage/repos/{connections,connections_test}.go`,
  `ks/flows/dbflow/sqlite_test.go`, `ks/adapters/s3/read.go` (+ s3 conformance expectations),
  `tests/ui/support/{ipcChannels,mockRuntime}.ts`.
- A5 sweep `S/api/**`, `S/workbench/**`, `S/project/**`, `S/App.vue`, `S/main.ts` remaining
  (grey roles, ghost, link `inline`, sub-bars, `EmptyState fill`/`InlineState` in popovers
  `VariableHistoryMenu`, `VariablesOverviewPanel`, TruncatedText, Identifier `StudioStart`, pending,
  tone, headings, menu file names `S/api/menus.ts`, `S/project/{menus,menuItems}.ts` → `menu.ts`).
- A6 sweep `S/views/{definition,console,grid,browse,documents}/**` remaining
  (`DocumentRow`/`DocumentTree` chevrons → `TreeTwisty`, `console/resultMenu.ts` and
  `definition/columnsMenu.ts` → `menu.ts`, `documents/page.ts` `compareNatural`).
- A7 sweep `S/views/{httprequest,grpcrequest,stream,shared}/**` remaining (`PreviewCommandPanel`,
  `StreamComposeMessage` → `PanelHeader`; HTTP pane count keys → `SecondaryTabs count`; picker
  triggers `EnvironmentSelect`, `MethodSelect`; `MethodSelect`/`FieldRowsTable`/`DateTimePicker`/
  `TimestampPane` defineModel).
- A8 splits (each ≤ 600 lines; extract child components and composables beside the file):
  `ConnectionDialog`, `StreamView`, `DocumentView`, `KeyValuePane`, `ConsoleView`,
  `HttpRequestView`, `CellEditorView`, `VariableSetView`, `GrpcRequestView` (9 files, chunked
  A8a/A8b by file count incl. new files).
- A9 specs (§5.3 A). A10 sweep: worklists clean, findings complete.

**Stream B** (order B1..B8):

- B1 ADE panel and board: `K/ade/v2/{panel,plan,board,backlog}/**` (KeyValueList, `paneFrame`,
  ghost, link, density, `AdeChangesTab` virtualize + rowHeight, `AdeStageMover` PickerTrigger,
  `AdeRepoChip` `pending`, `AdeBasePicker` defineModel, `AdeRunOutcome`/`AdeBranchPanel`
  Identifier, `AdeTaskCard` percent, `AdeDayBand` `SORTABLE_CHOSEN_CLASS`, `AdeStageBlock` slot
  `actions`, `pick` → `select`, board menus → `board/menu.ts`, titles `AdeBacklogPage`).
- B2 ADE rest: `K/ade/v2/{needs,sessions,workflows,review,notes,shell,run,dialog,state}/**`,
  `K/ade/**` other, `kp/appshell/menu.go` (+ test) (`ade.reviewCode` accelerator), toggles →
  `SecondaryTabs segmented` (`AdeAllSessions`, `AdeNotesEditor`, `AdeAllSessionRow`),
  `AdeWorkflowGraph` (tree.delete via `useShortcut ignoreTextFields`, keyboard reorder, link,
  Alert), `AdeNotesEditor` (`isPrimaryModifier`, `.kira-prose`), `AdeReviewSync` Disclosure,
  dirty on `AdeClaudeDialog`/`AdeRunDialog`, sort tie-breaks `sessionView`/`AdeAllSessions`,
  `AdeHeadlessPane`/`AdeTuiPane` sub-bar, `K/ade/state/` → `state.ts`.
- B3 repo and views: `K/repo/**`, `K/views/repo/**`, `K/state/**`, `K/workbench/**` (GitPanel
  tabindex + `useTreeShortcuts` + B1, `RepoFileTree` expansion persisted in `repo/state/
  fileTree.ts`, `RepoSearchRow` HighlightedText, `ReposDialog` description, `RepoMultiDiffView`,
  `RepoFileView` `revealElement block` + `.kira-prose`, `reviewDecorations` Alert via `createApp`,
  `worktrees.ts` → `orderWorktrees`, `search.ts`/`workspace.ts` `usePersistedState`, TIMING
  `blameLine`/`adeLayout`/`agentNotify`, status items `ClaudeUsageItem`/`StatusBar`, settings panes
  `GitPane`/`MobileAccessPane` FieldSet, `ReviewThread` emit `close`, `GitCredentialDialog` dirty,
  `repo/menus.ts` → `menu.ts`).
- B4 mobile: `M/**` (touch sizes, `Input size="touch"`, ghost, `KeyBar` pressed + defineModel,
  `PlanScreen` heading, AdeChip, percent, QueryState loading, `ReplySheet` description + dirty,
  `api/events.ts` `TIMING.reconnect`).
- B5 memory: `W/memory/**` (`MemoryStart` heading, `MemoryPanel` opacity, `ImportJobDetail`
  rowHeight + heading, `ImportView` sub-bar, `AddMemoryDialog` dirty).
- B6 split `GitPanel.vue` (834).
- B7 specs (§5.3 B). B8 sweep.

**Stream C** (order C1..C10):

- C1 git-ui layout move: `G/components/*.ts` (24) → `G/lib/`, importers updated; nothing else.
- C2 git menus and pickers: `G/components/{AppToolbar,PullStrategyPicker,BaseSelector,BranchPicker,
  SearchBox,SearchResults,TagList,StashRows,StackList,CommitMeta,UndoButton,RefreshButton}.vue`,
  `G/lib/{rowMenuModel,pickerModel,gridKeyboard,menuModel,useSectionMenu}.ts`; `MenuSections.vue`
  deleted (MenuItems, SplitButton, PickerTrigger, `useActiveDescendant`, SearchField, B1, F5 only,
  `compareNatural`, `orderWorktrees`, stash tie-break, Identifier, link `inline`).
- C3 git rest: `G/App.vue` (find chord via `shortcutFor`, drawer z/shadow, EmptyState, sub-bars),
  `G/components/{CommitGrid,FileTree,DetailPane,StashDetailPane,EmptyRepositoryPanel,GitBlockedPanel,
  NoRepositoryPanel}.vue`, `G/components/review/**`, `G/components/dialogs/**` (dirty, useFormErrors,
  `CheckoutDialog` emphasis, `ForcePushDialog` Disclosure), `G/state/repoScopedReload.ts` (+ 5
  constructor callers).
- C4 docker: `D/**` (`LogsView` onto `LogLines` + FindBar + HighlightedText, delete `lib/ansi.ts`,
  `ListState` inlined, lists tabindex/B1/Enter/count meta/`rowActions`/tone, `EndpointChip`
  PickerTrigger, KV lists, `EngineDiskSection` Table, `ContainerEditView` pending + useFormErrors,
  `UnavailableState`, `RecreateConfirmDialog`, `EditPendingSummary`, `EditField` `description`,
  persisted state + sort, TIMING, unit keys).
- C5 automations: `W/automations/**` (`AutomationsPanel` B1 ×3 + `useTreeShortcuts`,
  `ScriptDialog` dirty + useFormErrors, `RunScriptDialog`/`ScheduleConfirmDialog` CodeBlock +
  queryClient, `ScheduleFields`/`AdeContextFields` widths, `ScriptRunView` Disclosure,
  `McpToolsField`/`McpServerTools` queryClient, `runsQueries` tie-break + persisted, `runText`
  `formatCurrency`, `scheduleText` zone formatter, `RunLog` ANSI).
- C6 workbench components and state: `W/components/**` non-foundation (`RunsStatusItem`,
  `AppMetricsItem` (`formatPercent`), `UpdateAvailableItem` → size `status`; `ConfirmDialogView`
  touch + `pending`; `TabStrip` keyboard reorder + `rowActions`; `OpLogPanel` B1; `WorkbenchTitleBar`
  emits; `InlineEditInput` → `Input inline`; `SettingsShell` dirty; `TreeTwisty` cursor;
  `PanelHeader`), `W/prompt/**` (`TextPromptDialog` widths, z), `W/state/**` non-foundation
  (TIMING), `W/settings/**` (`LogLevelField` testid), `W/lib/collectionMenu.ts`.
- C7 api-core and git-core leftovers, `in/**` log text if any.
- C8 splits `ReviewView` (1137), `BranchPicker` (862), `FileTree` (745).
- C9 specs (§5.3 C; automations scenario modules). C10 sweep.

### 5.3 Specs each stream writes (written, not run; literal expected strings, testid locators)

Feature split at the IPC boundary applies where Go changes: A's Go edits update existing tests
(`s3` conformance text "123 KB", connections tests without `Reorder`); no other P267 behaviour
crosses IPC.

**A** `apps/kira-studio/tests/ui/ui-leftovers.spec.ts`:
- close a data tab with a staged edit → confirm with `Discard`; Cancel keeps the tab and the edit;
  `Close others` over a dirty tab asks once.
- connection dialog: type a name, click outside → still open; Esc → discard confirm; header X →
  same; footer Cancel → closes without asking.
- connection dialog submit with an empty name: error under the field, `aria-invalid="true"`, focus
  on the field, tab switched to General.
- Ctrl/Cmd+S in an HTTP request tab calls the save mock; in a document edit it saves.
- right-click a KeyValue row: row `aria-selected="true"` before the menu shows.
- Browse: `tree.copyName` chord copies (clipboard spy); `tree.delete` opens the confirm.
- pane `InlineState` loading hidden at 100 ms, visible within 1 s.
- response find bar: count text, Enter/Shift+Enter move `http-find-*` current match.
- project tree search: matches render `[data-slot="highlighted-text"] mark` with
  `bg-search-match`.
- collections tree expansion survives a reload.
- environments list: Alt+Down moves the row; Esc during a drag restores the order.
- a tooltip opened over `TextPromptDialog` has a higher computed `z-index` than the dialog.
- tree row and toolbar button computed cursor `default`; `variant="link"` button `pointer`.
- saving a connection: Save button `aria-busy="true"` while the mock is pending.
- filter history: pin toggles the row without reopening the menu (query invalidation).

**B** `apps/kira-space/tests/ui/ui-leftovers.spec.ts`:
- ADE All sessions filter is `[data-slot="secondary-tabs"]` segmented; notes toolbar toggle
  `aria-pressed`.
- workflow graph: Delete removes the selected stage; Delete inside the stage name field edits text.
- `kira:menu:` event for review code opens review (Go accelerator, no window keydown).
- GitPanel F2 starts rename; RepoFileTree expansion survives reload.
- markdown heading anchor scrolls the target to the pane top.
- review decoration load failure shows `[data-slot="alert"]` with Retry.
- Space status items `ClaudeUsageItem` height 22 px (`h-control-sm`).
- `GitCredentialDialog` outside click keeps it open when dirty.
- Go: `kp/appshell` menu test asserts the `ade.reviewCode` accelerator.

**B mobile** `apps/kira-space/tests/mobile/ui-leftovers.spec.ts`: every footer and sheet button box
≥ 44 px; Needs/Plan/Backlog loading shows `[data-slot="spinner"]`, no text-only line; chips render
the shared `AdeChip` testid.

**C** Studio `tests/ui/ui-leftovers-docker-automations.spec.ts`: docker logs render ANSI colour
spans, filter marks matches, FindBar prev/next; Enter on a container opens the same tab as
double-click (`logs`); right-click selects the container; script dialog dirty guard; script dialog
Save with empty name shows the error and focuses Name; run log keeps ANSI colour; TabStrip
Alt+Right moves the tab.
Space `tests/ui/ui-leftovers-git.spec.ts`: search box arrows set `aria-activedescendant`, first Esc
closes the dropdown and keeps the query; branch picker trigger is `[data-slot="picker-trigger"]`;
push menu disabled item shows its reason tooltip; file tree "Show more" reveals the next 500
(`useCappedList`); right-click a tag selects it; Ctrl+R does nothing, F5 refreshes; checkout
dialog shows one `dialog-primary` button.
Automations: `W/testing/ui/scenarios/automations-{editor,recurring,smart,runs}.ts`; the 8 app specs
become thin wrappers (same test titles, same assertions; app-only differences stay in each app).
Unit: `check-conventions.spec.ts` cases N8-N12 (F3/R owner writes them, see §6.2);
`T/format.spec.ts` boundary cases (F3). No other unit tests (CLAUDE.md bar).

### 5.4 Worklists (each stream, own dirs, before its sweep chunk ends)

Run the §3 regexes (U21 v, U43-U53 extensions, U83-U103) and N8-N12 over owned dirs with
`grep -rPzl`; every hit fixed or a planned named exemption recorded in the findings file with its
reason (R adds it to PERMANENT). Also: `grep -rn "biome-ignore lint/a11y/useFocusableInteractive"`
→ 0 in owned files; `grep -rn "TestId\b\|'update:modelValue'"` → 0.

### 5.5 Catalog merge

P265 §4.4 rule: each writer touches only its objects; `biome check --write
packages/theme/src/i18n/en.json` before each commit; a rebase conflict in en.json keeps both sides
and re-runs Biome; a PERMANENT or `copy/exemptions.ts` conflict applies both deletions; any other
conflict means ownership was wrong: stop and report.

## 6. Landing, R, test, close-out

### 6.1 Landing

Each stream done (worklists clean, specs written, findings complete, lint and typecheck green) →
in its worktree `git rebase v2.0`, lint, typecheck, `go build ./...`, then main checkout
`git merge --ff-only p267-<x>`; remove the worktree; background push after each.

### 6.2 R (one Sonnet, main checkout, after all streams land)

1. Apply the three findings files; delete them.
2. Mechanical sweeps over all scanned dirs: three-class spelling → `truncate`; `cursor-pointer`
   outside the pointer owners and `cursor-help|copy` removed (`TreeTwisty`, primitives already
   fixed); stragglers of any §3 worklist.
3. Guards (§3): edit `check-ui-primitives.sh` (DIRS + theme, extensions, U83-U103, built-in
   column stale check with `!` opt-out, 13 dead entries out), `check-theme-classes.sh` shadow
   rule, `check-conventions.ts` N8-N12 + spec cases. Every remaining hit fixed or added as a named
   PERMANENT entry with a reason. Commit per guard group: `chore(lint): P267 guards U83-U103`,
   `chore(lint): conventions N8-N12`, `chore(lint): built-in exempt stale check`.
4. `DEV_ENVIRONMENT.md` `KIRA_*` table (B13).
5. `bun run lint`, `typecheck`, `lint:go`, `lint:dead`, `test:unit` green. Commit, push.

### 6.3 T: test and fix (one serial Sonnet)

Suites, serial, low workers, each failure root-caused and fixed in a commit (no `--no-verify`):
`bun run test:unit`, `test:ui:studio`, `test:ui:space`, `test:ui:space-mobile`,
`test:visual:studio`, `test:visual:space`, `test:flows:studio`, `test:flows:space`, `go test ./...`,
`bun run lint:go`, `bun run lint:dead`. Visual: view each diff image; update a baseline only for an
intended §2 change (dialog shadow, header icons gone, hover, EmptyState padding, cursor none,
counts, titles) and list each with its reason. Known load-sensitive specs (Known open items) are
not P267 failures; prove against the base when unsure. "Test and fix result" section: commits,
suite counts, baselines with reasons.

### 6.4 Close-out (sequential)

1. ARCHITECTURE: "UI leftover conventions (P267)" final (guards landed, not "lands in R");
   Known open items: add "Quit discards staged grid edits and dirty edit buffers (P267)"; nothing
   else resolved here.
2. Plan "Close-out result": PERMANENT before/after (59 → n), built-in entries removed, copy
   exemptions 8 → 6, G4 named 9 → 1, suppressions removed, `TruncatedText`/`Button pending`/
   `Identifier`/`KeyValueList`/`Disclosure` importer counts, files over 600 lines, parked items
   (expected none).
3. SPEC P267 result section, row `Done`.
4. Final `bun run typecheck`, `lint`, `test:unit`, `go test ./internal/...` green.

## 7. Disk and worktrees (6.9 GB free at plan time)

Each worktree runs `sh scripts/prepare-worktree.sh` then `sh scripts/codegraph-setup.sh`; never
symlink `node_modules`. `/home/user/kira-v22-base` is not P267's; leave it. Keep the bun global cache
(installs hardlink from it).

1. D0 cleanup before F2: `git worktree prune`; delete `test-results/` and `playwright-report/` in
   both checkouts; `go clean -testcache`. Record `df -h /home/user`.
2. F2 worktree only with ≥ 2.5 GB free; record its `du -sh` after prepare. Removed at F3 step 1.
3. Streams: create A, then B, each only with ≥ 2.5 GB free after the previous prepare. Create C
   only with ≥ 2.5 GB free; if short, C waits until the first stream lands and its worktree is
   removed, and still branches off the F3 tip.
4. Keep ≥ 1.0 GB free while work runs; a worktree prunes only its own `test-results/` and
   `playwright-report/`. T runs in the main checkout after every stream worktree is removed.
5. A stopped stream resumes from its last commit in its worktree; never recreate it.

## 8. Risks and scope

- Size: the largest phase of the chapter (~400 files). One phase, more chunks; each chunk is
  self-contained and resumable from its commit.
- Async tab close (`closeTab` returns a promise): every caller (TabStrip, menus, `tab.close`
  command, tests) awaits or fire-and-forgets with `fireAndForget`; unit specs on `createTabsStore`
  update.
- `t()` grouping every number changes rendered text where a param is an id-like number (pageSize,
  port): such params pass as strings. Spec text that asserted ungrouped numbers updates.
- Splits move code between files: specs keep testids; codegraph blast radius per split.
- Visual baselines move; each diff viewed.
- Out of scope: accessibility beyond the a11y suppression swap, new features beyond the named
  behaviour rules, reveal channel renames, Go slog re-levelling, a second locale, Monaco/SlickGrid/
  xterm internals, `apps/kira-studio/frontend/proto`, `apps/kira-space-vscode`.

## 9. Verification checklist (orchestrator, after close-out)

`D="apps/kira-studio/frontend/src apps/kira-space/frontend/src apps/kira-space/frontend/mobile packages/workbench/src packages/git-ui/src packages/docker-ui/src packages/theme/src"`.

- Discovery: this planner's run holds 23 `codegraph_explore` calls; F1-F3, each stream and R show
  calls before structural edits.
- `test ! -d packages/kira-ui`; `grep -rn "kira-ui\|computeFloatPosition" $D package.json knip.json --include=*.ts --include=*.vue --include=*.json` → none.
- `test -f packages/theme/src/format.ts`; `grep -rlE "TruncatedText" --include=*.vue $D | wc -l` ≥ 20;
  `grep -rlE "<Identifier\b" --include=*.vue $D | wc -l` ≥ 15; `grep -rlE "<KeyValueList\b" --include=*.vue $D | wc -l` ≥ 10;
  `grep -rlE "<Disclosure\b" --include=*.vue $D | wc -l` ≥ 5; `grep -rlE ":pending=" --include=*.vue $D | wc -l` ≥ 40;
  `grep -rlE "<FindBar\b" --include=*.vue $D | wc -l` ≥ 4; `grep -rlE "<HighlightedText\b" --include=*.vue $D | wc -l` ≥ 5;
  `test ! -f packages/git-ui/src/components/MenuSections.vue`; `test ! -f packages/docker-ui/src/lib/ansi.ts`.
- `grep -rlE "<details\b" --include=*.vue $D` → none; `grep -rnE "variant=\"ghost\"|'ghost'" --include=*.vue $D | grep -v components/ui/` → none;
  `grep -rn "overflow-hidden text-ellipsis whitespace-nowrap" $D` → none; `grep -rn "cursor-pointer" $D | grep -v "components/ui/button\|linkify\|badgeClass"` → none;
  `grep -rnE "\bz-50\b|shadow-md" packages/theme/src/components/ui` → none.
- `grep -rn "connectionsReorder\|ConnectionsReorderArgs" apps packages --include=*.go --include=*.ts --include=*.vue | grep -v node_modules | grep -v /dist/` → none.
- `find packages/git-ui/src/components -name '*.ts' ! -name '*.spec.ts'` → none;
  `find apps/*/frontend/src -name 'menus.ts' -o -name 'menuItems.ts' -o -name '*[a-z]Menu.ts' ! -name 'use*'` → none.
- `find $D -name '*.vue' | xargs wc -l | awk '$1>600'` lists only `SlickGridHost`, `ConsoleSlickGrid`, `CommitGrid`, `MonacoHost`, git `App.vue`.
- `grep -c "^U" scripts/check-ui-primitives.sh` PERMANENT section ≈ 24 + new named entries, each with `#` reason;
  `grep -n "flowharness" internal/conventiontest/conventions_test.go` shows the path rule, one named G4 entry;
  `grep -rn "useFocusableInteractive" --include=*.vue apps packages | grep -v node_modules` → none.
- `grep -nE "U8[3-9]|U9[0-9]|U10[0-3]" scripts/check-ui-primitives.sh | wc -l` ≥ 21; `grep -n "N8\|N12" scripts/check-conventions.ts` hits;
  `bun run lint`, `lint:go`, `typecheck`, `lint:dead` green.
- `grep -n "KIRA_NO_STARTUP_ALERT" docs/DEV_ENVIRONMENT.md` hit; `grep -n "UI leftover conventions (P267)" docs/ARCHITECTURE.md` hit.
- Specs present: `apps/kira-studio/tests/ui/ui-leftovers.spec.ts`, `ui-leftovers-docker-automations.spec.ts`,
  `apps/kira-space/tests/ui/ui-leftovers.spec.ts`, `ui-leftovers-git.spec.ts`, `apps/kira-space/tests/mobile/ui-leftovers.spec.ts`,
  `packages/workbench/src/testing/ui/scenarios/automations-*.ts` (4); every §6.3 suite green; baselines listed.

## Step R result

Commits on `v2.0` after tip `b8970518b`:

- `873b9138f` chore(lint): P267 guards U83-U103 (+ `check-theme-classes.sh` shadow rule, `split="path"` fix)
- `1b1754a6e` chore(lint): built-in exempt stale check (13 dead entries removed)
- `cff3991bb` refactor(p267): R handoffs, unresolved-component check
- `83b120121` refactor(p267): shared spec helpers to support, non-component .ts to lib
- `79ad0ed32` chore(lint): conventions N8-N12 (+ spec cases)
- `c5222eb28` docs: `KIRA_*` table, `dateFormat` path, stream findings deleted

Handoffs closed: `isPrimaryModifier` takes MouseEvent; `ade.reviewCode` in `shell.Shortcuts` and
`CHANNEL.reviewCode`, used by Space; `close` emit for `LogLevelField`/`TextPromptDialog`; `TabStrip`
chip focus after a keyboard move; `LogLines` follow control and `scrollToIndex`, Docker Follow and
jump-to-end restored.

Unresolved-component check: `vueCompilerOptions.checkUnknownComponents` in the five vue-tsc tsconfigs
(proto extends Studio). Found and fixed missing imports in `GitPanel` (`RepoList`), `StashDetailPane`
(`Spinner`), `WorktreeList` (`FieldError`), `ResourceDetail` (`KeyValueList`), `ConstraintsSection`
(`SectionHeading`). `FindBar` keeps `<search>` as `<div role="search">` plus a biome-ignore, since
`nativeTags` is not honoured by vue-tsc 3.3.11.

PERMANENT lines in `check-ui-primitives.sh`: 59 at plan time, 29 at tip `b8970518b`, 38 now. Above the
~24 target: the user-listed exemptions (U88 x3, U101 x2, U100, U91) plus U91 `UncommittedChangesStrip`
(tooltip differs from label) and `U47 SearchResults` (listbox keys live in the combobox). `U47 SearchBox`
deleted.

Narrowings of the plan's wording:

- N8 flags a helper only when 3+ lines and a verbatim copy (whitespace-normalised) in 2+ specs or of a
  `support/` export. Name-only matching gave 249 hits, mostly one-line locator aliases (`t`, `row`).
  Fixed 31 real copies by moving them into `support/` (`apiRows`, `connectionArgs`, `consolePages`,
  `dockerFixture`, `repoRows`, `panelResize`, and existing `tree`, `tabs`, `apiMode`, `redisFixture`).
- N10 names `CheetahProto.vue` (P165 prototype). N11 names `grid.edit` (bound by the grid engine).
  N12 scans `apps/*/frontend/src` only.
- N9: `rowVariants.ts`, `frames.ts` moved to `packages/theme/src/lib/`; `opLog.ts`,
  `settingsPaneProps.ts` to `packages/workbench/src/lib/`.

Undone, not verifiable here:

- Specs the streams wrote and the spec helper moves touched were typechecked (tsgo) but not run; no UI,
  e2e or visual suites per instruction.
- `AdeAutomationsBlock.vue` keeps one bare `<button>`.
- `apps/kira-studio/frontend/bindings/` is gitignored and was stale: it still bound the removed
  `ConnectionsService.Reorder`, failing `mock-runtime-bindings.spec.ts` locally. Hand-trimmed; regenerate
  with the Wails bindings task on a real box.

Checks green at close: `bun run lint`, `typecheck`, `lint:go`, `lint:dead`, `test:unit` (1902 pass),
`go test` for `internal/shell` and `apps/kira-space/internal/appshell`.

## Test and fix result

Base `bb79625bf`. Serial run on one machine, no push.

Commits:

- `072553fa2` code fixes: find bar Esc captured before `SearchField`; `useFormErrors.submit` waits up to 5
  frames for the invalid field; `AutocompleteField` hover panel opens above the field (Reka popover
  intercepts the pointer below it); `CatalogText` groups numeric params through `formatCount`;
  `useShortcut` gets a `capture` option, used by the cell editor save chord; `FiltersDialog` checkbox hit
  area; `AdeAutomationsBlock` bare `<button>` is a `Button variant="toolbar" size="inline"`.
- `932deaf48` Studio ui specs. WebKit on Linux reports a Mac UA, so `isMac` is true: new
  `support/chord.ts` (`primaryChord`, `deleteChord`) presses Meta chords. Dirty dialog Esc/X specs click
  `confirm-dialog-confirm`. Count, duration and percent text follows `formatCount` (`10,000`, `60ms`,
  `60.0%`). `openHttpRequestView` regained the new-request click the N8 move dropped. Wrong-premise
  assertions fixed: Redis key rows have no Delete; D9 elapsed caption is muted, not subtle; LAW-12 label
  check is now stable left edges.
- `2f9c07211` Space ui specs: Meta+Backspace workflow delete, `60.0%`, tag name error appears after a
  change (fill then clear), tag fixture gets a first tag so v1 starts at tabindex -1, tooltip asserted by
  `data-slot="tooltip-content"` (no `role=tooltip`), credential dialog dirty flow (clean outside click
  closes by design), usage item is 18px (`control-sm`), heading link fixture gets tail content so the
  heading can reach the pane top, Retry located by `button` text (Monaco view zones are aria-hidden),
  sync disclosure opened by click.
- `a11e5e6df`, `9a115d400` visual baselines and `schema-dialog.spec.ts` blur target (`.help` class is gone,
  now `[data-slot="field-description"]`).
- `d41a99379` `flowharness.WithSeed`: the retired-model sweep runs in a goroutine at first build and raced
  the seed written after `New` (`TestStartupSweepsLeftovers` failed 1 in 2 runs).
- `11964d03b` `go mod tidy` in both nested `tests/claude` modules (missing `renameio` go.sum entry; `go vet`
  failed there).

Suite results at tip:

- `test:unit` 1902 pass.
- `test:ui:studio` 532 pass.
- `test:ui:space` 553 pass, 1 load flake (`ade-v2-dialogs` Merge from the fix menu): failed once at 3
  workers, passes 3 of 3 alone.
- `test:ui:space-mobile` 79 pass, 1 skipped.
- `test:visual:studio` 13 pass, `test:visual:space` 13 pass, after the baselines below.
- `test:flows:studio` pass. `test:flows:space` pass after the `WithSeed` fix.
- `go test ./...` pass except `termflow` `TestScheduleHeadless/stop` and `internal/terminal`
  `TestSessionClose*`, which fail under parallel package load and pass alone with `-p 1` (load-sensitive,
  not P267).
- `lint:go` 0 issues, `lint:dead` clean, `typecheck` clean, `lint` clean.
- "Failed to resolve component": the prod test build strips the dev warning, so vue-tsc
  `checkUnknownComponents` (inside `typecheck`) is the guard; it is clean.

Visual baselines updated, every diff image viewed. Studio (11 changed plus schema): title bar icons 15 to
16px (`workbench`, `console`, `data-grid`, `connection-dialog`); panel header `font-semibold` to
`font-medium` (`CONNECTIONS`); EmptyState padding wraps "Everything you connect to shows up here"
(`workbench`, `connection-dialog`); tree row counts spaced (`~1 rows`) (`data-grid`); loading spinner
hidden for 300 ms (ring gone in `http-request-view`, `console`, `data-grid`); `42 ms` to `42ms`, method and
environment selects on shared sizes (`http-request-view`); FK nav button on the borderless toolbar variant
(`data-grid`); script dialog Add no longer disabled when empty (`useFormErrors`), Identifier chips 1-2px
wider (`script-dialog`); dialog header icon gone and stepper chevrons 12px (`settings-*` x6,
`connection-dialog`); `schema-dialog` uses `fixed-height` dialog (shorter editor), shadow and intro as
`FieldDescription`. Space (11): dialog header icon gone and section headings as FieldLegend (`settings-*`,
`git-repos-dialog`); spacing moved to the density scale (`workflow-graph`, `workflow-graph-branches`:
inspector rows shift 2px); branch picker trigger on the shared picker trigger look (`git-graph`,
`git-graph-detail`); branch picker tab counts plain, not pills (`git-branch-picker`); stepper chevron size
(`git-repo-settings-dialog`, `settings-appearance`).

Could not run or not proven:

- `ui-timing`: fails here (console keystroke, scroll frame, tree expand p95) and fails the same, worse, at
  `ae1bb8648`. Environmental, listed under Known open items; not run again.
- Bindings: `apps/kira-studio/frontend/bindings` and `apps/kira-space/frontend/bindings` regenerated with
  `wails3 generate bindings -clean=true -b -names -ts -i` (`go install ...wails3@v3.0.0-beta.28` to a temp
  `GOBIN`; no `task` binary here). Gitignored, so nothing committed. Typecheck and `test:unit` pass on the
  regenerated set.
- Sync popover unpositioned (ade-v2-review "sync button lists..."): not a P267 regression. At base
  `795948768` (built with `build:test:space`) the same spec shows the popover box at x=0, y=-274, and a
  normal click on the Disclosure trigger times out there too. The popper wrapper keeps its initial style
  (`transform: translate(0px, -200%)`), so Reka's popper never computes a position in this review window
  under WebKit. Tip and base are identical, so the spec clicks with `dispatchEvent`. Other popovers
  position fine; root cause of the unpositioned wrapper is open.

## Close-out result

Base `ae1bb8648`, tip `570dc172a` plus this commit. §9 greps run on the tip.

Numbers:

- PERMANENT lines in `check-ui-primitives.sh`: 59 to 38. Above the ~24 target: the user-listed
  exemptions (U88 x3, U101 x2, U100, U91) plus U91 `UncommittedChangesStrip` and U47 `SearchResults`
  stay; each has a `#` reason naming a requirement a primitive cannot meet. The plan's own "≈ 24 + new
  named entries" allows this.
- Built-in exempt column: 13 dead entries removed; column now stale-checked (`!` opts a blanket out).
- Copy exemptions (`scripts/copy/exemptions.ts`): 8 to 6.
- G4 named exemptions (`internal/conventiontest`): 9 to 1 (`gitsession/incremental.go`); path rule skips
  `flowharness`, `flowtest`, `ipcfixture`.
- Suppressions: `biome-ignore` 174 to 164 (net 10 removed, mostly a11y list-row ignores; 4 new ones for
  `<search>`, role-switched rows and untyped fixtures).
- Importers (files, `.vue` under §9 `$D`): `TruncatedText` 29, `Identifier` 32, `KeyValueList` 11,
  `Disclosure` 5, `Button pending` (`:pending=`) 68, `FindBar` 4, `HighlightedText` 5.
- `.vue` files over 600 lines: `SlickGridHost` 2751, `ConsoleSlickGrid` 881, `CommitGrid` 1369,
  `MonacoHost` 786, git `App.vue` 1995. Exactly the §9 list.
- U83-U103 lines in `check-ui-primitives.sh`: 30 (≥ 21).

§9 checks:

- Pass: `packages/kira-ui` gone, no `kira-ui`/`computeFloatPosition` in `$D`, `package.json`, `knip.json`;
  `format.ts`; all importer floors; `MenuSections.vue`, `docker-ui/lib/ansi.ts` gone; no `<details`
  element, no `ghost` variant outside `components/ui/`, no `z-50`/`shadow-md` in `components/ui`;
  `connectionsReorder` gone; no `.ts` under git-ui `components/`; no menu file naming hits;
  `useFocusableInteractive` unused; G4 path rule present; N8-N12 present; `KIRA_NO_STARTUP_ALERT`
  documented; "UI leftover conventions (P267)" present; all listed specs present.
- Literal-grep hits, judged not failures: `Disclosure.vue` comment text `<details>`; three-class
  ellipsis spelling and `cursor-pointer` in `.css` only (`slickTheme.css`, `git.css` virtual row,
  `tailwind-core.css` comment). The §9 grep spans `.css`; the §2 rules target `.vue` class lists, and
  the SlickGrid theme is engine internals (out of scope, §8).
- Spec path drift: the `automations-*` specs live in `apps/*/tests/ui/`, not `packages/workbench/src/testing/ui/scenarios/`.

Parked items: none. Open items recorded in `docs/ARCHITECTURE.md` Known open items: quit discards
staged edits, sync popover unpositioned under WebKit (root cause open), `ui-timing` budgets on slow
hosts.

Docs: `ARCHITECTURE.md` conventions section final; remaining `kira-ui` mentions there and in `PERF.md`
are history lines, marked so.
