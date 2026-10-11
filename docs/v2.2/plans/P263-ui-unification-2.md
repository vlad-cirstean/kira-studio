# P263 plan: UI unification part 2, remaining element families

Ask (user): unify the remaining element families the same way as P262: tables/lists/tree rows,
badges/chips/pills, checkboxes/switches/radios, tooltips, toasts, loading states, alerts/inline
errors/validation, context menus/dropdowns, scrollbars/split handles, cards/panels, kbd hints,
colour and status tokens, focus rings/disabled states, mobile. Plan with decisions, foundation,
streams. Every look decision below is final (no sign-off list).
Addendum (user, during planning): unify ALL pane resize handles. `AdePanelResizeHandle` must match
the handle between the left panel and the main area: thickness, hit target, gap to neighbouring
panes, colour (idle, hover, drag), cursor, focus, keyboard. One shared visual; the ADE handle keeps
its VueUse mechanics (P132: a nested reka group hung the render process). Supersedes P262
close-out's 4px ADE handle (§1.10, §2.9).
Addendum (user): 3 parallel streams (A, B, C), not 2 (§4).

Base: `v2.0` at `27e8eebb8` (P262 close-out). Builds on P262 §2 (dialogs, tabs, buttons, fields,
bars, side panels) and its guard `scripts/check-ui-primitives.sh` (U1-U21). No new dependency:
new primitives are shadcn-vue registry parts (`skeleton`, `kbd`, `card`, `table`, fetched per
P99 4.2's direct-curl procedure, MIT) restyled onto kira tokens, or thin theme components.

Behaviour stays out of scope: shared composables for keyboard navigation, drag mechanics,
clipboard, persistence, loading/error wrappers and the like are P264 ("Behaviour unification and
modularisation"). P263 changes looks, primitives that render them, and the keyboard step of
resize handles (user addendum).

Steps, strictly in order:

1. **Foundation** (one sequential Sonnet implementer, `v2.0` main checkout): tokens, base class
   changes, new primitives, mechanical variant renames repo-wide, resize-handle unification,
   reference migrations, guards U22-U38 with per-stream allowlists, baselines (§3).
2. **Streams A, B, C** (three Sonnet implementers, three worktrees off the foundation tip,
   concurrent): per-site migration, chunk after chunk (§4).
3. **Close-out** (one sequential Sonnet implementer after all three land): findings, legacy
   removal, guard fold-in, docs, result (§5.5).

Method: `codegraph_explore` on every theme primitive of these families (`Badge`/`badgeVariants`,
`Checkbox`, `Switch`, `RadioGroupItem`, `SwatchRadio`, `Tooltip*`, `TooltipIconButton`,
`AttributeTooltip`, `Alert`/`alertVariants`, `FieldError`, `DropdownMenu*`, `ContextMenu`,
`RowContextMenu`, `Progress`, `RunState`, `ScriptProgress`, `ResizableHandle`, `DockResizeHandle`,
`AdePanelResizeHandle`, `KuiColumnResizeHandle`, `WorkbenchShell`) and their callers; then a
class-level `grep -P` over `apps/kira-studio/frontend/src` (S), `apps/kira-space/frontend/src` (K),
`apps/kira-space/frontend/mobile` (M), `packages/{workbench,git-ui,docker-ui,kira-ui}/src`
(W/G/D/U), `packages/theme/src` outside `components/ui` (T). Counts are tags, then files.

## 1. Inventory

### 1.1 Tables, grids, lists outside side panels

- **Data grids**: SlickGrid in 3 hosts (`S/views/grid/SlickGridHost.vue`,
  `S/views/console/ConsoleSlickGrid.vue`, `G/components/CommitGrid.vue`). Look lives in
  `S/views/shared/slick/slickTheme.css` (715 lines) and `G/theme/git.css`: header `bg-elevated`,
  `border-b border-strong`, `--kira-t-sm` muted, cell padding 8px, row `--kira-row-height`.
- **Native `<table>`**: 7 in 7 files (S only): 5 Definition sections
  (`S/views/definition/{Columns,Constraints,Indexes,Properties,Validation}Section.vue`, 16 `<th>`,
  per-file copies of `DEF_TH`/`DEF_TH_LAST`/`DEF_TD`: `px-1.5 py-1`, `bg-elevated`), 
  `S/views/grid/FkPreviewPopover.vue` (`py-0.5 pl-0 pr-1`, no head bg), `S/views/stream/StreamView.vue`.
- **CSS-grid tables**: `grid-cols-[` 32 tags in 20 files (S 15/5, K 6/6, W 1/1, G 2/1, D 8/7).
  Head looks: 3 (Definition `bg-elevated` sentence case; docker `ContainerTable.vue:50`
  `uppercase tracking-wider px-3 py-1`, no bg; none). Cell padding: `px-1.5`, `px-2`, `px-3`.
- **Hand-rolled row state** outside the P262 side-panel list: `hover:bg-hover` 54 tags in 42 files
  (S 38/26, W 8/8, D 5/5, K 2/2, G 1/1); `bg-select` 6/5. `rowVariants(` already in 23 files.
- **Row height**: `rowDensity === 'compact' ? 22 : 28` copied in 6 files
  (`S/views/grid/SlickGridHost.vue`, `S/views/console/{ConsoleSlickGrid,ConsoleResultGrid}.vue`,
  `S/views/shared/keyvalue/KeyValuePane.vue`, `S/views/stream/StreamView.vue`,
  `S/workbench/settings/AppearancePane.vue`) beside `useRowHeight()` (P262).

### 1.2 Badges, chips, status pills, dots

- `Badge` 116 in 55 files (S 79/32, G 13/7, W 10/5, D 7/6, K 5/3, M 2/2). Variants: none 38,
  `warn` 20, `info` 9, `chip` 8, `count` 4, `err` 3, dynamic 12 (`statusClass`, `grpcCodeClass`
  in `packages/shared/domain/{http,grpc}.ts` return `'err'`). Base carries `font-data` for every
  badge, UI words included. Tints: `warn/16 err/16 info/16 ok/14`.
- Chip components beside `Badge`: `K/ade/v2/{AdeChip,AdeRepoTag}.vue`, `K/ade/v2/plan/AdeRepoChip.vue`,
  `K/ade/v2/automation/AdeAutomationChip.vue`, `D/components/EndpointChip.vue`,
  `W/automations/smart/SmartBadge.vue`, `W/automations/runs/RunStatusBadge.vue`; DOM-built ref
  badges in git-ui (`refBadges.ts`, `badgeClass.ts`, grid canvas, out of scope as in P262).
- Ad-hoc pills (`rounded-full`/`rounded-kira-pill` + `px-`): 3 (`AdeStageBlock.vue:279`,
  `AppMetricsItem.vue:44`, mobile `PlanTaskCard.vue:49`).
- **Status dots**: 16 in 14 files, 4 sizes (`size-1.5` docker ×7, `w-2 h-2` `TreeRow.vue:167`,
  `size-2` mobile ×3, `size-2.5` `PlanTaskCard.vue:39`), colour via `bg-ok/warn/error/disabled`,
  data attributes, or inline `style` (ADE task colour).

### 1.3 Checkboxes, switches, radios

- `Checkbox` 55 in 27 files (S 33/13, G 14/8, W 6/4, K 1/1, D 1/1); `Switch` 24 in 16 files
  (K 15/9, W 7/5, D 2/2); `RadioGroup` 8/8 (W 3, G 5); `SwatchRadio` 4/4; raw native radios 2
  (`S/api/EnvironmentsView.vue:291` active environment, `S/project/ConnectionDialog.vue:689`
  kind cards, visually hidden over a card).
- **No rule**: a settings boolean is a `Checkbox` in Studio (`ApiPane` 3, `DatabaseMcpPane` 2,
  `AppearancePane` 1, `WordWrapField`) and Space `AppearancePane` 1, but a `Switch` in Space
  (`ClaudeCodePane` 3, `MobileAccessPane` 4, `AdvancedPane` 1, `NotifyPromptsField`). A form
  option submitted by a button is a `Checkbox` in git dialogs and `ConnectionDialog`, a `Switch` in
  `AdeClaudeDialog` ×2, `ScriptDialog` ×2, `ScheduleFields` ×2, `McpToolsField`, the workflow
  editor (`AdeWorkflowGraph`, `AdeStageInspector`, `AdeStepResults`, saved by a Save bar), docker
  edit (`EditSize`, `EditRecreateSection`, applied by Apply/Recreate).
- Sizes: Checkbox and radio 16px (`size-4`, `rounded-[4px]` arbitrary radius), Switch
  18.4×32px (`h-[1.15rem] w-8`); token `--kira-control-inline-h` (14px, "checkbox box") unused.

### 1.4 Tooltips

- Theme `Tooltip` 154 in 76 files, `TooltipIconButton` 249 in 109 files, `data-kira-tip` 42 in
  11 files (AttributeTooltip, grid DOM). Content overrides 7 (`whitespace-pre-line` ×4,
  `whitespace-pre-wrap` ×2, `max-w-72` ×1).
- **Native `title=` tooltips** on HTML elements: 21 in 15 files (K 16/10, W 2/2, D 2/2, S 1/1, M 1):
  truncated-path reveals (`ReposDialog`, `RepoConfigForm`, `AdeReviewSync`, `ImportFileRow`,
  `RepoMultiDiffView`), hints (`AdeActivityIcon`, `AdeStepNode`, `EditField`, `EditInPlaceSection`,
  `AdeWorkflowGraph` label), mobile `AppShell.vue` (no hover on touch).
- `TooltipProvider` props `:delay-duration="400" :skip-delay-duration="300" disable-hoverable-content`
  repeated in 4 files (both `App.vue`, `G/MountRoot.vue`, `T/components/AttributeTooltip.vue`);
  theme default is `delayDuration: 0`.

### 1.5 Toasts and transient feedback

- **No toast system** (0 `toast`/`sonner`; P92 decided "no toast channel"). Feedback today:
  `FailureBanner`-style strips (git-ui), `DialogFooter #start` status text (P262), OpLog/Operations
  panels, StatusBar items, `aria-live` 3 (git-ui).
- Copy confirmation: icon swap to `check` (`AdeSessionId`, `AdeBranchPanel`, `AdeLinkRow`) or
  label swap to "Copied" (`AdeWorkflowEditor`, `AdeRunOutcome`, `RunOutcomeBlock`,
  `ClaudeCodeMcpSection`), all 1500ms. Already one look per button kind.

### 1.6 Loading states

- **Spinners, 3 mechanisms**: CSS ring `border-2 rounded-full animate-spin` 5
  (`S/workbench/GenerateDataDialog.vue:356`, `W/automations/AutomationsPanel.vue:396,466`,
  `T/components/ScriptProgress.vue:55` `border-info`, `T/RunState.vue` `border-primary`); codicon +
  Tailwind `animate-spin` (1s smooth) 7 (`FkPreviewPopover`, `TreeRow`, `OpLogPanel`, git
  `AppToolbar` ×2, `RefreshButton`); codicon + `codicon-modifier-spin` (codicon CSS, stepped 1.5s)
  9 in 8 docker files. Static (never spinning) `loading` icon in `EmptyMedia` 2 (git `DetailPane`,
  `StashDetailPane`). Sizes 12, 13, 24.
- **Skeletons**: `animate-pulse rounded-kira-sm bg-field` bars in 3 docker files only
  (`ContainerDetail`, `ContainerEditView`, `ListState`).
- **Progress**: reka `Progress` 4 in 3 files (memory), compliant.
- **Loading text**: "Loading…" 67 mentions in 30 files; forms: `EmptyTitle`, bare `div`
  (`text-muted-foreground` vs `text-subtle`, `p-2` vs none), `Loading...` with three dots in places.

### 1.7 Alerts, inline errors, validation

- `Alert` 180 in 89 files (S 100/42, G 27/15, K 18/11, W 18/11, M 9/8, D 8/2). Variants
  `destructive`/`warn`/`note` 199 tags, no variant (neutral `bg-elevated`) 23 in 17 files.
  `destructive` has no tint (`bg-elevated`, default border) while `warn`/`note` are tinted
  (`/10` vs `/8`). Icons: 0 alerts use the base's `svg` slot (codicons are `<i>`, not svg); 9
  `AlertDescription class="flex items-start gap-1.5"` and 6 other flex variants hand-place the icon.
  Class overrides on `Alert` 28 (`w-auto` ×20 against base `w-full`, margins `m-3`/`m-2`/`m-1.5`/
  `mt-3`/`mb-2`, `rounded-none border-x-0` strip ×1, `self-stretch rounded-kira-sm border` ×2).
- Tone names: `err` (Badge), `destructive` (Alert, DropdownMenuItem), `danger` (Button), `error`
  (tokens), `note` vs `info`.
- **Inline errors**: `FieldError` 41 in 22 files; hand-rolled `text-error` text on `p`/`span`/`div`
  74 in 57 files (K 30/26, S 15/7, W 14/11, G 10/8, D 5/5).
- **Invalid controls**: `aria-invalid:border-error` plus a 3px `aria-invalid:ring-3 ring-error/20`
  halo on Input, Textarea, Checkbox, Radio, Button (P122 retired the 3px focus halo, not this one).

### 1.8 Context menus and dropdowns

- Point-anchored context menus: workbench `ContextMenu.vue` (store, 90 call refs in 25 files) and
  git-ui `RowContextMenu.vue` + `MenuSections.vue` (8 consumers). Same item anatomy (16px icon box,
  13px icon, label, shortcut, trailing check), rendered twice.
- `DropdownMenuContent` 11 in 11 files, 6 widths (`w-36 w-40 w-52 w-56 w-65 min-w-45`); base
  `min-w-32 w-(--reka-dropdown-menu-trigger-width) shadow-md`. `DropdownMenuItem` base `px-1.5 py-1`
  (height from text) vs `rowVariants` `menu` `h-control gap-1`. `DropdownMenuRadioItem` 5
  (indicator leading) vs ContextMenu check (trailing). `DropdownMenuShortcut` `tracking-widest`.
- `PopoverContent` 25 in 22 files (P262 widths), menus built on Popover + rows: `SavedListMenu`,
  `FilterHistoryMenu`, `ConsoleSavedMenu`, `ColumnsMenu`, `ProjectionMenu`, `VariableHistoryMenu`.

### 1.9 Scrollbars

- One webkit scrollbar in `T/base.css:47-68` (12px, thumb `--kira-scrollbar`, 3px transparent
  border, no hover/active state). Monaco mirrors the thumb for normal/hover/active
  (`W/editor/monacoTheme.ts:224-226`); xterm (`@xterm/xterm` 6.0.0) uses its own default.
- Hide: `scrollbar-none` utility 3 files vs arbitrary `[scrollbar-width:none]` 2
  (`K/ade/v2/sessions/AdeSessionStrip.vue:18`, `M/terminal/KeyBar.vue:25`).
- Mobile imports `base.css`, so phones get the 12px desktop scrollbar rules.

### 1.10 Split and resize handles (user addendum)

| Handle | Where | Thickness | Rest | Hover/drag | Hit | Focus | Keys | Gap |
|---|---|---|---|---|---|---|---|---|
| reka `ResizableHandle` shell | `W/components/WorkbenchShell.vue:125` left panel / main | 2px (override `w-0.5`) | transparent | `bg-focus` | margins 4 fine / 8 coarse | global 1px outline | reka arrows/Home/End | `gap-0.5` both sides, framed panes |
| `DockResizeHandle` | `WorkbenchShell.vue:152` main / dock | 2px `h-0.5` | transparent | `bg-focus` | `before:` ±4 / ±8 coarse | global outline | ±10px, Home/End | `gap-0.5`, framed |
| reka `ResizableHandle` default | 7 Studio in-view splitters (`KeyValuePane`, `HttpRequestView`, `GrpcRequestView`, `BrowseView`, `DataView`, `StreamView`, `ConsoleView`), `K/ade/v2/workflows/AdeWorkflowGraph.vue:352` | 4px `w-1`/`h-1` | 1px inset `--kira-border` line | `bg-focus`, line cleared | margins 4/8 except ADE (none) | global outline | reka | 0, flat panes |
| `AdePanelResizeHandle` | `K/ade/v2/panel/AdePanel.vue:46`, `K/ade/v2/review/AdeReviewWindow.vue:71,91` | 4px `w-1` | 1px inset line | `bg-focus`, also on focus | element only (4px) | `outline-none` + `bg-focus` | ±16px, no Home/End | AdePanel `gap-0.5` framed; review window 0, flat sections |
| `KuiColumnResizeHandle` as pane edge | `G/App.vue:1808` detail pane | 5px `w-1.25 -ml-0.5` | transparent | `bg-focus` hover/focus | element | `outline-none` + `bg-focus` | ±8px | 0 |
| `KuiColumnResizeHandle` columns | `G/components/CommitGrid.vue:1331-1351` ×3, `S/views/stream/StreamView.vue:1130-1175` ×4 | 5px / 4px | transparent | CommitGrid `bg-focus`; StreamView none | element | CommitGrid outline-none; StreamView outline | ±8px | n/a |
| SlickGrid header resizer | `slickTheme.css:695` | 4px `right:-2px` | transparent | none | element | n/a | none | n/a |

7 looks, 3 thicknesses (2/4/5px), 3 hit models, 3 focus treatments, 4 keyboard steps (reka, 8,
10, 16). `cursor-*-resize` hand-written 11 in 6 files. P262 §2.7 decided `AdeReviewWindow` adopts
framed panes and list bounds 180-480/260; never landed (sections flat, `LEFT_MIN 220`/`LEFT_MAX
560`).

### 1.11 Cards and panels

- Hand-rolled boxed blocks (`rounded-kira*` + `border` + padding in one class): 32 files
  (S 7, K 10, M 3, W 11, G 1): radius `sm` 26 / bare 13, border `border` 27 / `border-strong` 5,
  fill `bg-field` 8 / `bg-bg` 5 / `bg-elevated` 4 / none, padding `p-1` `p-1.5` `p-2` `p-3`
  `px-2.5 py-2` `py-3 px-2`. Examples: `RunLog.vue:27`, `ScriptProgress.vue:47`,
  `DateTimePicker.vue`, `AdeStepInspector.vue` ×3, `ScheduleConfirmDialog.vue`.
- Titled sections: docker `DetailSection.vue` (56 uses in 7 files: `rounded-kira border bg-field/40`,
  uppercase `h-control` header), ADE panel blocks (`AdeStageBlock`, `AdeWorkflowBlock`).
- `shadow-kira` on 5 non-floating surfaces (ADE `AdeTaskCard` board card, others floating).

### 1.12 Kbd hints

- 0 `<kbd>`, no `Kbd` primitive, yet `TooltipContent` already styles `data-slot=kbd`.
- Shortcut text: `DropdownMenuShortcut` in `ContextMenu` (menu form); `({{ formatShortcut(...) }})`
  muted text 3 (`AdeTaskCard.vue:243`, `AdeBranchRow.vue:238`, `AdeTaskPanel.vue:44` in a tooltip
  array); literal "Cmd/Ctrl+Enter" in help text 2 (`W/automations/ScriptBodyField.vue:51,53`).

### 1.13 Colour tokens and status colours

- Token tones exist (`--kira-ok/warn/error/info`, `warn-text`, `note-text`, `state-on`); no stock
  Tailwind palette class anywhere (0).
- Literal colours in app code: `.vue` 32 in 3 files (`S/theme/EngineIcon.vue` 30 brand marks,
  `D/components/OriginIcon.vue` `#00b4ff` compose brand, 1 git comment); `.ts` 116 in 7 files
  (`monacoTheme.ts` 73 editor theme, `setiFileIcon.ts` icon palette, `K/ade/v2/palette.ts` work
  palette guarded by `check-ade-colours.sh`, `ansi.ts` log data).
- Scrims: 3 (`DialogOverlay` `bg-black/10 backdrop-blur-xs`, `TextPromptDialog.vue:46`
  `bg-black/50`, `G/App.vue:1849` drawer `bg-black/10`); `bg-white` QR `MobileQr.vue:12`.
- Tone alphas in app code: `bg-warn/` 6 in 5 files, `text-*/N` 1.

### 1.14 Focus rings and disabled states

- Focus: base `:focus-visible` 1px inset `--kira-focus` outline (P122/P130) on everything; theme
  controls also swap `focus-visible:border-focus` (9 bases), which the outline already covers.
  App code: `outline-none` 14 in 10 files (CommitGrid ×3, FileTree ×2, AutocompleteField ×2,
  `InlineRenameInput`, `AdeNotesEditor`, `ReviewThread`, `ReviewView`, git `App.vue`,
  `ContainerTable`, `AdePanelResizeHandle`), `focus-within:border-focus` 2
  (`ConnectionDialog`, `AdeBacklogRow`), `focus-visible:outline-focus` 1 (`ContainerTable`).
- Disabled, 4 recipes in theme: `opacity-50` (most), `opacity-45` (`toolbar-primary`,
  `dialog-primary`, `dialog-danger`), `text-disabled cursor-default` (NativeSelect),
  `bg-border-strong/50` + `cursor-not-allowed` (Input, Textarea, InputGroup); `rowVariants`
  `disabled` = `text-muted-foreground` (same as `muted`). App: `data-[off]:opacity-40`
  (`ConnectionDialog` kind cards), `disabled:opacity` 4 in 2 files.

### 1.15 P262 leftovers found in the current tree

- `text-kira-xs` 5 in 3 S files (outside the grid CSS that P123 keeps); stock `text-xs/sm` 2
  (mobile `ReplySheet`, `TerminalScreen`); `text-[Npx]` 5 (`K/views/repo/RepoFileView.vue`);
  stock `rounded`/`rounded-md` 6 in 3 files (`StreamView`, `AdeResultEdge` ×4, `GitPanel`); raw
  heights `h-5..h-12` 24 in 16 files (K 16/9, D 6/5, S 1, M 1 besides the `h-11` touch rule).
- `AdeReviewWindow` framing and bounds (§1.10).
- `rowVariants` `menu` `gap-1` vs every menu item `gap-1.5`.

### 1.16 Mobile (`M/`, 13 `.vue` files)

`Alert` 9, `Badge` 2, status dots 3 sizes, `Empty` 3, native `title` 1 (`AppShell`), stock text
sizes 2, `[scrollbar-width:none]` 1, no checkbox/switch/radio, no tooltip, no menu, no table, no
spinner. Touch rule `h-11` (P262) holds.

Totals: 246 files carry at least one hit of a P263 family (S 74, K 65, M 11, W 42, G 32, D 22),
plus theme and kira-ui primitives.

## 2. Decisions (final)

### 2.1 Colour and status tokens

| Element | Spec | Why |
|---|---|---|
| Tone vocabulary | `ok` (success), `warn`, `error`, `info` in every variant API; neutral = `text-muted-foreground`; inactive = `disabled`; `state-on` unchanged. Renames: Badge `err` → `error`; Alert `destructive` → `error`, `note` → `info`, `default` deleted (default variant `info`); DropdownMenuItem `destructive` → `danger`; `statusClass`/`grpcCodeClass` return `'error'`. Button `danger`/`dialog-danger` stay (action roles, not tones) | one name per tone; tokens already say `error`/`info` |
| Chip tint | `bg-<tone>/16 text-<tone>` (ok 14 → 16) | one alpha per surface kind |
| Banner tint | `bg-<tone>/10 border-<tone>/20`; text `text-error`, `text-warn-text`, `text-note-text` (info), `text-ok` | `warn` already this; `note` 8 → 10; `destructive` gains the tint it lacked |
| Solid tone | `bg-<tone>` only in `StatusDot` and `Progress` fill | a solid fill is a signal, not a surface |
| App code | never writes a tone alpha (`bg-warn/16`, `text-error/90`); uses `Badge`, `Alert`, `StatusDot`, `FieldError` | tints live in one cva each |
| Literals | none in app code. Named exemptions: brand marks (`EngineIcon.vue`, `OriginIcon.vue`), editor/terminal/icon themes (`monacoTheme.ts`, `setiFileIcon.ts`), log data (`ansi.ts`), ADE work palette (own guard), QR `bg-white` (scanner contrast) | data and third-party themes are not chrome |
| Scrim | new token `--kira-scrim: rgb(0 0 0 / 0.3)` → `bg-scrim`; `DialogOverlay` `bg-scrim` (drops `backdrop-blur-xs`), `TextPromptDialog` and git-ui drawer `bg-scrim` | 3 scrims for one role; blur repaints the whole window on WebKitGTK |
| Scrollbar tokens | `--kira-scrollbar-hover: #646464b3`, `--kira-scrollbar-active: #bfbfbf66` (VS Code Dark Modern) | thumb gives no hover/drag feedback today |

### 2.2 Badges, chips, pills, status dots

| Element | Spec | Why |
|---|---|---|
| `Badge` | every text pill (status word, type, method, code, tag, count). Variants `default chip ok warn error info count`. Shape unchanged (`h-control-sm rounded-kira-sm px-1 text-kira-sm gap-1`, `count` pill). Base drops `font-data`; new boolean prop `data` → `font-data` for values that came from data (HTTP status, gRPC code, column type, method, TTL, ids, sizes); UI words (Running, Draft, Smart) render UI font | LAW 08 (P26): app-written words take the UI font |
| Chip components | `AdeChip`, `AdeRepoTag`, `AdeRepoChip`, `AdeAutomationChip`, `EndpointChip`, `SmartBadge`, `RunStatusBadge` render `Badge` (`variant="chip"` + ADE tone class, or a tone variant); no own shape string | 7 shapes for one element |
| Ad-hoc pills | the 3 spans become `Badge` | same |
| `count` | attention counts only (P262 §2.7) | unchanged |
| `StatusDot` (new, theme) | `span.inline-block size-2 shrink-0 rounded-full`; prop `tone: 'ok'\|'warn'\|'error'\|'info'\|'muted'\|'state-on'` (`muted` = `bg-disabled`), `color?: string` (data colour, e.g. ADE task colour, inline style), `pulse?` (`animate-pulse`, transitional states such as connecting), `label?` (`role="img"` + `aria-label`); mobile same 8px | 4 sizes today; 8px reads at both densities |

### 2.3 Checkboxes, switches, radios

| Element | Spec | Why |
|---|---|---|
| Rule | **Switch**: a boolean that takes effect the moment it flips (settings panes, live view filters, dialogs with only Close). **Checkbox**: an option inside a form committed by a primary button (dialogs, editors with Save/Apply), multi-select in lists, menus, trees, and enable cells in tables. **RadioGroup**: one of 2-5 exclusive options with a label each in a form; more than 5 → `NativeSelect`; a short value picker in a bar → `SecondaryTabs variant="segmented"` (P262) | platform convention (Apple HIG, Material): switch = live, checkbox = pending |
| Site changes | Checkbox → Switch: `S/workbench/settings/ApiPane.vue` ×3, `DatabaseMcpPane.vue` ×2, `AppearancePane.vue` ×1, `K/workbench/settings/AppearancePane.vue` ×1, `W/settings/fields/WordWrapField.vue`. Switch → Checkbox: `AdeClaudeDialog` ×2, `ScriptDialog` ×2, `ScheduleFields` ×2, `McpToolsField` ×1, `AdeWorkflowGraph` ×1, `AdeStageInspector` ×1, `AdeStepResults` ×1, `EditSize` ×1, `EditRecreateSection` ×1. Stay Switch: `ClaudeCodePane`, `MobileAccessPane`, Space `AdvancedPane`, `NotifyPromptsField`, `MemoryPanel` include-history (live filter), `AdeTaskTab` parked (persists on flip), `ReposDialog` folder watch (dialog has Close only) | the rule applied once |
| Checkbox look | `size-3.5` (14px, `--kira-control-inline-h`, new `--spacing-control-inline`) `rounded-kira-xs border border-border-strong bg-field`; checked `bg-primary border-primary text-primary-foreground`, check icon 10px; drops `rounded-[4px]` and `dark:` fills | the token exists for exactly this box; 16px was shadcn's default |
| Radio look | same box `rounded-full`, checked dot 6px `bg-primary-foreground` on `bg-primary` | same |
| Switch look | track `h-3.5 w-6.5` (14×26) `rounded-full border border-border-strong bg-field`, checked `bg-primary border-primary`; thumb `size-2.5` `bg-fg` → checked `bg-primary-foreground`, `translate-x-0.5` / `translate-x-3.5` | same row height as a checkbox, so lists of mixed options align |
| Label | `Field orientation="horizontal"`, control first, then `FieldLabel` (P262 §2.5); whole label clickable | unchanged |
| Hidden native radios | `EnvironmentsView` active environment → `RadioGroup` across rows (`RadioGroupItem` per row, testid kept); `ConnectionDialog` kind cards → `RadioGroup` + `RadioGroupItem as-child` on the card (card look unchanged, `data-[disabled]` instead of `data-[off]`) | radios are `RadioGroup`; reka keeps arrow-key roving |
| `SwatchRadio` | unchanged (colour swatches) | a swatch is not a text option |
| Mobile | none today; a future one is the same primitive in a `min-h-11` row with the label as tap target | touch minimum |

### 2.4 Tooltips

| Element | Spec | Why |
|---|---|---|
| Any hover hint | theme `Tooltip`: `TooltipIconButton` for icon buttons, `Tooltip` > `TooltipTrigger as-child` otherwise; `data-kira-tip` (AttributeTooltip) only on DOM the app does not render through Vue (SlickGrid headers, git grid rows) | one look, one delay, keyboard-focus open |
| Native `title` | retired on HTML elements (21 sites). Truncated-value reveal → `Tooltip` with the full value; hint → `Tooltip`; mobile → none (visible text or `aria-label`). Component props named `title` unaffected | native tooltips ignore the delay, theme and focus |
| Provider | theme `TooltipProvider` defaults `delayDuration 400`, `skipDelayDuration 300`, `disableHoverableContent true`; the 4 hosts drop the props | 4 copies of the same props |
| Content | base adds `whitespace-pre-line break-words`, keeps `max-w-xs`; only `whitespace-pre-wrap` allowed as override (verbatim payloads); `max-w-72` dropped | newline hints render without per-site classes |
| Shortcut | `Kbd` after the label inside the content (§2.11) | TooltipContent already styles `data-slot=kbd` |

### 2.5 Toasts and transient feedback

No toast host: none exists and P92 decided against one; adding one is a feature. Channels, by
case: a failed operation in a view → `Alert` strip at the top of that view (§2.7, git
`FailureBanner` model); in a dialog → `FieldError` in `DialogFooter #start`; background work →
OpLog/Operations panel and StatusBar item; copy → in-place swap for 1500ms (icon buttons: icon
`check` and label "Copied"; labelled buttons: label "Copied"). All current sites already match; the
shared clipboard composable is P264.

### 2.6 Loading states

| Element | Spec | Why |
|---|---|---|
| `Spinner` (new, theme) | `CodiconIcon` + Tailwind `animate-spin` (1s linear), props `size` 12/13/24 (default 13), `icon` `loading` (default) \| `sync` \| `refresh` (an action's own icon spinning, VS Code `~spin` convention), `label` (default "Loading"; `role="status"` + `aria-label`) | 3 mechanisms today |
| Retired | `codicon-modifier-spin` (stepped 1.5s), CSS ring spinners (`GenerateDataDialog`, `AutomationsPanel` ×2, `ScriptProgress`); `RunState` ring stays (an idle/running/error indicator, P110 LAW 12, not a spinner) | one motion |
| Action in flight | button disabled, `Spinner` 13 replaces its leading icon (or leads the label), label unchanged | docker Apply/Recreate already |
| Row busy | `Spinner` 13 in the row's trailing meta slot | docker rows already |
| Pane first load | `Empty class="h-full"` > `EmptyMedia` > `Spinner :size="24"` > `EmptyTitle` "Loading <noun>…" (git `DetailPane`/`StashDetailPane` static icons start spinning) | P262 empty-state anatomy |
| List/popover line | new theme `InlineState` (`kind: 'loading'\|'empty'\|'error'`, default slot text): the P262 line `px-1.5 py-1 text-kira-sm text-subtle`, loading prefixed `Spinner` 13, error `text-error` + `role="alert"`, loading `role="status"` | P262 decided the line, not a component; 30 files hand-write it |
| `Skeleton` (new, theme `ui/skeleton`) | `animate-pulse rounded-kira-sm bg-field`; only where the layout is known before data (docker detail and edit forms, docker list placeholder rows) | docker already; nowhere else needs one |
| Progress | reka `Progress` (unchanged, `h-1 bg-field`, fill `bg-primary`); text beside `text-kira-sm text-muted-foreground tabular-nums` | compliant |
| Copy | "Loading…" with the ellipsis character, "Loading <noun>…" when a noun helps; never "..." | one spelling |

### 2.7 Alerts, inline errors, validation

| Element | Spec | Why |
|---|---|---|
| `Alert` variants | `error`, `warn`, `info` (default) per §2.1 tints | §2.1 |
| Base | `grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2 gap-y-0.5 rounded-kira border px-2.5 py-2 text-kira-md`; drops `w-full` (a grid block fills its row anyway; `w-auto` overrides vanish) | 20 `w-auto` overrides fight the base |
| Icon | prop `icon` (codicon name; defaults `error` / `warning` / `info`; `:icon="null"` none) rendered `CodiconIcon :size="13"` in the first column, `mt-px`, tone colour; `AlertDescription` takes no layout class | 15 hand-placed icon layouts; the svg slot never matched a codicon |
| Title | `AlertTitle` `font-medium` (500) | P262 weights |
| Placement | block inside padded content: no margin (parent `p-3 gap-3` spaces it); top-of-view banner: prop `strip` → `rounded-none border-x-0 border-t-0` full width (`FailureBanner`, `ConflictBanner`, `ImportReportStrip`, `RawExchangePane` strip, `GitBlockedPanel` style banners) | 6 margin values today |
| Action | `AlertAction` (exists) for a trailing button (`dialog kira-lg`) | unchanged |
| Inline error | every error sentence is `FieldError` (under a control, in `DialogFooter #start`, in a pane body); in a list or popover `InlineState kind="error"`. A `span.text-error` stays only for a status word or icon inside a row | 74 hand-rolled error texts |
| Invalid control | `aria-invalid` on the control → `border-error`; the `ring-3 ring-error/20` halo removed from Input, Textarea, Checkbox, Radio, Button | P122's 1px rule, applied to the invalid state |
| Help text | `FieldDescription` (P262) | unchanged |

### 2.8 Context menus and dropdowns

| Element | Spec | Why |
|---|---|---|
| Which primitive | command list from a button → `DropdownMenu`; right-click → point-anchored `DropdownMenu` (`ContextMenu` store, git `RowContextMenu`); picker with search → `Popover` + `rowVariants({ layout: 'menu' })` rows (P262); fixed value list → `NativeSelect` | unchanged split, now stated |
| `DropdownMenuContent` | base `min-w-45 w-max max-w-80 p-1 rounded-kira bg-elevated ring-1 ring-fg/10 shadow-kira` (drops trigger-width and `shadow-md`); callers pass no width | P262 said content-sized `min-w-45`; 6 widths today |
| Item | `DropdownMenuItem` base `h-control gap-1.5 px-1.5 rounded-kira-sm text-kira-md`, highlight `bg-hover`, `danger` `text-error` + highlight `bg-error/10`, disabled `opacity-50`; icon column `span.size-4` with a 13px icon whenever any item in that menu has an icon | ContextMenu's anatomy, the most-seen menu |
| `rowVariants` `menu` | `gap-1` → `gap-1.5` | picker rows equal menu items |
| Checked items | `DropdownMenuCheckboxItem`/`RadioItem` indicator moves to a trailing `size-4` slot (13px `check`) | matches ContextMenu's trailing check |
| Shortcut | `DropdownMenuShortcut` `ml-auto pl-4 text-kira-sm text-muted-foreground` (drops `tracking-widest`) | wide tracking spaced out `Ctrl+Shift+P` |
| Label | `DropdownMenuLabel` = `SectionHeading` string (P262) | one heading look |
| Separator | `-mx-1 my-1 h-px bg-border` | shadcn default on tokens |
| Rendering | `ContextMenu.vue` and git `MenuSections.vue` both render items through the parts above; no own item classes | 2 renderers, 1 anatomy |

### 2.9 Scrollbars and split handles

**Scrollbar.** One look from `base.css`: 12px, thumb `--kira-scrollbar`, `:hover`
`--kira-scrollbar-hover`, `:active` `--kira-scrollbar-active`, 3px transparent border, transparent
track and corner. Rules wrapped in `@media (pointer: fine)` so touch devices (mobile, iPad) keep
native overlay scrollbars. Monaco's three `scrollbarSlider.*` and xterm's
`scrollbarSlider{,Hover,Active}Background` read the three tokens. Hiding only via `scrollbar-none`,
only on horizontal tab/chip strips. No `ScrollArea` (P262). Why: VS Code feedback states, and a
desktop scrollbar on a phone steals width.

**Resize handles (user addendum).** One visual, one cva `resizeHandleVariants` in
`packages/theme/src/components/ui/resizable/index.ts`, bound by every handle component.

| Property | Spec | Why |
|---|---|---|
| Thickness | 2px visible bar (`w-0.5` vertical bar / `h-0.5` horizontal bar) | the shell handles, the most-seen two |
| Hit target | ±4px each side fine, ±8px coarse: reka handles via `hitAreaMargins` (default `{ fine: 4, coarse: 8 }` in `ResizableHandle`), the rest via the cva's `before:absolute before:-inset-x-1 pointer-coarse:before:-inset-x-2` (`-inset-y-*` on the other axis) | Dock's proven model; 10px grab without a 10px visual |
| Rest | `line: false` (default, between framed panes and on column edges, where a border already draws the edge): transparent. `line: true` (between flat panes inside one view): a 1px `--kira-border` inset line (the current divider shadow) | a framed pane has its own border; a flat pane has none |
| Hover / drag / keyboard focus | `bg-focus` fill (line cleared); drag state from `data-[state=drag]` (reka) or the component's dragging flag | every handle already uses `bg-focus` somewhere |
| Focus | `focus-visible:bg-focus focus-visible:outline-none` (the bar is the ring) | a 1px inset outline on a 2px bar is invisible |
| Cursor | `cursor-col-resize` / `cursor-row-resize` from the cva only | 11 hand-written cursors |
| Gap | between framed panes on chrome: parent `gap-0.5` on both sides (2 + 2 + 2px, the `WorkbenchShell` geometry); flat panes: 0 | shell geometry |
| Keyboard | Arrow keys ±10px, Home = min, End = max (where finite); reka px groups get `keyboardResizeBy: 10` (`WorkbenchShell` project group); reka % groups keep reka's default; `AdePanelResizeHandle` 16 → 10 and gains Home/End; `KuiColumnResizeHandle` default `step` 8 → 10 and gains Home/End | Dock's step, the one hand-tuned px step |
| ARIA | `role="separator"`, `aria-orientation`, `aria-valuenow/min/max`, `aria-label` (existing labels kept) | unchanged |

Per site: shell left handle (`variant` default `line: false`, the `w-0.5 shadow-none` override
deleted), `DockResizeHandle` (`line: false`), `AdePanelResizeHandle` (`line: false`; AdePanel sits
in the AdeShell row's `gap-0.5` between framed panes, same as the shell), `AdeReviewWindow` ×2
(`line: false`, after the window adopts framed panes: sections `rounded-kira border border-border
bg-bg overflow-hidden` in a `flex gap-0.5 px-1.5 pb-0.5 bg-chrome` row, P262 §2.7; left bounds
180-480 default 260, right 280-720 kept, stored widths clamped not reset), 7 Studio in-view
splitters and `AdeWorkflowGraph` (`line: true`; `AdeWorkflowGraph` gains `hitAreaMargins` via the
new default), git detail pane `G/App.vue:1808` (`line: false`, on the pane's own border), column
handles (`CommitGrid` ×3, `StreamView` ×4, `line: false`, centred on the column edge: caller keeps
only `absolute inset-y-0 z-2` and its left/right position), SlickGrid `.slick-resizable-handle`
(`slickTheme.css`: 10px hit box `right: -5px`, `::after` 2px centred bar, `--kira-focus` on hover
and during `.slick-header-column-active` drag). Mechanics stay per component (reka, VueUse
`useDraggable`, pointer capture); merging them or root-causing the P132 reka hang is P264.

### 2.10 Cards and panels

| Element | Spec | Why |
|---|---|---|
| `Card` (new, theme `ui/card`: `Card`, `CardHeader`, `CardTitle`, `CardAction`, `CardContent`, `CardFooter`) | `variant="inset"` (default): a box inside a form, dialog or pane (preview, command/cURL preview, run outcome, summary, log output): `flex flex-col gap-1.5 rounded-kira-sm border border-border-strong bg-field px-2.5 py-2`; log/output content adds `font-data text-kira-sm`. `variant="section"`: a titled block in a detail pane (docker `DetailSection`, ADE panel blocks, Engine/Stats): `rounded-kira border border-border bg-elevated`, `CardHeader` `flex h-control items-center gap-1.5 border-b border-border px-3` with the `SectionHeading` title string and `CardAction` `ml-auto`, `CardContent` `p-3` (`flush` → `p-0`) | `ScriptProgress` (theme-owned) for inset; DetailSection (56 uses) for section, moved to the elevated surface every other raised block uses |
| `DetailSection.vue` | thin wrapper over `Card variant="section"` (props unchanged) | 56 call sites keep their API |
| Shadow | `shadow-kira` only on floating surfaces (menus, popovers, tooltips, drag ghosts); cards flat | depth means "floats" |
| Exempt | ADE plan board task cards (`AdeTaskCard` tone border, shadow, P129 board visual) and mobile list rows (`li` with `border-b`) | domain visuals, not content boxes |
| Panels | P262 framed panes and side panels stand | — |

### 2.11 Kbd hints

| Element | Spec | Why |
|---|---|---|
| `Kbd` (new, theme `ui/kbd`) | `kbd[data-slot=kbd] inline-flex h-4 min-w-4 items-center justify-center rounded-kira-xs border border-border-strong bg-field px-1 font-ui text-kira-sm text-muted-foreground`; inside `TooltipContent` the existing `data-slot=kbd` rule adds `bg-bg/15 border-transparent text-bg`. One `Kbd` per formatted chord (`formatShortcut` already returns `⌘⇧P` / `Ctrl+Shift+P`) | shadcn-vue's primitive; the tooltip already expects it |
| Where | tooltip trailing shortcut; inline help ("Press `Kbd` to save"); ADE `({{ formatShortcut }})` → `Kbd`. Menus keep `DropdownMenuShortcut` (plain right-aligned text, the menu form) | two forms, one per surface |
| `TooltipIconButton` | new prop `kbd?: string` → `Kbd` after the label in the content | theme cannot import `formatShortcut`; callers pass the text |
| Scope | only existing hint texts migrate; no new hints | no feature work |

### 2.12 Focus rings and disabled states

| Element | Spec | Why |
|---|---|---|
| Focus ring | the base `:focus-visible` 1px inset `--kira-focus` outline (P122/P130) everywhere; theme bases drop `focus-visible:border-focus` (the outline already sits on the border) | one ring, no double paint |
| Fill-focus exceptions | rows/items without room for an outline use their fill (`rowVariants` `menu`, menu items, resize handles) | unchanged |
| Caret hosts | Monaco, CodeMirror, xterm, contenteditable editors (`AdeNotesEditor`, `ReviewThread` compose, `AutocompleteField` inner textarea, `InlineRenameInput`) keep `outline-none` on the inner element and show `focus-within:focus-ring` on their box; `focus-within:border-focus` retired | box reads like an input |
| Grid canvases | `CommitGrid` and git `App.vue` grid viewport keep `outline-none` (selection row shows focus): named exemption | SlickGrid canvas |
| Disabled | controls `disabled:opacity-50` + `disabled:pointer-events-none` (buttons, toggles) or `disabled:cursor-default` (inputs, selects, textarea); no `cursor-not-allowed`, no fill swap; `opacity-45` → 50; NativeSelect `text-disabled` → `opacity-50`; `rowVariants` `disabled` → `opacity-50 cursor-default` (no hover); menu items `data-disabled:opacity-50`; `ConnectionDialog` `data-[off]:opacity-40` → `data-[disabled]:opacity-50`; a disabled field's label `group-has-disabled/field:opacity-50` (exists) | 4 recipes → 1; a desktop app shows no "forbidden" cursor |
| `text-disabled` | only for non-control text that marks absence (P16: NULL markers) | token's stated role |

### 2.13 Tables, grids, lists

| Element | Spec | Why |
|---|---|---|
| `Table` (new, theme `ui/table`: `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`, `TableEmpty`) | table `w-full border-collapse text-kira-md`; head row `bg-elevated border-b border-border-strong` (sticky `top-0` inside a scroller); head cell `h-row px-2 text-left align-middle text-kira-sm font-normal text-muted-foreground whitespace-nowrap`, sentence case; body row `h-row border-b border-border hover:bg-hover data-[state=selected]:bg-select`; cell `px-2 align-middle`; numeric `text-right tabular-nums`; data values `font-data`. Prop `columns` on `Table` adds column dividers `border-r border-border last:border-r-0` | SlickGrid's header and cell (elevated, strong border, sm muted, 8px, row height): the app's main table |
| Dividers | `columns` only on data tables (Definition sections, `StreamView`, `FkPreviewPopover`); list tables (docker, OpLog/Operations, variables, history) rows only | grids show cell edges, lists do not |
| CSS-grid tables | theme exports `tableHeadRowClass`, `tableHeadClass`, `tableRowClass`, `tableCellClass` (the same strings) for `grid-cols-[...]` tables (docker `ContainerTable`, `VariablesOverviewPanel`, `OpLogPanel`, Operations panels, `ResponseDiffDialog`, `GenerateDataDialog` preview); docker header drops `uppercase tracking-wider` | uppercase is `SectionHeading` only (P262) |
| Read-only key/value grid | P262 §2.5 rule (`grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1`) | unchanged |
| SlickGrid, CommitGrid | CSS themes already match; only the column handle (§2.9) | — |
| Lists outside side panels | `rowVariants` (`tree`, `double`, `menu`) + `rowIndent`; hand-rolled `hover:bg-hover`/`bg-select` row states retired (U18 extended to every file); a hoverable non-row surface (chip, card) is a `Button` variant | P262 §2.7 rows, now everywhere |
| Row height | `useRowHeight()` (`single`, `double`) replaces the 6 density formulas, SlickGrid hosts included (same numbers) | P262 helper |
| Virtualizers | unchanged (behaviour, P264) | — |

### 2.14 Typography and size leftovers

`text-kira-xs` → `text-kira-sm` (CSS grid themes keep `--kira-t-xs`); mobile `text-xs/sm` → kira
scale; `text-[Npx]` → kira scale; stock `rounded`/`rounded-md` → `rounded-kira-sm`; raw `h-5..h-12`
→ by role `h-control-sm` (18), `h-control` (22), `h-control-lg` (26), `h-row`, `h-bar`; mobile
`h-11` kept. Why: P262 §2.1 scale.

### 2.15 Mobile equivalents

| Family | Mobile |
|---|---|
| Tables/lists | list rows `li` `min-h-11 border-b border-border px-3`, no tables |
| Badges/dots | `Badge`, `StatusDot` (8px) as desktop |
| Checkbox/switch/radio | §2.3 rule, `min-h-11` row |
| Tooltips | none; `title` removed, meaning in visible text or `aria-label` |
| Toasts | none (§2.5) |
| Loading | `Spinner`, `Empty` + `Spinner` 24, no skeleton |
| Alerts/errors | `Alert`, `FieldError` as desktop |
| Menus | none today; a future one is a `Dialog size="sm"` action list (no hover menus on touch) |
| Scrollbars | native overlay (`pointer: fine` gate) |
| Handles | none |
| Cards | list rows; `Card inset` for boxed content (pair code, reply preview) |
| Kbd | none (terminal `KeyBar` keys are buttons) |
| Colour | §2.1 tokens |
| Focus/disabled | §2.12 |

## 3. Foundation (step 1, sequential, before any worktree)

One Sonnet implementer on `v2.0`, main checkout. Owner of every file in the first table for the
whole phase; streams never edit them (findings go to the stream's findings file, fixed in
close-out).

| File | Change |
|---|---|
| `packages/theme/src/tokens.css` | `--kira-scrim`, `--kira-scrollbar-hover`, `--kira-scrollbar-active` |
| `packages/theme/src/tailwind-core.css` | `--color-scrim`; `--spacing-control-inline: var(--kira-control-inline-h)` |
| `packages/theme/src/base.css` | scrollbar hover/active, rules inside `@media (pointer: fine)` |
| `packages/workbench/src/editor/monacoTheme.ts`, `packages/workbench/src/terminal/terminalRenderer.ts` | scrollbar tokens (Monaco hover/active; xterm three `scrollbarSlider*`) |
| `ui/badge/variants.ts`, `Badge.vue` | `err` → `error`, `ok/16`, base drops `font-data`, prop `data` |
| `ui/alert/{index.ts,Alert.vue,AlertTitle.vue,AlertDescription.vue}` | §2.7 base, variants, `icon`, `strip` |
| `ui/checkbox`, `ui/radio-group`, `ui/switch` | §2.3 looks; invalid halo removed |
| `ui/input`, `ui/textarea`, `ui/input-group`, `ui/native-select`, `ui/button`, `ui/toggle` | §2.12 focus/disabled/invalid |
| `ui/tooltip/{TooltipProvider,TooltipContent}.vue` | §2.4 defaults and base |
| `ui/dropdown-menu/*` | §2.8 content, item (`danger`), shortcut, label, separator, trailing indicators |
| `ui/dialog/DialogOverlay.vue` | `bg-scrim`, no blur |
| `ui/resizable/{index.ts,ResizableHandle.vue}` | `resizeHandleVariants` (axis `x`/`y`, `line`), handle `line` prop default `true`, `hitAreaMargins` default `{ fine: 4, coarse: 8 }` |
| `ui/skeleton`, `ui/kbd`, `ui/card`, `ui/table` (new, shadcn-vue registry, restyled) | §2.6, §2.11, §2.10, §2.13 incl. table class constants |
| `components/Spinner.vue`, `StatusDot.vue`, `InlineState.vue` (new) | §2.6, §2.2 |
| `components/rowVariants.ts` | `menu` `gap-1.5`; `disabled` `opacity-50 cursor-default` |
| `components/TooltipIconButton.vue` | prop `kbd` |
| `components/ScriptProgress.vue`, `RunState.vue` | ScriptProgress → `Spinner` + `Card inset` string; RunState unchanged (frozen) |
| `packages/kira-ui/src/KuiColumnResizeHandle.vue` | `step` default 10, Home/End |
| `packages/workbench/src/components/{WorkbenchShell,DockResizeHandle,ContextMenu}.vue` | handles per §2.9 (shell `keyboardResizeBy` 10, override class deleted); ContextMenu items per §2.8 |
| `packages/workbench/src/prompt/TextPromptDialog.vue` | `bg-scrim` |
| `apps/kira-space/frontend/src/ade/v2/panel/AdePanelResizeHandle.vue` | cva, step 10, Home/End |
| `apps/kira-space/frontend/src/ade/v2/review/AdeReviewWindow.vue` | framed panes, bounds (§2.9) |
| `packages/git-ui/src/MountRoot.vue` | provider props dropped |
| `scripts/check-ui-primitives.sh` | guards U22-U38; allowlist reading restored (P262 format) |
| `scripts/ui-primitives-allowlist/stream-{a,b,c}.txt` (new) | every file failing a new guard at foundation tip, split by §4.1 |
| `docs/ARCHITECTURE.md` "UI architecture" | one paragraph: §2 rules and the guard (close-out finalises) |

Early, targeted edits in stream-owned files (before worktrees exist, so no conflict), each limited
to the named change:

- Mechanical renames repo-wide: `Alert` `variant="destructive"` → `"error"`, `"note"` → `"info"`;
  `Badge` `variant="err"` → `"error"`; `statusClass`/`grpcCodeClass`
  (`packages/shared/domain/{http,grpc}.ts`) return `'error'`; ContextMenu `danger` mapping. One
  `sed`-scale commit, typecheck green.
- `TooltipProvider` props dropped in `apps/kira-studio/frontend/src/App.vue`,
  `apps/kira-space/frontend/src/App.vue`.
- Handle class bindings: `packages/git-ui/src/App.vue:1808`,
  `packages/git-ui/src/components/CommitGrid.vue:1331-1351`,
  `apps/kira-studio/frontend/src/views/stream/StreamView.vue:1130-1175` (look classes → cva);
  `apps/kira-studio/frontend/src/views/shared/slick/slickTheme.css` resizer;
  `apps/kira-space/frontend/src/ade/v2/workflows/AdeWorkflowGraph.vue:352` (nothing to edit beyond
  the new default; listed so the PNG move is expected).
- Git-ui drawer scrim `packages/git-ui/src/App.vue:1849` → `bg-scrim`.
- `packages/docker-ui/src/components/DetailSection.vue` → `Card variant="section"` wrapper
  (reference migration).

Guards (`check-ui-primitives.sh`, same mechanics and scan dirs as U1-U21; guard kind `v` = `.vue`,
`vt` = `.vue` + `.ts`):

- U22 (v) native `title=` on an HTML element (`span div button i li dd dt a label Label p td th tr
  img code small section header`).
- U23 (vt) `animate-spin`, `animate-pulse`, `codicon-modifier-spin`, `~spin` (use `Spinner`,
  `Skeleton`, `StatusDot pulse`).
- U24 (v) `<Alert` class with `w-`, `m-`, `mx-`/`my-`/`mt-`/`mb-`, `bg-`, `rounded`, `border`, `p-`,
  or `<AlertDescription` with any class except `whitespace-pre-wrap`; `variant="default"`.
- U25 (v) `<p`/`<div` whose class has `text-error` (use `FieldError`/`InlineState`).
- U26 (vt) `variant="(err|destructive|note)"` on Badge/Alert/DropdownMenuItem; tone alpha
  `(text|bg|border)-(ok|warn|info|error)/\d+`.
- U27 (v) status dot or pill by hand: `rounded-full` with `size-(1.5|2|2.5)`/`w-2 h-2`/`w-2.5
  h-2.5`; `<span` with `rounded-full|rounded-kira-pill` and `px-` (use `StatusDot`/`Badge`).
- U28 (v) raw `type="(checkbox|radio)"` outside `SwatchRadio.vue`; `<Checkbox` in a `/settings/`
  path; `<Switch` outside `/settings/` paths and the script's `SWITCH_SITES` list
  (`MemoryPanel.vue`, `AdeTaskTab.vue`, `ReposDialog.vue`).
- U29 (v) `<TooltipProvider` (theme exempt); `<TooltipContent` class other than
  `whitespace-pre-wrap`.
- U30 (v) `<DropdownMenuContent` class with `w-`/`min-w-`/`max-w-`; `<DropdownMenuItem` class with
  `h-`/`py-`/`px-`/`gap-`.
- U31 (v) `cursor-(col|row)-resize`; `<(ResizableHandle|KuiColumnResizeHandle)` class with
  `w-`/`h-`/`bg-`/`shadow`/`cursor`/`outline`; `role="separator"` in a file without
  `resizeHandleVariants` (whole-file check).
- U32 (v) `[scrollbar-` arbitrary, `scrollbar-(?!none)` utilities, `::-webkit-scrollbar` in a
  component (use `scrollbar-none`, base).
- U33 (v) `Cmd/Ctrl` literal or `({{ formatShortcut` in a template (use `Kbd`).
- U34 (vt) colour literal `#[0-9a-fA-F]{3,8}\b` in a class, style or string outside the named
  exemptions (§2.1); `(bg|text|border)-(black|white)` (QR exempt).
- U35 (v) `outline-none|outline-hidden|outline-0|focus:outline|focus-visible:outline-|focus(-visible|-within)?:border-focus|cursor-not-allowed|disabled:opacity-(?!50\b)|data-\[off\]`
  outside the named caret hosts and grid canvases (§2.12).
- U36 (v) hand-rolled box: one class with `rounded-kira(-sm|-lg)?`, a full `border`, and `p-`/`px-`/
  `py-` (use `Card`); input-like boxes get named exemptions with a reason.
- U37 (vt) raw `<table|<thead|<tbody|<tr|<th|<td`; `rowDensity\s*===` outside
  `createSettingsStore.ts`; U18's `(hover:)?bg-(select|hover)` extended from side panels to every
  file (theme exempt).
- U38 (v) `text-kira-xs`, stock `text-(xs|sm|base|lg|xl|2xl)`, `text-\[\d`, stock
  `rounded(-md|-lg|-xl)?`, raw `h-(5|6|7|8|9|10|12)`.

Allowlist format (P262): `path` (file exempt while unmigrated) or `permanent U<n> path # reason`.
A stream edits only its own list; guards fail on stale entries, so lists only shrink.

No unit tests: `Spinner`, `StatusDot`, `InlineState`, `Kbd`, `Card`, `Table` parts, the cva are thin
(CLAUDE.md test bar). Coverage: existing UI specs (`tooltips`, `focus-ring`, `panel-resize`,
`control-sizing`, `docker-*`, `ade-v2-panel`, `ade-v2-review*`, `settings-*`) and both visual
projects through the reference migrations.

Foundation commits (Conventional Commits, each hook-green): (1) tokens, scrollbar, scrim;
(2) tone renames repo-wide + Badge/Alert bases; (3) checkbox/radio/switch, focus/disabled/invalid
bases; (4) tooltip, dropdown-menu, ContextMenu; (5) new primitives (`Spinner`, `Skeleton`,
`StatusDot`, `InlineState`, `Kbd`, `Card`, `Table`), `TooltipIconButton kbd`, ScriptProgress,
DetailSection; (6) resize handles end to end (cva, ResizableHandle, shell, Dock, ADE, Kui, callers,
slickTheme, AdeReviewWindow framing); (7) guards + allowlists + lint wiring + ARCHITECTURE
paragraph; (8) baselines; (9) plan "Foundation result" (what landed, allowlist counts, deviations).
Verify: `bun run typecheck`, `bun run lint`, `bun run test:unit`, `bun run test:ui:studio`,
`bun run test:ui:space`, `bun run test:ui:space-mobile`, `bun run test:visual:update:studio` and
`:space`, inspect each diff is a §2 base change (checkbox 16 → 14, alert tint/icon, scrim, handle
thickness, scrollbar), re-run without update clean. Handle check: in the running app (or a UI spec
screenshot) the shell left handle, the dock handle and the ADE panel handle are pixel-equal in
thickness and colour at rest, hover and drag.

## 4. Streams (step 2)

Three named streams, worktrees off the **foundation tip** (same base commit for all three):
`/home/user/kira-p263-a` (branch `p263-a`), `/home/user/kira-p263-b` (`p263-b`),
`/home/user/kira-p263-c` (`p263-c`). One Sonnet implementer per stream, chunk after chunk in the
order below, one commit per chunk (more if a chunk splits into logical groups), each hook-green.
Each chunk removes its files from the stream's allowlist (or turns a line into `permanent ...`
with a reason). Per site the implementer applies §2 exactly. A file whose hits are already
compliant needs no edit. Discovery inside a file (what a component renders, its callers) uses
`codegraph_explore` first. P262-migrated files are cheap to re-touch: edit only the P263 families
in them.

### 4.1 Ownership (zero overlap)

| Stream | Owns | Files | Hits |
|---|---|---|---|
| Foundation (done before) | §3 first table (plus the listed early edits) | ~40 | — |
| A: Kira Studio | `apps/kira-studio/frontend/src/**` (minus foundation-early lines already landed), `apps/kira-studio/tests/**` except C's below, `scripts/ui-primitives-allowlist/stream-a.txt`, `docs/v2.2/plans/P263-stream-a-findings.md` | 75 | 438 |
| B: Kira Space + mobile + memory | `apps/kira-space/frontend/src/**` and `apps/kira-space/frontend/mobile/**` (minus foundation files), `packages/workbench/src/memory/**`, `apps/kira-space/tests/**` except C's below, `scripts/ui-primitives-allowlist/stream-b.txt`, `docs/v2.2/plans/P263-stream-b-findings.md` | 86 | ~280 |
| C: shared modules (git, Docker, Automations, workbench chrome) | `packages/git-ui/src/**` (minus `MountRoot.vue`), `packages/docker-ui/src/**`, `packages/workbench/src/**` except `memory/**` and foundation files; specs: Studio `apps/kira-studio/tests/ui/{docker-*,automations-*}.spec.ts`, Studio visual `automations-module.spec.ts` + snapshots; Space `apps/kira-space/tests/ui/{automations-*,repo-graph-*,repo-commit-*,repo-branch-picker,repo-floating-geometry,repo-review-interaction}.spec.ts`, Space visual `git-module.spec.ts` + snapshots; `scripts/ui-primitives-allowlist/stream-c.txt`, `docs/v2.2/plans/P263-stream-c-findings.md` | 87 | ~320 |

`packages/theme/**`, `packages/kira-ui/**`, `packages/shared/**`, `scripts/check-ui-primitives.sh`,
`package.json`, `docs/ARCHITECTURE.md`, `docs/v2.2/SPEC.md` belong to foundation/close-out only.
Spec support helpers: Studio `tests/ui/support/**` A, Space `tests/ui/support/**` B; a helper C
needs changed → C's findings file.

**No ordering dependency between streams**: all three consume only foundation primitives; no
source file, spec, PNG or allowlist is shared; each visual spec file and its snapshot directory has
one owner (a PNG another stream's change moves is recorded in that stream's findings file and
re-recorded in close-out, never by the other stream). Any needed change in another stream's or
foundation's file goes to the findings file and is fixed in close-out.

### 4.2 Chunks

Paths: `S/` `apps/kira-studio/frontend/src/`, `K/` `apps/kira-space/frontend/src/`, `M/`
`apps/kira-space/frontend/mobile/`, `p/` `packages/`. Families per file come from the guard hits
(alert, error text, badge/dot, toggle, tooltip, menu, spinner/loading, card, table/row, focus,
colour, leftovers).

Stream A order: A1 API + project, A2 data views, A3 HTTP/gRPC, A4 shared views + stream + Studio
workbench, A5 sweep.

#### A1 (23 files)
`S/api/BulkVariablesEditor.vue`, `S/api/CopyAsCurlDialog.vue`, `S/api/DynamicValuesDialog.vue`, `S/api/EditRawRequestDialog.vue`, `S/api/EnvironmentSelect.vue`, `S/api/EnvironmentsView.vue`, `S/api/ImportCurlDialog.vue`, `S/api/ImportReportStrip.vue`, `S/api/MethodSelect.vue`, `S/api/SaveRequestDialog.vue`, `S/api/VariableHistoryMenu.vue`, `S/api/VariableRow.vue`, `S/api/VariableSetView.vue`, `S/api/VariablesOverviewPanel.vue`, `S/project/ConnectionDialog.vue`, `S/project/CredentialsUpdateDialog.vue`, `S/project/DataGripImportDialog.vue`, `S/project/ErrorPopover.vue`, `S/project/FiltersDialog.vue`, `S/project/ProjectTree.vue`, `S/project/SchemaDialog.vue`, `S/project/TreeRow.vue`, `S/theme/EngineIcon.vue` (permanent U34 line only)

#### A2 (20 files)
`S/views/browse/BrowseView.vue`, `S/views/console/ConsoleResultGrid.vue`, `S/views/console/ConsoleSavedMenu.vue`, `S/views/console/ConsoleSlickGrid.vue`, `S/views/console/ConsoleView.vue`, `S/views/console/ExplainResultView.vue`, `S/views/definition/ColumnsSection.vue`, `S/views/definition/ConstraintsSection.vue`, `S/views/definition/DefinitionView.vue`, `S/views/definition/IndexesSection.vue`, `S/views/definition/PropertiesSection.vue`, `S/views/definition/ValidationSection.vue`, `S/views/documents/DocumentView.vue`, `S/views/documents/ProjectionMenu.vue`, `S/views/grid/ColumnsMenu.vue`, `S/views/grid/DataView.vue`, `S/views/grid/FkPreviewPopover.vue`, `S/views/grid/PreviewCommandPanel.vue`, `S/views/grid/SlickGridHost.vue`, `S/views/shared/slick/slickTheme.css` (handle already done; `text-kira-xs` stays in CSS, check only)

#### A3 (13 files)
`S/views/grpcrequest/CallHistoryList.vue`, `S/views/grpcrequest/GrpcRequestView.vue`, `S/views/grpcrequest/ResponsePane.vue`, `S/views/grpcrequest/SchemaBrowser.vue`, `S/views/httprequest/CookiesPane.vue`, `S/views/httprequest/HttpRequestView.vue`, `S/views/httprequest/RawExchangePane.vue`, `S/views/httprequest/RequestBodyPane.vue`, `S/views/httprequest/RequestSettingsPane.vue`, `S/views/httprequest/ResponseDiffDialog.vue`, `S/views/httprequest/ResponseHistoryList.vue`, `S/views/httprequest/ResponsePane.vue`, `S/views/httprequest/TimelinePane.vue`

#### A4 (19 files)
`S/views/shared/DateTimePicker.vue`, `S/views/shared/FilterHistoryMenu.vue`, `S/views/shared/SavedListMenu.vue`, `S/views/shared/celleditor/CellEditorView.vue`, `S/views/shared/celleditor/TimestampPane.vue`, `S/views/shared/document/DocumentRow.vue`, `S/views/shared/fields/FieldRowsTable.vue`, `S/views/shared/keyvalue/KeyValuePane.vue`, `S/views/stream/StreamComposeMessage.vue`, `S/views/stream/StreamView.vue`, `S/workbench/DbMcpApprovalDialog.vue`, `S/workbench/GenerateDataDialog.vue`, `S/workbench/TitleBar.vue`, `S/workbench/UploadObjectDialog.vue`, `S/workbench/panels/OperationsPanel.vue`, `S/workbench/panels/StudioStart.vue`, `S/workbench/settings/ApiPane.vue`, `S/workbench/settings/AppearancePane.vue`, `S/workbench/settings/DatabaseMcpPane.vue`

#### A5 (sweep, no new files)
Run `check-ui-primitives.sh` with an empty `stream-a.txt` to list any Studio file the guards hit
that no chunk named (plan gap: fix it in this commit, record it in the result). Screenshot
Connections, a data grid with cell dock, Definition, HTTP request/response, Settings > API in both
densities; fix §2 drift in A's files.

Stream B order: B1 Space repo + views + workbench, B2 ADE shell pieces, B3 ADE panel + review +
sessions, B4 ADE workflows + memory, B5 mobile, B6 sweep.

#### B1 (17 files)
`K/repo/GitPanel.vue`, `K/repo/RepoConfigForm.vue`, `K/repo/RepoReviewView.vue`, `K/repo/RepoSearchView.vue`, `K/repo/ReposDialog.vue`, `K/views/repo/RepoFileView.vue`, `K/views/repo/RepoMultiDiffView.vue`, `K/views/repo/ReviewThread.vue`, `K/workbench/ClaudeUsageItem.vue`, `K/workbench/OperationsPanel.vue`, `K/workbench/SettingsDialog.vue`, `K/workbench/StatusBar.vue`, `K/workbench/settings/AdvancedPane.vue`, `K/workbench/settings/AppearancePane.vue`, `K/workbench/settings/ClaudeCodePane.vue`, `K/workbench/settings/MobileAccessPane.vue`, `K/workbench/settings/MobileQr.vue` (permanent U34 line only)

#### B2 (19 files)
`K/ade/v2/AdeActivityIcon.vue`, `K/ade/v2/AdeAddPopover.vue`, `K/ade/v2/AdeBasePicker.vue`, `K/ade/v2/AdeCandidateRow.vue`, `K/ade/v2/AdeChip.vue`, `K/ade/v2/AdeConfirmDialog.vue`, `K/ade/v2/AdeRepoTag.vue`, `K/ade/v2/AdeTip.vue`, `K/ade/v2/backlog/AdeBacklogPage.vue`, `K/ade/v2/backlog/AdeBacklogPanel.vue`, `K/ade/v2/backlog/AdeBacklogRow.vue`, `K/ade/v2/dialog/AdeClaudeDialog.vue`, `K/ade/v2/notes/AdeNotesEditor.vue`, `K/ade/v2/plan/AdeActionCell.vue`, `K/ade/v2/plan/AdeBranchRow.vue`, `K/ade/v2/plan/AdePlanView.vue`, `K/ade/v2/plan/AdeRepoChip.vue`, `K/ade/v2/plan/AdeTaskCard.vue`, `K/ade/v2/run/AdeRunDialog.vue`

#### B3 (21 files)
`K/ade/v2/automation/AdeAutomationChip.vue`, `K/ade/v2/panel/AdeBranchPanel.vue`, `K/ade/v2/panel/AdeChangesTab.vue`, `K/ade/v2/panel/AdeEstimateField.vue`, `K/ade/v2/panel/AdeLinkRow.vue`, `K/ade/v2/panel/AdePanel.vue`, `K/ade/v2/panel/AdeRunLog.vue`, `K/ade/v2/panel/AdeRunOutcome.vue`, `K/ade/v2/panel/AdeSetupProgress.vue`, `K/ade/v2/panel/AdeStageBlock.vue`, `K/ade/v2/panel/AdeStageMover.vue`, `K/ade/v2/panel/AdeTaskPanel.vue`, `K/ade/v2/panel/AdeTaskTab.vue`, `K/ade/v2/panel/AdeWorkflowBlock.vue`, `K/ade/v2/review/AdeReviewAgentPanel.vue`, `K/ade/v2/review/AdeReviewCompose.vue`, `K/ade/v2/review/AdeReviewFiles.vue`, `K/ade/v2/review/AdeReviewSync.vue`, `K/ade/v2/sessions/AdeHeadlessPane.vue`, `K/ade/v2/sessions/AdeSessionId.vue`, `K/ade/v2/sessions/AdeSessionStrip.vue`

#### B4 (18 files)
`K/ade/v2/workflows/AdeResultEdge.vue`, `K/ade/v2/workflows/AdeStageGroupNode.vue`, `K/ade/v2/workflows/AdeStageInspector.vue`, `K/ade/v2/workflows/AdeStepInspector.vue`, `K/ade/v2/workflows/AdeStepNode.vue`, `K/ade/v2/workflows/AdeStepResults.vue`, `K/ade/v2/workflows/AdeWorkflowGraph.vue`, `K/ade/v2/workflows/AdeWorkflowYaml.vue`, `K/ade/v2/workflows/AdeWorkflowsPage.vue`, `p/workbench/src/memory/AddMemoryDialog.vue`, `p/workbench/src/memory/MemoryPanel.vue`, `p/workbench/src/memory/MemoryStart.vue`, `p/workbench/src/memory/import/ImportConfirmDialog.vue`, `p/workbench/src/memory/import/ImportFileRow.vue`, `p/workbench/src/memory/import/ImportJobDetail.vue`, `p/workbench/src/memory/import/ImportStatus.vue`, `p/workbench/src/memory/settings/ClaudeCodeMcpSection.vue`, `p/workbench/src/memory/settings/SemanticModelSection.vue`

Workflow node content stays P255's (P262 §5.3); only the families above change in node files.

#### B5 (11 files)
`M/AppShell.vue`, `M/components/ConfirmDialog.vue`, `M/components/PermissionHint.vue`, `M/components/ReplySheet.vue`, `M/screens/BacklogScreen.vue`, `M/screens/NeedsScreen.vue`, `M/screens/PairScreen.vue`, `M/screens/PlanScreen.vue`, `M/screens/PlanTaskCard.vue`, `M/screens/TerminalScreen.vue`, `M/terminal/KeyBar.vue`

#### B6 (sweep, no new files)
Empty `stream-b.txt` check as A5; screenshot ADE plan + panel, review window, workflows, repos
dialog, Settings (Claude Code, Mobile access, Appearance, Memory) and the phone screens; fix drift.

Stream C order: C1 git-ui components, C2 git-ui dialogs + review, C3 Docker, C4 Automations,
C5 workbench chrome, C6 sweep.

#### C1 (17 files)
`p/git-ui/src/App.vue`, `p/git-ui/src/components/AppToolbar.vue`, `p/git-ui/src/components/BranchPicker.vue`, `p/git-ui/src/components/CommitGrid.vue`, `p/git-ui/src/components/CommitMeta.vue`, `p/git-ui/src/components/ConflictBanner.vue`, `p/git-ui/src/components/DetailPane.vue`, `p/git-ui/src/components/FailureBanner.vue`, `p/git-ui/src/components/FileTree.vue`, `p/git-ui/src/components/LoadMoreButton.vue`, `p/git-ui/src/components/MenuSections.vue`, `p/git-ui/src/components/PullStrategyPicker.vue`, `p/git-ui/src/components/RefreshButton.vue`, `p/git-ui/src/components/SearchBox.vue`, `p/git-ui/src/components/StackList.vue`, `p/git-ui/src/components/StashDetailPane.vue`, `p/git-ui/src/components/UncommittedChangesStrip.vue`

#### C2 (15 files)
`p/git-ui/src/components/WorkingDetailPane.vue`, `p/git-ui/src/components/dialogs/BranchDialog.vue`, `p/git-ui/src/components/dialogs/ForcePushDialog.vue`, `p/git-ui/src/components/dialogs/PreflightPrediction.vue`, `p/git-ui/src/components/dialogs/RepoSettingsDialog.vue`, `p/git-ui/src/components/dialogs/ResetDialog.vue`, `p/git-ui/src/components/dialogs/RevertDialog.vue`, `p/git-ui/src/components/dialogs/StashDialog.vue`, `p/git-ui/src/components/dialogs/TagDialog.vue`, `p/git-ui/src/components/dialogs/WorktreeDialog.vue`, `p/git-ui/src/components/review/BaseSelector.vue`, `p/git-ui/src/components/review/ReviewCommentsPane.vue`, `p/git-ui/src/components/review/ReviewCommitRow.vue`, `p/git-ui/src/components/review/ReviewFilesPane.vue`, `p/git-ui/src/components/review/ReviewView.vue`

#### C3 (23 files)
`p/docker-ui/src/components/ContainerDetail.vue`, `p/docker-ui/src/components/ContainerEditView.vue`, `p/docker-ui/src/components/ContainerList.vue`, `p/docker-ui/src/components/ContainerOverview.vue`, `p/docker-ui/src/components/ContainerSizeSection.vue`, `p/docker-ui/src/components/ContainerTable.vue`, `p/docker-ui/src/components/DetailSection.vue`, `p/docker-ui/src/components/DockerPanel.vue`, `p/docker-ui/src/components/EditField.vue`, `p/docker-ui/src/components/EditInPlaceSection.vue`, `p/docker-ui/src/components/EditRecreateSection.vue`, `p/docker-ui/src/components/EditSize.vue`, `p/docker-ui/src/components/EndpointChip.vue`, `p/docker-ui/src/components/EngineDiskSection.vue`, `p/docker-ui/src/components/EngineOverview.vue`, `p/docker-ui/src/components/ListState.vue`, `p/docker-ui/src/components/LogsView.vue`, `p/docker-ui/src/components/OriginIcon.vue` (permanent U34 line only), `p/docker-ui/src/components/RecreateConfirmDialog.vue`, `p/docker-ui/src/components/ResourceDetail.vue`, `p/docker-ui/src/components/StatsSparkline.vue`, `p/docker-ui/src/components/StatsView.vue`, `p/docker-ui/src/components/UnavailableState.vue`

#### C4 (20 files)
`p/workbench/src/automations/AutomationsPanel.vue`, `p/workbench/src/automations/ParamsEditor.vue`, `p/workbench/src/automations/ScriptBodyField.vue`, `p/workbench/src/automations/ScriptDialog.vue`, `p/workbench/src/automations/run/AdeContextFields.vue`, `p/workbench/src/automations/run/ParamsForm.vue`, `p/workbench/src/automations/run/RunPreview.vue`, `p/workbench/src/automations/run/RunScriptDialog.vue`, `p/workbench/src/automations/runs/RunLog.vue`, `p/workbench/src/automations/runs/RunOutcomeBlock.vue`, `p/workbench/src/automations/runs/RunStatusBadge.vue`, `p/workbench/src/automations/runs/RunsSection.vue`, `p/workbench/src/automations/runs/RunsStatusItem.vue`, `p/workbench/src/automations/runs/ScriptRunView.vue`, `p/workbench/src/automations/schedule/ScheduleConfirmDialog.vue`, `p/workbench/src/automations/schedule/ScheduleFields.vue`, `p/workbench/src/automations/smart/McpServerTools.vue`, `p/workbench/src/automations/smart/McpToolsField.vue`, `p/workbench/src/automations/smart/SmartBadge.vue`, `p/workbench/src/automations/smart/ToolsField.vue`

#### C5 (12 files)
`p/workbench/src/components/AppMetricsItem.vue`, `p/workbench/src/components/AutocompleteField.vue`, `p/workbench/src/components/InlineRenameInput.vue`, `p/workbench/src/components/OpLogPanel.vue`, `p/workbench/src/components/TabStrip.vue`, `p/workbench/src/components/TabStripNewButton.vue`, `p/workbench/src/components/UpdateAvailableItem.vue`, `p/workbench/src/components/UpdateDialog.vue`, `p/workbench/src/settings/fields/NotifyPromptsField.vue`, `p/workbench/src/settings/fields/WordWrapField.vue`, `p/workbench/src/terminal/TerminalTabView.vue`, `p/workbench/src/state/createSettingsStore.ts` (check only: the one allowed density formula)

#### C6 (sweep, no new files)
Empty `stream-c.txt` check as A5; screenshot git graph + detail + review, git dialogs, Docker
list/detail/edit/engine, Automations panel/run/dialog, OpLog in both densities; fix drift.

Sizes: A 75 files (5 chunks), B 86 (6), C 87 (6); weighted guard hits A 438, B ~280, C ~320 (A's hits are
dense mechanical alert/table sites).

### 4.3 Verification per stream

- Per commit (pre-commit hook): `bun run typecheck`, `bun run lint` (includes
  `check-ui-primitives.sh` with the stream's allowlist).
- Per chunk: UI specs covering the chunk's testids (grep the changed files' `data-testid` values in
  `apps/<app>/tests/ui`): `bun run build:test:studio && npx playwright test
  --config=apps/kira-studio/playwright.config.ts --project=ui <specs>` (Space: `build:test:space`,
  Space config). C runs both apps' configs for its specs. Unit: `bun run test:unit`.
- Stream end, once: A `bun run test:ui:studio` minus C's specs; B `bun run test:ui:space` minus C's
  specs, then `bun run test:ui:space-mobile`; C its own Studio and Space specs. Then its own visual
  PNGs: `test:visual:update:<app>` with `--grep` limited to its own snapshots, inspect each diff
  against §2, re-run without update clean.
- A stream is done when its allowlist holds only `permanent` lines and every check above is green.

### 4.4 Disk and worktrees (4.0 GB free at plan time)

Each worktree needs its own `node_modules` (~900 MB apparent; Bun hardlinks from its global cache
on Linux, so real use is lower), Wails bindings and `frontend/dist`. Never symlink `node_modules`
(DEV_ENVIRONMENT). Three worktrees do not fit with margin at once, so they are staggered by
measurement:

1. Before: `git worktree list`; `/home/user/kira-v22-base` (`v2.2-fixes`) is not P263's, leave it
   unless the user removes it. `df -h /home/user`.
2. Create A: `git worktree add -b p263-a /home/user/kira-p263-a <foundation-tip>`, then in it
   `sh scripts/prepare-worktree.sh` and `sh scripts/codegraph-setup.sh`. `df`.
3. Create B the same way only with ≥ 2.0 GB free; `df`.
4. Create C the same way only with ≥ 1.5 GB free after B. If short: C waits; the first stream to
   finish lands (§5.6), its worktree is removed (`git worktree remove`), then C is created off the
   same foundation tip (never off the moved `v2.0`; C rebases at landing like the others). C has no
   dependency on A or B, so the wait changes only wall-clock time.
5. Keep ≥ 1.0 GB free while streams run (Playwright traces, `dist` rebuilds); a stream that needs
   space prunes its own `test-results/`, never another worktree's.
6. Playwright browsers and the Go build cache are shared (`~/.cache`), no extra cost.
7. Clean-up after landing: `git worktree remove` each, `git worktree prune`,
   `git branch -d p263-a p263-b p263-c`.
8. A stopped stream resumes from its last commit in its worktree; never recreate it.

## 5. Risks, scope, guarantees, landing

### 5.1 Behaviour-neutral guarantee

No store, query, IPC, bridge or Go edit; event wiring unchanged. Testids, accessible names and
labels stay. Accepted semantic shifts, each from a §2 decision: Checkbox ↔ Switch at the §2.3
sites (`role="checkbox"` ↔ `role="switch"`, same `aria-checked`, Playwright `toBeChecked` works on
both); two hidden native radios become reka `RadioGroup` items (roving focus, arrow keys as
before); native `title` attributes become Tooltips (hover/focus with delay; mobile drops them);
resize-handle keyboard step 16/8 → 10 plus Home/End; `AdeReviewWindow` left bounds 220-560/320 →
180-480/260 (stored width clamped). No toast, no new hint text, no copy change beyond "Loading..."
→ "Loading…".

### 5.2 Testids stable

None renamed. Specs change only for a documented §2 effect: role queries after Checkbox/Switch
swaps, `data-state`/class assertions on alerts, handles (`panel-resize.spec.ts` widths/steps),
checkbox size in `control-sizing.spec.ts`, focus assertions in `focus-ring.spec.ts`.

### 5.3 Risks

- Base changes (checkbox 16 → 14, alert tint and icon, scrim, handle 4 → 2px, invalid halo,
  scrollbar) move most baselines at once: foundation re-records and inspects each before streams.
- Mechanical renames in foundation touch ~100 files across all streams' trees; they land before the
  worktrees exist, so streams branch from them.
- `Badge` UI font: a value badge missed by the `data` prop renders in the UI font; per-chunk visual
  check plus the sweep.
- Tooltip-per-row cost: replacing `title` in long lists mounts a reka Tooltip per row; the 15 files
  hold short lists except `ImportFileRow` (virtualized window, bounded).
- Hiding desktop scrollbars on `pointer: coarse` also affects touch-screen laptops: they get the
  native scrollbar, accepted.
- 2px pane handles narrow the visible target; the hit area stays 10px (fine) / 18px (coarse).
- Disk: §4.4.
- Rebase conflicts: none expected (zero overlap); a real conflict means ownership was wrong: stop,
  fix ownership, never merge PNGs (re-record after rebase).

### 5.4 Out of scope

Behaviour and modularisation (P264: keyboard navigation, context-menu open/close, confirm flows,
inline rename, persistence, clipboard composable, virtualization, drag mechanics, focus return,
query wrappers, shortcuts registry, debounce, selection, undo, dirty state, formatting, polling);
SlickGrid/CommitGrid internals beyond the handle; Monaco/CodeMirror/xterm internals beyond scrollbar
colours; git graph canvas and ref badges; workflow node rendering (P255); ADE plan board cards;
new features, new hints, copy rewrites; Go.

### 5.5 Close-out (step 3, sequential, after all three streams land)

On the landed `v2.0`: fix every item in the three findings files and re-record PNGs they name;
delete the Alert `default` variant and any legacy alias kept for the streams; move `permanent`
allowlist lines into `check-ui-primitives.sh` as named exemptions with reasons; delete
`scripts/ui-primitives-allowlist/`; delete findings files once fixed; `docs/ARCHITECTURE.md` UI
paragraph final (P263 element rules, handle rule, tone vocabulary); `docs/DEV_ENVIRONMENT.md`
unaffected; plan "Close-out result"; SPEC P263 result section and row Done; full `typecheck`,
`lint`, `test:unit`, `test:ui:studio`, `test:ui:space`, `test:ui:space-mobile`,
`test:visual:studio`, `test:visual:space` green.

### 5.6 Landing

1. Foundation commits on `v2.0` (main checkout), hook-green, verified, "Foundation result" written.
   Plain push in the background (`git push origin v2.0`); no PR.
2. Worktrees A, B, C off the foundation tip (§4.4); streams run concurrently.
3. Each stream done (§4.3) → in its worktree `git rebase v2.0` (any order), re-run lint/typecheck
   and its own visual check, then in the main checkout `git merge --ff-only p263-<x>`. Plain
   background push after each.
4. Close-out (§5.5) on `v2.0`, push, remove worktrees (§4.4 step 7).

## 6. Verification checklist (orchestrator greps, after close-out)

Scope `D="apps/kira-studio/frontend/src apps/kira-space/frontend/src apps/kira-space/frontend/mobile packages/workbench/src packages/git-ui/src packages/docker-ui/src packages/kira-ui/src"`.

- `sh scripts/check-ui-primitives.sh` exits 0; `scripts/ui-primitives-allowlist/` gone.
- `grep -rnP 'variant="(err|destructive|note)"' --include=*.vue $D` → 0.
- `grep -rnP 'animate-spin|codicon-modifier-spin|animate-pulse' --include=*.vue $D` → 0 (theme only).
- `grep -rlP 'type="(checkbox|radio)"' --include=*.vue $D` → 0.
- `grep -rn '<Checkbox' $D --include=*.vue | grep /settings/` → 0; every `<Switch` site is in a
  `/settings/` path or `MemoryPanel.vue`, `AdeTaskTab.vue`, `ReposDialog.vue`.
- `grep -rnP '<(span|div|button|i|li|dd|label|p)\b[^>]*\s:?title=' --include=*.vue $D` → 0.
- `grep -rn '<TooltipProvider' --include=*.vue $D` → 0.
- `grep -rnP '<p\b[^>]*class="[^"]*text-error' --include=*.vue $D` → 0.
- `grep -rnP 'cursor-(col|row)-resize' --include=*.vue $D` → 0; `grep -rln 'resizeHandleVariants'
  packages apps --include=*.vue --include=*.ts` covers `ResizableHandle.vue`, `DockResizeHandle.vue`,
  `AdePanelResizeHandle.vue`, `CommitGrid.vue`, git `App.vue`, `StreamView.vue`; no
  `w-0.5 ... shadow-none` override left in `WorkbenchShell.vue`.
- `grep -rnP '<(table|thead|tr|th|td)\b' --include=*.vue $D` → 0; `grep -rn "rowDensity ===" $D` →
  only `createSettingsStore.ts`.
- `grep -rnP '\[scrollbar-' --include=*.vue $D` → 0.
- `grep -rnP 'bg-black|text-(ok|warn|info|error)/\d' --include=*.vue $D` → 0.
- Real usage of new primitives: `<Spinner` ≥ 20 files, `<StatusDot` ≥ 12, `<InlineState` ≥ 15,
  `<Kbd` ≥ 4, `<Card` ≥ 25, `<Table` ≥ 7, `<Skeleton` ≥ 3, `tableRowClass` ≥ 4.
- `git diff --stat <foundation-base>..HEAD -- '*.go'` → empty.
- Visual: shell left, dock and ADE panel handles identical in the Space `ade` and Studio workbench
  baselines; every `visual` project green on both apps.

## Foundation result

Base `d381439d6`. Commits (none pushed, no `--no-verify` at tip):

- `5131e34c7` scrim and scrollbar state tokens, `pointer: fine` scrollbar
- `d3562235d` tone vocabulary (`ok/warn/error/info`), Badge `data` prop, Alert `icon`/`strip`
- `f6554088a` 14px checkbox/radio, compact switch, one focus/disabled/invalid recipe
- `0b9ab5b95` tooltip defaults, content-sized dropdown, trailing indicators
- `0b79ad81a` Spinner, StatusDot, InlineState, Skeleton, Kbd, Card, Table
- `7269162dc` one resize handle look (`resizeHandleVariants`), 10px keyboard step, Home/End
- `66259e6ce` guards U22-U38, per-stream allowlists, ARCHITECTURE paragraph
- `5b1157e0a` fix: docker endpoint menu items `h-auto min-h-control py-1` for two-line content
- `69ed219c6` visual baselines

Allowlist entries: stream A 54 files, B 68, C 63.

Verify: typecheck green, `bun run lint` green, `test:unit` 1793 pass, `test:ui:studio` 427 pass
(one failure, docker engine dropdown, fixed in `5b1157e0a`), `test:ui:space` 457 pass,
`test:ui:space-mobile` 53 pass 1 skipped, `test:visual:studio` and `:space` 13/13 after re-record.
Baseline diffs reviewed: checked checkbox/switch now filled (old `data-checked:` classes never
matched reka `data-state`), badges sans unless `data`, 2px menu item shifts, visible
scrollbar thumb, handle thickness. No unintended diffs.

Deviations:

- Switch thumb `translate-x-3` (not 3.5): symmetric 2px gap.
- Keyboard step is px: reka `keyboardResizeBy` is percent of group, so `WorkbenchShell` computes it from measured width.
- `data-[state=checked]` replaces dead `data-checked:` selectors.
- U29 flags `<TooltipProvider` only with attributes; app roots keep bare providers. `proto/grid` provider cleaned too.
- U34 uses a real hex pattern (no `#123` false positives).
- Permanent exemptions: `WorkbenchShell.vue` (U31), `ContextMenu.vue` (U27 swatch).
- Allowlist whole-file entries apply only to U22+; stale entries fail the run.
- `StreamView` handles sit at `right-0` inside the clipped cell.
- Alerts in stream-owned files show doubled icons (hand-placed plus `icon` prop) until streams migrate.

## Stream A result

Base `cff645739`. Commits (none pushed, no `--no-verify` at tip):

- `2a5633dce` A1 API and project views
- `93fd05428` A2 data, console and definition views
- `e53a6173b` A3 HTTP and gRPC views
- `8d30f13fb` A4 shared views, stream and Studio workbench
- `c1f6fc76b` fix: environments radio hit area, specs query `role=radio`
- visual baselines and this section (final commit)

Allowlist: every bare entry removed. `stream-a.txt` holds only permanent lines: U34 `EngineIcon`;
U36 and U37 `ConnectionDialog` (engine tile is a radio card); U36 `FiltersDialog` and
`ExplainResultView` (bordered list containers); U37 `SlickGridHost` (DOM-built cell button);
U36 `DbMcpApprovalDialog` and `DatabaseMcpPane` (code blocks, connection list item); U37
`AppearancePane` (density preview renders the unsaved draft, `useRowHeight` reads the applied var).

A5 sweep: with only permanent lines left, the guard hits no Studio file outside the chunks.

Verify: guard, `bun run lint`, `bun run typecheck` green. `test:ui:studio` minus docker-* and
automations-*: 419 pass first run, 4 fail. Three fixed: radio queries after `RadioGroup` (spec
`input[type="radio"]` to `[role="radio"]`, `collections`, `connection-dialog-tabs`), env grip drag
(theme `RadioGroupItem` `after:` hit area covered the grip; `after:inset-0` on the item). `mutations`
timed out under load, passes alone. Visual: re-recorded `settings-api`, `settings-appearance`,
`settings-database-mcp` (Checkbox to Switch), `data-grid` and `http-request-view` (Badge `data`,
strip alerts, row recipe, kira scale). `console` and `schema-dialog` baselines unchanged; `data-grid`,
`console`, `schema-dialog` flake in a parallel full run, pass alone (`--repeat-each=5` clean).

Deviations:

- Dialog alerts (`FiltersDialog`, `SchemaDialog`, `GenerateDataDialog`, `UploadObjectDialog`) stay non-strip; view alerts are `strip`.
- `DocumentRow` expanded state uses `bg-select` (was `bg-elevated`); row height `min-h-row`.
- `KeyValuePane`, `StreamView` rows use `rowVariants` tree with `gap-0 px-0`.
- `ConnectionDialog` kind tiles use reka `RadioGroupItem` directly: the theme item is the 14px dot.
- `FieldRowsTable` selector is `input:not([type=checkbox])` (unquoted) to avoid the U28 literal.

Open: see `P263-stream-a-findings.md` (WordWrapField Checkbox).

## Stream B result

Branch `p263-b`. Commits: B1 ce749a487, B2 cfcdb0034, B3 2b2c765a9, B4 c640b3768, B5 3f8797bc0, B6 sweep and baselines (this commit).

Verify: `bash scripts/check-ui-primitives.sh`, `bun run lint`, `bun run typecheck` pass on every commit via hook. `stream-b.txt` holds only `permanent` lines. `bun run test:ui:space` minus Stream C specs: 348 passed. `test:ui:space-mobile`: 53 passed, 1 skipped. Visual: ade-workflow-graph and settings re-recorded and viewed, rerun clean.

Deviations:
- Status-bar items use `Button variant="toolbar" size="kira"` with size overrides.
- Rows holding controls use `min-h-row`, not `h-row`. `h-9` became `h-row`.
- Mobile Alerts use `strip`, status dot uses `StatusDot` with `aria-label`, so mobile specs assert `aria-label` not `title`. Release button `h-9` became `h-11` (44px).
- AdeStepResults uses `Card variant="section"`: inset fill hides inner controls.
- Permanent exemptions: U26 reviewDecorations.ts, U34 MobileQr.vue, U38 RepoFileView.vue, AdeActionCell.vue, AdeBranchRow.vue, ReplySheet.vue, TerminalScreen.vue, U37 AdeTaskCard.vue, U25 AdeRunLog.vue. Reasons in `stream-b.txt`.

Left: see `P263-stream-b-findings.md`.


## Stream C result

Base `cff645739`. Commits (none pushed, no `--no-verify` at tip):

- `ac35633d3` C1 git components
- `580161bcb` C2 git dialogs and review
- `10642ce1a` C3 docker views
- `63ad94cf5` C4 and C5 automations and workbench shell (one commit: each hook run typechecks the whole tree, slow under load)
- C6 sweep and verify commit (this section, specs, baselines)

Allowlist: `stream-c.txt` holds only `permanent` lines: OriginIcon U34 (brand colour), LogsView and RunLog U25 (stderr log data colour), AutocompleteField and InlineRenameInput U36 (caret popups, bare input). `check-ui-primitives`, `bun run lint`, `bun run typecheck` green.

Verify: Studio `ui` docker-*/automations-* and `visual` automations-module pass; Space `ui` automations-*, repo-graph-*, repo-commit-*, repo-branch-picker, repo-floating-geometry, repo-review-interaction and `visual` git-module pass.

Baselines re-recorded after viewing diffs: studio `script-dialog` (Kbd chord replaces `Cmd/Ctrl+Enter` text), space `git-graph` and `git-graph-detail` (uncommitted strip row on `rowVariants`).

Deviations:

- Spec `automations-module.spec.ts` asserts the script row command in the Tooltip (hover, `tooltip-content`) instead of the native `title` attribute.
- Reka renders tooltip text twice (visually hidden a11y copy), so the assert uses `toContainText`.
- `WordWrapField` is a Switch (live setting), `EditRecreateSection`/`EditSize` and automations form toggles are Checkbox.
- `createSettingsStore.ts` and `NotifyPromptsField` unchanged by design.

## Close-out result

Base `b43269636`. Commits (none pushed, hooks green, no `--no-verify`):

- `b9eb9cdbc` tokens, folded guard exemptions, radio hit area, Card docs
- `acca70f78` one resize cursor
- `f654db821` de-flake `data-view`, `slick-grid`, `mutations` specs
- `5eb92288d` de-flake studio visuals, re-record 4 baselines
- docs and result (this commit)

Findings fixed:

- Card: `inset` holds text only (`bg-field` hides controls), `section` holds controls; stated in `cardVariants` comment and ARCHITECTURE.
- Status-bar items: `AppMetricsItem`, `UpdateAvailableItem`, `RunsStatusItem` already `Button variant="toolbar" size="kira" class="h-control-sm gap-1 px-1.5"`; `ClaudeUsageItem` gained `font-normal`.
- 16px token `text-kira-touch` (`--kira-t-touch`, fixed, not tied to Appearance font size): `ReplySheet`, `TerminalScreen`. Exemptions removed.
- Board tokens `h-board-row` (40px), `h-board-row-tall` (68px): `AdeActionCell`, `AdeBranchRow`. Exemptions removed. `AdeTaskCard` U37 stays (selected fill on a card, not a row).
- `WordWrapField` already `Switch` (Stream C).
- Theme `RadioGroupItem` hit area `after:-inset-x-3 after:-inset-y-2` to `after:-inset-1`; `EnvironmentsView` override deleted, drag spec green.

Legacy: no `destructive`/`err`/`note` variant, Alert `default` variant or alias left in code (grep 0; `note-text` is a colour token). Stale `destructive` text in ARCHITECTURE fixed. `scripts/ui-primitives-allowlist/` deleted; 27 exemptions (8 from P262, 19 permanent from the stream lists) now named in `check-ui-primitives.sh` (EngineIcon, OriginIcon, MobileQr colours; log stderr colour; caret popups; radio-card tile; DOM-built grid cell; AppearancePane density preview; code/list boxes; Monaco view-zone DOM; markdown em scale; board card fill; shell row-resize cursor).

Pixel check (shell, dock, ADE panel handle, Space ui spec, rest/hover/drag, screenshots viewed): thickness 2px, fill transparent then `rgb(0,120,212)` on hover and drag, hit area 4px, identical. One difference: cursor. Reka sets `ew-resize` globally on hover; the cva said `col-resize`. cva now `ew-resize`/`ns-resize` (SlickGrid resizer and shell dock cursor too); U31 regex covers all four names.

Flakes, root causes (each reproduced under 6 CPU burners and 8 workers on 4 cores, then 32/32 clean):

- `slick-grid` pacing: 60s default budget against ~33s unloaded and a p95 bound a single starved fling can break. Budget 240s; the gate takes up to three flings and passes on the first clean one (a real regression fails all). `slick-grid` resize drag: handle grabbed while column widths still autosize; now waits for settled width first. (Playwright summaries show test declaration lines 1233/1634, so the exact assertion was not recoverable.)
- `data-view` pagination (new this run): `firstGutterNumber`/`lastGutterNumber` read the first/last DOM node; SlickGrid recycles row nodes, so a stale far row (`80`) read before the post-scroll render. Now page row 0 and highest `data-row`.
- `mutations`: single 7-scenario test at 60s default, ~13s unloaded; budget 180s.
- Visuals: `console` caret blink and scrollbar fade (JS-driven, no stable pair); `data-grid`/`console` codicon font painting late (`settleFonts`); `schema-dialog` captured before the lazy Monaco chunk mounted (no editor, mask target missing). Also `connection-dialog`, `console`, `data-grid`, `schema-dialog` baselines had drifted inside the 0.2 pixel threshold (scrim 0.3 vs old 0.1, alert `/20` border vs old grey), leaving no margin for jitter; re-recorded and viewed.

Deviations: none from §5.5. Space `ui`, `ui-timing` and Go untouched.
