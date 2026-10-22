# v0.2.10

First phase `P322` (highest in `docs/HISTORY.md` is `P321`). Branch `v0.2.10`. Phases run top to bottom.

| # | Phase | Status |
|---|-------|--------|
| P322 | MCP required params enforced at the schema level. Parameters such as `database` that a tool needs must be required in the MCP tool input schema (and rejected with a clear error otherwise) so the AI builds the request correctly the first time. Audit every MCP tool (`dbmcp`, `agentmcp`, memory tools) for params that are optional in the schema but required in practice. | Done |
| P323 | SQL approval dialog. When the user approves an SQL command from the agent, show it formatted with syntax highlighting, in a much larger dialog. | Todo |
| P324 | UI polish bundle (simple changes, one Sonnet implementer, no separate plan). (a) Selection styling: selecting a cell, row or similar drops the border; the background change alone marks the selection. (b) Working indicators on Connect, Reconnect and Load buttons: show progress while a DB connection or load takes a while. (c) Automations: the Runs panel takes only half of the available space. (d) Update dialog: add a loading indicator (spinner, not a progress bar) to the installing state in `UpdateDialog.vue`, which has only text now. | Done |
| P325 Part 1 | Keep fetched data when a connection drops: shared stale-data foundation (stale predicate, session stamps, drop banner) plus the SQL data view. Data stays visible and selectable; banner plus Reconnect; stale data cannot be edited or committed. | Done |
| P325 Part 2 | Keep fetched data when a connection drops: Documents, KeyValue (tab and browse preview) and Browse. Same banner, Reconnect and write lockout; immediate writes refused from stale data. | Todo |
| P325 Part 3 | Keep fetched data when a connection drops: Stream, Definition and Console result grids. Same banner and Reconnect; Stream writes locked; Definition and Console have no write path on shown data. | Todo |
| P326 | Pending changes show a real diff. In the SQL data view, a pending edit currently shows the new value as one long string; show before and after as a diff, like code. | Todo |
| P327 | Cell editor before/after diff. Highlight the change between the original and the edited value in the cell editor, as a code-style diff. | Todo |
| P328 | Code review, one round (Opus reviewer covering architecture, correctness, performance; then a Sonnet fixer) over everything changed since the last review session (v2.8 P319 close-out base `d61472b`, scope: P320 sweep and P322-P327). Runs last. | Todo |
| P329 | Close chapter v0.2.10 (fold per `CLAUDE.md`). Hold until user says to close. | Todo |

## Results

### P322

Added `llmprompts.RequireNonEmpty` (minLength/minItems). Wrapped 16 tool schemas: 5 dbmcp, 6 agentmcp, 5 memory. `run_query`/`explain_query` `path` now schema-required; handler refuses empty path on postgres, mysql, mariadb, mongodb. `finish_step` refuses empty `reason` on not-ok or `needs_input`. Flow test asserts the schema rejection over HTTP. Budgets raised: `dbmcp.instructions` 1500, `finish_step` reason 80. Real `claude` tests not run.

### P323

Approval dialog now `2xl` fixed-height. New `ApprovalStatement.vue`: read-only `MonacoHost` (new `forceWrap` prop), `formatConsoleText` via `computedAsync` (worker over `INLINE_CHARS`), Formatted / As sent toggle hidden when nothing formats. `consoleLanguageFor` moved to `format.ts`. Deny keeps initial focus via `data-dialog-initial`. UI specs `dbmcp-approval`, `copy-coverage`, `prompts` pass.

### P324

(a) Removed grid selection perimeter: `selectionEdges.ts`, `refreshSelEdges` in both Slick hosts, `sel-*` flags, box-shadow CSS. Fill alone marks selection. Tree/list rows already background-only. Proto grid (`frontend/proto`) still draws edges, left as prototype. (b) `useConnectionGate` exposes `reconnecting`; 6 Reconnect-and-load buttons use `pending` spinner. Console refresh icon button has no `pending` support, unchanged. (c) Panel root `h-full`; runs list cap `max-h-72` to `max-h-[50vh]`. Not seen rendered. (d) `Spinner` in installing state.

### P325 Part 1

New `state/staleData.ts` (`useStaleDataStore`: `stamp`, `isStale`, cleanup on tab close), `tabNeedsReconnect` in `useConnectionGate.ts`, `views/shared/StaleDataStrip.vue`, `writeDisabledReason(…, stale)`, `connection-lost` dock reason. `KEEPS_DATA_ON_DROP` in `tabs.ts` holds `'data'`. Grid stamps each read; `gridViewStore.isStale` gates `DataView`, `DataToolbar`, `SlickGridHost` (edit, paste, menus, insert inputs, dock) and `GenerateDataDialog`. Staged edits survive; Discard stays enabled. Deviation: `description` copy split into two sentences (copy check C6 rejects lowercase after the dash). New spec `grid-connection-drop`; listed UI specs pass (50). Real `claude` tests not run.
