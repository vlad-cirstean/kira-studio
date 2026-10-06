# P168 Part 11: review plan, Studio grid and shared view machinery

Chunk C2, Stream C position 2 of 4 (pre-plan `P168-prep-plan.md` §5.10; moved from Stream A by user
instruction, SPEC row). One Opus reviewer runs this plan and reports findings. It fixes nothing. One
Sonnet fixer follows (§8). Tree surveyed: `9c4f0f9` (`p168-stream-c`, rebased onto `v2.0` with Part
10's fixes and the user's P162 grid commits `71d7c6a`/`60ed063`).

Paths repo-relative. `SF` = `apps/kira-studio/frontend/src`, `ST` = `apps/kira-studio/tests`,
`SP` = `packages/shared/protocol`, `SD` = `packages/shared/domain`, `PW` = `packages/workbench/src`
(`@workbench`), `PT` = `packages/theme/src` (`@theme`). Line numbers are as of `9c4f0f9`; re-read
before citing.

SPEC row names this file `P168-part11-grid.md`; the orchestrator named it
`P168-part11-studio-grid.md`. Same plan, this name wins.

## 0. Method for the reviewer

- **`codegraph_explore` first, mandatory.** Load it with `ToolSearch "codegraph"` if it is not
  listed, then call it with `projectPath=/home/user/kira-studio-streamC` before any Read/Grep on a
  symbol, call-path or blast-radius question. The orchestrator greps the run's tool log for real
  calls. Index present at planning (`.codegraph/codegraph.db`); if missing, run
  `sh scripts/codegraph-setup.sh` in the worktree, never fall back silently. Seeds:
  - grid engine: `KiraSlickGrid` (`getRenderedRange`, `scheduleChase`, `destroy`,
    `bindAncestorScrollEvents`, `createCssRules`, `ensureColumnRules`, `render`), `rowRangeBounds`,
    `countNewRows`, `clampColumnOverscan`, `runwayConfig`, `createGridDataSource`, `rowHandleAt`,
    `pageRowAt`, `displayPositionOf`, `renderedPageRowBand`, `createScrollVelocityTracker`,
    `SlickHybridSelectionModel` subclass in `selectionModel.ts`, `selectionFromRanges`,
    `rangesFromSelection`, `computeSelEdgeHashes`, `searchCellLayers`.
  - page machinery: `createPageStore` (`setPage`, `cached`, `cachedView`, `setVisibleWindow`,
    `drop`, `totalRetainedBytes`), `runPagedLoad`, `navigation.ts`, `scan.ts` (`ScanResult`),
    `search.ts`, `searchFilter.ts`, `visibleRows.ts`, `columns.ts` (`alignmentFor`,
    `pageColumnIndexFor`).
  - data grid: `useGridViewStore` (`load`, `reload`, `reloadAfterMutation`, `stop`,
    `setMaskPreview`), `usePendingChangesStore` (`stageEdit`, `stageNull`, `stageDelete`,
    `addInsertRow`, `stageInsertValue`, `duplicateAsInsert`, `buildPlan`, `commitPending`,
    `previewPending`, `registerFullPrimaryKeyAccessor`, `primaryKeyOf`), `applyPastedCells`,
    `resolvePasteTarget`, `parseDelimited`, `KiraCellEditor`, `editorCtx`, `cellNavEntry`,
    `rowsForSelection`, `createDisplayValueExtractor`, `pendingRowClasses`, `SlickGridHost`
    (`onCopy`, `onPaste`, `onKeydown`, `onGridRendered`, `placeNavButtonsForRenderedCells`,
    `applyCellFocusRequest`, `refreshSearchLayer`, `refreshStagedLayer`, `refreshSelEdges`),
    `fkPreview.ts`, `focusRequest.ts`, `menu.ts` (`foreignKeyNavItems`, `referencedByItems`,
    `editReferencedRow`, `navigateForeignKey`).
  - cell editor and clipboard: `CellEditorView`, `detectFormat`, `describeValue`,
    `validateFormat`, `beautifyFor`, `decodeToText`/`encodeFromText`, `timestamp.ts`,
    `useCellEditorFormatStore`, `tsvField`, `rowsToTsv`, `columnsToTsv`, `rowsToCsv`,
    `rowsToJson`, `rowsToInsert`, `neutralizeFormulaPrefix`, `disambiguateNames`, `sqlIdent.ts`.
  - document, key-value, request: `ejson.ts`, `rawTree.ts`, `useDocumentRowsStore`,
    `KeyValuePane`, `useKeyValueViewStore`, `keyvalue/mutations.ts`, `createImmediateMutator`,
    `resolve.ts`, `useRequestChrome`, `useRequestTabSave`, `FieldRowsTable`, `viewOp.ts`,
    `useConnectionGate`, `useEditBuffer`.
- **CodeGraph over-links TS names.** `getItem`, `load`, `reload`, `destroy`, `focus`, `cell`,
  `page`, `state` collide across Studio, Space, `git-ui`, the P165 prototype (`SF/../proto/grid`)
  and Go. Confirm every cross-package claim with `git grep` of real `import` lines. §3 and §4 were
  verified that way. The prototype under `apps/kira-studio/frontend/proto/**` is excluded
  (pre-plan §6); ignore its hits.
- **Unreviewed callees (gates G1/G2 waived).** Part 9 (`PW`, `PT`, `packages/kira-ui`) and Parts
  5/6 (`SP/{page,frame,data-ops}.ts`, `SF/bridge/**`, `SI/page`, `SI/adapterhost/frame.go`) are
  **not reviewed yet**. Read them as unreviewed callees: verify the contract this chunk relies on,
  do not assume it holds. A defect there is reported with the routing tag (§8), never left
  implicit.
- **Scratch probes** in the session scratchpad, never in the tree, where a claim turns on runtime
  behavior: a `bun test` harness over `usePendingChangesStore` or `createPageStore` with a fake
  `data` bridge (ordering, double commit, stale page), or a Playwright run against `ST/ui`'s static
  server and mock runtime. Mark each claim "verified" or "code-read".
- **Checks.** No baseline taken at planning: a full `test:ui:studio` run was occupying this
  worktree. Reviewer records its own baseline first: `bun test` over the 31 own unit specs (§2),
  `bun run typecheck:web:studio`, `bun run typecheck:unit:studio`, `bunx biome check` over the own
  paths. Optional, when a claim needs it: `bun run build:test:studio`, then
  `node_modules/.bin/playwright test --config=apps/kira-studio/playwright.config.ts --project=ui
  <spec>` for the 7 own UI specs (bare `playwright` hits a global binary, P162 result). If deps or
  bindings are missing: `bun install --frozen-lockfile` and `bun run setup`. Never run
  `test:visual:update:*` here (sandbox font drift, `docs/DEV_ENVIRONMENT.md`). A red check is a
  finding.
- **Known open items read first** (`docs/ARCHITECTURE.md`): tab switch remounts `DataView` and
  SlickGrid above the 50 ms budget (P139 Part 2); documents fastest-flick frames (P161, Part 12's
  view); ClickHouse `ᴺᵁᴸᴸ` text renders as NULL (P168 Part 3). Do not re-report.

## 1. Ownership re-run (pre-plan §8) and drift

Re-ran the §8 script verbatim at `9c4f0f9`. **Part 11: 133 files (unchanged), 30,574 to 30,551
code lines, tests 10,074 (unchanged).** The -23 is `71d7c6a` (user P162 follow-up, +1/-24) in
`slickTheme.css`; `00570dd` (P162 D1) already predates `f40cd35`. P161/P162's `ST/perf/grid-scroll.spec.ts` (98) and
`ST/perf/support/wideTable.ts` (136) were already counted at `f40cd35`.

Drift elsewhere since `f40cd35` (from Part 2/3/10 fixes, P166/P167, user commits), none touching a
Part 11 file:
- Part 2: 145 to 148 files, 19,684 to 20,159. Part 3: 138 to 142, 26,401 to 27,722 (Part 3 fixes).
  Part 8: 16,274 to 16,328.
- Part 10: 91 to 92 files, 23,319 to 23,917, tests 10,157 to 10,431 (Part 10 fixes).
- Part 13: 151 to 152 files, 26,687 to 26,740 (`tooltips.spec.ts` rewrite in `71d7c6a`, plus Part 10
  spill).
- Part 14: 134 to 135, 16,073 to 16,275. Part 16: 18,789 to 18,773. Part 20: 20,140 to 20,312.
  Part 21: 17,275 to 17,327. Stream B files.
- Totals: streams A+C 256,562, B 182,504; 2,878 owned, 0 orphans, 3,510 tracked (docs 479).
- **Script label drift** (carried from Part 10): the script prints `[A]` for every Part `<= 13`.
  Parts 10-13 are Stream C (SPEC rows). Rules unchanged; label only. Not a Part 11 finding.

**Part 10's fixer touched no Part 11 file.** `git diff --stat 8a008bd HEAD` over the 133 own files
shows only `slickTheme.css` (`71d7c6a`, user P162). `views/shared/request/**` and
`views/shared/fields/FieldRowsTable.vue` are byte-identical to Part 10's base.

Before landing, re-check `git diff --name-only 9c4f0f9 v2.0 -- apps/kira-studio/frontend/src/views/{shared,grid}`.

## 2. Own file set (133 files)

20,477 production lines (92 files), 10,074 test lines (41 files). Visual baseline `.png`s are
excluded assets (pre-plan §6).

- **`SF/views/grid` (26 files, 7,256).** `SlickGridHost.vue` (2,659), `menu.ts` (677),
  `DataToolbar.vue` (393), `DataView.vue` (377), `state.ts` (364), `pendingChanges.ts` (338),
  `FilterToolbar.vue` (192), `FkPreviewPopover.vue` (192), `ColumnsMenu.vue` (161), `paste.ts`
  (129), `maskPreview.ts` (121), `fkPreview.ts` (99), `PreviewCommandPanel.vue` (87),
  `filterCompletion.ts` (74), `search.ts` (60), `focusRequest.ts` (53), `page.ts` (42),
  `sortTerms.ts` (23); `slick/{rowValues (252), editor (123), dataSource (102)}.ts`;
  `fakeData/{generate (349), recipes (195), typeBounds (137), types (50), fakerEntry (7)}.ts`.
- **`SF/views/shared/slick` (11, 2,647).** `slickTheme.css` (732), `kiraSlickGrid.ts` (641),
  `scrollTrace.ts` (361), `dataSource.ts` (245), `selection.ts` (171), `selectionEdges.ts` (166),
  `gridHostShared.ts` (136), `scrollVelocity.ts` (80), `cssLayers.ts` (42), `selectionModel.ts`
  (39), `rowVisibility.ts` (34).
- **`SF/views/shared/page` (11, 1,814).** `columns.ts` (413), `SearchToolbar.vue` (378), `scan.ts`
  (269), `store.ts` (199), `search.ts` (160), `PagerControls.vue` (123), `navigation.ts` (120),
  `load.ts` (53), `searchFilter.ts` (50), `visibleRows.ts` (29), `sizes.ts` (20).
- **`SF/views/shared/celleditor` (11, 2,093).** `CellEditorView.vue` (734), `detect.ts` (375),
  `timestamp.ts` (345), `TimestampPane.vue` (167), `validate.ts` (107), `formats.ts` (98),
  `generate.ts` (89), `state.ts` (63), `binary.ts` (59), `CellEditorDock.vue` (46),
  `TimestampReading.vue` (10).
- **`SF/views/shared/document` (5, 1,415).** `ejson.ts` (661), `rows.ts` (327), `rawTree.ts`
  (252), `DocumentTree.vue` (89), `DocumentRow.vue` (86).
- **`SF/views/shared/keyvalue` (7, 1,671).** `KeyValuePane.vue` (1,155), `state.ts` (190),
  `mutations.ts` (84), `menu.ts` (83), `search.ts` (69), `host.ts` (48), `page.ts` (42).
- **`SF/views/shared/request` (3, 133)** `resolve.ts`, `useRequestChrome.ts`,
  `useRequestTabSave.ts`; **`fields/FieldRowsTable.vue` (389).**
- **`SF/views/shared` top level (17, 3,059).** `AutocompleteField.vue` (645), `DateTimePicker.vue`
  (370), `typeGlossary.ts` (290), `viewOp.ts` (258), `clipboardFormats.ts` (248), `sqlIdent.ts`
  (202), `ResponseFindBar.vue` (191), `FilterHistoryMenu.vue` (190), `SavedListMenu.vue` (136),
  `useEditBuffer.ts` (109), `mongoFieldSample.ts` (97), `useConnectionGate.ts` (92),
  `EditBufferActions.vue` (89), `immediateMutation.ts` (57), `mongoVocabulary.ts` (45),
  `eventCoords.ts` (25), `targetPath.ts` (15).
- **`ST/unit` (31, 3,898):** `column-widths-cache`, `document-row-height-cache`, `ejson`,
  `fake-data-{generator-bounds,recipes,temporal-format}`, `grid-clipboard-formats-safety`,
  `grid-commit-{composite-pk,pkless}-guard`, `grid-menu-projection-empty-guard`,
  `grid-paste-row-cell-kind-target`, `grid-row-menu-lazy-snapshot`, `grid-rows-for-selection`,
  `grid-rows-to-insert`, `grid-sql-literal-escaping`, `grid-stage-delete-idempotent`,
  `grid-staged-value-snapshot`, `kira-slick-grid`, `match-index`,
  `page-navigation-in-flight-guard`, `page-store-cell-cache`, `resolve-column-order`,
  `row-range-bounds`, `row-values-visible-span`, `scan`, `slick-data-source`, `slick-selection`,
  `timestamp-{epoch-fraction,two-digit-year}`, `view-op-disconnected-status`, `view-state`.
- **`ST/ui` (7, 5,859):** `slick-grid` (1,930), `data-view` (1,596), `cell-editor` (1,282),
  `mutations` (397), `fake-data` (342), `scroll-trace` (162), `row-coloring` (150).
- **`ST/perf` (2, 234):** `grid-scroll.spec.ts`, `support/wideTable.ts`. **`ST/visual` (1, 83):**
  `data-view.spec.ts`.

## 3. One hop: callers (git grep of import lines, production files)

Importers outside the chunk, by owner. Every one verified on a real `import` line.

- **Part 12 (Stream C, later):**
  - `views/console/*` (24 files): `ConsoleSlickGrid.vue` (12 imports: `kiraSlickGrid`,
    `dataSource`, `gridHostShared`, `selection*`, `cssLayers`, `scrollVelocity`,
    `clipboardFormats`, `page/*`), `ConsoleResultGrid.vue` (6), `ConsoleView.vue` (4:
    `celleditor`, `useConnectionGate`, `sqlIdent`, `page`), `resultPages.ts` (`page/store`),
    `copyAll.ts`/`format.ts`/`lint.ts`/`resultMenu.ts`/`state.ts` (`document/ejson`,
    `clipboardFormats`, `viewOp`), every `sql*.ts`/`completion.ts`/`ddl.ts` (`sqlIdent`),
    `completion.ts` (`mongoFieldSample`, `mongoVocabulary`), `ConsoleSavedMenu.vue`
    (`SavedListMenu`).
  - `views/documents/*`: `DocumentView.vue` (16: `AutocompleteField`, `FilterHistoryMenu`,
    `EditBufferActions`, `useEditBuffer`, `useConnectionGate`, `targetPath`, `mongoFieldSample`,
    `document/*`, `page/*`), `page.ts` (`page/store`, `document/rows`), `menu.ts`, `search.ts`,
    `state.ts` (`viewOp`, `page/load`), `mutations.ts` (`immediateMutation`).
  - `views/stream/*`: `StreamView.vue` (7: `celleditor`, `DateTimePicker`, `eventCoords`,
    `useConnectionGate`, `page/*`), `page.ts`, `search.ts`, `state.ts`, `mutations.ts`
    (`immediateMutation`), `StreamSearchToolbar.vue`, `StreamFilterHistoryMenu.vue`
    (`SavedListMenu`).
  - `views/keyvalue/KeyValueView.vue` and `views/browse/BrowseView.vue` (`keyvalue/*`),
    `views/browse/state.ts` (`viewOp`), `views/definition/{DefinitionView.vue,ColumnsSection.vue,
    state.ts}` (`ResponseFindBar`, `sqlIdent`, `typeGlossary`, `useConnectionGate`, `viewOp`).
  - `SF/beautify.ts` (`document/rawTree`), `editor/MonacoHost.vue` (type `SqlDialect`),
    `editor/findRanges.ts` (`REGEX_SCAN_TEXT_CAP` from `page/scan`).
- **Part 10 (Stream C, closed):** `httprequest/{HttpRequestView,state}`,
  `grpcrequest/{GrpcRequestView,state}` (`request/*`, `viewOp`, `AutocompleteField`,
  `ResponseFindBar`); `FormDataTable`, `QueryParamsTable`, `RequestHeadersTable`,
  `UrlEncodedTable`, `GrpcMetadataTable` (`fields/FieldRowsTable.vue`); `RequestBodyPane.vue`
  (`celleditor/formats`); both `ResponsePane.vue`s and `RawExchangePane.vue` (`ResponseFindBar`).
- **Part 13 (Stream C, later):** `main.ts` (6: `grid/page` `pageStoreEntries`/`totalRetainedBytes`,
  `grid/search`, `document/rows`, `keyvalue/{page,search}`, `slick/scrollTrace` test hooks);
  `state/tabKinds.ts` (`grid/page.drop`, `keyvalue/page.drop` on tab close); `state/tabs.ts`
  (`usePendingChangesStore`); `state/schemas.ts` (`sqlIdent`); `workbench/tabViews.ts`
  (`DataView.vue`); `workbench/GenerateDataDialog.vue` (`fakeData/*`, `grid/page`, `grid/state`,
  `sqlIdent`); `workbench/panels/OperationsPanel.vue` (`sqlIdent`, `useConnectionGate`).
- **Test callers in other Parts:** Part 12 unit specs `document-byte-label`,
  `document-console-row-menu-lazy-snapshot`, `ddl-schema`, `sigma-count-refresh`;
  `ST/perf/pureFns.entry.ts`; Part 13 `ST/ui/{global.d.ts,support/measure.ts,
  support/mockRuntime.ts}`. A changed export signature breaks these.
- **Drift from the pre-plan caller list:** `browse`, `definition`, `keyvalue`, `beautify.ts`,
  `editor/*`, `main.ts`, `state/*` and `workbench/*` are callers too (pre-plan lists console, grid,
  documents, stream, httprequest, grpcrequest). No dynamic `import()` of own files except
  `fakeData/fakerEntry.ts` (lazy faker chunk, ARCHITECTURE "Renderer build").

## 4. One hop: callees

Grouped by owner, with the routing that applies to a fix there (§8).

- **Part 5, Stream A, unreviewed (gate waived):** `@shared/protocol/page` (17 imports:
  `TabularPage`, `DocumentPage`, `KeyValuePage`, `cellText`, `isNull`, `isTruncated`,
  `TextColumnChunk`; Go mirror `SI/page/encode.go` + `SI/adapterhost/frame.go` against
  `SP/frame.ts` `decodeFrame`), `@shared/protocol/data-ops` (4: `PageCursor`, `MutationRowOp`,
  `MutateResponse` = `{ affectedRows }` only), `SD/{mutations,connection,tree}` (`tree` 14
  imports); `SF/bridge/data`
  (7 files: `read`, `mutate`, `preview`, `invalidate`), `SF/bridge/control` (5 files).
- **Part 6, Stream A, unreviewed:** `SD/mask` (5 imports; Go `SI/mask` mirror).
- **Part 7, Stream A:** `@kira/api-core` (`resolve`, `sanitizeUrlSpan` in `request/resolve.ts`).
- **Part 9, Stream A, unreviewed:** `PT/components/ui/*` (tooltip 10, popover 9, button 7, input 6,
  badge 6, alert 6, toggle-group, separator, resizable, input-group, empty, checkbox,
  native-select, label), `PT/{CodiconIcon,RunState}.vue`, `PT/components/{TooltipIconButton,
  AttributeTooltip}.vue`, `PT/{connColor,wrapSelection}`; `PW/state/{tabRuntime,contextMenu,
  confirmDialog}`, `PW/util/{format,clipboard,floatingPosition,wheelScroll,useSortableReorder}`,
  `PW/components/{ViewToolbar,SearchOptionToggles}.vue`, `PW/shortcuts/{commands,keys}`,
  `PW/prompt/*`, `PW/editor/monaco`; `SD/{tabs,base64}`.
- **Part 10, Stream C, closed:** `api/state/variables` (`useRequestChrome.ts`),
  `api/state/variableCompletion` (type, `FieldRowsTable.vue`).
- **Part 12, Stream C, later:** `SF/beautify.ts` (`scanJson`, `scanXml`, beautify modes;
  `celleditor/{detect,formats,validate}.ts`, `useEditBuffer.ts`), `SF/editor/{MonacoHost.vue,
  findRanges,ranges,paintSpans,monacoLanguages,diagnostics,searchPattern}`, `SD/{queries,editor,
  sql-lex,sql-lint}`. The cell editor does **not** use the parse worker (§6).
- **Part 13, Stream C, later:** `SF/state/{tabs,connections,cellSelection,tabDomain,viewCommands,
  maskRules,fakeData,settings,runState,pinia,tabIncognito,objectStore,layout}`,
  `SF/theme/{completion,icons,cellClass,EngineIcon.vue}`, `SF/project/state/tree`.
- Third-party: `slickgrid@5.20.0` core only (9 imports: `SlickGrid`, `SlickHybridSelectionModel`,
  `SlickRange`, `SlickEventHandler`, editor types), Vue, Pinia (7), VueUse (7), TanStack Query (3:
  `DataToolbar`, `PreviewCommandPanel`, `SlickGridHost`), `@tanstack/vue-virtual` (1:
  `KeyValuePane.vue`), `vue-draggable-plus` via `useSortableReorder` (`ColumnsMenu.vue`),
  `reka-ui` (1), `@faker-js/faker/locale/en` (lazy).

## 5. Edge cases and failure modes to weight

Freeform: any kind of issue or bug counts. Weight edge cases. Data integrity first: this chunk
stages and commits writes against real databases. Items marked "suspect" were seen during planning
but not verified; confirm or drop each, never report unverified.

### 5.1 Mutations: staging, commit, pending layers

- **Suspect: double commit.** `DataView.vue:276-283` Commit is disabled only on `!isWritable`, not
  while `commitPending` is in flight. `commitPending` (`pendingChanges.ts:295`) builds the plan,
  awaits `data.mutate`, then `clearPending`. A second click (or Enter repeat) during the await
  sends the same plan again: duplicate INSERTs, a second UPDATE, a delete reporting 0 rows.
- **Suspect: edits staged during an in-flight commit are lost.** `clearPending(tabId)` after the
  await drops anything staged between `buildPlan` and the response. Then `reloadAfterMutation`
  replaces the page.
- **Suspect: silent no-op update.** `MutateResponse` is `{ affectedRows }` only. An UPDATE or
  DELETE whose key matched no row (row changed or deleted elsewhere, a `numeric`/`float` or
  collation-sensitive PK compared as quoted text) reports success. Check whether anything compares
  `affectedRows` with the plan's row-op count, against Part 3/4 adapter behavior (read only).
- `buildPlan` keying: staged rows are page-row indices. `load`'s `apply` clears pending only once a
  new page lands (`grid/state.ts:166-173`, P108 Part 10 F2). Check every path that replaces the
  page without `apply` (sort, filter, projection change, `reloadAfterMutation`, mask preview
  toggle, external `invalidate` broadcast, tab reopen) for index drift onto the wrong row.
- PK resolution: `primaryKeyOf` with hidden PK columns (`missingColumns`), PK-less tables,
  composite PKs, a PK value that is NULL or truncated, a PK column renamed by projection, duplicate
  column names. Existing guards: `grid-commit-{composite-pk,pkless}-guard`; verify they still drive
  the current code.
- `stageEdit` to the original value, `stageNull` vs `''`, edit on a pending-delete row (silently
  ignored), `discardCellEdit` leaving an empty `changes` object (an UPDATE with no SET).
- `duplicateAsInsert`: generated and PK columns skipped, truncated cells left unset (P21 F2).
- Pending layers on screen: `refreshStagedLayer`, `pendingRowClasses` gutter rails, insert-row
  `<input>`s, against fast scroll (rows rebuilt by `invalidateRow`) and filtered display rows.
- `previewPending` vs `commitPending` agree (same `buildPlan`); preview text escaping
  (`rowsToInsert`, `sqlIdent`) for quotes, backslashes (MySQL `NO_BACKSLASH_ESCAPES` off), NUL,
  newlines, identifiers with quotes or dots, per dialect.
- Key-value and document mutations (`keyvalue/mutations.ts`, `immediateMutation.ts`): reload after
  failure, `addKey` opening a tab when the database segment is missing, sentinel keys
  (`KEY_SENTINEL`/`VALUE_SENTINEL`) colliding with a real field name.

### 5.2 Paste

- **Suspect: stale target across the clipboard await.** `onPaste` (`SlickGridHost.vue:1794`)
  captures `sel` and `p` before `await navigator.clipboard.readText()`. A page load, sort, tab
  switch or unmount during the permission prompt stages edits at old page-row indices on the new
  page, or calls `grid`/`dataSource` after teardown.
- `parseDelimited`: TSV vs CSV choice, quoted fields with embedded tabs/newlines, CRLF, trailing
  newline producing an empty last row, ragged rows, no size cap (a 100k-line paste creates 100k
  inserts synchronously).
- Paste into generated columns (skipped, P108 Part 10 F3), into pending-delete rows, past the last
  column, under an active filter (display rows vs page rows), onto existing insert rows.

### 5.3 Copy and clipboard fidelity

- `onCopy` (`SlickGridHost.vue:1757`): NULL copies as `''` (indistinguishable from empty), a
  truncated cell copies its 64 KiB prefix with no warning, binary cells copy their display form.
  Decide per format whether that is a defect or a documented choice; check comments and P108 Part
  11 history first.
- Large selections: `column`/`all` selections build one string over every page row
  (`columnsToTsv`, `rowsForColumnOps`) synchronously; `copyText` failure surfaces or is swallowed.
- `tsvField`/`csvField` quoting, `neutralizeFormulaPrefix` (CSV only: TSV pasted into a spreadsheet
  also evaluates `=`; check `grid-clipboard-formats-safety` intent), `rowsToJson` NULL vs `''`,
  `disambiguateNames` for repeated console columns (P108 Part 11 F7).
- Copy reads staged values (display) vs stored values: consistent across cell, range, row, column.

### 5.4 SlickGrid lifecycle, virtualization and scroll

- Teardown: `SlickGridHost` unmount (`:2213-2225`) and `ConsoleSlickGrid` unmount: `grid.destroy(true)`,
  `eventHandler.unsubscribeAll`, `ResizeObserver`, delegated insert-region listeners,
  `useEventListener` scopes, `editorCtx` reset, `KiraSlickGrid.destroy` (ancestor scroll listener,
  chase rAF). Check no rAF/timer/promise touches a destroyed grid (`scheduleChase` re-arm after
  `destroy`, async `refreshMaskTagCache` then `invalidateAllRows`/`render`).
- `ensureColumnRules` shared append-only sheet (P139 Part 2): grows to the widest grid ever opened,
  never shrinks; bounded? Two grids with different column counts.
- `getRenderedRange` arithmetic: `mustStart/mustEnd`, budget rows when `mountedColumnCount` is 0,
  `dataLength` 0 or 1, `range.bottom` past `dataLength - 1`, `rowHeight` from density switch
  mid-scroll, `direction` sign. `rowRangeBounds` and `countNewRows` have unit specs; `growStart`/
  `growEnd` closures do not.
- P161/P162 runway, overscan and canvas containment are user-decided (§6). Do not propose
  overscan/runway or `onGridRendered` JS changes on perf grounds. A correctness defect in that code
  is in scope.
- `renderedPageRowBand` and `setVisibleWindow`/`setVisibleRows`: decode-cache pruning keyed to the
  rendered band; off-by-one at band edges (inclusive `hi` vs exclusive `hi + 1`).
- `scrollTrace.ts`, `scrollVelocity.ts`, `window.__kiraGridTuning`, `__kiraGridScrollWorkStart`:
  test/perf hooks shipped in production. Check cost when unset and that nothing allocates per frame
  when tracing is off.
- `placeNavButtonsForRenderedCells` runs on every render: DOM work per rendered cell, listener
  per button, cleanup when the cell node is rebuilt.

### 5.5 Page store, decode cache and memory

- `createPageStore` (`page/store.ts`): two-level cache (`cached`, `cachedView`), frozen pages with a
  tripwire, `setVisibleWindow` pruning, `drop` on tab close (`state/tabKinds.ts`), `onSet` reset
  (documents). Check every page kind's store is dropped on every close path (grid, keyvalue,
  console `resultPages`, documents, stream) and on connection delete/disconnect.
- Memory growth on long scroll (cache bounded by visible window?) and on many tabs opened then
  closed (module-level maps: `maskRulesByColumn`, `maskTagCache`, `lastCssLayerBand`, focus requests,
  FK preview state, `useCellEditorFormatStore` overrides, `useDocumentRowsStore`, keyvalue
  runtime).
- `cellText` decode of `offsets` and `nulls` against `TextColumnChunk`; NULL vs empty from the
  bitset only (`SP/page.ts:40-46`); truncated index lookup (`truncated` sorted `Uint32Array`).
  A malformed page (offsets past `data.length`, `chunks.length !== columns.length`) is a Part 5
  contract question: check `decodeFrame`/`decodePayload` validation, route a defect there.

### 5.6 Stale responses and loads

- `runPagedLoad` (`page/load.ts`) and `beginOp`: superseded loads, `stillMounted`, stop during load,
  `revertPageIndexOnFailure`. `page-navigation-in-flight-guard` covers navigation; check sort,
  filter, page-size and refresh paths too.
- `fkPreview.ts` fetch vs fast hover/click on another cell, tab close, popover close.
- `focusRequest.ts` pending-focus handshake: a request for a tab that never loads, two requests in
  a row, request consumed by the wrong page.
- `keyvalue/state.ts` `reload`, `scan.ts` progressive search and cancellation, `search.ts` match
  index against a page that changed mid-scan.
- `viewOp.ts` op status shared by 8 view stores: disconnected status (`view-op-disconnected-status`),
  error clearing, cancel of an op Go never saw.

### 5.7 Selection, keyboard, accessibility

- `selection.ts` round trip `SlickRange[]` to `Selection` (display positions vs page rows under a
  filter), `selectionEdges.ts` hashes at band edges, column/row multi-select with modifiers,
  select-all (`kira-select-all`).
- `onKeydown`: Delete, Enter, F2, Escape, copy/paste shortcuts while an editor or the insert-row
  `<input>` has focus; commands registered via `PW/shortcuts` gated to the active tab.
- `cellSelection` publish on every move (`publishSelectedCell`, 50 ms path) and clear on page swap.
- Accessibility: grid has no ARIA grid roles from SlickGrid core by default; check focusability of
  nav buttons (real `<button>`s with labels), native `<button>`s in `DateTimePicker.vue`,
  `SavedListMenu.vue`, `FilterHistoryMenu.vue`, `DocumentRow.vue`, `DocumentTree.vue`,
  `CellEditorView.vue:567,605` (focus ring, `type="button"`, label). Report a real regression, not
  a wishlist.

### 5.8 Cell editor

- `detectFormat`/`describeValue`/`validateFormat`/`beautifyFor` on NULL, `''`, truncated values,
  binary (`decodeToText`/`encodeFromText` round trip, invalid hex/base64), timestamps
  (`timestamp.ts`: two-digit years, epoch fractions, time zones, out-of-range dates, DST).
- Editable vs read-only: truncated cells never editable (P24 D27), console `readOnly`, masked
  preview, generated columns; Revert (`discardCellEdit`) vs pinned formats (`PINNED_FORMATS`).
- Blur auto-stage: switching cells or tabs with an unsaved buffer stages to the right row (the
  `SelectedCell.onEdit` closure captured for the old cell).

### 5.9 Sorting, filter, columns, FK/PK navigation, row coloring

- `sortTerms.ts`, `FilterToolbar.vue` (`filterCompletion.ts`, `FilterHistoryMenu`), filter SQL
  built from user text (trust boundary documented as the user's own WHERE clause; check identifier
  quoting of completions).
- `ColumnsMenu.vue` reorder via `useSortableReorder` (`vue-draggable-plus`): reorder during load,
  hidden PK columns, persisted order (`resolve-column-order`, `column-widths-cache`) for a table
  whose columns changed.
- FK/PK nav (`cellNavEntry`, `menu.ts` `navigateForeignKey`, `editReferencedRow`): composite FKs,
  NULL FK values, cross-schema targets, values needing quoting.
- Row coloring (`row-coloring` UI spec, `theme/cellClass`): staged/deleted/inserted rails vs
  selection and search layers precedence.

### 5.10 Document, key-value and request shared code

- `ejson.ts` (661): canonical/relaxed/shell round trips, `$numberLong` precision, `$date` out of
  range, `$binary` subtypes, deep nesting, malformed input. `rawTree.ts` and `rows.ts` expansion
  state reset on page change (`resetRows`).
- `KeyValuePane.vue` (1,155): `useVirtualizer` row measurement, Redis type variants, TTL display,
  large values, hash/list/set/zset edits.
- `AutocompleteField.vue:557` `v-html="overlayHtml"`: confirm `escapeHtml` runs on every
  user/server string before `mergeHighlightRanges` and variable decorations insert markup.
- `request/resolve.ts`, `useRequestChrome.ts`, `useRequestTabSave.ts`, `FieldRowsTable.vue`:
  Part 10 reviewed their callers; check the contract both sides now assume (Part 10 fixes:
  `9c4f0f9` and earlier).

### 5.11 Conventions (`CLAUDE.md`)

- All 23 own `.vue` files carry exactly one `<script setup lang="ts">` (two with `generic=`:
  `FieldRowsTable.vue`, `SearchToolbar.vue`). No `<style>` block in any own `.vue`. Styling outside
  Tailwind: `slickTheme.css` (732, SlickGrid DOM is imperative, utility classes cannot reach it)
  and `kiraSlickGrid.ts`'s appended sheet (P139). Check for new rules there that belong in Tailwind.
- **Stale comment, seen:** `slickTheme.css` P162 block above `.slick-grid-host .grid-canvas` still
  cites "the header strip's `will-change` layer", removed by `71d7c6a`. Low; confirm and report.
- Raw timers/listeners: 25 `setTimeout`/`setInterval`/`requestAnimationFrame`/`addEventListener`/
  `ResizeObserver` sites in own files. Judge each against VueUse (`useEventListener`,
  `useResizeObserver`, `useTimeoutFn`); SlickGrid-internal and render-path code may decline with a
  named reason (no Vue scope, synchronous render path).
- `navigator.clipboard.readText` in `onPaste` declines `useClipboard` with a named reason (P99 §9.3);
  do not re-report.
- Server state: `fkPreview.ts`, `keyvalue/state.ts`, `grid/state.ts` loads hand-roll sequence and
  error. Paged grid data in a frozen page store is a documented exception (Vue must not see the
  grid). Weigh small fetches (`fkPreview`) against TanStack Query; a migration too large for this
  fixer becomes its own `SPEC.md` phase.
- One store, one concern: `usePendingChangesStore`, `useGridViewStore`, `useKeyValueViewStore`,
  `useCellEditorFormatStore`, `useDocumentRowsStore`. Report a real second concern, not size.
  `SlickGridHost.vue` at 2,659 lines: report a concrete maintainability defect, not length alone.
- P105: disabled triggers inside `TooltipTrigger` wrap in `TooltipDisabledTrigger`.

### 5.12 Tests against the `CLAUDE.md` bar

- Most own unit specs guard boundary arithmetic, guards and races: they qualify. Check each still
  drives current code and is not a restated body (candidates to judge: `grid-sql-literal-escaping`
  28 lines, `view-op-disconnected-status` 45, `fake-data-temporal-format` 47).
- Gaps worth a guard only where a finding's fix needs one: double commit (§5.1), paste stale
  target (§5.2), `growStart`/`growEnd` budget.
- UI specs: `mutations` against §5.1; `slick-grid` against §5.3/§5.7; `scroll-trace` and
  `ST/perf/grid-scroll` measure the current path (P162 changed CSS only). Prune duplicate coverage
  across `slick-grid`/`data-view`/`cell-editor` only when truly duplicate.

## 6. What earlier reviews and P143-P167 changed (do not re-report)

- **P141/P142** (base `771512bc`, not in this shallow clone): SPEC "P141 result" says Studio grid
  code untouched; P142 touched no Part 11 file.
- **P166/P167** (base `743af03`): fixed no Part 11 file. P166's coverage list names the "grid layer
  fix" and "Studio documents scroll" as **not reached**; P167 fixed ADE and git only. So P162's
  CSS is unreviewed: review it. `docs/v2.0/plans/P16{6,7}-code-review.md` are gone.
- **`git diff 743af03 HEAD` on own paths: 266 lines, 3 files.**
  - `slickTheme.css` (+8/-32): `00570dd` adds `.slick-grid-host .grid-canvas { contain: layout
    paint; }` (P162 D1); `71d7c6a` drops header `will-change: transform` and per-cell
    `border-right`/`border-bottom` (user decision, `data-view` baseline regenerated in `60ed063`).
  - `ST/perf/grid-scroll.spec.ts` (98) and `support/wideTable.ts` (136) new (P161/P162 probe).
- **Decided trade-offs:** SlickGrid stays (P165 NO-GO, user Mac run). No overscan/runway or JS
  change in `onGridRendered`/`placeNavButtonsForRenderedCells`/`setCellCssStyles` (P162 D5, user).
  Header `will-change` and cell borders removed (user). `contain: paint` clips the range
  decorator's 1 px right edge in one geometry (P162 D1, accepted). Cell editor detect/validate/
  beautify stay inline, not on the parse worker (P163 inventory row 7: 64 KiB cap, ~8 ms).
- **P108 Part 10/11 and P21-P43** fixes are in code (comments cite F-numbers: generated-column
  paste skip, PK-hidden guard, idempotent delete, pending cleared only on page landing, single-cell
  copy quoting, duplicate column names in copy, `editorCtx` reset). Verify they hold; do not
  re-report them as new.

## 7. Watch items

- Pre-plan §5.10: P162 layer fix (§6), page store cursor and boundary arithmetic (§5.4, §5.5,
  §5.6), selection model edges (§5.7), clipboard format safety (§5.3), SQL literal escaping (§5.1),
  staged edits on composite/PK-less tables (§5.1).
- Task list: lifecycle and cleanup (§5.4), virtualization arithmetic (§5.4), cell editor (§5.8),
  page wire decode (§5.5), selection/keyboard/clipboard (§5.3, §5.7), mutations (§5.1), sort/filter
  (§5.9), FK/PK nav (§5.9), column resize/reorder (§5.9), row coloring (§5.9), large values and
  truncation (§5.3, §5.8), memory (§5.5), stale responses (§5.6), accessibility (§5.7), tests
  (§5.12), conventions (§5.11).

## 8. Rubric, order and outputs

- **One Opus reviewer**, freeform "any kind of issue or bug", edge cases weighted. Not three
  dimension reviewers (user deviation from `CLAUDE.md`'s recipe, P168 only).
- Reports only. Fixes nothing, edits no code.
- **Whole chunk, in this block order** (shared engine first, so hosts read against known layers):
  1. Shared grid engine and page machinery: `shared/slick/*` (incl. `slickTheme.css`),
     `shared/page/*`, `gridHostShared.ts`. Contract read: `SP/page.ts`, `SP/frame.ts`
     `decodeFrame`/`decodePayload`.
  2. Data grid core: `grid/{state,page,search,sortTerms,pendingChanges,paste,menu}.ts`,
     `grid/slick/*`, then `SlickGridHost.vue`.
  3. Grid chrome: `DataView`, `DataToolbar`, `FilterToolbar`, `ColumnsMenu`, `FkPreviewPopover`,
     `PreviewCommandPanel`, `fkPreview.ts`, `focusRequest.ts`, `maskPreview.ts`,
     `filterCompletion.ts`, `fakeData/*`.
  4. Cell editor, clipboard and shared utilities: `celleditor/*`, `clipboardFormats.ts`,
     `sqlIdent.ts`, `typeGlossary.ts`, `viewOp.ts`, `immediateMutation.ts`, `useConnectionGate.ts`,
     `useEditBuffer.ts`, `EditBufferActions`, `AutocompleteField`, `DateTimePicker`,
     `FilterHistoryMenu`, `SavedListMenu`, `ResponseFindBar`, `eventCoords.ts`, `targetPath.ts`,
     `mongoFieldSample.ts`, `mongoVocabulary.ts`.
  5. Document and key-value: `shared/document/*`, `shared/keyvalue/*`.
  6. Request and fields: `shared/request/*`, `shared/fields/FieldRowsTable.vue`.
  7. Tests: 31 unit, 7 UI, 2 perf, 1 visual specs (coverage claims, test bar).
- **Resumable:** write `docs/v2.0/plans/P168-part11-findings.md` as blocks finish and commit it
  after **each** block (`docs(v2.0): P168 Part 11 findings, block <n>`), normal commit, explicit
  `git add <path>`, hooks green. An interrupted run resumes from the last committed block, never
  re-derives one.
- Each finding: id (`F<n>`), severity (high/medium/low), `file:line` on the current tree, a concrete
  failure scenario, a proposed fix, "verified" or "code-read". Mark one that needs a real design
  decision; the fixer turns it into its own `SPEC.md` phase.
- **Routing tag (G1/G2 waived).** A finding whose fix must edit a file owned by another Part
  carries `needs-other-part-file: <path> (Part N)`. Owners: Stream A Parts 2-9 (here mostly Part 5
  `SP/{page,frame,data-ops}.ts`, `SF/bridge/**`, `SI/page`; Part 6 `SD/mask`; Part 7 `api-core`;
  Part 9 `PW`/`PT`); Stream B Parts 14-23; Stream C Parts 10 (`api`, `httprequest`,
  `grpcrequest`), 12 (`console`, `documents`, `stream`, `keyvalue`, `browse`, `definition`,
  `editor`, `workers`, `beautify.ts`), 13 (`state`, `workbench`, `theme`, `main.ts`, `App.vue`).
  The fixer does not make those edits; it appends each to
  `docs/v2.0/plans/P168-routed-from-streamC.md` (exists; one `## From Part 11 F<n>` section per
  finding: id, file, issue, fix). A finding fixable in own files with only a read of another Part's
  contract carries no tag.
- The findings file states base commit (`9c4f0f9`), HEAD reviewed, checks run and results,
  findings, then coverage per block: reviewed, skimmed (with reason), not reached. No unexplained
  gap. A chunk with nothing real says so; never manufacture a finding.
- Final commit `docs(v2.0): P168 Part 11 findings` before any fixer starts.
- Then one Sonnet fixer: one commit per group of related findings, naming `P168 Part 11`, only in
  own files; tagged findings routed as above. Re-runs the own unit specs, `typecheck:web:studio`,
  lint, and the own UI specs touched. Deletes the findings file when done. Chunk lands per pre-plan
  §3.4 before Part 12's plan starts.

## 9. Out of scope

- Part 5/6/7/9 internals beyond the contract this chunk uses (report a defect there with the
  routing tag).
- Part 12 views (`console`, `documents`, `stream`, `keyvalue`, `browse`, `definition`), `editor/**`,
  `workers/**`, `beautify.ts`; Part 13 `state/**`, `workbench/**`, `theme/**`, `main.ts`: contract
  only.
- P165 prototype (`apps/kira-studio/frontend/proto/**`, `tests/proto/**`): excluded.
- Decided trade-offs and known open items (§0, §6).
- Generated bindings and wire code, docs, excluded files (pre-plan §6).
