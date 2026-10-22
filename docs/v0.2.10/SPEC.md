# v0.2.10

First phase `P322` (highest in `docs/HISTORY.md` is `P321`). Branch `v0.2.10`. Phases run top to bottom.

| # | Phase | Status |
|---|-------|--------|
| P322 | MCP required params enforced at the schema level. Parameters such as `database` that a tool needs must be required in the MCP tool input schema (and rejected with a clear error otherwise) so the AI builds the request correctly the first time. Audit every MCP tool (`dbmcp`, `agentmcp`, memory tools) for params that are optional in the schema but required in practice. | Done |
| P323 | SQL approval dialog. When the user approves an SQL command from the agent, show it formatted with syntax highlighting, in a much larger dialog. | Todo |
| P324 | UI polish bundle (simple changes, one Sonnet implementer, no separate plan). (a) Selection styling: selecting a cell, row or similar drops the border; the background change alone marks the selection. (b) Working indicators on Connect, Reconnect and Load buttons: show progress while a DB connection or load takes a while. (c) Automations: the Runs panel takes only half of the available space. (d) Update dialog: add a loading indicator (spinner, not a progress bar) to the installing state in `UpdateDialog.vue`, which has only text now. | Todo |
| P325 | Keep fetched data when a connection drops. Show the drop clearly (banner or status, plus the Reconnect button) while the already fetched data stays visible and selectable. Stale data cannot be edited or committed; no update can be triggered from it. | Todo |
| P326 | Pending changes show a real diff. In the SQL data view, a pending edit currently shows the new value as one long string; show before and after as a diff, like code. | Todo |
| P327 | Cell editor before/after diff. Highlight the change between the original and the edited value in the cell editor, as a code-style diff. | Todo |
| P328 | Code review, one round (Opus reviewer covering architecture, correctness, performance; then a Sonnet fixer) over everything changed since the last review session (v2.8 P319 close-out base `d61472b`, scope: P320 sweep and P322-P327). Runs last. | Todo |
| P329 | Close chapter v0.2.10 (fold per `CLAUDE.md`). Hold until user says to close. | Todo |

## Results

### P322

Added `llmprompts.RequireNonEmpty` (minLength/minItems). Wrapped 16 tool schemas: 5 dbmcp, 6 agentmcp, 5 memory. `run_query`/`explain_query` `path` now schema-required; handler refuses empty path on postgres, mysql, mariadb, mongodb. `finish_step` refuses empty `reason` on not-ok or `needs_input`. Flow test asserts the schema rejection over HTTP. Budgets raised: `dbmcp.instructions` 1500, `finish_step` reason 80. Real `claude` tests not run.

### P323

Approval dialog now `2xl` fixed-height. New `ApprovalStatement.vue`: read-only `MonacoHost` (new `forceWrap` prop), `formatConsoleText` via `computedAsync` (worker over `INLINE_CHARS`), Formatted / As sent toggle hidden when nothing formats. `consoleLanguageFor` moved to `format.ts`. Deny keeps initial focus via `data-dialog-initial`. UI specs `dbmcp-approval`, `copy-coverage`, `prompts` pass.
