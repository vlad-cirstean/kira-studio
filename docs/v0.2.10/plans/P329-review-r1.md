# P329 review round 1 findings

Base `d61472b` (v2.8 P319 close-out). Scope `git diff d61472b..HEAD`, HEAD `9c420fe42`: P320 comment sweep, P322-P328, plus the rebased-in `9aa86034c` (macOS title bar) and two lint fixes. One Opus reviewer, three dimensions. Findings only, ranked by severity. Nine findings.

## Scope checks with no finding

- P320 sweep is code-neutral. Go: every modified `.go` file in `d61472b..5d2c3d482` parsed old and new with comments dropped; 768 files, 7 AST diffs, all from named non-sweep commits (git 2.55 credential tests, flowharness re-pull, docshistory ledger). TS/Vue: `transpileModule` with `removeComments` plus template comment strip; 832 files, 1 diff (`CellEditorView.vue`, the pane-title line-height fix). No `#__PURE__`, `biome-ignore`, `@ts-*` or `go:` directive removed.
- P322 `RequireNonEmpty`: panics on a misnamed or non-required property, so a wiring slip fails at startup. No issue.
- P323 approval dialog: `Dialog` keys on `requestId`, so `computedAsync` cannot show request A's formatted text while B is pending. Dismissed.
- P326/P327 diff: `original` captured from the page cell at first stage; truncated cells are non-editable, so no truncated "before". The `actionsBuffer.isDirty` override only gates Revert and the Modified chip. No issue.
- P328 (a), (e), (f): bare identifiers quote anything outside `^[a-z_][a-z0-9_]*$` or reserved, so mixed-case Postgres columns stay quoted. `ImportEnvironment` is one transaction; duplicate keys resolve first-wins like existing scopes. No issue.
- P328 (b) partitions: tree search flags `incomplete` for unexpanded nodes, and `revealPath` falls back to the parent. No issue.

## 1. High: MCP reads run with full write privileges on a non-read-only connection

`apps/kira-studio/internal/dbmcp/tools.go:217-223` executes a `ClassRead` statement with no read-only request. The adapter wrap only runs when the connection itself is `ReadOnly`: `postgres/console.go:239-256` (`BEGIN READ ONLY`), `mysqlfamily/console.go:211-226` (`START TRANSACTION READ ONLY`), `sqlite/client.go:98-104` (`_query_only`), `clickhouse/query.go:61-72` (`readonly=2`). `classify.go:9-12` documents that `SELECT write_function()` classifies read. Default modes are read allow, write prompt, DDL deny (migration 0021).

Failure: connection not marked read-only, defaults untouched. An MCP client sends `SELECT purge_orders()` (a `VOLATILE` plpgsql function doing `DELETE`), or on MySQL `SELECT f()` where `f` writes. The statement classifies read, verdict allow, no prompt, rows deleted. The user configured "ask me about every write" and was never asked.

Per engine:
- Postgres: function bodies, `nextval`, `setval`, `lo_unlink`, `pg_terminate_backend`, `set_config(..., false)` on the pooled session, `dblink_exec` all run. `BEGIN READ ONLY` would block function-body DML, `nextval`/`setval` and `lo_*`, but not `pg_terminate_backend`, `pg_cancel_backend` or `dblink_exec`.
- MySQL/MariaDB: stored functions that write run; `GET_LOCK` holds a lock on a pooled session. `START TRANSACTION READ ONLY` blocks non-temporary-table writes.
- SQLite: no built-in write-capable function reachable from `SELECT` (modernc, no extension loading registered). Exposure negligible.
- ClickHouse: `SELECT` has no write-capable function; `INSERT INTO FUNCTION` and `INTO OUTFILE` already classify write. Exposure negligible.

Fix direction: give `model.ConsoleRequest` a per-request read-only flag. Set it from dbmcp whenever the verdict came from `ClassRead` and the write mode is not `allow`, and route it into each adapter's existing wrap. Add a Known open items entry in `docs/ARCHITECTURE.md` for what `READ ONLY` still lets through on Postgres. The gap is real, current and absent from Known open items today.

## 2. Medium: `DESCRIBE ANALYZE` and MariaDB `ANALYZE` execute DML past the classifier

`apps/kira-studio/internal/adapters/classify.go:49` lists `DESCRIBE`/`DESC` as plain reads; `:173` returns `ClassRead` before the `EXPLAIN` branch at `:175` ever runs. MySQL 8.0.18+ accepts `{EXPLAIN | DESCRIBE | DESC} ANALYZE`, which executes its target, including multi-table `UPDATE` and `DELETE`.

Failure (MySQL, defaults): `DESCRIBE ANALYZE DELETE o FROM orders o JOIN users u ON u.id = o.user_id` classifies read, runs without a prompt and deletes rows. `classify_test.go:79-80` only covers `DESCRIBE t`.

MariaDB: `ANALYZE <DELETE|UPDATE|SELECT>` executes its statement. The leading `ANALYZE` is a DDL keyword (`classify.go:42`), so with DDL set to allow and write set to prompt, `ANALYZE DELETE FROM t` skips the write prompt.

Fix direction: treat `DESCRIBE`/`DESC` followed by `ANALYZE` like `EXPLAIN ANALYZE`, classifying the target. Treat a leading `ANALYZE` followed by a DML verb as the target's class. Add the cases to `classify_test.go`. Finding 1's read-only wrap would back this up, but the classifier must not depend on it.

## 3. Medium: stale strip and reconnect empty state render together

`StaleDataStrip` is shown on `stale`, and `isStale` is true whenever `tabNeedsReconnect` is (`state/staleData.ts:17`). The reconnect empty state shows on `needsReconnect && !<data>`. Nothing excludes one from the other in:
- `views/definition/DefinitionView.vue:365-372` (strip, then `EmptyState v-if="needsReconnect && !rt?.definition"`)
- `views/documents/DocumentView.vue:367-368` and `:398-399`
- `views/stream/StreamView.vue:105-106` and `:134-135`

Grid (`grid/DataView.vue:342-361`, strip inside `v-else`), Browse (`stale && !showGate`), KeyValue (inside `v-else`) and Console (`stale && hasResults`) guard correctly.

Failure: on app launch, every restored Definition, Documents or Stream tab is unhydrated. It shows a "connection was lost" warning strip with a Reconnect button above a second, full-size reconnect empty state. Nothing was lost; nothing was ever loaded. The P325 Part 3 result claims "reconnect gates show only with nothing loaded", but the strip still shows then. No UI spec asserts the strip is absent on an unloaded tab.

Fix direction: gate each strip on "data shown", as Console and Browse do (`stale && hasPage` or `stale && rt?.definition`), and add that negative assertion to `view-connection-drop.spec.ts`.

## 4. Medium-low: Console stale strip never clears after Reconnect

`views/console/ConsoleView.vue:47` calls `useConnectionGate(() => props.tab)` with no `onLoad`. The strip at `:436-440` wires its "Reconnect and load" button to that `onReconnectAndLoad` (`views/shared/useConnectionGate.ts:52-67`).

Failure: the connection drops with results shown. The user presses the strip's Reconnect and load. The connection comes back, but nothing reruns, so the results keep the old session stamp and `isStale` stays true. The strip stays up saying the connection was lost, while the toolbar shows connected. A second press does nothing. Only rerunning the statement clears it. The same applies when any other view reconnects the connection.

Fix direction: either give the console strip a reconnect-only label and clear the stale state once connected (results stay read-only output), or pass an `onLoad` that reruns the last statement. A rerun is risky for a write, so prefer the first option.

## 5. Medium-low: a failed manual update check sticks to the dialog

`packages/workbench/src/state/createAppUpdateStore.ts:106-128`: `checkError` is reset only at the start of `checkForUpdates`. `later()` resets `checkRequested` but never `checkError`. `UpdateDialog.vue:30` ranks `checkFailed` above every state except installing and checking.

Failure: a menu check fails offline, and the user closes the dialog. Later, the background poll finds a release and the router raises the update popup, or the user clicks the status-bar item. The dialog opens with "check failed" and no Update button, though the update is available.

Fix direction: clear `checkError` (and `checkRequested`) in `later()` and whenever the dialog opens by any route other than `checkForUpdates`. Add a UI spec step: fail, close, then become available, and expect the available state.

## 6. Low-medium: Runs section still capped at half, against the viewport

`packages/workbench/src/automations/runs/RunsSection.vue:54` keeps the section `shrink-0`, and `:63` caps the list at `max-h-[50vh]`. The P324 (c) ask was that the Runs panel takes only half of the available space; the fix replaced an 18rem cap with a half-viewport cap. The result section records "Not seen rendered", confirming the open concern.

Failure: with many runs and few scripts, the script list (`flex-1`) still holds the empty upper half and Runs stops at 50vh. In a short panel (a split sidebar, or a small window where the panel is under 50vh), the `shrink-0` section can exceed the panel height. The script list then collapses to zero and the Runs list overflows the panel bottom, since the root has no overflow clip.

Fix direction: size against the panel, not the viewport. For example, make the open Runs section `flex-1 min-h-0` sharing space with the script list (or `basis-1/2 grow`), drop the `vh` cap, then take a real-render screenshot to confirm.

## 7. Low: S3 Browse stale paths have no test

The P325 Part 2 spec `tests/ui/immediate-write-connection-drop.spec.ts` drives Redis only (`:3-5`, `:17`). Untested S3-only stale gates: toolbar Upload disabled (`views/browse/BrowseView.vue:265-269`), container Upload menu item omitted (`views/browse/menu.ts:50`), object Delete disabled and re-checked on confirm (`menu.ts:112`, `:130`), and `workbench/UploadObjectDialog.vue:91` refusing a stale origin tab. The result section cites "no S3 fixture".

Failure: a regression in any of those four gates lets an upload or delete go through from a listing of a dropped session, and no spec fails. CLAUDE.md requires every new feature to be tested on both sides of the IPC boundary.

Fix direction: add an S3 IPC fixture (or extend the mock runtime) and cover the four gates in the UI spec.

## 8. Low: MCP-started connect and preconnect ops are logged as the user's

`apps/kira-studio/internal/dbmcp/access.go:53-58` calls `s.cfg.Conns.Connect(connectionID)` with no context. `connections/service.go:804` builds the connect context from `context.Background()`, so `adapterhost.OpSourceOf` (`adapterhost/opsource.go:19-24`) answers `user` for the resulting `connect` and `preconnect` ops.

Failure: an MCP `run_query` against a disconnected connection auto-connects it and runs its pre-connect script. The Operations panel shows both ops as user-started, against P328 (c)'s "whether an operation came from the user or from MCP". The pre-connect script is exactly the op a user would want attributed.

Fix direction: thread `ctx` through `connectForQuery` into a `ConnectContext(ctx, id)` variant (or carry the source in the connect request) so `WithOpSource` reaches `RunOp`.

## 9. Low: macOS title-bar comments contradict the new code

`9aa86034c` switched `internal/shell/window.go:96-103` to `MacTitleBar{UseToolbar: true, ToolbarStyle: MacToolbarStyleUnifiedCompact, ...}`. The comment above it (`:82-93`) still says `UseToolbar: true` "was the source of this session's whole title-bar saga" and that `Hidden` was chosen. `packages/theme/src/tokens.css:77-97` still says the bar sits "on top of `Mac.TitleBarHidden`" and that `--kira-titlebar-h` is "loosely coupled ... via `--kira-bar-h`". It is now a literal `38px`.

Failure: the next person tuning the bar reads guidance written for the opposite layout mode. Per CLAUDE.md's comment rule, cut both down to the current constraint: the toolbar style chosen, and that `38px` matches it on a real Mac.
