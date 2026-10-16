Input to P267 plan. Audit at tip 36eb6b80d; re-verify counts against the current tree.

# UI leftovers audit after P262-P266

Base: branch v2.0, tip `36eb6b80d`. Frontend tree clean (other agent's uncommitted edits are Go/test/contract only). `scripts/check-ui-primitives.sh` passes. Pending allowlists hold no frontend U entries except one permanent U82.
Scope scanned: `apps/kira-studio/frontend/src`, `apps/kira-space/frontend/src`, `apps/kira-space/frontend/mobile`, `packages/{workbench,git-ui,docker-ui,theme,kira-ui}/src`.
Discovery: `codegraph_explore` per area (primitives, confirm flow, trees/rows, pickers/menus, status indicators, toasts/errors, context menus), then grep for counts.
Counts are real grep counts. Multiline tags were counted with `grep -Pzo`.

Classes: UNIFY NOW, JUSTIFIED DIFFERENCE, NEEDS DECISION (with recommendation).

---

## Ranked findings

### 1. Hand-rolled uppercase section headings bypass `SectionHeading`: UNIFY NOW
- 21 sites in 14 files restate the heading recipe. U21 scans only side panels.
- Exact copies of `SectionHeading`: `SavedListMenu.vue:96,144`, `git-ui SearchResults.vue:87`, `StackList.vue:87,165`.
- Drifted copies use `text-muted-foreground` where the primitive uses `text-subtle`. Some add `font-medium`, and one uses `tracking-wide`:
  - `views/definition/{Columns,Constraints,Validation,Indexes,Properties}Section.vue` (5): the line shape is identical across all five.
  - `SchemaBrowser.vue:168,230`, `StudioStart.vue:109`, `MemoryStart.vue:76`, `ImportJobDetail.vue:78`, `AdeAutomationsBlock.vue:36` (`h4 font-medium`).
  - `RecreateConfirmDialog.vue:37,61` and `EditPendingSummary.vue:27` (`h4`), mobile `PlanScreen.vue:38` (`font-medium tracking-wide`).
- Fix: use `SectionHeading` everywhere, or `FieldLegend` inside forms. Extend U21 from kind `s` to `v`.

### 2. Status-bar items restate one Button override 6 times: UNIFY NOW
- `h-control-sm gap-1 px-1.5 text-kira-sm font-normal` appears on `Button variant="toolbar" size="kira"` in 6 places:
  - `RunsStatusItem.vue:27`, `AppMetricsItem.vue:49`, `UpdateAvailableItem.vue:30`
  - `ClaudeUsageItem.vue:100`, Space `StatusBar.vue:58`, `docker EndpointChip.vue:52` (adds `px-1 normal-case tracking-normal`)
- Fix: add Button size `status` (or a `StatusBarItem` in workbench).
- Wider point: 69 `<Button>` tags override height, padding, text or radius by class. Items 3, 4 and 5 cover most of them.

### 3. Mobile touch buttons are hand-sized on every call site: UNIFY NOW
- 19 mobile Buttons take `size="kira"` and then override it with `class="h-touch px-4|px-3|flex-1"`. Padding drifts: `px-4` ×8, `px-3` ×4.
- `ConfirmDialogView.vue:72,83` (workbench, used by mobile) still uses retired `h-11` behind its `touch` prop. U82 misses it because the file is not under `mobile/`.
- A second touch mechanism exists: `DialogHeader.vue:36` and `resizable/index.ts` use `pointer-coarse:size-touch`.
- `KeyBar.vue:47` hand-rolls a pressed fill (`bg-primary text-primary-foreground`).
- Fix: add Button sizes `touch` and `touch-icon`. Drop the per-site classes. Make `ConfirmDialogView` use `h-touch`.
- Decide between the explicit size and `pointer-coarse:`. Recommendation: explicit size on mobile, keep `pointer-coarse:` only inside shared primitives.

### 4. Ghost variant and button-as-toggle outside the P262 rules: UNIFY NOW
- P262 §2.4 allows `ghost` only for the dialog header close. It appears 18× literally plus 2× conditionally in 14 files:
  - mobile `AppShell.vue:46`, `TerminalScreen.vue:142,158,170`
  - ADE `AdeCandidateRow`, `AdeAttention`, `AdeDayBand` ×2, `AdeStoppedRow`, `AdeNeedsRow`, `AdeStageBlock`, `AdeTaskTab`, `AdeBranchPanel`, `AdeRunOutcome` ×2
  - Studio `VariablesOverviewPanel:145`, `DynamicValuesDialog:109`; docker `LogsView:195`
- `ghost` (hover `bg-field`) and `toolbar` (hover `bg-hover`) are two near-identical quiet buttons.
- P262 said button toggles become segmented. Still not done:
  - `AdeAllSessions.vue:80,88`: `filter === 'running' ? 'dialog' : 'ghost'`
  - `AdeNotesEditor.vue:230`: `btn.active ? 'dialog' : 'toolbar'`
  - `AdeAllSessionRow.vue:69`: `opens ? 'dialog' : undefined`
- Fix: map to `toolbar`. Convert the two toggles to `SecondaryTabs variant="segmented"` and the pressed toolbar look (item 8). Guard `variant="ghost"` outside `DialogHeader.vue`.

### 5. Link variant overridden into 3 looks: UNIFY NOW
- `variant="link"` has 23 uses, and 14 override it.
- Studio inline: `class="h-auto p-0"` in `FiltersDialog` ×4, `GenerateDataDialog`, `MemorySetupHint`; `VariablesOverviewPanel` ×2 adds `text-info no-underline font-normal`.
- Space: `class="px-1 text-kira-sm text-info"` in `AdeWorkflowGraph` ×4, `AdeWorkflowYaml` ×2, `AdeWorkflowBlock` `px-2 text-info`.
- The link colour is `text-primary` in the cva, but Space overrides it to `text-info`.
- ADE fakes links with ghost plus `underline`: `AdeStoppedRow`, `AdeNeedsRow`.
- git-ui has its own `LINK_BUTTON_CLASS` (`CommitMeta.vue`).
- Fix: add Button size `inline` (`h-auto p-0`) and pick one link colour. Recommendation: `text-primary`. Delete the overrides.

### 6. Search-match highlighting has 5 renderers and 4 looks: UNIFY NOW
- `TreeRow.vue:77,195` (`highlightParts`, `rounded-kira-xs bg-search-match`)
- `CollectionRow.vue:62,164` (copy, `rounded-kira-sm bg-search-match`)
- `docker LogsView.vue:227,256` plus `lib/ansi.ts:31 splitMatches` (`bg-search-match`, no radius)
- `RepoSearchRow.vue:42,136` (slice, `rounded-kira-xs bg-search-match`)
- `DocumentView.vue:1253` (`rounded-kira-sm bg-warn text-bg`, a different colour)
- Fix: add one `HighlightedText` (theme) plus `splitMatches` (workbench behaviour). Use one radius and one token.

### 7. Disclosure and twisty have 5 mechanisms outside `TreeTwisty`/`SectionHeading collapsible`: UNIFY NOW
- `<details>/<summary>` ×7 in 3 looks:
  - CSS codicon glyph via `before:content-['\eab6']`: `ResponseDiffDialog:362`, `TimelinePane:326,340`
  - native marker plus `cursor-pointer`: `AdeReviewSync:209`, `ForcePushDialog:141`
  - native marker plus `cursor-default`: `ScriptRunView:136`
- Raw chevron buttons: `DocumentRow.vue:59-66` (13px), `DocumentTree.vue:67-71` (12px), `ExplainResultView.vue:176`.
- `TooltipIconButton` chevron: `RepoMultiDiffView.vue:136`.
- Fix: add a `Disclosure` built on shadcn-vue `Collapsible` (not yet in `ui/`), with the `SectionHeading` chevron at 12. Use `TreeTwisty` in rows.

### 8. "Pressed" toggle state has at least 5 looks: UNIFY NOW
- `TooltipIconButton` `pressed` prop gives `bg-field text-fg`.
- Sites that bypass the prop and restate it: `SearchOptionToggles.vue:38,46,54` (`:class` plus `:aria-pressed`), `AppToolbar.vue:432,441` (`aria-pressed:bg-field`).
- `ReposDialog.vue:312,403`: `aria-pressed` with no visual state.
- Other looks: Button `title` variant `aria-pressed:bg-elevated border` (TitleBar); `KeyBar` primary fill; `AdeNotesEditor` variant swap.
- Fix: put `aria-pressed:bg-field aria-pressed:text-fg` into the `toolbar` cva and drop the class overrides.
- Keep `title` (justified: title-bar chrome on `bg-chrome`). Mobile toggle: same toolbar rule.

### 9. Floating surfaces disagree on z-index and elevation: NEEDS DECISION
- `tokens.css:238-247` define a ladder: popover 100, dialog 200, menu 300, autocomplete 350, tooltip 400. Every shadcn primitive ignores it and uses `z-50` (9 sites: Dialog, DialogOverlay, Popover, Dropdown ×2, Tooltip ×2, CommandDialog).
- Hand-rolled layers do use it: `TextPromptDialog` (200), `ErrorPopover` (300), `AutocompleteField` (350), Monaco hover (400).
- Result: a tooltip or dropdown opened over `TextPromptDialog` renders under it.
- Other drift: `AdePlanView.vue:327` `z-10`, `ReviewCommentsPane.vue:161` `z-10`, git `App.vue:1859` `z-20` overlay.
- Elevation: Dropdown uses `shadow-kira`, Popover stock `shadow-md`, Dialog and CommandDialog have no shadow. `shadow-kira-dialog` sits only on hand-rolled surfaces (AutocompleteField ×2, ErrorPopover, git detail overlay).
- `ErrorPopover:43` adds `border border-border-strong` on top of the primitive ring.
- Recommendation: wire the primitives to the token ladder (`z-(--kira-z-*)`). Use one shadow per tier: menus/popovers `shadow-kira`, dialogs `shadow-kira-dialog`. Guard bare `z-\d`.

### 10. Picker/select trigger is hand-built about 8 ways: NEEDS DECISION
- `nativeSelectVariants` on a raw `<button>`: `EnvironmentSelect.vue:84`, `MethodSelect.vue:43`, `CellEditorView.vue:596`.
- Toolbar Button shrunk by overrides: `EndpointChip.vue:52`. `dialog` Button: `AdeStageMover.vue:62`.
- Split-button chevron restating `rounded-l-none border-l-0 px-0.5` twice: `PullStrategyPicker.vue:167`, `AppToolbar.vue:380`.
- Own triggers: `BaseSelector`, `BranchPicker`.
- Recommendation: add `PickerTrigger` (label, optional leading dot/icon, chevron-down 12, `kira`/`kira-lg`) and a `SplitButton` in theme.

### 11. Two menu item models and renderers: NEEDS DECISION
- workbench `state/contextMenu.ts` `MenuItem` is rendered by `ContextMenu.vue`. Disabled reason shows as a hover tooltip; icon box size-4; shortcut via `Kbd` text.
- git-ui `lib/menuModel.ts` `MenuItem/MenuSection` is rendered by `MenuSections.vue` (AppToolbar, PullStrategyPicker). Disabled reason is sr-only (no hover hint), and `detail` sits in the `DropdownMenuShortcut` slot.
- 10 other `DropdownMenu`s hand-write their items.
- Recommendation: one `MenuItems` renderer over the workbench model, used by both the point menu and anchored dropdowns. git `MenuSection` maps through `sectionsToMenuItems`, which already exists.

### 12. Three copy-pasted find bars: UNIFY NOW
- `ResponseFindBar.vue` (183 lines), `views/shared/page/SearchToolbar.vue` (372), `StreamSearchToolbar.vue` (158).
- All three share the shell: `ViewToolbar class="bg-elevated"`, `w-52` field, count, chevron-up/down `TooltipIconButton`, `SearchOptionToggles`.
- docker `LogsView.vue:144,179` diverges: hand-rolled bar `px-1.5 py-1 gap-1`, `w-56` field, no prev/next.
- Fix: add one `FindBar` in workbench (slots for count and toggles). Views supply only the matcher.

### 13. Hand-rolled sub-bars beside `ViewToolbar`/`PanelBar`: UNIFY NOW
- 15 bars set their own height via padding: `py-0.5`/`py-1`/`py-1.5`/`py-2`, `gap-0.5..2`, `px-1.5/2/3`.
- `PreviewCommandPanel.vue:67` and `StreamComposeMessage.vue:55` copy the `PanelHeader` string with `h-control-lg`, which dodges U13.
- `AdeHeadlessPane.vue:57` and `AdeTuiPane.vue:57` are identical (`gap-2 px-3 py-1.5`).
- Others: `CellEditorView.vue:715,750`, `ResponseDiffDialog.vue:266`, `OpLogPanel.vue:169`, `ImportView.vue:33`, git `App.vue:1733,1752`, `LogsView.vue:144`, `ResourceDetail.vue:121`, `AdeNotesEditor.vue:222`.
- Fix: use `ViewToolbar` for action bars and `PanelBar` for sub-rows. Add a `dense` (`h-control-lg`) variant if needed.

### 14. Read-only key/value grid has 12 sites and 7 spacing combos, none on spec: UNIFY NOW
- P262 §2.5 spec: `grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1`.
- Space uses `auto_minmax(0,1fr)`: `AdeAddPopover`, `AdeBacklogPanel`, `AdeBranchPanel`, `AdeChangesTab`, `AdeTaskTab`, `RepoConfigForm`. gap-x is 2, 2.5, 3 or 4.
- docker and git use `max-content_1fr gap-x-4 gap-y-1`: `ContainerOverview`, `ContainerSizeSection`, `ResourceDetail`, `StatsView`. `CommitMeta` ×2 uses `gap-x-2 gap-y-0.5`.
- Fix: add a `KeyValueList` (`dl`) primitive in theme.

### 15. Grid-based tables with their own headers: UNIFY NOW
- U37 catches only `<table>`. Grid tables with header rows use 3 header looks against the `TableHead` spec (sentence case, `text-muted-foreground`):
  - `VariableSetView.vue:647` (`text-subtle`)
  - `ResponseDiffDialog.vue:340` (uppercase `text-subtle`)
  - `GenerateDataDialog.vue:271` (`text-muted-foreground`)
  - `EngineDiskSection.vue:79` (no header row; `gap-x-6`)
- Fix: use `Table` where rows are static (ResponseDiffDialog, GenerateDataDialog, EngineDiskSection). Where a grid is needed (VariableSetView: inline edit and Alt-reorder), reuse a `tableHeadClass` constant from `ui/table`.

### 16. EmptyState padding and fill drift: UNIFY NOW
- 82 uses. Class overrides:
  - fill: `h-full` ×19, `flex-1 min-h-0` ×10, `min-h-0 flex-1` ×2
  - padding: `h-full p-6` ×6 and `p-6` ×1 (git-ui: `App.vue`, `DetailPane`, `StashDetailPane`, `GitBlockedPanel`, `NoRepositoryPanel`, `EmptyRepositoryPanel`); `p-4` ×4 and `py-10` ×3 (mobile screens, `RepoMultiDiffView`)
- So padding is 0, 16, 24 or 40px depending on module.
- `EmptyState` inside popovers (`VariableHistoryMenu.vue:38`, `VariablesOverviewPanel.vue`) breaks P262's "empty line inside list/popover = `InlineState`".
- Fix: put default padding (`p-6`) in `Empty` and add a `fill` prop. Use `InlineState` in popovers. Guard `EmptyState class` with `p|py|px`.
- docker `ListState.vue` is a 15-line pass-through over `EmptyState`. Inline it.

### 17. Row hover-revealed actions have 3 mechanisms: UNIFY NOW
- `opacity-0 group-hover:opacity-100` (+/- focus-within): `TabStrip.vue:321`, `ConsoleView.vue:981` (no focus reveal, so the keyboard cannot see close), `AdeBranchRow.vue:265`, `ReviewCommitRow.vue:232`.
- `invisible group-hover/row:visible`: `ContainerTable.vue:140`.
- `hidden group-hover/row:flex`: `ImageList.vue:90`.
- Fix: add a `rowActions` class in `rowVariants.ts` (opacity, includes focus-within).

### 18. Operation-failure surface split between Alert and FieldError: NEEDS DECISION
- `Alert variant="error"` 68 uses; `FieldError` 107, of which about 23 in 22 files are operation failures, not field validation:
  - `ConnectionDialog connection-save-error`, `SchemaDialog schema-save-error`, both `SettingsDialog settings-save-error`
  - `DatabaseMcpPane settings-action-error`, `MobileAccessPane`
  - `AdeReviewAgentPanel`, `AdeReviewCompose`, `AdeReviewSync`, `AdeWorkflowsPage`, `AdeWorkflowGraph`
  - `StreamComposeMessage`, `KeyValuePane` add/edit
- Compare: `ScheduleConfirmDialog` and `ImportConfirmDialog` show the same kind of failure as an `Alert`.
- Two run logs show the same error two ways: `RunLog.vue` FieldError vs `AdeRunLog.vue` inside `LogLines`.
- Recommendation: a dialog or pane operation failure is `Alert error` in the body. `FieldError` is only for a field, or a one-line footer `#start` status. Record the rule in P262 §2.6.

### 19. Space ADE density runs looser than Studio: NEEDS DECISION
- `gap-2`: Space src 70, mobile 10, workbench 16, docker 18, Studio 13, git 4. The P262 scale is `gap-1/1.5/3`.
- Space only: `gap-2.5` ×9, `px-2.5` ×15. One-offs: `gap-3.5`, `gap-1.25`, `gap-1.75`, `gap-0.25` (`AdeAllSessions.vue:77,100`, `AdeStageBlock.vue:291`, `SearchBox.vue:275`).
- Recommendation: keep the board canvas (P129 exemption). Move ADE chrome (panels, rows, dialogs) to the P262 scale. Add a guard for fractional gap off the scale.

### 20. Framed pane and embedded-editor box recipes repeated: UNIFY NOW (small)
- `rounded-kira border border-border bg-bg overflow-hidden` appears 13× (`WorkbenchShell` ×3, ADE pages ×10). Fix: a `paneFrame` class constant.
- Embedded Monaco box has a radius split: `rounded-kira` (`RawExchangePane`, `EditRawRequestDialog`, `BulkVariablesEditor`) vs `rounded-kira-sm` (`SchemaDialog`, `ExplainResultView`).
- Code block `pre` drift: `DbMcpApprovalDialog.vue:109` `py-1 px-1.5` vs `DatabaseMcpPane.vue:146` `p-1 text-kira-sm`.
- Fix: one `CodeBlock`.

### 21. Secondary text has two greys with no rule: NEEDS DECISION
- `text-muted-foreground` (#9d9d9d) is used 514×; `text-subtle` (#8a8a8a) 249×.
- `SectionHeading`, `InlineState` and the empty line use subtle. `TableHead`, `DropdownMenuShortcut`, `Kbd`, Badge default and `FieldDescription` disagree (FieldDescription is subtle per P262 §2.5).
- Hand-rolled copies (item 1) pick either.
- Recommendation: subtle = meta/hint/empty/heading; muted = secondary labels and values. Write the rule down; there are too many sites to guard.

### 22. Sub-section title drift: NEEDS DECISION
- `h3 m-0 text-kira-lg` (400) ×4, `h3 text-kira-lg font-medium` ×1, `h3 m-0 text-kira-md font-medium` ×3, `h2 text-kira-md text-fg` ×2, `h1 text-kira-lg font-medium` ×2.
- Recommendation: view/detail title `text-kira-lg font-medium` (P262 §2.6); in-view section = `SectionHeading` or `FieldLegend`.

### 23. Chip duplicates: UNIFY NOW (small)
- Mobile `NeedsScreen.vue:99` and `PlanTaskCard.vue:46` rebuild `AdeChip` (`Badge variant="chip" :class="TONE_TAG_CLASS[…]"`).
- Fix: import `@ade/AdeChip.vue`, the same way they already import `@ade/tones`.

### 24. Spinners and run indicators: NEEDS DECISION
- `RunState.vue` (theme, 22 callers) draws its own spinning ring (`border-2 animate-spin`), unlike `Spinner`. It also has a `'—'` literal and `min-w-[7ch]`.
- U23 and U59 do not scan `packages/theme/src`.
- Recommendation: `running` uses `Spinner`. Keep the idle/error ring only if it has meaning; otherwise use `StatusDot`. Extend the U23/U59 scan to theme non-`ui/` files.

### 25. Cursor convention undecided: NEEDS DECISION
- `cursor-pointer`: Studio 38, Space 11, git 8, workbench 5, docker 0.
- `cursor-default`: docker 7, Studio 6, workbench 4.
- `rowVariants` uses `menu`=pointer and `tree`=default. The disclosures in item 7 split pointer/default.
- Recommendation (desktop convention): `cursor-default` for controls and rows; pointer only for hyperlinks. Guard `cursor-pointer` outside `link`.

### 26. Popover and dialog widths outside the size scale: UNIFY NOW (small)
- `max-w-[90vw]` restated: `TextPromptDialog.vue:57`, git `App.vue:1863`. `max-w-[80vw]`: `ScheduleFields.vue:187`, `AdeContextFields.vue:61`.
- `h-[60vh]`: `SchemaDialog.vue:145`, `RepoMultiDiffView.vue:172`. This should be `fixed-height` on `DialogContent`.
- `max-w-[calc(100vw-8px)]`: `ErrorPopover.vue:43`.

### 27. Explicit `queryClient` argument in components is a guard gap: UNIFY NOW
- U53 `,\s*queryClient\)` misses the multiline `},\n  queryClient,\n)` form. 8 `.vue` files pass it:
  - `ScheduleConfirmDialog`, `ScheduleFields`, `ScriptDialog`, `RunScriptDialog`, `ScriptRunView`
  - `McpToolsField`, `McpServerTools`, `CookiesPane`
- Fix: make the regex `,\s*queryClient\s*,?\s*\)`.

### 28. Dialog header icon on 5 of 45 dialogs: NEEDS DECISION
- `ConnectionDialog`, `DataGripImportDialog`, `FiltersDialog`, `ReposDialog`, `UpdateDialog` show an icon; the rest do not.
- `RecreateConfirmDialog.vue:30` and mobile `ReplySheet.vue` keep a visible `DialogDescription` in the header, against P262 §2.2 ("description never in the header visually").
- Recommendation: drop header icons (40/45 have none) and move the two descriptions into `DialogBody`.

### 29. Rich-text typography has two recipes: NEEDS DECISION
- `RepoFileView.vue` scoped `.md-reading :deep()` rules plus arbitrary `text-[1.6em]...` (permanent U38).
- `AdeNotesEditor.vue:42-51` TipTap prose with its own arbitrary em values (`mb-[0.6em]`, `my-[0.4em]`, `pl-[1.4em]`, `gap-[0.4em]`).
- Recommendation: one `kira-prose` layer in theme CSS, used by both.

### 30. `CommandShortcut` keeps `tracking-widest`: UNIFY NOW (one line)
- P263 dropped `tracking-widest` from `DropdownMenuShortcut`. `ui/command/CommandShortcut.vue:13` still has it.
- The palette shows no shortcuts today, so either delete it or align it.

---

## Justified differences (keep)
- git `text-graph-*` scale (17 sm + 6 md): follows Settings > Git graph font size. It leaks into `FileTree.vue` (6 sites) and review panes (5), so git trees can size differently from Studio/Space trees. Keep it for graph/commit data. Decide whether `FileTree`/review rows should follow it (recommendation: yes, it is git data).
- ADE tone palette (`ade/v2/tones.ts`, 6 colour tones, solid ink): encodes board state, pinned by `check-ade-colours.sh`, P129 board exemption.
- SlickGrid/Monaco z-index and scoped `:deep()` styles (`slickTheme.css`, `MonacoHost`, `OperationsPanel`, `ResponseDiffDialog` style blocks): third-party DOM.
- `TextPromptDialog` own scrim (non-portaled prompt, P262 §2.2). Only its z rung conflicts (item 9).
- `SettingsDialog` per app: thin composition over `SettingsShell`. Appearance/Advanced forks hold per-app fields. P266 §1.6 recorded them; not UI drift.
- Masked secret `tracking-widest` (`VariableRow`, `VariableHistoryMenu`) and pairing codes: data display.

## Clean areas
- Toasts: none exist in either app; errors go inline. One surface, nothing to unify.
- Raw `<input>`/`<textarea>`: only inside primitives (`AutocompleteField`, `InlineEditInput`).
- Focus rings in apps: 3 uses, all `focus-ring`. Guard U35 holds.
- Font weights: `font-semibold` 1 (PanelHeader), `font-bold` 2 (LogsView, exempt).
- Text sizes: all `text-kira-*`; no stock sizes.
- Tooltips: `TooltipIconButton` 247 uses; only 4 hand-wrapped icon buttons (`DataToolbar`, `StreamView`, `DocumentView`, `RefreshButton`). Low value.
- Secondary tabs: no hand-rolled `role="tab"` left; `tabChipVariants` only in the 6 primary strips.
- Confirm flow: one store plus `ConfirmDialogView` everywhere, mobile included. Only the `h-11` leftover remains (item 3).
- Resize handles, scrollbars, kbd, colour literals: guarded and clean.

## Suggested guard additions (cheap, for whichever phase picks this up)
- U21 scan `v`, not `s`.
- `variant="ghost"` outside `DialogHeader.vue`.
- `EmptyState class` with `p|px|py`.
- Bare `z-\d+` / `z-\[`.
- Button `class` with `h-touch|h-control-sm`, once the `touch` and `status` sizes exist.
- U53 multiline form.
- U23/U59 also scan `packages/theme/src` outside `components/ui`.
- `<details>` outside `Disclosure`.
- Off-scale `gap-(0.25|1.25|1.75|2.5|3.5)`.
