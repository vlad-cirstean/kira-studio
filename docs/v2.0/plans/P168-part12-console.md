# P168 Part 12: review plan, Studio console, editor, parse worker and per-kind data views

Chunk C3, Stream C position 3 of 4 (pre-plan `P168-prep-plan.md` §5.11; moved from Stream A by user
instruction, SPEC row). One Opus reviewer runs this plan and reports findings. It fixes nothing. One
Sonnet fixer follows (§8). Tree surveyed: `8b20119` (`p168-stream-c`, on `v2.0` with Part 11's fixes
and the drop of its findings file).

Paths repo-relative. `SF` = `apps/kira-studio/frontend/src`, `ST` = `apps/kira-studio/tests`,
`SD` = `packages/shared/domain`, `SP` = `packages/shared/protocol`, `SI` = `apps/kira-studio/internal`,
`PW` = `packages/workbench/src` (`@workbench`), `PT` = `packages/theme/src` (`@theme`). Line numbers
are as of `8b20119`; re-read before citing.

SPEC row names this file `plans/P168-part12-console.md`; the orchestrator gave the same name.

## 0. Method for the reviewer

- **`codegraph_explore` first, mandatory.** Load it with `ToolSearch "codegraph"` if it is not
  listed, then call it with `projectPath=/home/user/kira-studio-streamC` before any Read/Grep on a
  symbol, call-path or blast-radius question. The orchestrator greps the run's tool log for real
  calls. Index present at planning (`.codegraph/codegraph.db`); if missing, run
  `sh scripts/codegraph-setup.sh` in the worktree, never fall back silently. Seeds:
  - parse worker: `createParseClient` (`settle`, `runInline`, `onWorkerFailure`, `spawn`, `pump`,
    `abort`, `run`), `parseInline`, `INLINE_CHARS`, `handlers`, `useParseWorker` (`run`,
    `runLatest`), `parse.worker.ts`, `protocol.ts` (`ParseJobs`), `instance.ts`;
    `chunkedText.ts` (`textChunks`, `pumpChunks`).
  - console run/stop: `useConsoleViewStore` (`run`, `stop`, `explain`, `pushPlanResult`,
    `showAutoExplainPlan`, `clearAutoExplain`, `dropResults`, `closeResult`,
    `closeOtherResults`, `closeResultsToTheRight`, `setActiveResult`, `activePage`,
    `registerTabRuntimeCleanup` closure), `runAutoExplainGate`, `autoExplainCheck`,
    `evictOldestResults`, `releaseResult`, `applyLoadFailure`; `ConsoleView` (`runStatement`,
    `runAll`, `onStop`, `onFormat`, `onExplain`, `ensureConnectedForRun`, `starting`,
    `resetStalePreviewState`, `onDocChange`); `resultPages.ts` (`cell`, `documentRow`,
    `keyValueRow`, `dropForTab`).
  - console results: `ConsoleResultGrid` (`onDocumentRowContextMenu`, `allText`),
    `ConsoleSlickGrid` (mount/unmount, `onViewportScroll`, `resizeObserver`), `resultMenu.ts`
    (`mongoDocumentRowMenu`, cell/row/column copy items), `copyAll.ts` (`copyAllDocuments`),
    `ExplainResultView`, `explain.ts`, `explainResults.ts`, `plan.ts`, `planIssues.ts`,
    `planModel.ts`, `planParsers/*`, `console/search.ts`.
  - SQL language: `splitSqlStatements`, `statementAtOffset`, `statementAtCursor`,
    `trimmedStatementStart` (`SD/sql-split.ts`), `scanSqlSpan`/`resolveLexOptions`
    (`SD/sql-lex.ts`), `lintSql`, `tokenizeSql` (`SD/sql-tokens.ts`), `SD/sql-keywords.ts`,
    `consoleLintSource`, `lintMongoConsole`, `lintRedisConsole`, `ddlDiagnostics`, `parseDdl`,
    `toSqlNamespace`, `namespaceFromCached`, `sqlCompletionSources`, `relationCompletionSource`,
    `sqlSchemaCompletionSource`, `sqlKeywordCompletionSource`, `consoleCompletionSources`,
    `mongoCompletionSource`, `redisCompletionSource`, `statementsWithRefs`, `sqlHoverSource`,
    `sqlNodes.ts`; `formatConsoleText`, `loadSqlFormatter`, `formatMongoStatement`,
    `joinFormattedStatements`, `canFormatConsole`.
  - editor: `MonacoHost` (`onMounted`, `onUnmounted`, `fillModel`, `finishFill`,
    `applyExternalDoc`, `registerProviders`, `buildCompletionProvider`, `buildHoverProvider`,
    `scheduleLint`, `repaintRanges`, `attachWrapOnType`, `defineExpose`), `paintSpans.ts`
    (`paintOverlayHtml`), `findRanges.ts`, `hoverInfo.ts` (`fenceMarkdownValue`,
    `escapeMarkdownSyntaxTokens`), `searchPattern.ts`, `monacoLanguages.ts`; `beautify.ts`
    (`beautifyJson`, `beautifyXml`, `scanJson`, `scanXml`, `tryParseJson`).
  - per-kind views: `useDocumentViewStore`, `DocumentView` (`editGate`, `editBuffer`, `rows`,
    `rowAt`, `startEdit`, `commitEdit`, `onDeleteRow`), `documents/{page,search,menu,mutations,
    projection,sortDocument}.ts`, `ProjectionMenu`; `useStreamViewStore` (`load`, `poll`,
    `setPageSize`, `runCount`, `currentStreamFilter`), `StreamView` (`rowAt`, `onCellClick`,
    row context menu), `streamRow`, `useStreamSearchStore`, `StreamSearchToolbar`,
    `StreamComposeMessage`, `streamFilterHistory.ts`, `stream/mutations.ts`; `useBrowseViewStore`
    (`load`, `ensureKeyTypes`, `goToLevel`, `ascend`, `selectRow`), `BrowseView`, `browse/menu.ts`;
    `useDefinitionViewStore` (`load`), `DefinitionView` (`onCopy`, find bar), `structure.ts`,
    `columnsMenu.ts`; `KeyValueView`.
- **CodeGraph over-links TS names.** `run`, `load`, `stop`, `cancel`, `format`, `state`, `page`,
  `runLatest` collide across Studio, Space, `git-ui` (`latestRequest.ts` has its own `runLatest`),
  the P165 prototype and Go adapters (`runStatement` exists in `mongo/console.go`). Confirm every
  cross-package claim with `git grep` of real `import` lines; §3 and §4 were verified that way.
  Ignore `apps/kira-studio/frontend/proto/**` hits (pre-plan §6).
- **Unreviewed callees.** Part 7 (`packages/api-core`, `SD/{http,grpc,…}`) and Part 9 (`PW`, `PT`,
  `packages/kira-ui`, `SD/tabs`) are **not reviewed yet**; Part 6 (`SI/queryplan`, `SI/mask`) is
  read as a contract only. Verify the contract this chunk relies on, do not assume it holds. A fix
  that needs a Stream A-owned file is routed (§8), never made.
- **Scratch probes** in the session scratchpad, never in the tree, where a claim turns on runtime
  behavior: a `bun test` harness over `createParseClient` with a fake worker (abort while running,
  worker error mid-queue, stale reply id), over `useConsoleViewStore` with a fake `data`/`control`
  bridge (`ST/unit/support/consoleHarness.ts` is the existing seam: run/stop/explain/close
  ordering), or a Playwright run against `ST/ui`'s static server and mock runtime. Mark each claim
  "verified" or "code-read".
- **Checks.** Taken at planning (`8b20119`):
  - `bun test` over the 40 own unit specs together: **310 pass, 0 fail.**
  - Each spec alone: **39 green, 1 red.** `document-console-row-menu-lazy-snapshot.spec.ts` alone
    fails 3 tests: `getActivePinia()` with no active Pinia, reached from `copyOrReportError`
    (`PW/util/clipboard.ts:32`). Same shape as Part 11 F2 (order luck hides it in the subset).
    Reviewer confirms and reports it as a finding.
  - Reviewer records its own baseline first: the above, `bun run typecheck:web:studio`,
    `bun run typecheck:unit:studio`, `bunx biome check` over the own paths. Optional, when a claim
    needs it: `bun run build:test:studio`, then `node_modules/.bin/playwright test
    --config=apps/kira-studio/playwright.config.ts --project=ui <spec>` for the 7 own UI specs
    (bare `playwright` hits a global binary). Perf specs (`ST/perf/*`) only where a claim needs a
    number (`playwright.perf.config.ts`). If deps or bindings are missing:
    `bun install --frozen-lockfile` and `bun run setup`. Never run `test:visual:update:*` here
    (sandbox font drift, `docs/DEV_ENVIRONMENT.md`). **Do not run the full UI suite.** A red check
    is a finding.
- **Known open items read first** (`docs/ARCHITECTURE.md`): documents fastest-flick frames (P161,
  a user call on lighter rows), tab-switch remount budget (P139 Part 2). Do not re-report.

## 1. Ownership re-run (pre-plan §8) and drift

Re-ran the §8 script verbatim at `8b20119`. **Part 12: 314 files (unchanged), 27,172 to 27,187 code
lines, tests 10,375 to 10,389.** Owned files touched since `f40cd35`: 3, all from Part 11's fix pass.

- `c7b13a9` (Part 11 F4) added `pageOf: getPage` to `SF/views/documents/search.ts:71` (+1). A Part 12
  file, edited by Part 11 as its finding allowed (`needs-other-part-file … (Part 12)`).
- `568bbd4` `ST/ui/console-format.spec.ts` (+3): poll for the off-thread first Format before the
  second press.
- `c2df5e9` `ST/ui/console.spec.ts` (+14/-3): poll for the async worker Copy-all clipboard write.

**Double check for the reviewer (F4 spill):**
- `documents/search.ts` `pageOf: getPage` works only because `createPageStore.setPage` freezes and
  replaces the page object on every load (`SF/views/shared/page/store.ts:95-108`), and
  `SearchToolbar.vue:184-194` reads `pageVersion.n` before `pageOf` (the store Map is not reactive).
  Confirm no documents path changes the rows on screen without a new page object (`drop` then
  re-set, projection, `onSet` row reset, mutation reload, filter toggle), and that a `drop`
  (tab close, `null`) does not restart a scan on a tab being torn down.
- Same F4 defect, not wired: `stream/StreamSearchToolbar.vue:53-58` still watches the shared
  `pageVersion.n`, and `console/search.ts:114` keeps the counter fallback (console's active page is
  `activePage(tabId)`, `console/state.ts:431`). Another stream or console tab's load or close
  restarts this tab's scan. Confirm or drop; fix is own-file (`pageOf`).

Drift elsewhere since `f40cd35` (Part 2-5, 10, 11 fixes, P166/P167, user commits); no Part 12 file
beyond the three above:
- Part 2: 145 to 148 files, 19,684 to 20,159. Part 3: 138 to 143, 26,401 to 27,825. Part 4: 72 to
  76, 15,798 to 16,751. Part 5: 110 to 119, 21,623 to 21,695. Part 6: 14,755 to 14,757. Part 8:
  16,274 to 16,328.
- Part 10: 91 to 92 files, 23,319 to 23,917 (tests 10,157 to 10,431). Part 11: 133 to 135, 30,574 to
  30,837 (tests 10,074 to 10,211; Part 11 fixes plus two new specs). Part 13: 151 to 154, 26,687 to
  26,924.
- Stream B: Part 14 134 to 135; Part 15 98 to 100, 15,176 to 15,641; Part 16 51 to 53, 18,789 to
  19,279; Part 17 23,577 to 23,594; Part 20 20,312; Part 21 17,327.
- Totals: A+C 258,177, B 183,492; 2,900 owned, 0 orphans, 3,538 tracked (docs 485).
- **Script label drift** (carried from Parts 10-11): the script prints `[A]` for every Part `<= 13`.
  Parts 10-13 are Stream C. Label only; not a finding.

**Part 11 fixes changed shared code Part 12 consumes** (read them as the current contract):
`600e87f` (`shared/page/{scan,search,searchFilter}.ts`, `SearchToolbar.vue`: filter keeps rows past
the 50 000-match cap), `c7b13a9` (`PageSearchApi.pageOf`), `4fe61d0` (`PagerControls.vue` integer
page), `8a5cb1c` (`shared/document/ejson.ts` out-of-range `$date` returns raw; `clipboardFormats.ts`
paste parser), `c68b1b0` (cell editor dock stale-page guard; `CellEditorDock` is mounted by console
and stream). Check console, documents and stream still behave against them (e.g. `DocumentView` Edit
seeds from `toShellText` on an out-of-range date; console Mongo copy-all on the same document).

Before landing, re-check `git diff --name-only 8b20119 v2.0 -- apps/kira-studio/frontend/src/{views,editor,workers} packages/shared/domain`.

## 2. Own file set (314 files)

16,798 production lines (95 files), 10,389 test lines (57 TS files), plus 162 JSON fixtures
(1,688 lines, not code-counted by the script).

- **`SF/views/console` (33, 7,045).** `ConsoleView.vue` (984), `ConsoleSlickGrid.vue` (862),
  `state.ts` (638), `ddl.ts` (492), `ConsoleResultGrid.vue` (465), `resultMenu.ts` (304),
  `completion.ts` (263), `format.ts` (240), `lint.ts` (229), `sqlRefs.ts` (210),
  `ExplainResultView.vue` (180), `planParsers/{mysql (180), mariadb (137), postgres (134),
  clickhouse (127), sqlite (66)}.ts`, `sqlHover.ts` (150), `sqlNodes.ts` (141),
  `sqlSchemaCompletion.ts` (135), `ConsoleSavedMenu.vue` (131), `sqlDiagnostics.ts` (120),
  `search.ts` (118), `plan.ts` (105), `planIssues.ts` (105), `sqlLanguageService.ts` (101),
  `resultPages.ts` (83), `mongoStatement.ts` (66), `explain.ts` (65), `planModel.ts` (63),
  `copyAll.ts` (57), `sqlKeywordCompletion.ts` (53), `explainResults.ts` (34),
  `sqlFormatterEntry.ts` (7).
- **`SF/views/documents` (10, 2,013).** `DocumentView.vue` (1,167), `state.ts` (266), `menu.ts`
  (163), `ProjectionMenu.vue` (110), `page.ts` (88), `search.ts` (75), `sortDocument.ts` (49),
  `projection.ts` (38), `mutations.ts` (35), `RowActionButton.vue` (22).
- **`SF/views/stream` (10, 2,235).** `StreamView.vue` (1,224), `state.ts` (291),
  `StreamSearchToolbar.vue` (166), `StreamComposeMessage.vue` (127), `search.ts` (116),
  `streamFilterHistory.ts` (107), `StreamFilterHistoryMenu.vue` (95), `page.ts` (44),
  `mutations.ts` (39), `menu.ts` (26).
- **`SF/views/browse` (3, 938).** `BrowseView.vue` (520), `state.ts` (292), `menu.ts` (126).
- **`SF/views/definition` (9, 1,016).** `DefinitionView.vue` (385), `structure.ts` (111),
  `ColumnsSection.vue` (107), `ConstraintsSection.vue` (105), `columnsMenu.ts` (82), `state.ts`
  (82), `ValidationSection.vue` (58), `IndexesSection.vue` (48), `PropertiesSection.vue` (38).
- **`SF/views/keyvalue` (1, 20).** `KeyValueView.vue` (thin shell over Part 11's `KeyValuePane`).
- **`SF/editor` (11, 1,383).** `MonacoHost.vue` (777), `paintSpans.ts` (214), `findRanges.ts`
  (118), `hoverInfo.ts` (66), `chunkedText.ts` (60), `completion.ts` (48), `edDecorations.css`
  (29), `searchPattern.ts` (28), `monacoLanguages.ts` (23), `ranges.ts` (11), `diagnostics.ts` (9).
- **`SF/workers/parse` (6, 288).** `client.ts` (161), `useParseWorker.ts` (38), `handlers.ts` (33),
  `protocol.ts` (33), `parse.worker.ts` (18), `instance.ts` (5). **`SF/beautify.ts` (441).**
- **`SD` (11, 1,419).** `sql-tokens.ts` (411), `sql-keywords.ts` (360), `sql-lex.ts` (228),
  `sql-split.ts` (99), `sql-lint.ts` (92), `definition.ts` (83), `queries.ts` (68),
  `streamFilter.ts` (30), `console.ts` (27), `schema.ts` (14), `editor.ts` (7).
- **`ST/unit` (41, 4,592):** 40 specs plus `support/consoleHarness.ts` (49):
  `autocomplete-tokenizers`, `browse-key-types`, `chunked-text`, `console-{auto-explain-race,
  auto-explain-worst, column-widths-session, explain-embedded-semicolon, format, mongo-brackets,
  overlapping-explain-clobber, result-cap, root-completion, run-after-tab-close,
  stop-auto-explain, stop-explain-resolves-anyway}`, `ddl-schema`, `document-{byte-label,
  collapse-all-preserves-other-pages, console-row-menu-lazy-snapshot, projection-menu-close}`,
  `explain-{plan,truncated}`, `find-ranges-memo`, `hover-{markdown-escape,value-caption}`,
  `mongo-sort-document-roundtrip`, `paint-spans-merge`, `parse-worker-client`,
  `schema-{columns-effective,ddl-cache}`, `sigma-count-refresh`, `sql-{cte-shadow,
  hover-no-reparse,keywords,lint,split,tokens}`, `sqs-mutation-never-polls`,
  `stream-{count-honors-filter,search-no-permanent-cache}`.
- **`ST/ui` (7, 4,383):** `console` (1,151), `autocomplete` (1,015), `sql-schema` (689),
  `console-format` (533), `console-explain` (500), `definition` (364),
  `document-view-readonly` (131).
- **`ST/perf` (6, 1,127):** `parse-callers.spec.ts` (483), `documents-scroll.spec.ts` (149),
  `pureFns.entry.ts` (143), `documentsFixture.ts` (129), `documents-flick.spec.ts` (115),
  `console-grid-scroll.spec.ts` (108). **`ST/visual` (2, 176):** `console`, `schema-dialog`.
- **`ST/fixtures` (163):** `explain-plans/loader.ts` (111) plus 30 JSON (`<engine>-<case>.{input,
  expected}.json`); `mask/*.{input,expected}.json` (132). Both sets are **cross-language
  contracts**: `explain-plans` is read by `SI/queryplan/{plan.go,parse_test.go}` (Part 6) and
  `ST/unit/explain-plan.spec.ts`; `mask` by `SI/mask/parity_test.go` and
  `ST/unit/mask-parity.spec.ts` (Part 6). A fixture change needs both sides: route, do not edit.

## 3. One hop: callers (git grep of import lines, production files)

Importers outside the chunk, by owner. Every one verified on a real `import` line.

- **Part 10 (Stream C, closed):** `httprequest/{RawExchangePane,RequestBodyPane,ResponsePane}.vue`,
  `grpcrequest/{GrpcRequestView,ResponsePane}.vue`, `api/{BulkVariablesEditor,
  EditRawRequestDialog}.vue` (`MonacoHost.vue`); `HttpRequestView.vue`, both `ResponsePane.vue`s
  (`editor/{findRanges,ranges}`); `ResponseDiffDialog.vue` (`editor/monacoLanguages`,
  `beautify`); `RequestBodyPane.vue`, `GrpcRequestView.vue`, `useResponseBody.ts`
  (`workers/parse/{client (INLINE_CHARS, parseInline), useParseWorker, protocol}`),
  `GrpcRequestView.vue` (`beautify`); `api/state/variableCompletion.ts`
  (`editor/{completion,ranges,hoverInfo}` types and `formatHoverValue`).
- **Part 11 (Stream C, closed):** `views/shared/celleditor/{detect,validate,formats}.ts`
  (`beautify` `scanJson`/`scanXml`, modes), `CellEditorView.vue` (`MonacoHost`,
  `editor/{diagnostics,findRanges}`, `SD/editor`), `useEditBuffer.ts` (`beautify` types),
  `AutocompleteField.vue` (`editor/{ranges,monacoLanguages,paintSpans}`, `SD/editor`),
  `ResponseFindBar.vue` (`editor/findRanges`), `page/scan.ts` (`editor/searchPattern`),
  `grid/PreviewCommandPanel.vue` (`MonacoHost`), `sqlIdent.ts` (`SD/sql-lex` type),
  `celleditor/validate.ts` (`SD/sql-lint`), `grid/{state,FilterToolbar}.ts`,
  `FilterHistoryMenu.vue` (`SD/queries`).
- **Part 13 (Stream C, later):** `workbench/tabViews.ts` (all six view components); `main.ts`
  (`console/{explainResults,search,resultPages}`, `documents/{search,page}`, `stream/{search,page}`
  test hooks); `state/tabKinds.ts` (`documents/page.drop`, `stream/page.drop`,
  `console/resultPages.dropForTab` on tab close); `state/schemas.ts` (`console/{ddl,
  sqlKeywordCompletion}`, `editor/completion`, `SD/schema`); `state/schemaColumns.ts`
  (`console/ddl`); `state/viewCommands.ts` (`SD/queries`); `workbench/panels/OperationsPanel.vue`
  (`console/state` `useConsoleViewStore`, `MonacoHost`, `SD/sql-split`);
  `workbench/GenerateDataDialog.vue`, `project/SchemaDialog.vue` (`MonacoHost`);
  `project/state/tree.ts` (`SD/queries`).
- **Part 5 (Stream A, closed):** `SF/bridge/index.ts` (`SD/{schema,definition,queries}` types);
  `SP/data-ops.ts` (`SD/queries` `sortSpecSchema`).
- **Part 7 (Stream A, unreviewed):** `packages/api-core/src/http/body.ts` (`SD/editor`
  `EditorLanguageId`, type only).
- **Test callers in other Parts:** `ST/unit/view-state.spec.ts` (`browse/state`),
  `grid-menu-projection-empty-guard.spec.ts` (`definition/columnsMenu`) (Part 11). Stream, Redis
  and SQS view UI coverage lives in Part 5's `ST/ipc/{kafka,redis,sqs}/*.frontend.spec.ts`, not
  in any own spec (no `ST/ui` spec targets `stream-view`, `browse` or `keyvalue`). A changed
  testid or export breaks those.
- No dynamic `import()` of own files except `console/sqlFormatterEntry.ts` (lazy sql-formatter
  chunk, `format.ts:20`) and the worker entry (`instance.ts`).

## 4. One hop: callees

Grouped by owner, with the routing that applies to a fix there (§8).

- **Part 11, Stream C, closed:** `views/shared/{sqlIdent (13 imports), viewOp (5),
  useConnectionGate (5), clipboardFormats, immediateMutation, eventCoords, mongoFieldSample,
  useEditBuffer, SavedListMenu, AutocompleteField, FilterHistoryMenu, EditBufferActions,
  targetPath, DateTimePicker}`, `shared/page/{store, search, searchFilter, visibleRows (5), scan,
  load, sizes, SearchToolbar, PagerControls}`, `shared/document/{ejson (6), rows, rawTree,
  DocumentTree, DocumentRow}`, `shared/keyvalue/KeyValuePane.vue`, `shared/celleditor/
  CellEditorDock.vue`, `shared/slick/*` (from `ConsoleSlickGrid.vue`). Own edits here allowed
  inside Stream C only if a Part 12 finding needs it (state why in the commit).
- **Part 13, Stream C, later:** `SF/state/{tabs (16), tabDomain (9), connections (9), settings,
  runState, pinia, viewCommands, cellSelection, objectStore, schemas, schemaColumns, mode}`,
  `SF/theme/{EngineIcon.vue, icons, cellClass, completion}`. Tag `needs-other-part-file … (Part 13)`;
  Part 13 picks it up, nothing routed to Stream A.
- **Part 5, Stream A, closed:** `SF/bridge/{data, control}` (`execute`, `read`, `mutate`,
  `opsCancel`, `treeChildren`, `treeDefinition`, `treeDescribe`), `SP/page` (`cellText`, `isNull`,
  `isTruncated`, `cellByteLength`, `StreamPage`, `DocumentPage`), `SP/data-ops`
  (`PageCursor`), `SD/{tree (15), connection (9)}`. Part 5 F4 changed `StreamRow.Body` to a nullable
  cell (§5.6).
- **Part 6, Stream A:** `SI/queryplan` Go parser mirrors `console/planParsers/*` over shared
  fixtures; `SI/mask` over `ST/fixtures/mask`.
- **Part 9, Stream A, unreviewed:** `PT/components/ui/*` (tooltip 10, badge 9, button 8, alert 6,
  empty, toggle-group, resizable, popover, label, input-group, separator, input, checkbox),
  `PT/{CodiconIcon (12), RunState, connColor}`, `PT/components/TooltipIconButton.vue` (9);
  `PW/state/{contextMenu (12), tabRuntime (6), confirmDialog}`, `PW/util/{clipboard (7),
  virtualRows, wheelScroll}`, `PW/components/ViewToolbar.vue`, `PW/shortcuts/commands`,
  `PW/editor/monaco` (`loadMonaco`, `KIRA_EDITOR_THEME`, `MonacoModule`); `@kira/kira-ui`
  (`KuiColumnResizeHandle`); `SD/tabs`.
- Third-party: `monaco-editor` (13 type/value references, loaded via `PW/editor/monaco`),
  `sql-formatter` (3, lazy), `slickgrid` (2, `ConsoleSlickGrid`), Vue, Pinia (7), VueUse (4),
  TanStack Query (1: `ConsoleView` `ddlQuery`).

## 5. Edge cases and failure modes to weight

Freeform: any kind of issue or bug counts. Weight edge cases. Items marked "suspect" were seen during
planning but not verified; confirm or drop each, never report unverified.

### 5.1 Parse worker (P163, unreviewed by P166/P167)

- `client.ts` one-in-flight FIFO: `abort` of the running job leaves `running` set until the worker
  replies unless a queued job forces `killWorker` (`:99-104`); a long sync parse then blocks every
  later job. Check the queue-empty path, then a new job arriving while an aborted job still runs.
- **Suspect:** `onWorkerFailure` (`:71-77`) re-runs the in-flight job inline even when it is already
  aborted: a multi-MB aborted parse runs on the main thread for nothing.
- Stale reply: `spawn` listener drops a reply whose id is not `running.id` but does not `pump`
  (`:84`). Can that strand the queue (reply for a job killed and replaced)?
- `settle` and the signal wrapper: abort listener removed on resolve/reject; a job aborted after
  its inline `settle` started still runs to completion.
- `useParseWorker` (`:10-38`): scope abort on dispose; `runLatest` key reuse; callers must treat
  `AbortError` as silent. **Suspect:** `ConsoleView.onFormat` worker path `.catch(() => null)`
  (`ConsoleView.vue:438`) maps every worker failure, not only unmount, to a silent no-op.
- Inline vs worker parity: `INLINE_CHARS` (65,536 chars) gate is applied by each caller
  (`ConsoleView.vue:436`, `ConsoleResultGrid.vue:312`, Part 10 callers). Same handler both sides
  (`handlers.ts`); check outputs that cross `postMessage` (structured clone of `FormatResult`,
  `BeautifyResult`) and the `SyncKind` typing for `console.format` (async handler).
- Worker in the built app: `instance.ts` worker URL under Wails `wails://` origin and the
  `build:test:studio` static server; failure falls back inline (P163 design).

### 5.2 Console run, Stop, Explain, auto-explain

- `run` (`state.ts:456-528`): opId supersession, detached runtime after tab close
  (`registerTabRuntimeCleanup` `:301-324` cancels both op ids), auto-explain gate
  (`runAutoExplainGate` `:243-287`) before the real statement, `applyLoadFailure` on
  disconnect. Existing guards: `console-{auto-explain-race, overlapping-explain-clobber,
  run-after-tab-close, stop-auto-explain, stop-explain-resolves-anyway}`; verify they still drive
  current code.
- `stop` (`:530-543`) sets `cancelled` synchronously then cancels `explainOpId` and `opId`. Check a
  Stop between the auto-explain batch and the real `execute` (gate returns `stop`), and a Stop after
  `execute` was sent but before Go registered the op.
- `explain` (`:570-616`): no `runtime[tabId]` presence check after the await (relies on
  `pushPlanResult`'s `findConsoleTab`); a Stop that loses the race still pushes a plan
  (`stop-explain-resolves-anyway` intent: confirm it is a decision). Explain button gates on
  `!canExplain || starting`; `canExplain` includes `!running` (`ConsoleView.vue:264-269`).
- `ConsoleView` `starting` window (`:81`, `runStatement` `:375-395`, `runAll`, `onExplain`): the
  statement is captured before the reconnect await; `ensureConnectedForRun` (`:371-373`) drops
  `onReconnectAndLoad`'s `Promise<boolean>` (`shared/useConnectionGate.ts:19`), so a failed
  reconnect still calls `run`/`explain`. Check what the user then sees, and any throw left
  unhandled in the `void (async…)` IIFE.
- Result cap: `MAX_RESULTS_PER_TAB = 50` and `evictOldestResults` (`:134-…`) with
  `protectedCount`; `releaseResult` drops page, plan and document-row caches on every removal path.
  Part 4 F8 (Go materialises whole console results) is parked: do not re-report the Go side.
- Run all on a script whose statements depend on each other: one `execute` per batch, adapter
  all-or-nothing (P5.5). Splitter correctness is the risk (§5.4).

### 5.3 Console results grid, copy, search

- `ConsoleSlickGrid.vue` lifecycle (`:765-800`): hand-ordered teardown (scroll listener,
  `ResizeObserver`, `selectionModel.destroy`, `grid.destroy(true)`); P99 §9.3 declines VueUse with
  a named reason (do not re-report the decline). Check active-result switch remount, result close
  while selected cell published to `cellSelection`, column widths per result
  (`console-column-widths-session`).
- `resultPages.ts`: keys `resultPageKey(tabId, seq)`, `dropForTab` prefix match (`tabId` that is a
  prefix of another tab id plus `:`?), `documentRow` truncation flag.
- **Suspect:** `resultMenu.ts:37,44,51,86` call `copyText(...)` bare: a clipboard rejection is an
  unhandled promise, not reported; the Mongo copy-all items use `copyOrReportErrorLazy`. Part 10
  fixed the same class in its views (`510214f`).
- Copy all (`ConsoleResultGrid.vue:302-316`, `copyAll.ts`, `ec60520`): inline under
  `INLINE_CHARS`, worker above; abort on unmount reported as a copy error? Shell vs JSON output for
  out-of-range dates after Part 11's `ejson.ts` fix.
- `console/search.ts`: counter-based restart (§1 double check); plan results gated off
  (`activeResultIsPlan`).
- NULL copies as `''` in cell copy: Part 11 judged per format for the grid; do not re-report unless
  console diverges from the grid's documented choice.

### 5.4 SQL language: split, lex, lint, format, hover

- `SD/sql-split.ts` + `sql-lex.ts`: dialect flags (`backslashEscapes`, `dollarQuoting`,
  `hashComments`, `slashSlashComments`, `nestedBlockComments`, `bracketIdentifiers`,
  `postgresEscapeStrings`). `;` inside a trigger/procedure body (SQLite `BEGIN … END;`, MySQL
  without `DELIMITER`) splits the body: Run all sends broken pieces. Judge against what the Go
  console accepts (`SI/adapters/*/console.go`, read only); report only a concrete wrong split.
- `statementAtOffset` ownership rule (P108 Part 11 F3) and `trimmedStatementStart` after Format.
- `lintSql` stops at the first unterminated span (`sql-lint.ts:57-65`); paren reset at `;`.
- Format (`format.ts`): per-statement `formatDialect`, verbatim on failure, trailing-comment join
  (P108 Part 11 F9), terminator preservation (P22b D12), Mongo trailing-content refusal.
  **Suspect:** `loadSqlFormatter` memoises a rejected import forever (`format.ts:18-21`); the inline
  path (`ConsoleView.vue:437`) has no catch, so a failed chunk load is an unhandled rejection and
  every later press fails silently.
- Format while running, Format twice in flight (`568bbd4` fixed the spec, not the product: the
  second press formats stale text and shows "Text changed…"); acceptable or a guard?
- sql-formatter `keywordCase: 'preserve'` (P13 D4) is decided; ClickHouse identifiers.
- Hover (`sqlHover.ts`, `hoverInfo.ts`): Markdown escape and fence length (P108 Part 11 F8 fixed);
  `sql-hover-no-reparse` cache.

### 5.5 Autocomplete

- `consoleCompletionSources`, `sqlCompletionSources`, `relationCompletionSource`,
  `sqlSchemaCompletionSource` (`QUALIFIED_RE` handles `"…"` and backticks, not SQLite
  `[bracket]`), alias resolution via `statementsWithRefs`, CTE shadowing (`sql-cte-shadow`),
  `toOption` quoting via `identNeedsQuoting`/`quoteIdent` per dialect.
- Mongo (`mongoCompletionSource`, `mongoFieldSample`) and Redis (`REDIS_COMMANDS`) sources; schema
  cache warming (`ensureSchemaColumns` keyed by `generationFor`, P108 Part 12 F5) and remote
  `onSchemaChanged` through `ddlQuery`.
- Per-keystroke cost: every source is synchronous over the whole doc (`ctx.doc.slice(0, offset)`,
  `statementsWithRefs`); large documents (parse-callers perf probe covers some).
- `MonacoHost` provider registration is global per language id and model-scoped
  (`buildCompletionProvider` returns empty for other models): two mounted hosts with the same
  language (console + cell editor dock, `OperationsPanel`), dispose on unmount and on prop change.

### 5.6 Per-kind views

- **Routed to Part 12 (Part 4 F12 / Part 5 F4 renderer half; must fix).** `stream/page.ts:17-24,40`:
  `StreamRow.body: string` and `body: cached('body', page.bodies)` never checks
  `isNull(page.bodies, row)`. Part 5 (`21c1338`) now sets the null bit for a Kafka tombstone
  (`SI/page/builder.go:325-353`, `kafka/read.go:116-120`). The renderer shows `''`
  (`StreamView.vue:1191`), same as an empty value. Fix: `body: string | null`, `isNull` check like
  `key`/`timestamp` above it, and a **distinct null/tombstone state** in the row (`StreamView.vue`
  body cell: the grid's NULL styling, not empty text), the cell dock (`onCellClick` `:235,244`
  already passes `?? null`), the context menu (`:215` passes `?? ''`: decide copy text), and search
  (`stream/search.ts:66` matches `cellText` of a null body; confirm it never matches). Check
  `StreamComposeMessage`/`stream/mutations.ts` never resend a tombstone as `''`. Coverage of the
  stream view lives in Part 5's `ST/ipc/kafka/kafka.frontend.spec.ts`; a new assertion there is a
  Part 5 file: route it, or verify with a scratch probe. The binary-body half (encoding flag vs
  marker) is a parked design decision: no renderer change for it.
- Stream: `load`/`poll` (SQS batch strategy, `isBatch`), `runCount` honours the filter
  (`stream-count-honors-filter`), page-size options per `caps.maxPageSize`, selection cleared on
  page change (`StreamView.vue:252-255`), virtual rows and `setVisibleWindow` band (`:541-545`).
  Part 4 F15 (SQS browse consumes messages on a read-only connection) is a parked design decision:
  do not re-report.
- Documents: `editGate` (projection blocks edit, `DocumentView.vue:128-143`), edit/new buffer
  (`useEditBuffer`, `beautifyShellText`), save/delete through `immediateMutation`, row expansion
  state (`state.ts:197-217`, absent = expanded), `fieldNamesOnPage` memo per frozen page
  (`page.ts:63-88`), `documentRow` source registered at setup top level (`DocumentView.vue:82`),
  sort text round trip (`sortDocument.ts`, `mongo-sort-document-roundtrip`), projection menu.
  Edit of a truncated body must be refused (64 KiB cap).
- Browse: `loadSeq` supersession (`browse/state.ts:91-133`), `ensureKeyTypes` windowed and
  debounced (`BrowseView.vue:210` cancels), `${tabId}::preview` key-value host registration and
  cleanup (`:172`), level change resets, S3 previewable gate, delete from a level.
- Definition: `load` has no supersession guard by design (`definition/state.ts:36-38`): a Refresh
  racing the mount load lets the older response win; an error keeps the previous `definition`
  (stale DDL under an error?). `onCopy` (`DefinitionView.vue:67-69`) bare `copyText`, same class as
  §5.3's suspect. Structure filter and Source find bar.
- Key-value tab: thin over `KeyValuePane` (Part 11 reviewed); only the shell and its host wiring.

### 5.7 Monaco lifecycle and disposal (`MonacoHost.vue`)

- Mount (`:485-521`): `await loadMonaco()`, unmount-during-import guard via `rootRef`, double rAF for
  large docs, model created empty then filled. Check a prop change (`doc`, `language`, `readOnly`)
  during the import window: `applyExternalDoc` returns early (`!editor`), mount fills from current
  `props.doc`; a `language` change before mount is read at create.
- Unmount (`:523-538`): fill aborted, lint timer cleared, providers, decorations, wrap handler,
  editor, model disposed. `onDidChangeContent`/`onDidChangeCursorPosition` disposables die with the
  model/editor. `overflowWidgetsContainer()` (shared body node) never removed: bounded?
- Chunked fill (`fillModel` `:439-483`, `chunkedText.ts`): read-only only; a newer fill cancels;
  `readOnly` flipping mid-fill; `applyExternalDoc` editable path calls `cancelFill` then
  `pushEditOperations` (undo boundary); `lastAppliedVersionId` echo guard.
- `scheduleLint` 400 ms per change, guarded by `isDisposed`; lint source swapped on schema change.
- `<style scoped>` block (`:733-…`) with `:deep()` rules over Monaco's own DOM: a named
  Tailwind exception (no template to put classes on). Do not re-report unless a rule could be a
  utility class.

### 5.8 `beautify.ts` and editor helpers

- `beautifyJson`/`beautifyXml`/`scanJson`/`scanXml` on huge, deeply nested, malformed input, BOM,
  duplicate keys, number precision (`jsonKeyText`), XML entities/CDATA; worker vs inline parity.
- `findRanges` memo (`find-ranges-memo`), regex scan cap (`REGEX_SCAN_TEXT_CAP` from Part 11
  `page/scan`), `paintSpans` HTML escaping (`paintOverlayHtml` feeds `AutocompleteField`'s
  `v-html`; Part 11 confirmed every text run escaped, verify class names stay internal),
  `searchPattern` invalid regex.

### 5.9 Conventions (`CLAUDE.md`)

- 21 own `.vue` files: each one `<script setup lang="ts">`, no second `<script>`, no `generic=`.
  Only `MonacoHost.vue` has a `<style>` block (§5.7).
- Raw timers/listeners: 14 sites (`MonacoHost.vue` 3, `chunkedText.ts` 1, `ConsoleSlickGrid.vue` 2,
  `stream/search.ts` 1, `workers/parse/client.ts` 5, `parse.worker.ts` 2). Judge each against
  VueUse; non-Vue modules (worker, client, chunker) and `ConsoleSlickGrid`'s P99 §9.3 decline have
  named reasons.
- Server state: `definition/state.ts` (small fetch, hand-rolled status) and `browse/state.ts`
  (`loadSeq`) against TanStack Query; paged views (documents, stream, console results) keep frozen
  page stores (documented exception). A migration too large for this fixer becomes its own
  `SPEC.md` phase.
- One store, one concern: `useConsoleViewStore` (runtime, results, auto-explain, column widths,
  expanded docs), `useDocumentViewStore`, `useStreamViewStore`, `useStreamSearchStore`,
  `useBrowseViewStore`, `useDefinitionViewStore`. Report a real second concern, not size.
- P105: disabled triggers inside `TooltipTrigger` wrap in `TooltipDisabledTrigger` (console toolbar
  does; check documents/stream/browse/definition toolbars).
- Comments: very long historical comments (`P12 round 2 finding #3 …`) restate history; report only
  a comment that is now wrong.

### 5.10 Tests against the `CLAUDE.md` bar

- Red alone: `document-console-row-menu-lazy-snapshot` (§0). Each spec must pass alone and in the
  subset.
- Most own unit specs guard races, splitter/lexer rules and caches: they qualify. Judge thin ones
  (`console-explain-embedded-semicolon` 21 lines, `hover-value-caption` 33,
  `console-mongo-brackets` 38, `sql-cte-shadow` 44, `sql-lint` 47, `sql-keywords` 50) only against
  "still drives current code"; `CLAUDE.md` applies going forward, no retroactive prune.
- Gaps worth a guard only where a fix needs one: parse client abort/failure ordering (§5.1,
  concurrency), stream null body (single condition: no unit test).
- `parse-worker-client.spec.ts` covers the client with a fake worker; `ST/perf/parse-callers`
  measures callers. Check the perf probe is not a duplicate of the unit spec.
- UI specs: `console`, `console-format`, `console-explain` against §5.2-§5.4; `autocomplete`,
  `sql-schema` against §5.5; `definition`, `document-view-readonly` against §5.6. Prune duplicate
  coverage only when truly duplicate.

## 6. What earlier reviews and P143-P167 changed (do not re-report)

- **P166/P167** (base `743af03`): fixed no Part 12 file. P166 listed as **not reached**: Studio
  documents scroll, console `copyAll`/`resultMenu`, gRPC/HTTP body panes; P167 fixed ADE and git
  only. So P161 (documents scroll), P163 (parse worker, chunker, MonacoHost fill) and `ec60520`
  (copy-all on the worker) are unreviewed: review them.
- **`git diff 743af03 HEAD` on own paths: 26 files, +1,973/-87.** New: `workers/parse/*` (288),
  `editor/chunkedText.ts` (60), `console/copyAll.ts` (57), `documents/RowActionButton.vue` (22),
  perf specs and `pureFns.entry.ts` (1,127), `chunked-text` and `parse-worker-client` unit specs.
  Changed: `MonacoHost.vue` (+139), `DocumentView.vue` (+66), `resultMenu.ts` (63),
  `ConsoleResultGrid.vue`, `ConsoleView.vue`, `documents/page.ts`, `documents/search.ts`, two UI
  specs.
- **Decided trade-offs:** cell editor detect/validate/beautify stay inline, not on the worker (P163
  inventory row 7). Documents flick needs lighter rows (user call, known open item). `keywordCase:
  'preserve'` (P13 D4). Explain applies to SELECT/WITH only (D12). Auto-explain warns, never blocks
  (D19). Console result append vs replace toggle (P40 D6, P46-2). `definition` load has no
  supersession by design (comment): report only a concrete wrong-screen scenario.
- **Parked design decisions (do not re-report):** Part 4 F8 (console results fully materialised in
  Go, no cap), Part 4 F15 (SQS browse consumes messages on a read-only connection), Part 5 F4
  binary-body half (encoding flag vs marker), Part 11 F7 (grid staged changes dropped on reload).
- **Part 10 and Part 11 fixes** in shared code are the current contract (§1); verify Part 12 callers
  against them, do not re-report them. Part 11 F17's optional cancel-gated mock reply needs Part 13
  files (`ST/ui/support/{mockStream,mockRuntime}.ts`); it is Part 13's, not Part 12's. Console Stop
  specs that race a fixed mock delay the same way are in scope as own-spec flakes.
- **P108** (v1.9 numbering, console was its Part 11; schema columns its Part 12) fixes are in code,
  cited as `P108 Part 11 F<n>` / `P108 Part 12 F5` (statement-at-offset rule, Format join, Mongo
  trailing content, hover fence, `starting` window, `explain` cancellable, tab-close cancel,
  schema generation). Also P12/P13/P18/P19/P21/P22/P40/P42/P43 round fixes cited in comments.
  Verify they hold; never report them as new.

## 7. Watch items

- Pre-plan §5.11: parse worker abort on scope dispose, `runLatest` key reuse, inline vs worker
  parity, chunker boundaries (§5.1, §5.7); auto-explain races: stop, overlap, clobber, run after tab
  close (§5.2); splitter and linter rule interactions (§5.4); console result cap (§5.2).
- Task list: Monaco lifecycle/disposal (§5.7), console run/cancel/Stop state (§5.2), parse worker
  messaging, cancellation and stale results (§5.1), documents/keyvalue/stream/browse/definition
  views (§5.6), sql-formatter use (§5.4), autocomplete (§5.5), routed stream tombstone (§5.6), F4
  spill double check (§1), tests (§5.10), conventions (§5.9).

## 8. Rubric, order and outputs

- **One Opus reviewer**, freeform "any kind of issue or bug", edge cases weighted. Not three
  dimension reviewers (user deviation from `CLAUDE.md`'s recipe, P168 only).
- Reports only. Fixes nothing, edits no code.
- **Whole chunk, in this block order** (shared helpers first, so views read against known layers):
  1. Parse worker and editor core: `workers/parse/*`, `editor/chunkedText.ts`, `beautify.ts`,
     `editor/MonacoHost.vue`, `editor/{paintSpans,findRanges,hoverInfo,searchPattern,
     monacoLanguages,completion,ranges,diagnostics}.ts`, `edDecorations.css`.
  2. SQL language: `SD/{sql-lex,sql-split,sql-lint,sql-tokens,sql-keywords}.ts`,
     `console/{format,sqlFormatterEntry,lint,sqlDiagnostics,ddl,sqlNodes,sqlRefs,sqlHover,
     mongoStatement}.ts`, `SD/{console,schema,editor}.ts`.
  3. Autocomplete: `console/{completion,sqlLanguageService,sqlSchemaCompletion,
     sqlKeywordCompletion}.ts` and MonacoHost provider glue.
  4. Console run and results: `console/state.ts`, `ConsoleView.vue`, `resultPages.ts`,
     `ConsoleResultGrid.vue`, `ConsoleSlickGrid.vue`, `resultMenu.ts`, `copyAll.ts`, `search.ts`,
     `ConsoleSavedMenu.vue`, explain (`explain,explainResults,plan,planIssues,planModel`,
     `planParsers/*`, `ExplainResultView.vue`). Contract read: `SI/queryplan` against
     `ST/fixtures/explain-plans`.
  5. Documents and key-value: `views/documents/*`, `views/keyvalue/KeyValueView.vue`,
     `SD/queries.ts`, `sortDocument.ts`.
  6. Stream, browse, definition: `views/stream/*` (routed tombstone fix first),
     `SD/streamFilter.ts`, `views/browse/*`, `views/definition/*`, `SD/definition.ts`.
  7. Tests: 40 unit specs + harness, 7 UI, 6 perf, 2 visual, fixtures loader (coverage claims, test
     bar).
- **Resumable:** write `docs/v2.0/plans/P168-part12-findings.md` as blocks finish and commit it
  after **each** block (`docs(v2.0): P168 Part 12 findings, block <n>`), normal commit, explicit
  `git add <path>`, hooks green. An interrupted run resumes from the last committed block, never
  re-derives one.
- Each finding: id (`F<n>`), severity (high/medium/low), `file:line` on the current tree, a concrete
  failure scenario, a proposed fix, "verified" or "code-read". Mark one that needs a real design
  decision (`DESIGN-DECISION`); the fixer turns it into its own `SPEC.md` phase.
- **The routed stream tombstone item is a finding** (carry it as `F<n>`, source "Part 4 F12 / Part 5
  F4 renderer half"), so the fixer lands it with the rest.
- **Routing tag.** A finding whose fix must edit a file owned by another Part carries
  `needs-other-part-file: <path> (Part N)`. Owners: Stream A Parts 2-9 (here mostly Part 5
  `SF/bridge/**`, `SP/**`, `ST/ipc/**`; Part 6 `SI/queryplan`, `SI/mask`, `SD/mask`; Part 7
  `packages/api-core`; Part 9 `PW`/`PT`/`kira-ui`/`SD/tabs`); Stream B Parts 14-23; Stream C Parts
  10 (`api`, `httprequest`, `grpcrequest`), 11 (`views/{shared,grid}`), 13 (`state`, `workbench`,
  `theme`, `project`, `main.ts`, `App.vue`, `ST/ui/support/**`). The fixer does not make Stream A or
  B edits: it appends each to `docs/v2.0/plans/P168-routed-from-streamC.md` (exists; one
  `## From Part 12 F<n>` section per finding: id, file, issue, fix). A Part 13 tag is left in the
  findings for Part 13's plan to pick up (same stream, later), nothing routed. A Part 11 file edit
  needed by a Part 12 finding may be made in Stream C, stated in the commit. A finding fixable in
  own files with only a read of another Part's contract carries no tag.
- The findings file states base commit (`8b20119`), HEAD reviewed, checks run and results, findings,
  then coverage per block: reviewed, skimmed (with reason), not reached. No unexplained gap. A chunk
  with nothing real says so; never manufacture a finding.
- Final commit `docs(v2.0): P168 Part 12 findings` before any fixer starts.
- Then one Sonnet fixer: one commit per group of related findings, naming `P168 Part 12`, only in
  own files (plus Part 11 files where stated); tagged findings routed as above. Re-runs the own unit
  specs (together and each alone), `typecheck:web:studio`, `typecheck:unit:studio`, lint, and the own
  UI specs touched (targeted, never the full suite). Deletes the findings file when done. Chunk
  lands per pre-plan §3.4 before Part 13's plan starts.

## 9. Out of scope

- Part 5/6/7/9 internals beyond the contract this chunk uses (report a defect there with the
  routing tag).
- Part 11 `views/{shared,grid}/**` (closed; contract only, except an edit a Part 12 finding needs);
  Part 10 `api`, `httprequest`, `grpcrequest` (contract only: they are callers of the editor and
  parse worker); Part 13 `state/**`, `workbench/**`, `theme/**`, `project/**`, `main.ts`.
- Go console/read adapters (`SI/adapters/**`): read only to judge splitter and stream contracts.
- P165 prototype (`apps/kira-studio/frontend/proto/**`, `tests/proto/**`): excluded.
- Decided trade-offs, parked decisions and known open items (§0, §6).
- Generated bindings and wire code, docs, excluded files (pre-plan §6).
