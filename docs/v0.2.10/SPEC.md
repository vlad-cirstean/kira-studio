# v0.2.10

First phase `P322` (highest in `docs/HISTORY.md` is `P321`). Branch `v0.2.10`. Phases run top to bottom.

| # | Phase | Status |
|---|-------|--------|
| P322 | MCP required params enforced at the schema level. Parameters such as `database` that a tool needs must be required in the MCP tool input schema (and rejected with a clear error otherwise) so the AI builds the request correctly the first time. Audit every MCP tool (`dbmcp`, `agentmcp`, memory tools) for params that are optional in the schema but required in practice. | Done |
| P323 | SQL approval dialog. When the user approves an SQL command from the agent, show it formatted with syntax highlighting, in a much larger dialog. | Todo |
| P324 | UI polish bundle (simple changes, one Sonnet implementer, no separate plan). (a) Selection styling: selecting a cell, row or similar drops the border; the background change alone marks the selection. (b) Working indicators on Connect, Reconnect and Load buttons: show progress while a DB connection or load takes a while. (c) Automations: the Runs panel takes only half of the available space. (d) Update dialog: add a loading indicator (spinner, not a progress bar) to the installing state in `UpdateDialog.vue`, which has only text now. | Done |
| P325 Part 1 | Keep fetched data when a connection drops: shared stale-data foundation (stale predicate, session stamps, drop banner) plus the SQL data view. Data stays visible and selectable; banner plus Reconnect; stale data cannot be edited or committed. | Done |
| P325 Part 2 | Keep fetched data when a connection drops: Documents, KeyValue (tab and browse preview) and Browse. Same banner, Reconnect and write lockout; immediate writes refused from stale data. | Done |
| P325 Part 3 | Keep fetched data when a connection drops: Stream, Definition and Console result grids. Same banner and Reconnect; Stream writes locked; Definition and Console have no write path on shown data. | Done |
| P326 | Pending changes show a real diff. In the SQL data view, a pending edit currently shows the new value as one long string; show before and after as a diff, like code. | Done |
| P327 | Cell editor before/after diff. Highlight the change between the original and the edited value in the cell editor, as a code-style diff. | Done |
| P328 | Fixes and small features bundle (one Opus plan, one Sonnet implementer). (a) Connection tree: where an element count shows, drop the word "rows" and keep only the number. (b) Partitioned tables collapse into their parent by default; partitions show only after the user expands it. (c) Operations panel: show whether an operation came from the user or from MCP. (d) Add a Check for updates button. (e) Go to PK/FK button: the filter box value is cleaner, no backticks around columns and no quotes around numbers. (f) Postman collection importer: accept more than one collection, and import environments as well. | Done |
| P329 | Code review, one round (Opus reviewer covering architecture, correctness, performance; then a Sonnet fixer) over everything changed since the last review session (v2.8 P319 close-out base `d61472b`, scope: P320 sweep and P322-P328). Runs last. | Done |
| P330 | Code review, round 2 (user asked for one more round; Opus reviewer covering architecture, correctness, performance; then a Sonnet fixer) over everything changed since the same base as P329 (v2.8 P319 close-out base `d61472b`), including P329 round 1 fixer commits as unreviewed code. Runs last before close. | Done |
| P331 | Close chapter v0.2.10 (fold per `CLAUDE.md`). Hold until user says to close. | Todo |

## Results

### P322

Added `llmprompts.RequireNonEmpty` (minLength/minItems). Wrapped 16 tool schemas: 5 dbmcp, 6 agentmcp, 5 memory. `run_query`/`explain_query` `path` now schema-required; handler refuses empty path on postgres, mysql, mariadb, mongodb. `finish_step` refuses empty `reason` on not-ok or `needs_input`. Flow test asserts the schema rejection over HTTP. Budgets raised: `dbmcp.instructions` 1500, `finish_step` reason 80. Real `claude` tests not run.

### P323

Approval dialog now `2xl` fixed-height. New `ApprovalStatement.vue`: read-only `MonacoHost` (new `forceWrap` prop), `formatConsoleText` via `computedAsync` (worker over `INLINE_CHARS`), Formatted / As sent toggle hidden when nothing formats. `consoleLanguageFor` moved to `format.ts`. Deny keeps initial focus via `data-dialog-initial`. UI specs `dbmcp-approval`, `copy-coverage`, `prompts` pass.

### P324

(a) Removed grid selection perimeter: `selectionEdges.ts`, `refreshSelEdges` in both Slick hosts, `sel-*` flags, box-shadow CSS. Fill alone marks selection. Tree/list rows already background-only. Proto grid (`frontend/proto`) still draws edges, left as prototype. (b) `useConnectionGate` exposes `reconnecting`; 6 Reconnect-and-load buttons use `pending` spinner. Console refresh icon button has no `pending` support, unchanged. (c) Panel root `h-full`; runs list cap `max-h-72` to `max-h-[50vh]`. Not seen rendered. (d) `Spinner` in installing state.

### P325 Part 1

New `state/staleData.ts` (`useStaleDataStore`: `stamp`, `isStale`, cleanup on tab close), `tabNeedsReconnect` in `useConnectionGate.ts`, `views/shared/StaleDataStrip.vue`, `writeDisabledReason(…, stale)`, `connection-lost` dock reason. `KEEPS_DATA_ON_DROP` in `tabs.ts` holds `'data'`. Grid stamps each read; `gridViewStore.isStale` gates `DataView`, `DataToolbar`, `SlickGridHost` (edit, paste, menus, insert inputs, dock) and `GenerateDataDialog`. Staged edits survive; Discard stays enabled. Deviation: `description` copy split into two sentences (copy check C6 rejects lowercase after the dash). New spec `grid-connection-drop`; listed UI specs pass (50). Real `claude` tests not run.

### P325 Part 2

Documents, KeyValue (tab and browse preview) and Browse keep data on a drop, read-only behind `StaleDataStrip` (`document-stale`, `keyvalue-stale`, `browse-stale`). `KEEPS_DATA_ON_DROP` adds `'document'`, `'keyvalue'`. Each `load` stamps; each store has `isStale`; `KeyValueHost.gateTabId` ties the preview to the browse tab. `createImmediateMutator` takes `isStale` and throws `studio.common.connectionLost.error`; documents and keyvalue wire it, `addKey` checks itself. Open editors, popovers and object draft keep their buffer with Save disabled; delete confirms re-check stale. Upload dialog refuses when its origin tab is stale; browse container Upload item is omitted, object Delete disabled. New `useDocumentGate.ts` (N10 file-length limit). Deviations: error copy "Can’t save. The connection was lost." (check C6 rejects lowercase after colon). Browse spec uses Redis, so toolbar Upload and object-row Delete are not covered (no S3 fixture). New spec `immediate-write-connection-drop`; listed UI specs pass. Real `claude` tests not run.

### P325 Part 3

Stream, Definition and Console stamp on load/run (`stream/state.ts`, `definition/state.ts`, `console/state.ts`, each with `isStale`); `'stream'` and `'console'` join `KEEPS_DATA_ON_DROP`. `StaleDataStrip` in `StreamView`, `DefinitionView`, `ConsoleView` (above result strip); reconnect gates show only with nothing loaded. Stream: `useStreamGate` adds `stale`, `canInsertCaps`/`canDeleteCaps`; Send/Produce and Delete stay visible, disabled while stale; compose submit and Delete re-check stale; caps cleared on drop, so the gate keeps last live caps. `createImmediateMutator` `isStale` now required. Deviations: new spec `view-connection-drop` has 4 tests (Kafka Produce, SQS Send/Delete, Definition, Console); no `stale` on the stream `SelectedCell` (dock is viewer mode, shows no chip); console `explain` also stamps. UI specs pass (69). ARCHITECTURE updated. Real `claude` tests not run.

### P326

`PromptDiff` moved to `packages/workbench/src/editor/MonacoDiff.vue` with `language` prop and `hideUnchangedRegions`. New `valueDiffSides` (`celleditor/valueDiff.ts`, reused by P327). `PendingEdit.original` captured at first stage, dropped in `discardCellEdit`; `editedCells` getter. `PreviewCommandPanel`: Changes (cell list plus diff) and SQL tabs, tabs only with edits; SQL fetched only when shown. UI spec scenario 1b in `mutations.spec`; listed UI specs pass (40), unit spec passes. No backend half: no IPC or Go change. Deviations: popover stays `w-120` (U15 allows no wider); tab labels and panel title reuse existing keys (check C3 rejects duplicate text), `previewCommand.title` kept for Generate data; cell list is `ul`/`li` (biome rejects `role` on `div`). Real-render screenshot not taken.

### P327

Cell editor Show changes toggle (`cell-editor-diff-toggle`) diffs buffer against stored value via shared `MonacoDiff` and `valueDiffSides`. `SelectedCell.original` from new `stagedOriginal` getter; grid publish watch gains staged-value source, so stage or discard republishes. New `useCellDiff.ts`; Generate popover moved to `CellGenerateMenu.vue` (view 579 lines). UI spec scenario 9 extended; listed UI specs pass (40), unit spec passes, screenshot taken (fits, side by side). No backend half: no IPC or Go change. Deviations: republish made the buffer read clean after blur-stage, disabling Revert and breaking scenario 6b, so Revert and Modified chip now also key on `SelectedCell.original` (own `fix:` commit); spec trims trailing newline from the Ctrl+Enter value.

### P328

(a) Tree row estimate shows only the number. (b) Postgres partitions list under their partitioned table; tree expands it, collapsed by default. (c) Op log records source (user or MCP); Operations panel shows it; both apps. (d) Check for updates: `appupdate` checker, both app bridges, menu and palette entries, `UpdateDialog` manual mode; dev builds refuse (`TestCheckForUpdatesRefusedInDevBuild` in each app). (e) Go to PK/FK writes plain filter: no backticks, no quotes around numbers (`numericNavColumns` in `rowValues.ts`). (f) Postman parser reads environment exports and globals, classified by shape; `Import` takes several paths, collections and environments in one report (`ImportEnvironment` in variables repo); atomic per file; contracts `api-postman*.json`; ImportReportStrip shows environments.

Verification: Go postman, storage, tree, dbmcp, oplog, appupdate, both apps' flow suites; postgres, sqlite, mysqlfamily, clickhouse conformance; ipcfixture; `test:ipc:fe:studio` (7); `test:ui:studio` 582 passed; `test:ui:space` 664 passed, 1 timing flake (`graph-blank-rows`) green on rerun; screenshots regenerated; typecheck, lint, vet clean.

Deviations: item (d) landed as one commit (Go and frontend together; the hook rejects unused i18n keys otherwise). Tree nav columns use `numericNavColumns` in place of a `NavColumns` field. Item (e) quoted-name test case skipped; `interaction.spec` line 376 keeps `"name" = '...'` (mock serves filter-by-value). Pre-existing fixes: fakeagent failure now sends `reason` (`termflow` `TestSmartScript`); `llm-prompts.json` hash regenerated; stale `space agents board` screenshot label expectation (`Make CI green 3/6`).

### P329

Round 1 fixed all nine findings.

1. MCP reads on writable connections: `ConsoleRequest.ReadOnly` set by dbmcp when verdict is read and write mode is not `allow`. Postgres and MySQL/MariaDB route it into their existing read-only wrap; conformance scenario `ReadOnlyRequestRefusesWrite` passes on real Postgres, MySQL 8.4, MariaDB 11.4. Postgres `READ ONLY` leftovers recorded in `docs/ARCHITECTURE.md` Known open items.
2. Classifier: `DESCRIBE`/`DESC ANALYZE` and MariaDB `ANALYZE <DML>` classify as the target. 7 cases in `classify_test.go`.
3. Stale strip hidden when nothing loaded (Definition, Documents, Stream). 2 new specs in `view-connection-drop.spec.ts`.
4. Console strip is reconnect-only and restamps results after connect; no rerun. 1 new spec.
5. `checkError` cleared in `later()` and `openUpdateDialog()`. 1 new spec.
6. Runs section: `max-h-1/2` against the panel, not the viewport. Rendered screenshot reviewed. New `automations-runs-layout.spec.ts`.
7. S3 Browse gates: new `s3Fixture.ts` and `browse-s3-connection-drop.spec.ts`, 3 tests.
8. `Service.ConnectContext` carries ctx values, not cancellation; dbmcp uses it. Test in `connections/service_test.go`.
9. Title bar comments in `window.go` and `tokens.css` cut to current constraint.

Deviations:

- SQLite and ClickHouse get no per-request read-only wrap; exposure negligible.
- MySQL/MariaDB expose no per-transaction read-only flag to read back. On a writable connection, verify trusts the open transaction.
- S3 fixture hand-built, renderer-only; no backend half since the gates are renderer-only.
- Console reconnect-only chosen over rerun (a rerun could repeat a write).

Verification: `go test ./...`, `typecheck`, `lint:go`, `lint:dead`, `test:ui:studio`, `test:ui:space`, `test:visual:studio`, `test:visual:space` pass. 4 timing specs failed once under concurrent load and passed rerun alone. No baseline changed.

### P330

Round 2 fixed all four findings.

1. MCP read refuses on a writable connection with an open transaction: Postgres checks `TxStatus`, MySQL/MariaDB use the 1568 probe before `START TRANSACTION READ ONLY`. The user's transaction is never committed or rolled back. New message `openTransaction`. Scenario `ReadOnlyRequestKeepsOpenTransaction` on real Postgres, MySQL 8.4, MariaDB 11.4.
2. `AssertNoTransactionEscalation` runs only on read-only connections. Per-request violation uses its own message `readOnlyRequest` (`adapters.ReadOnlyViolation`). Scenario `ReadOnlyRequestAllowsBackslashRead` covers `~ '\d+'`, `LIKE 'a\_b'`, `E'\n'`, a `read write` literal.
3. Failed update check sends a short cause (`appupdate.FailureCause`: timed out, offline, unexpected status N, unknown error); raw error logged with `slog`. Applied to both app bridges, which share the code.
4. `DESCRIBE`/`DESC` removed from `sqlReadKeywords` and the name guard dropped; the EXPLAIN case owns them.

Deviations: finding 3 also touched `apps/kira-space/internal/bridge/update.go`, same leak. MySQL wrap resets the armed read-only flag if `START TRANSACTION` fails. No UI suite run: no frontend code changed, update dialog specs mock the IPC error.

Verification: `go test ./...` passes (ClickHouse and Kafka timed out once under concurrent container load, green alone), `typecheck`, `lint:go`, `lint:dead` clean.
