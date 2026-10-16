Input to P267 plan. Audit at tip 36eb6b80d; re-verify counts against the current tree.

# Permanent exemption audit (v2.0 @ 36eb6b80d, read-only)

Pre-P262 base: `f046f9a12` (P262 plan line 10). Discovery via `codegraph_explore` per cluster, then targeted reads.
`sh scripts/check-ui-primitives.sh` passes at tip (every PERMANENT line still matches something).

## Totals (asked inventory, 130 entries)

- LEGITIMATE 58, UNIFIABLE 60, STALE 12.
- Extra (not in the asked set): 13 STALE built-in exempt paths in the guard table's 3rd column (script never checks those for staleness).

Per source:
- check-ui-primitives.sh PERMANENT, 58 lines: L 22, U 35, S 1.
- scripts/copy/exemptions.ts, 8: L 7, U 1.
- consistency-allowlist stream-b U82, 1: L 1 (misfiled).
- consistency-allowlist go-stream-* G4, 9: L 9 (misfiled; mechanism unifiable).
- biome.json noConsole override block, 23: S 11, U 10, L 2.
- Suppressions added P262-P266 (31): 24 biome-ignore a11y, 3 noExplicitAny, 3 @ts-expect-error, 1 //nolint: L 17, U 14.
- Other config ignores (biome files.includes, test/vue overrides, knip ignore*, golangci exclusions): all pre-P262, LEGITIMATE (generated, vendored, CSS-only deps, Go binary, test complexity).

## 1. check-ui-primitives.sh PERMANENT (lines 96-153)

### UNIFIABLE (35)

Combobox / caret popup cluster (one change set, ~5 files + delete a package):
- 118 U36 AutocompleteField.vue, 145 U41, 146 U47, 147 U58: hand-rolled caret popup on `@kira/kira-ui` computeFloatPosition. `packages/kira-ui` exists only for this one consumer. SearchBox.vue already proves a reka `PopoverContent` with `@open-auto-focus.prevent` keeps focus in the input; `PointPopover` already does virtual-point anchoring. Move both popups onto PointPopover/PopoverContent (U36, U58 gone), delete packages/kira-ui. U41 Ctrl+Space: add `editor.suggest` to SHORTCUTS, use `shortcutFor`.
- 149 U47 SearchBox.vue, 150 U47 SearchResults.vue, 146 U47 AutocompleteField.vue: two hand-rolled aria-activedescendant comboboxes (same ArrowUp/Down/Enter/Escape model). Extract one `useActiveDescendant` composable in workbench/behaviour; teach U47 to accept it. ~60 new lines, 3 callers.
- 98 U17 SearchBox.vue: its InputGroup (search icon, input, clear button) is a copy of SearchField. Only blocker is two-stage Escape: SearchField.onEscape should return when `e.defaultPrevented` (caller's `@keydown` lands first via $attrs). 2 files, ~25 lines.

Keyboard chords read raw (U41/U47), all expressible with existing `shortcutFor(e, ids)` (works on any KeyboardEvent; SlickGridHost already uses it at ~1940):
- 123 U41 ConsoleSlickGrid.vue:656 Ctrl/Cmd+C -> `grid.copy`.
- 124 U41 SlickGridHost.vue:1925/1931 -> `grid.copy`/`grid.paste`; :1537 column toggle-click needs a new `isPrimaryModifier(e)` export in keys.ts.
- 127 U41 CellEditorView.vue:353 Ctrl/Cmd+Enter -> `form.submit`.
- 140 U41 AdeNotesEditor.vue:63 link Cmd/Ctrl-click -> `isPrimaryModifier(event)`.
- 142 U41 git-ui App.vue:1517 Cmd/Ctrl+F -> `view.find`.
- 152 U41 gridKeyboard.ts:102 Ctrl/Cmd+R -> SHORTCUTS id (refresh) via shortcutFor.
- 130 U47 EnvironmentsView.vue:213, 131 U47 VariableRow.vue:114: identical Alt+Up/Down reorder handler twice -> SHORTCUTS `list.moveUp`/`list.moveDown` (alt) + shortcutFor.
- Size: keys.ts +1 export, shortcuts.ts +4 ids, 9 callers, ~30 lines. Also fixes platform behaviour (today Ctrl and Cmd both fire on every platform).

Other keyboard/behaviour:
- 139 U40 AdeWorkflowGraph.vue:239 onKeyStroke('Delete') skipping text fields. Same "is the target a text field" test exists 4 times (listNavigation TEXT_FIELD, git-ui App isEditableTarget, AdeWorkflowGraph IN_FIELD, FieldRowsTable). Add `ignoreTextFields` to useShortcut (check before preventDefault) + one exported `isEditableTarget`. 3-4 files.
- 135 U57 RepoFileView.vue:127 scrollIntoView({block:'start'}): add an optional `block` to `revealElement`. 2 files, 3 lines.
- 129 U42 scrollTrace.ts: reason is wrong. `copyOrReportError` calls copyText inside its own try, so an absent `navigator.clipboard` (sync TypeError) is caught. Replace with `void copyOrReportError(json, (m) => logWarn('scrollTrace', m))`. 1 file.
- 125 U42 SlickGridHost.vue:1875 clipboard readText: add `readClipboardText()` beside copyText in behaviour/clipboard.ts. 2 files, ~5 lines (low).
- 144 U52 scheduleText.ts: `fireText`/`clockText` are display formats (weekday + clock in a zone), not domain text. Add a zone-aware formatter (and `localTimezone`) to behaviour/format.ts. 2 files, ~25 lines moved.

Visual primitives:
- 99 U9 BacklogScreen.vue, 100 U9 TerminalScreen.vue: reason stale (now `h-touch`, still hits U9 because U9 bans any `h-` class on Input). P266 §3 triage fix was half done. Add `size: touch` ('h-touch px-2 text-kira-touch') to inputVariants. 3 files.
- 97 U9 AdeBacklogRow.vue, 119 U36 InlineEditInput.vue (+ built-in U35 InlineEditInput): two inline-edit inputs, each hand-styled. Add an `inline` appearance to inputVariants (bare/ghost until focus); InlineEditInput renders `<Input>`. 3 files.
- 101 U27 ContextMenu.vue:113/160: the swatch is a palette colour mark with the same "none = border-disabled ring" rule as `colorMarkClass` in connColor.ts. Add mark `swatch` (size-2.5) to MARK_SHAPE. 2 files, ~6 lines.
- 102 U31 WorkbenchShell.vue:66: only the dock handle holds the resize cursor shell-wide during drag; the project handle and every column handle do not. Move it into usePaneResize/ResizeHandle (root class while `dragging`), drop the `dragging` emit wiring. 2-3 files, ~10 lines.
- 109 U36 DbMcpApprovalDialog.vue:109, 110 U36 DatabaseMcpPane.vue:146/205: code blocks are exactly what ClaudeCodeMcpSection.vue, RunScriptDialog.vue and ScheduleConfirmDialog.vue already render as `<Card class="font-data whitespace-pre-wrap ...">`. Connection list items -> Card per row. 2 files, ~8 lines.
- 106 U36 FiltersDialog.vue:218/270, 107 U36 ExplainResultView.vue:160: same bordered scroll list box 3 times. Add Card variant `list` (rounded-kira-sm border p-1, no fill). 3 files.
- 111 U37 AppearancePane.vue:38: 22/28 density mapping duplicated in createSettingsStore.ts:87 (built-in U37 exempt). Export `ROW_HEIGHT_PX: Record<RowDensity, number>` from workbench lib/rowHeight.ts, use in both. Kills this line and the createSettingsStore built-in exempt. 3 files.
- 112 U26 reviewDecorations.ts:215: reason false. Same file already mounts Vue into Monaco view zones (`createApp(ReviewThread)` at :494/:509). Mount `Alert` + Retry Button the same way. 1 file, ~20 lines.
- 108 U37 SlickGridHost.vue:1106: "no Vue Button" is not a blocker; reviewDecorations.ts:222 already builds a DOM button from `buttonVariants(...)`. Use `buttonVariants({variant:'toolbar'})` plus positioning. 1 file (low).
- 114 U38 RepoFileView.vue:371-384: two divergent markdown prose recipes (RepoFileView `.md-reading` scoped CSS vs AdeNotesEditor PROSE arbitrary classes: different p/code spacing and radius, no heading scale in notes). One theme `markdown-prose` class in base.css keeps the em scale and leaves the scanned tree. 3 files, medium.
- 117 U25 LogsView.vue:217/241: LogLines.vue ("the one log viewer") already maps stderr -> text-error. LogsView is a second virtualized log viewer with duplicated ANSI templates (wrap and virtual branches). Give LogLines a per-line slot + wrap prop, move parseAnsi to workbench; LogsView becomes toolbar + LogLines; run logs gain ANSI. 3-4 files, net negative lines, medium.

### LEGITIMATE (22)

- 96 U11 LogsView.vue: ANSI bold is log data (stays even after LogLines merge).
- 103 U34 EngineIcon.vue, 116 U34 OriginIcon.vue: third-party brand colours.
- 113 U34 MobileQr.vue: QR quiet zone needs white for scanners.
- 104 U36 / 105 U37 ConnectionDialog.vue:755: selectable radio-card tile; shadcn-vue has no radio card, single consumer.
- 115 U37 AdeTaskCard.vue:148: plan-board card selected state, P129 board design, not a row.
- 120 U46 bridge/port.ts:138: per-request timeout in a module-level pending map, cleared on reply; not a component timer.
- 151 U46 graph/layoutClient.ts:83: worker fallback must yield a macrotask per request.
- 121 U41 / 122 U62 MonacoHost.vue: Monaco IKeyboardEvent (not DOM) select-all/undo/redo intercept; `editor.focus()` is Monaco API.
- 126 U62 slick/editor.ts: SlickGrid editor class (non-Vue) focusing its own input.
- 128 U52 celleditor/timestamp.ts: spelling-preserving timestamp re-encoding (CLAUDE.md names it).
- 132 U62 ConsoleView.vue:329: focus goes to the editor, not the invoker, so useFocusReturn does not fit.
- 133 U47 / 134 U62 FieldRowsTable.vue: 2D caret navigation between text inputs; useListNavigation deliberately ignores text fields.
- 136 U62 RepoFileView.vue:254, 137 U62 RepoDiffView.vue:84: Monaco `editor.focus()`.
- 138 U60 AdeDayBand.vue: drag source onto other targets (sort/pull/put off), single consumer; useSortableReorder is reorder-only.
- 141 U62 AdeNotesEditor.vue: TipTap `chain().focus()`.
- 148 U62 AutocompleteField.vue:325/493: caret restore after accept.
- 153 U47 gridKeyboard.ts: reason text wrong (it is row nav, not cells) but the exemption holds: PageUp/PageDown plus O(1) row access on a streamed 100k-row store; useListNavigation maps `items()` per keystroke and has no page keys.

### STALE (1)

- 143 U62 CommitGrid.vue: every `.focus()` match is inside comments (:842, :964, :966). Code no longer calls it. Reword three comments, delete the line.

## 2. scripts/copy/exemptions.ts (8)

- UNIFIABLE: GrpcMetadataTable.vue:36-40 U67. The authorization list (Bearer/Basic/Digest/Token/ApiKey) duplicates api-core http/headers.ts:172-178, which uses `prefix()` helpers and so never hits U67. Move metadataValueCompletions into api-core beside headerValueCompletions. 2 files, ~15 lines.
- LEGITIMATE: frame.ts (internal invariant, shown only as E_CONTRACT/E_INTERNAL detail, matches Go adapters.Contract); button/index.ts (`title` variant key; checker false positive, could teach checker to skip cva variant keys); completion.ts (Redis grammar); ejson.ts (shell-literal syntax); AdeActivityIcon.vue (`z` glyph); RunPreview.vue, ToolsField.vue (claude CLI flag names).

## 3. scripts/consistency-allowlist (10)

- LEGITIMATE U82 mobile/state/useAdeWrites.ts:17: hand-rolled UUIDv4 group slicing, not a sha (guard false positive). Note: the `uuid` npm package (MIT) handles the no-randomUUID plain-HTTP case if a library is preferred.
- LEGITIMATE G4 x9: flowharness (studio harness.go, servers/ca.go, servers/grpc.go; space harness.go, gitrepo.go), ipcfixture/write.go, flowtest/contract.go, flowtest/fakeagent/fakeagent.go are test tooling; gitsession/incremental.go:477/480 writes into a per-call MkdirTemp dir removed by defer.
- Mechanism UNIFIABLE: these are permanent lines parked in stream-named "pending" files whose own header says pending lists only shrink. Go already has an empty `permanentExemptions` map (internal/conventiontest/conventions_test.go:22) for exactly this; the sh script has PERMANENT. Better still for G4: one path rule (skip packages named flowharness, flowtest, ipcfixture) instead of 8 file lines. Then delete the 6 stream-*.txt files.

## 4. biome.json noConsole override block (23 files)

STALE (11): no `console.` left in apps/kira-space/frontend/src/main.ts, state/agentNotify.ts, workbench/settings/ClaudeCodePane.vue, kira-studio api/state/apiQueries.ts, api/state/collections.ts, packages/workbench/src/bootstrapShell.ts (comment only), state/createOpLogStore.ts, createTabsStore.ts, createTerminalsStore.ts; files gone: apps/kira-space/frontend/src/workbench/TitleBar.vue, apps/kira-studio/frontend/src/workbench/TitleBar.vue. Biome does not flag dead override paths.

UNIFIABLE (10, ~20 call sites) onto `logWarn`/`logError` (W/bridge/log.ts), as P266 §2.2 decided ("overrides only for log.ts, scrollTrace.ts, testing, tests, scripts, proto"): repo/state/repoHeads.ts:56, state/repoOpenHold.ts:26, views/repo/reviewDecorations.ts (7), views/repo/useDiffEditor.ts:132/136, workbench/panels/OperationsPanel.vue:115, git-ui state/clipboardActions.ts:26, graphView.ts (5), packedStream.ts:101/105, repoScopedReload.ts:65, repoSettings.ts:75. git-ui already imports `@workbench/*`. Then the whole first block goes.

LEGITIMATE (2): tools/mutation/stryker.config.mjs, summarize.ts are CLI tools; belong in the second block as `tools/**` beside `scripts/**`.

## 5. Suppressions added P262-P266 (31)

- UNIFIABLE, biome-ignore a11y/useFocusableInteractive x11: GitPanel.vue:559/656, RepoSearchRow.vue:65/114, ContainerList.vue:278, ContainerTable.vue:80, ImageList.vue:51, NetworkList.vue:42, VolumeList.vue:42, FileTree.vue:540/639. Nine other rowProps callers (CallHistoryList.vue:168 etc.) add explicit `:tabindex="nav.tabindexFor(key)"` and need no suppression. Pick that one convention.
- LEGITIMATE, biome-ignore a11y/useKeyWithClickEvents x13 (same files + RepoTreeRow.vue:74, OpLogPanel.vue:229): roving-tabindex pattern, keys handled on the container by useListNavigation; Biome cannot see that.
- UNIFIABLE (low), noExplicitAny x3: copy-coverage-docker-automations.spec.ts:17 and copy-wording-docker-automations.spec.ts:36 each declare the same `Record<string, any>` (one shared type in tests/ui/support/contract.ts; Space copy specs need none); scripts/copy/sourceRules.ts:28 `TplNode = any` while @vue/compiler-core ships `TemplateChildNode`/`ElementNode`/`NodeTypes` (also replaces magic `p.type === 7`).
- LEGITIMATE: packages/theme/src/i18n/types.check.ts x3 @ts-expect-error (intentional type tests); internal/startupfail/report.go:78 //nolint:sloglint (wrapper forwards caller's static message).

## 6. Extra: stale built-in exempts (guard table 3rd column, never stale-checked)

Verified no hit in the exempt file: U35 CommitGrid.vue, U35 /git-ui/src/App.vue, U35 ReviewThread.vue, U34 ansi.ts, U39 codedError.ts, U40 useShortcut.ts, U41 useShortcut.ts, U73 CodiconIcon.vue and U73 Spinner.vue (packages/theme is not in DIRS, so never scanned), U79 openExternal.ts, U80 ShowMoreButton.vue, U82 /lib/sha.ts (uses SHORT_SHA_LENGTH, not 7|8), U58 floatingPosition.ts (redundant with /kira-ui/).
Fix: apply the same "exempts nothing fails the run" check to column-3 entries (built-in `/behaviour/`, `/testing/` blankets would need an opt-out, many are inert by design).

## Ranked unifiable work

1. noConsole override: 10 files to logWarn/logError, drop 11 dead paths, move tools/mutation. Small, mechanical, closes a P266 §2.2 contradiction.
2. Chords via shortcutFor + `isPrimaryModifier` + 4 SHORTCUTS ids: 9 PERMANENT lines, ~10 files, ~30 lines; fixes Ctrl-vs-Cmd platform behaviour.
3. Combobox/caret popup: AutocompleteField onto PointPopover + shared activedescendant composable for AutocompleteField and SearchBox; SearchBox onto SearchField; delete packages/kira-ui. 8 PERMANENT lines + 1 built-in; medium-large.
4. reviewDecorations Alert via createApp (reason false; 1 file).
5. Card for MCP code blocks and connection rows (twin of ClaudeCodeMcpSection), Card `list` variant: 5 lines, 5 files.
6. inputVariants `touch` + `inline`: 4 lines + 1 built-in, 5 files.
7. Resize drag cursor in usePaneResize (also fixes project handle inconsistency).
8. Single density-to-px map (AppearancePane + createSettingsStore built-in).
9. ContextMenu swatch via colorMarkClass.
10. LogsView onto LogLines (ANSI for all logs), shared markdown prose class.
11. a11y: explicit `:tabindex` in 8 files (11 suppressions).
12. Small: useShortcut ignoreTextFields + shared isEditableTarget, revealElement block option, scrollTrace via copyOrReportError, CommitGrid comment reword (stale), readClipboardText, zone-aware formatter for scheduleText, gRPC metadata vocabulary into api-core, buttonVariants for grid nav button, spec Json type, sourceRules compiler-core types.
13. Housekeeping: permanent G4/U82 lines out of stream pending files (or G4 path rule); stale-check built-in exempts (13 dead now).
