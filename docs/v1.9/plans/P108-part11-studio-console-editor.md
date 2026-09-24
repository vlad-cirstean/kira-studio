# P108 Part 11 — review plan: Studio query console, SQL editor and per-kind data views

Chunk A10, stream A position 10 (pre-plan §5.10). One Opus reviewer runs this plan and reports
findings. It fixes nothing. One Sonnet fixer then lands one commit per finding. Tree surveyed:
`7a05aa4` (Parts 2-10 and 13-19 closed, stream B done at `f455c75`).

Paths repo-relative. `SF` = `apps/kira-studio/frontend/src`, `SI` = `apps/kira-studio/internal`,
`SD` = `packages/shared/domain`, `ST` = `apps/kira-studio/tests`, `PW` = `packages/workbench/src`
(alias `@workbench`), `PT` = `packages/theme/src` (alias `@theme`), `KU` = `packages/kira-ui/src`.
`VC` = `SF/views/console`, `VS` = `SF/views/shared` (Part 10, closed).

## 0. Method

- **`codegraph_explore`** for discovery, before any Read. Targets:
  - console run pipeline: `useConsoleViewStore` (`run`, `stop`, `explain`, `autoExplainCheck`,
    `worstFlaggedIndex`, `pushPlanResult`, `evictOldestResults`, `releaseResult`,
    `registerTabRuntimeCleanup` callback), `ConsoleView.vue` (`runStatement`, `runAll`,
    `onExplain`, `ensureConnectedForRun`, `splitOptionsFor`, `statementAtCursorText`);
  - explain: `VC/explain.ts` (`isExplainable`, `explainStatementsFor`), `VC/plan.ts`,
    `VC/planParsers/*`, `VC/planIssues.ts`, `VC/explainResults.ts`, and their Go mirrors
    `SI/queryplan/statements.go` (`Explainable`, `StatementsFor`) and `SI/queryplan/parse*.go`;
  - lexers: `scanSqlSpan` (`SD/sql-lex.ts`), `splitSqlStatements`/`statementAtCursor`
    (`SD/sql-split.ts`), `lintSql` (`SD/sql-lint.ts`), `tokenizeSql` (`SD/sql-tokens.ts`),
    `SD/sql-keywords.ts`, `VC/sqlNodes.ts` (`tokenOptionsFor`, `unquotedName`), `VC/ddl.ts`
    (`parseDdl`), `VC/format.ts` (`formatConsoleText`), `VC/mongoStatement.ts`;
  - editor: `SF/editor/MonacoHost.vue` (`registerProviders`, `scheduleLint`,
    `applyExternalDoc`, hover provider), `paintSpans.ts`, `findRanges.ts`, `hoverInfo.ts`,
    `searchPattern.ts`, `VC/{sqlHover,sqlSchemaCompletion,sqlKeywordCompletion,completion,
    sqlDiagnostics,sqlRefs,lint}.ts`;
  - per-kind views: `useDocumentViewStore`, `ProjectionMenu.vue`, `useStreamViewStore` (`load`,
    `applyStreamFilter`, `poll`), `StreamView.vue` resize wiring, `useBrowseViewStore` (`load`,
    `setLevel`, `ensureKeyTypes`), `DefinitionView.vue`, `definition/structure.ts`.
  Check any proposed fix's blast radius the same way. `SD/sql-*` has callers outside this chunk
  (`VS/celleditor/validate.ts`, `SF/views/grid`, `OperationsPanel.vue`).
- **Read closed chunks first.** Part 7 (`SI/queryplan`) is the Go mirror of `VC/explain.ts` and
  `VC/planParsers`. Parity is pinned by `ST/fixtures/explain-plans/*.{input,expected}.json`, read
  by both `ST/unit/explain-plan.spec.ts` and `SI/queryplan/parse_test.go`. `loader.ts` says the
  TS side generates and Go is pinned. A parser fix here must keep both sides green in the same
  commit. Part 10 (`VS`) closed with F1-F21 (SPEC "P108 Part 10 result"). Treat every one as
  correct: sibling-reload pending guard, countError threading, immediate-mutation isolation and
  the rest. Do not re-flag them.
- **Carry-overs from Part 10, in scope here:**
  - F20 corrected `VS/page/load.ts`'s header only. `stream/state.ts` `load()` still hand-writes
    the `runPagedLoad` frame. Adopt it or name the real shape difference (§4.9).
  - F16 capped user regex scan cost in grid and keyvalue only. `VC/search.ts` and
    `documents/search.ts` were left uncapped by design, for this chunk (§4.12).
  - `paintOverlayHtml` class attribute: Part 10 cleared it on the assumption that every
    `rangeHighlights` class is static. Re-verify from this side (§4.11).
  - Duplicate column names: Part 10 §4.7 deferred console `SELECT a.id, b.id` here.
    `ConsoleSlickGrid.vue` addresses cells by index (`colField(i)`), not `pageColumnIndexFor`.
    The one name-keyed seam left is the sticky width store (`consoleColumnWidths`), a stated
    trade in `buildColumns`. Confirm no other console path resolves by name, then close it.
- **Premise corrections, stated up front.**
  - Pre-plan §5.10 says P105 moved "ten column handles" in the stream view onto
    `KuiColumnResizeHandle`. `StreamView.vue` holds **4** instances (key, timestamp, headers,
    attrs; body is flex). Other callers: `packages/git-ui/src/components/CommitGrid.vue` and
    `packages/git-ui/src/App.vue`. The watch item stands; its size does not.
  - Stream B is done (`f455c75`). Per pre-plan §3.3 a fixer may now edit B1 files directly,
    including `KU/KuiColumnResizeHandle.vue`. Part 10 said report-only for `PW`/`PT`; that no
    longer holds. A `KU` fix must keep `CommitGrid.vue`'s contract (verify with its own callers).
  - `ST/fixtures/**` is nominally A10-owned. `ST/fixtures/mask/**` (132 files) is the parity
    contract of `SI/mask/parity_test.go` and `ST/unit/mask-parity.spec.ts` (A6, closed). Read it
    for the contract only. `ST/fixtures/explain-plans/**` (31 files) is live here (see above).
- **Scratch replicas** in the session scratchpad, never in the tree, where a claim depends on
  runtime behavior:
  - a `bun test` harness over `useConsoleViewStore` with a fake `data` bridge whose `execute`
    resolves on demand (tab close mid auto-explain, second click during reconnect, Stop then
    late resolve);
  - direct calls into `splitSqlStatements`/`lintSql`/`tokenizeSql` with the inputs in §4.2;
  - a Playwright run against `ST/ui`'s static server and bridge mock for UI paths
    (`ProjectionMenu`, resize cancel).
  Mark each claim "verified" or "code-read".
- **Known open items read first** (`docs/ARCHITECTURE.md` "Known open items").
  `maskedColumnRenamedOrHidden`'s view blind spot and M5 correlation provenance touch console
  masking. Both are documented. Do not re-report either.

## 1. Own file set

About 17.1k production lines. 36 unit and 7 UI specs.

- **`VC` (32 files, 7,241 lines)**:
  - components: `ConsoleView.vue` (1109), `ConsoleSlickGrid.vue` (889), `ConsoleResultGrid.vue`
    (522), `ExplainResultView.vue` (268), `ConsoleSavedMenu.vue` (145);
  - run and results: `state.ts` (603), `resultMenu.ts` (341), `resultPages.ts` (83),
    `explainResults.ts` (34), `search.ts` (101);
  - explain: `explain.ts` (54), `plan.ts` (105), `planModel.ts` (63), `planIssues.ts` (82),
    `planParsers/{mysql 193, mariadb 150, postgres 134, clickhouse 127, sqlite 66}`;
  - SQL language: `ddl.ts` (492), `completion.ts` (263), `lint.ts` (232), `sqlRefs.ts` (210),
    `format.ts` (201), `sqlHover.ts` (150), `sqlNodes.ts` (142), `sqlSchemaCompletion.ts` (135),
    `sqlDiagnostics.ts` (120), `sqlLanguageService.ts` (101), `mongoStatement.ts` (66),
    `sqlKeywordCompletion.ts` (53), `sqlFormatterEntry.ts` (7).
- **`SF/editor` (1,179)**: `MonacoHost.vue` (697), `paintSpans.ts` (214), `findRanges.ts` (110),
  `completion.ts`, `hoverInfo.ts`, `searchPattern.ts`, `monacoLanguages.ts`, `ranges.ts`,
  `diagnostics.ts`.
- **`SF/beautify.ts` (469)**: lossless JSON and XML scanners. Callers: `VS/celleditor/formats.ts`,
  `httprequest/ResponsePane.vue`, `ResponseDiffDialog.vue`.
- **`SF/views/documents` (2,071)**: `DocumentView.vue` (1285), `state.ts` (288), `menu.ts`,
  `ProjectionMenu.vue`, `page.ts`, `search.ts`, `sortDocument.ts`, `mutations.ts`.
- **`SF/views/stream` (2,530)**: `StreamView.vue` (1431), `state.ts` (308),
  `StreamSearchToolbar.vue`, `StreamComposeMessage.vue`, `search.ts`, `streamFilterHistory.ts`,
  `StreamFilterHistoryMenu.vue`, `page.ts`, `mutations.ts`, `menu.ts`.
- **`SF/views/browse` (1,101)**: `BrowseView.vue` (683), `state.ts` (292), `menu.ts` (126).
- **`SF/views/definition` (1,135)**: `DefinitionView.vue` (448), five section components,
  `structure.ts`, `state.ts`, `columnsMenu.ts`.
- **`SF/views/keyvalue`**: `KeyValueView.vue` (28), a thin wrapper over `VS/keyvalue/KeyValuePane.vue`
  (Part 10). Nothing of substance to review here.
- **`SD` (1,280)**: `sql-tokens` (408), `sql-keywords` (360), `sql-lex` (107), `sql-lint` (98),
  `sql-split` (78), `definition` (83), `queries` (68), `streamFilter` (30), `console` (27),
  `schema` (14), `editor` (7).
- **`ST/unit`** (36): `autocomplete-tokenizers`, `browse-key-types`, `console-{auto-explain-race,
  auto-explain-worst,column-widths-session,format,mongo-brackets,overlapping-explain-clobber,
  result-cap,root-completion,run-after-tab-close,stop-auto-explain,
  stop-explain-resolves-anyway}`, `ddl-schema`, `document-{byte-label,
  collapse-all-preserves-other-pages,console-row-menu-lazy-snapshot}`, `explain-plan`,
  `explain-truncated`, `find-ranges-memo`, `hover-value-caption`,
  `mongo-sort-document-roundtrip`, `paint-spans-merge`, `schema-columns-effective`,
  `schema-ddl-cache`, `sigma-count-refresh`, `sql-cte-shadow`, `sql-hover-no-reparse`,
  `sql-keywords`, `sql-lint`, `sql-split`, `sql-tokens`, `sqs-mutation-never-polls`,
  `stream-count-honors-filter`, `stream-search-no-permanent-cache`. `document-row-height-cache` is
  A9.
- **`ST/ui`** (7): `autocomplete` (1010), `console` (1140), `console-explain` (500),
  `console-format` (530), `definition` (364), `document-view-readonly` (131), `sql-schema` (689).
- **`ST/fixtures`**: `explain-plans/` (31, live), `mask/` (132, contract only, §0).

## 2. One hop: callers

- **`SF/workbench/tabViews.ts`** (Part 12): static `TAB_VIEWS` entries for `console`,
  `definition`, `document`, `keyvalue`, `stream`, `browse`. MainView keys each by `tab.id`.
- **`SF/views/httprequest`**: `RequestBodyPane.vue` mounts `MonacoHost`; `ResponsePane.vue` and
  `ResponseDiffDialog.vue` call `beautifyXml`/`beautifyFor`. `VS/ResponseFindBar` uses
  `findRanges`/`searchPattern`.
- **`VS` (Part 10, closed)** calls back into this chunk: `VS/AutocompleteField.vue`
  (`paintOverlayHtml`), `VS/celleditor/validate.ts` (`lintSql`), `VS/celleditor/formats.ts`
  (`beautify.ts`), `VS/page/scan.ts` (`compileSearchPattern`).
- **`SF/views/grid`** (Part 10): filter completion and `quoteIdent` paths use `SD/sql-keywords`
  and `SD/sql-tokens`.
- **`SF/workbench/OperationsPanel.vue`** (Part 12): `onRerun` re-splits a recorded
  `record.command` with `splitSqlStatements` and calls `consoleViewStore.run` in a new console
  tab (§4.3).
- **`SF/state/*`** (Part 12): tab open/close drives `registerTabRuntimeCleanup` for console,
  documents, stream and browse runtimes.

## 3. One hop: callees

- **Settled (closed parts):**
  - `VS` (Part 10): `createPageStore`, `runPagedLoad`, `runPagedCount`, `applyLoadFailure`,
    `beginOp`, `createPageSearch`, `runChunkedScan`, `eachMatch`, `KeyValuePane`,
    `CellEditorDock`, `DocumentRow`/`DocumentTree`, `useConnectionGate`, `kiraSlickGrid`.
  - `SI/queryplan` (Part 7): Go mirror of explain statements and plan parsers.
  - `SF/bridge/{data,control}` and `@shared/protocol/page` (Part 6).
  - `PW`, `PT`, `KU` (B1, stream B done): `state/confirmDialog`, `state/contextMenu`,
    `util/clipboard`, `util/virtualRows`, shadcn-vue components incl. `TooltipDisabledTrigger`,
    `KuiColumnResizeHandle`. Editable per §0.
- **Later in this stream (read for the contract):**
  - Part 12: `SF/state/{schemas,schemaColumns,runState,connections,tabs,cellSelection,settings,
    consoleDefaults}`, `SF/workbench/OperationsPanel.vue`, `SF/theme/completion.ts` (`tokenAt`,
    `templateToken`, `rankCandidates`, `MAX_VISIBLE = 12`), `SF/api/state/variableCompletion.ts`
    (feeds `hoverInfo.value`).
- Third-party: `monaco-editor` (providers are global per language id; `MonacoHost` registers
  per instance, model-scoped), `sql-formatter` (lazy via `sqlFormatterEntry.ts`,
  `keywordCase: 'preserve'`), `@tanstack/vue-query` (`schemaQueryOptions` in `ConsoleView`),
  `@tanstack/vue-virtual` via `useVirtualRows`, `slickgrid` via `kiraSlickGrid`, VueUse, reka-ui.

## 4. Edge cases to weight

Correctness of what reaches the server first. This chunk is where typed text becomes one or more
statements sent to a real database, possibly DML or DDL, and where a hidden EXPLAIN runs ahead of
it.

1. **Auto-explain and run races (`VC/state.ts`, `ConsoleView.vue`).**
   - `run()` awaits `autoExplainCheck` before `data.execute`. After that await it checks
     `rt.opId !== opId || rt.status !== 'running'`. It does not check `runtime[tabId]`. Tab
     cleanup deletes the runtime but does not cancel `rt.opId` or `explainOpId`, so `rt` is a
     detached object whose opId still matches. Scenario: auto-explain on, run an UPDATE, close
     the tab while EXPLAIN runs. Check whether the real UPDATE still fires. `console-run-after-
     tab-close` pins which await; confirm it covers this one.
   - Same check after the real `data.execute` exists (`if (!runtime[tabId]) return`). Confirm
     cleanup cancels the server-side op (a SELECT with a long scan keeps running otherwise).
   - `runStatement`/`runAll`/`onExplain` guard `if (running.value) return` synchronously, then
     `await ensureConnectedForRun()` before calling the store. Status flips to `'running'` only
     inside the store. A second click, Ctrl+Enter or command-registry call during reconnect
     passes the guard. Check whether two runs overlap and which one's results survive.
   - `explain()` shares `rt.opId` and status with `run`. After its await it checks opId only,
     not `status !== 'running'` and not `runtime[tabId]`. `console-stop-explain-resolves-anyway`
     pins that a plan landing after Stop is still shown. Decide intended; confirm it cannot set
     status idle over a newer run.
   - `stop()` sets `'cancelled'`, cancels `explainOpId`, then `stopOp`. Stop during auto-explain:
     confirm the real statement never starts (`console-stop-auto-explain` pins it) and the status
     line reads cancelled, not idle.
   - `autoExplainCheck` sends every EXPLAIN in one `data.execute` and slices `response.pages` by
     `perStatementSql[i].length`. That assumes each EXPLAIN statement yields exactly the pages its
     prefix list predicts. ClickHouse sends 2 statements per input. Check a server that returns
     fewer pages (an EXPLAIN that errors mid-batch, a driver that merges result sets): plans
     attach to the wrong statement, and `worstFlaggedIndex` points at the wrong SQL.
   - `autoExplainCheck` swallows every error except cancel. Check a permission error on EXPLAIN
     does not block the real run and does not show a stale banner from an earlier run.
   - `AUTO_EXPLAIN_MAX_STATEMENTS = 10`: check the banner says the check was skipped, not clean,
     for 11+ statements.
2. **Splitter, linter and tokenizer: three lexers over one `scanSqlSpan`.**
   One span scanner, three consumers with different rules. Weight any disagreement between them,
   since each feeds a different surface: split decides what executes, lint decides red squiggles,
   tokenize decides hover, DDL and diagnostics.
   - `scanSqlSpan` has no `#` line comment. MySQL, MariaDB and ClickHouse accept `# ...`. A `;`
     or `'` inside a `#` comment splits or opens a string. `explain.ts`'s
     `LEADING_COMMENT_RE` also misses `#`, so `# note\nSELECT` is not explainable (harmless) and
     `# note\nDELETE` is correctly not. Check the splitter case first.
   - Postgres `E'...'` strings: `backslashEscapes` is false for Postgres, so `E'it\'s'` ends at
     `\'`. The rest of the document shifts in and out of a string. Check split and lint.
   - Postgres nested block comments (`/* a /* b */ c */`) end at the first `*/`.
   - SQLite `[bracket]` identifiers are not spans. `[a;b]` splits.
   - Dollar quoting: `/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/` on `source.slice(i)` starts at any `$`.
     Postgres allows `$` inside identifiers (`a$b$c`). The splitter reads `$b$` as an open tag;
     the tokenizer consumes `$` via `isIdentPart`. Check split and tokenize disagree. Check
     `source.slice(i)` per `$` is not quadratic on a long script with many `$1` placeholders.
   - Compound bodies: SQLite `CREATE TRIGGER ... BEGIN ...; ...; END;`, Postgres `BEGIN ATOMIC`,
     MySQL `CREATE PROCEDURE ... BEGIN ... END` (no `DELIMITER` support). Each splits at the
     inner `;`. Run-all then sends fragments. Decide finding (depth tracking) or documented limit.
   - `lintSql` resets its paren stack at every `;` (`flushParens`). `tokenizeSql` groups
     statements at top-level `;` only, after `scanLevel` builds recursive Parens. One unclosed
     `(` makes the tokenizer swallow every later statement into one Parens node. Lint shows the
     error on one statement; hover, DDL and diagnostics silently stop for the rest. Check.
   - `statementAtCursor`: inclusive `start <= cursor <= end`, else the last statement. Cursor in
     whitespace between two statements, cursor after a trailing `;`, and cursor in an empty
     document. Check the "Run statement" target is never a surprise (a DELETE picked from a
     blank line).
   - Mongo consoles split with SQL options (`backslashEscapesFor(undefined)` true, default dollar
     quoting). `//` comments, regex literals `/a;b/` and template strings are not spans. Check
     `db.c.find({x: /;/})` and a `;` inside a `//` comment.
   - `OPERATOR_RE = /[=<>+\-*/%|!]+/y`: `~ & ^ # @ ?` are Punctuation. Postgres `@>`, `?|`, `#>>`
     and `~*` split into parts. Check hover and diagnostics do not misread them.
   - `sql-split` and `sql-lint` are also imported by `VS/celleditor/validate.ts` and
     `OperationsPanel.vue`. A fix changes their behavior too; sweep with `codegraph_explore`.
3. **Operation history re-run (`OperationsPanel.vue`, Part 12, splitter caller).**
   - Go `SetCommand` joins statements with `";\n"`. A statement ending in a `--` comment puts the
     `;` inside the comment. `onRerun` re-splits and merges two statements into one. Check
     whether a re-run then sends something other than what was originally run.
   - `onRerun` calls `consoleViewStore.run` directly, without `ensureConnectedForRun`. Check
     behavior on a disconnected connection.
   - A Mongo command re-splits with SQL rules (§4.2).
4. **EXPLAIN safety and plan parsers.**
   - `EXPLAINABLE_RE = /^(SELECT|WITH)\b/i` after stripping leading comments. EXPLAIN without
     ANALYZE is side-effect-free only if the splitter isolated exactly one statement. Any
     §4.2 mis-split can put `SELECT 1; DROP ...` under one EXPLAIN prefix. Check each
     `explainStatementsFor` prefix never includes `ANALYZE`, and a data-modifying CTE
     (`WITH d AS (DELETE ...) SELECT`) stays plain EXPLAIN.
   - `SI/queryplan/statements.go` mirrors `explain.ts` verbatim. A fix on one side goes to both
     in the same commit.
   - Plan parsers (`planParsers/*`): malformed or truncated JSON (`ExplainTruncatedError`), MySQL
     vs MariaDB JSON shape drift, ClickHouse two-page pairing, SQLite `EXPLAIN QUERY PLAN` rows.
     Check each fixture in `explain-plans/` has a Go twin and the TS generator still reproduces
     it (`loader.ts`). Go sorts metrics; order is non-contractual, so do not flag it.
   - `worstFlaggedIndex` compares `estimatedRowsRead`. Check NaN, missing and string-typed
     estimates (MySQL emits strings).
5. **Result retention and memory (`VC/state.ts`, `resultPages.ts`, `explainResults.ts`).**
   - `MAX_RESULTS_PER_TAB = 50`, `evictOldestResults`. Check eviction releases the page, plan,
     document rows, row caches and expanded doc ids (`releaseResult`), and never evicts the
     active result.
   - Module-level maps in `explainResults.ts` and `resultPages.ts`. Check tab close clears every
     key for that tab, including results added after cleanup registration.
   - "New result set" off drops prior results before pushing. Check a failed run with the toggle
     off does not leave zero results and no error.
   - Console result page size cap: `console-result-cap` pins it. Check the UI says truncated.
6. **Formatter (`VC/format.ts`).**
   - Splits, formats each statement with `sql-formatter`, rejoins with `;\n\n`. Comments between
     statements, a trailing comment after the last `;`, and a statement ending in `--` comment
     (rejoin puts `;` inside it). Check format never changes what executes.
   - Dialects `sql-formatter` does not know (ClickHouse maps to which language?). Check a
     formatter throw leaves the text untouched and reports an error.
   - Caret mapping by statement index: check it after a format that merges or drops a statement.
   - Mongo branch via `formatMongoStatement`: check invalid input is left untouched.
7. **DDL schema parse (`VC/ddl.ts`, `SF/state/schemas.ts`).**
   - `parseDdl` handles CREATE TABLE/VIEW/INDEX, ALTER TABLE ADD COLUMN, COMMENT ON COLUMN.
     `COMMENT ... IS '...'` unescapes `''` only; backslash escapes and `E'...'` stay raw.
   - `TableIndex` resolves by qualified key or first bare name. Two schemas with the same table
     name: check hover and completion pick the one the console's container resolves to.
   - Quoted identifiers with doubled quotes or backticks (`unquotedName`). Check case folding per
     dialect (Postgres folds unquoted to lower; MySQL table case depends on the server).
   - `ddlQuery` is `useQuery(schemaQueryOptions(...))` with `enabled` on connectionId and
     dialect. Check the key follows a connection change on the same tab and that a broadcast
     invalidation re-parses once, not per consumer.
8. **Documents view (`SF/views/documents`).**
   - `ProjectionMenu.vue`: `fieldNames` is a snapshot of `fieldNamesOnPage(tabId)`, excluding
     `_id`, and only holds fields present on the current (already projected) page. `selected`
     starts as `currentProjection() ?? fieldNames`. `onUnmounted` always calls
     `setProjection(tabId, selected.size === fieldNames.length ? null : [...selected])`. After a
     projection to `[a, b]`, the page holds only `a, b`. Reopen and close the menu: `selected`
     equals `fieldNames`, so the projection is silently cleared. Every close also reloads and
     resets `pageIndex` to 0 even when nothing changed. "None" sends an empty projection. Treat
     as a strong finding candidate; verify in a replica.
   - `setSearch`/`setProjection`/`setSort`/`setPageSize` reset `pageIndex` to 0 with revert on
     failure. Check revert against a superseding second call (Part 10 §4.5 pattern).
   - `setAllExpanded` merges `false` entries; the expanded map is persisted and grows across
     pages. `document-collapse-all-preserves-other-pages` pins the merge. Check growth is bounded
     or pruned on page change.
   - `sortDocument.ts` round trip (`mongo-sort-document-roundtrip`). Check duplicate keys and
     non-±1 values.
   - Read-only connection gating (`canInsert`, `canDelete`, P21 round 2): confirm every write
     affordance (menu, keyboard, toolbar) reads it.
9. **Stream view (`SF/views/stream`).**
   - `state.ts` `load()` hand-writes `beginOp`, `data.read`, `!runtime[tabId]` and opId guards,
     page-kind check, `setPage`, `selectedRow = null`, `applyLoadFailure`. That is
     `runPagedLoad`'s frame. Adopt it or name the real difference (Part 10 F20 carry-over).
   - `applyStreamFilter` clears `nextToken` and count and records history. `streamFilter.ts`
     carries offset as a decimal string (int64). Check no `Number()` conversion on it anywhere.
   - SQS: `onRefresh` refuses for batch kinds; `sqs-mutation-never-polls` pins delete. Check the
     command-registry path and the Poll button agree (receive is destructive to visibility).
   - `deleteSqsMessage` confirm dialog interpolates `row.key`. Check it renders as text.
   - `search.ts` scans every row synchronously on the main thread (substring, not regex). Page
     size bounds it; check the largest allowed page with 64 KiB bodies stays under a frame
     budget by estimate, not measurement.
10. **Stream column resize (`StreamView.vue` plus `KU/KuiColumnResizeHandle.vue`, P105).**
    - `onResizeLive` sets `liveResizeWidth`; `onResizeCommit` patches `columnWidths` then nulls
      it. `KuiColumnResizeHandle`'s `onCancel` (`pointercancel`, `lostpointercapture`) cleans up
      without emitting `change`. Then `liveResizeWidth` stays non-null and uncommitted. The next
      drag on another column snaps the first back. Verify in a replica (Playwright can dispatch
      `pointercancel`).
    - Window listeners inside `KuiColumnResizeHandle` are removed on pointerup/cancel only. Check
      unmount mid-drag (tab close, view switch) removes them.
    - A right-button `pointerdown` starts a drag. Check `e.button` filtering.
    - Keyboard ArrowLeft/Right emits both `update:value` and `change`: confirm the stream view
      handles a commit with no preceding live value.
    - `:min="40"`, no max. Check a drag past the viewport.
    - A `KU` fix must hold for `CommitGrid.vue` and `git-ui/App.vue` (B7 closed).
11. **HTML and Markdown injection in the editor.**
    - `MonacoHost.vue` hover provider pushes `info.lines` as Markdown strings
      (`supportHtml: false`, but still Markdown). `hoverInfo.ts`'s own doc says plain text. Column
      descriptions come from DDL `COMMENT` text and server column comments; both are
      user- or database-controlled. Check whether a comment like `[x](command:...)` or
      `![](http://...)` renders a link or fetches an image. `isTrusted` must stay false.
    - `info.value` goes inside a ```` ``` ```` fence without escaping backticks. A value holding
      ```` ``` ```` breaks out of the fence. Source: `variableCompletion` values (Part 12).
    - `paintSpans.ts` `escapeHtml` escapes `& < >` only. `class="${run.classes.join(' ')}"`
      joins Monaco `mtkN` classes with provider classes. Re-verify Part 10's "all static"
      conclusion from the provider side. `decodeEntities` handles `&lt; &gt; &amp;` and NBSP only;
      if `colorize` emits `&#39;` or `&quot;`, the text mismatches and falls back to plain. Check
      that path is only a cosmetic loss.
    - `ConsoleSavedMenu.vue` renders saved names and bodies with `{{ }}`: text, fine. Check no
      `v-html` in the chunk other than `AutocompleteField`'s overlay (grep).
12. **Search and find (`VC/search.ts`, `documents/search.ts`, `findRanges.ts`).**
    - User regex on JS's backtracking engine, main thread. `VC/search.ts` runs through
      `runChunkedScan`, bounding rows per frame but not one `exec`. Part 10 F16 left console and
      documents uncapped. Apply the same decision here: cap, or state why these differ.
    - `findRanges.ts`: `POSITION_CACHE_SIZE = 4` keyed by document identity. Check a large
      response body with many matches does not hold four full position arrays indefinitely.
    - `findQueryIsInvalid`: a half-typed `[` is zero matches, not an error. Confirm.
13. **Editor lifecycle (`MonacoHost.vue`).**
    - `onMounted` awaits `loadMonaco` then returns if `rootRef` is null. Check unmount during
      that await: `onUnmounted` has nothing to dispose yet, then the continuation creates an
      editor on a detached node or returns cleanly.
    - `scheduleLint` 400 ms timer captures `targetModel` and checks `isDisposed`. Check the timer
      is cleared on unmount.
    - `registerProviders` disposes and re-registers on language, completion or hover source
      change. Providers are global per language id and filtered by model. Two consoles on one
      language: check each provider answers only for its own model.
    - `applyExternalDoc` uses `pushEditOperations` with an `applyingExternal` flag. Check an
      external update mid-IME composition and that undo history stays sane.
14. **Browse and definition.**
    - `browse/state.ts` `load` supersedes by `loadSeq` but has no `runtime[tabId]` still-mounted
      guard. Check a load resolving after tab close recreates the runtime.
    - `ensureKeyTypes` dedupes with a pending set and `KEY_TYPES_BATCH_LIMIT = 200`. Check a
      failed batch clears its pending keys so a retry can happen.
    - `BrowseView.vue` registers `${tab.id}::preview` and unregisters on unmount. Part 10 §4.7
      asked whether other close paths leak; confirm from this side.
    - The browse Stop button is permanently `disabled`. Decide remove or wire.
    - `definition/structure.ts` `buildConstraintRows` dedupes FKs by name. Two FKs with one name
      on different tables (Postgres allows per-table names). Check.
    - `DefinitionView` "Open in console" and copy actions: check identifier quoting per dialect.
15. **Repo conventions.**
    - `<style>` blocks in 18 own files. Check each against CLAUDE.md's Tailwind rule; a block that
      styles Monaco or SlickGrid DOM is a real exception.
    - `ConsoleView.vue` Refresh and Stop are `:disabled` controls inside a plain `TooltipTrigger`
      (Run and Run all already use `TooltipDisabledTrigger`). Sweep the whole chunk (P105).
    - Every SFC is `<script setup lang="ts">`. One store, one concern:
      `useConsoleViewStore` holds run state, results, explain state, column widths and expanded
      docs. Decide whether column widths are a second concern.
    - `StreamView.vue` (1431), `DocumentView.vue` (1285), `ConsoleView.vue` (1109). Report a
      split only with a concrete seam, not size alone.
    - `beautify.ts` hand-rolls JSON and XML scanners. The named requirement is losslessness
      (a number reproduced byte for byte). Confirm the XML side has the same requirement, or name
      a library.
16. **Doc drift.** Check `docs/ARCHITECTURE.md`'s console, editor and stream sections against
    the code: explain flow, auto-explain limit, split options, resize handle count.
17. **Tests against CLAUDE.md's unit-test bar.** Splitter, linter, tokenizer, DDL parse, plan
    parsers and the console race specs qualify. Check `browse-key-types`,
    `document-byte-label` and `hover-value-caption` are not restated function bodies. Name a
    missing guard only where a finding's fix needs one (§4.1 tab close mid auto-explain, §4.2
    split/tokenize disagreement, §4.8 projection clear).

## 5. Watch items (pre-plan §5.10, verified)

- **Auto-explain races (stop, overlap, clobber, run-after-tab-close):** confirmed real, with two
  gaps the pinned specs may not cover. §4.1: no `runtime[tabId]` check between auto-explain and
  the real execute; the reconnect await lets two runs overlap; page-count slicing in
  `autoExplainCheck`.
- **Splitter and linter as parsers with interacting rules:** confirmed, and wider than two. Three
  lexers share `scanSqlSpan` and disagree on paren recovery and `$` in identifiers. Dialect gaps:
  `#` comments, `E''` strings, nested comments, `[ident]`, compound bodies, Mongo `//`. §4.2,
  §4.3 (history re-run), §4.4 (EXPLAIN isolation), §4.6 (format rejoin).
- **Stream view `KuiColumnResizeHandle` migration (P105):** premise corrected in §0 (4 handles,
  not 10). Cancel path leaves a live width stuck, plus listener teardown on unmount. §4.10. `KU`
  is editable now (§0).
- **Churn (`documents` 1,168, `stream` 1,098, `console` 866):** figures not re-derived; §1 gives
  current size.

## 6. Out of scope

- Generated code (`frontend/bindings`) and P110's `--color-muted` collision.
- Documented known open items: M5 correlation provenance, `maskedColumnRenamedOrHidden` view
  blind spot.
- **Part 10's `VS` fixes F1-F21.** Treat as correct. Do not re-flag.
- **Part 7's `SI/queryplan`.** Closed. A mirror defect found from the TS side is fixed on both
  sides in one commit (§0); review Go only for parity.
- **`ST/fixtures/mask/**`.** A6 contract. Read only.
- **`SF/state/**`, `SF/workbench/**`, `SF/theme/completion.ts`** (Part 12). Read for the
  contract. Same-stream later chunk, so a fixer may edit them (pre-plan §3.3).
- **`SF/views/httprequest`, `SF/views/grpcrequest`** beyond their `MonacoHost`/`beautify.ts`
  use. Reviewed elsewhere.
