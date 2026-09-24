# P108 Part 11 — Studio console, editor and per-kind views review findings

Scope: `views/console/**`, `editor/**`, `views/documents/**`, `views/stream/**`, `views/browse/**`,
`views/definition/**`, the shared SQL lexers in `packages/shared/domain/sql-{lex,split,lint,tokens}.ts`,
`packages/kira-ui/src/KuiColumnResizeHandle.vue`, and the Go mirror `internal/queryplan`. Plan:
`P108-part11-studio-console-editor.md`. Review only; fixer applies each finding as its own commit.
Paths are relative to `apps/kira-studio/frontend/src/` unless they start with `apps/`, `docs/` or
`packages/`. Stream B is closed, so `packages/kira-ui` is editable by the fixer. Items already in
`docs/ARCHITECTURE.md` Known open items are not re-reported.

"Verified" means reproduced in a scratch bun replica that imports the real modules. "Code-read"
means traced through the source only.

Severity count: 3 High, 8 Medium, 6 Low.

## F1 (High) — Closing a console tab during auto-explain still runs the statement

Sites:
- `views/console/state.ts:415` (`await autoExplainCheck(...)`)
- `views/console/state.ts:437` (post-await guard checks only `rt.opId !== opId || rt.status !== 'running'`)
- `views/console/state.ts:250-262` (tab cleanup releases results and deletes `runtime[tabId]`; cancels nothing)
- `views/console/state.ts:456` (the `!runtime[tabId]` check exists only after the real execute)
- `packages/workbench/src/state/createTabsStore.ts:386-412`, `state/tabs.ts:146-150` (tab close cancels no op)
- `apps/kira-studio/internal/adapterhost/data.go:199-227` (`Execute` has no tab-liveness check)

Bug: cleanup deletes `runtime[tabId]` but `run()` holds `rt`, the detached object. Its `opId` and
`status` are unchanged, so the guard at `:437` passes and `data.execute` fires for a closed tab.
The result is then dropped at `:456`.

Reachable (code-read): connection with auto-explain on. Run a slow SELECT or any DML. Close the tab
while the EXPLAIN is in flight. The real statement still executes server-side. Without auto-explain,
closing the tab mid-execute also leaves a long server-side query running, since nothing cancels
`rt.opId`.

Fix:
- Add `if (!runtime[tabId]) return;` right after the auto-explain await, beside the `:437` check.
- In the cleanup callback, cancel `rt.explainOpId` and `rt.opId` when set (same call `stop()` uses),
  then set `status` to `'idle'` before the delete.
- Extend `tests/unit/console-run-after-tab-close.spec.ts` with the auto-explain await case (ordering
  and cancellation meet the CLAUDE.md bar).

## F2 (High) — Explain on Postgres can execute a merged second statement

Sites:
- `views/console/explain.ts:9-14` (`isExplainable`: leading comment strip, then `/^(SELECT|WITH)\b/i`)
- `views/console/explain.ts:30` onward (`explainStatementsFor` prefixes `EXPLAIN (...)` to the whole text)
- `views/console/state.ts:188-236` (`autoExplainCheck`), `:535-581` (`explain()`)
- `views/console/ConsoleView.vue:224-232`, `:240-245`, `:442-451` (Explain reads `statementAtCursorText`)
- `apps/kira-studio/internal/adapters/postgres/query.go:34-36` (`QueryExecModeSimpleProtocol`)
- Go mirror: `apps/kira-studio/internal/queryplan/statements.go:11-21` (`Explainable`), `:28-44`

Bug: Explain safety rests on the splitter. When the splitter merges `SELECT …; DELETE …` into one
statement (see F4: `E'it\'s'`, a `$` inside an identifier), `isExplainable` sees a leading SELECT and
passes. The composed text is `EXPLAIN (…) SELECT …; DELETE …`. Postgres simple protocol runs every
command in one Query message, so the DELETE executes. With auto-explain on, it runs once during the
check and again in the real run.

Reachable (verified split, code-read execution): `SELECT E'it\'s'; DELETE FROM t; SELECT 'x';` splits
to one statement. The lint reports only "unterminated string literal". Press Explain with the caret
on the SELECT, on a writable connection. A read-only connection's `BEGIN READ ONLY` wrap blocks it.

The Go dbmcp path is already safe. `adapters.ClassifySQL` returns `ClassUnknown` for any raw `;`
(`internal/adapters/classify.go:145-148`), and `planFor` runs it on every composed statement
(`internal/dbmcp/explain.go:116-129`, `:143`).

Fix:
- In `isExplainable`, strip one trailing `;` and reject any remaining raw `;`, mirroring
  `ClassifySQL`'s embedded-semicolon guard. It runs on raw text, so no lexer can fool it. A `;` inside
  a string literal costs a disabled Explain button, never a write.
- Mirror the same rule in `queryplan.Explainable` in the same commit. Keep
  `tests/fixtures/explain-plans` and `explain-plan.spec.ts`/`parse_test.go` green. Add one case per
  port for `SELECT 1; DELETE FROM t`.
- Auto-explain then skips the merged statement on its own, since it filters with `isExplainable`.

## F3 (High) — Run statement picks the next statement when the caret sits after `;`

Sites:
- `packages/shared/domain/sql-split.ts:68-78` (`statementAtCursor`: `cursor >= s.start && cursor <= s.end`, else last)
- `packages/shared/domain/sql-split.ts:34-65` (`stmtStart` set just past `;`; `end` excludes the `;`)
- `views/console/ConsoleView.vue:224-232` (`statementAtCursorText`, same rule, used by Explain)
- `views/console/ConsoleView.vue:351-365` (`runStatement`)

Bug: a caret right after a statement's `;`, or on the blank line between two statements, resolves to
the following statement. That is where the caret lands after typing `;` or pressing End.

Reachable (verified): `SELECT 1;\n\nDELETE FROM t;\n`. Caret at offset 9, right after `SELECT 1;`.
`statementAtCursor` returns `DELETE FROM t`. Ctrl+Enter runs the DELETE. A caret on the blank line
also picks the DELETE. `sql-split.spec.ts` 10a/10b cover only part of this and pin nothing about the
position just after `;`.

Fix: attribute the position just after `;`, and trailing whitespace up to the next statement's first
non-space character, to the preceding statement. Do it once in `statementAtCursor` and make
`statementAtCursorText` call it (it is already a scan over the cached split). A spec for the three
positions (after `;`, blank line between, trailing whitespace at EOF) meets the bar: boundary
arithmetic.

## F4 (Medium) — Splitter misses several dialect lexical forms

Sites:
- `packages/shared/domain/sql-lex.ts:82-89` (`scanDollarQuote` at every `$`), `:96` onward (`scanSqlSpan`)
- `views/shared/sqlIdent.ts` (`backslashEscapesFor`, `dollarQuotingFor`: `undefined` returns true for both)
- Callers: `ConsoleView.vue:214-217`, `:367-377`; `views/console/format.ts:141-144`;
  `workbench/panels/OperationsPanel.vue:129-132`; `views/shared/celleditor/validate.ts`

Bug: `scanSqlSpan` has no case for these forms:
- MySQL/ClickHouse `#` line comments.
- Postgres `E'…'` strings with backslash escapes (Postgres gets `backslashEscapes: false`).
- Postgres nested block comments.
- SQLite/SQL Server-style `[ident]`.
- `$` inside an identifier (`a$b`) on Postgres, read as a dollar-quote open tag.
- Mongo consoles split with SQL rules (`dialect` undefined), so `//` comments and `/;/` regex
  literals are unknown.

Reachable (verified):
- MySQL `# don't run\nSELECT 1;\nSELECT 2;` gives one statement.
- MySQL `SELECT 1 # a; b\n FROM dual;` splits inside the comment.
- Postgres `SELECT a$b$c FROM t; DELETE FROM t;` gives one statement.
- SQLite `SELECT [a;b] FROM t` splits inside the identifier.
- Mongo `// don't` merges the following statements.

Effect: Run all sends merged or fragmented text. MySQL (`MultiStatements=false`) and SQLite
(`assertSingleStatement`) fail loudly. Postgres runs every merged command and returns only the first
result. On Postgres, Run statement on the first statement also runs its merged neighbours.

Also undocumented: compound bodies (SQLite `CREATE TRIGGER … BEGIN …; END`, MySQL procedures,
Postgres `BEGIN ATOMIC`) split at their inner `;`. The verified SQLite trigger splits into four
fragments.

Fix:
- Teach `scanSqlSpan` the `#` comment (MySQL, ClickHouse), the `E'…'` string (Postgres, backslash
  escapes on regardless of the option), nested block comments (Postgres), and `[…]` (SQLite). Allow
  a dollar-quote tag only when the preceding character is not an identifier character.
- Give Mongo its own options (`//` comments), or skip splitting for Mongo where the Go side already
  parses one statement.
- Record the compound-body limit in `docs/ARCHITECTURE.md` Known open items, or add
  `BEGIN … END` depth tracking.
- Extend `sql-split.spec.ts` per form. A splitter with interacting rules is on the bar.

## F5 (Medium) — Re-run from operation history uses the wrong path and skips reconnect

Sites:
- `workbench/panels/OperationsPanel.vue:127-136` (`onRerun`)
- `packages/shared/domain/ops.ts`, `apps/kira-studio/internal/storage/model/ops.go` (`OpRecord` has no path)
- `state/tabs.ts:262` (`openConsoleTab(id, '')` substitutes the connection's console default path)
- Go `op.SetCommand(strings.Join(statements, ";\n"))`: `internal/adapters/postgres/console.go:197`,
  plus the sqlite and mongo equivalents

Bug (code-read):
- The original op ran against the tab's path (database or schema). Re-run opens a console at the
  connection default, so the same text can run against a different database or schema. Unqualified
  DML hits a different table of the same name.
- `run()` fires without `ensureConnectedForRun`. On a disconnected connection it fails instead of
  reconnecting, unlike Run in the console itself.
- The recorded command is `;\n`-joined. A statement ending in a `--` comment gets the `;` inside the
  comment, so the re-split merges it with the next statement.
- Mongo commands re-split with SQL rules (F4).

Fix:
- Record the op's `path` in `OpRecord` (Go model, migration, wire type) and pass it to
  `openConsoleTab`. Refuse re-run when the stored path no longer resolves.
- Store the statement list, or join with `;\n` only after appending `\n` to a statement whose last
  line is a `--` comment.
- Route re-run through the same reconnect step Run uses.

## F6 (Medium) — Projection menu silently clears an active projection

Sites:
- `views/documents/ProjectionMenu.vue:25` (`fieldNames = fieldNamesOnPage(tabId)`, `_id` excluded)
- `views/documents/ProjectionMenu.vue:31` (`selected` starts as `currentProjection() ?? fieldNames`)
- `views/documents/ProjectionMenu.vue:48-51` (`onUnmounted` always calls `setProjection`)
- `views/documents/state.ts:186-191` (`setProjection` resets `pageIndex` to 0 and reloads)
- `views/documents/DocumentView.vue:127-139` (edit gate refuses any non-null projection)

Bug (code-read): after a projection to `[a, b]`, the page holds only `_id, a, b`, so `fieldNames` is
`[a, b]`. Reopen and close the menu without touching anything. `selected.size === fieldNames.length`,
so the unmount writes `null` and the projection is gone. Every close also reloads and jumps to page
1, even when nothing changed. "None" writes `[]`. Mongo then returns every field, but
`projection !== null`, so the edit gate still refuses editing and the badge shows a projection.

Fix:
- On unmount, compare `selected` with the projection the menu opened with. Skip `setProjection` when
  they are equal.
- Decide "everything" from the unprojected field set. Simplest: when a projection is active, only
  All clears it, and a close keeps the explicit list.
- Treat an empty selection as `null`, or disable closing with nothing selected.

## F7 (Medium) — Console row copy merges same-named columns

Sites:
- `views/console/ConsoleSlickGrid.vue:511-519` (`rowSnapshotFor` keys `values` by `col.name`)
- `views/console/resultMenu.ts:68-77` (`rangeSnapshots`, same keying)
- `views/shared/clipboardFormats.ts:47-49`, `:88-98` (`rowsToTsv`/`rowsToCsv`/`rowsToJson` read `values[name]`)

Bug (code-read): console results routinely repeat a column name (`SELECT a.id, b.id FROM a JOIN b`,
`SELECT 1 AS x, 2 AS x`; the grid's own comment at `ConsoleSlickGrid.vue:103` says so). The
last-written value wins. Row copy (⌘C with rows selected, the gutter menu's TSV/CSV/JSON) and the
range menu's CSV/JSON then paste the second column's value under both headers. JSON drops a key.
Range ⌘C (`columnsToTsv`, index-based) is correct, so two copy paths of the same cells disagree.

This closes the Part 10 carry-over. Column widths keyed by name (`state.ts:272-278`,
`ConsoleSlickGrid.vue:195-216`) are the documented cosmetic trade-off and stay out of this finding.

Fix: build console snapshots positionally. Either give `RowSnapshot` an index-keyed variant for
TSV/CSV, or disambiguate duplicate names (`id`, `id_2`) before keying, and use the same names for the
JSON keys.

## F8 (Medium) — Hover renders database text as Markdown

Sites:
- `editor/MonacoHost.vue:262-267` (`info.value` wrapped in a triple-backtick fence; each `info.lines` entry pushed as `{ value: line, supportHtml: false }`)
- `editor/hoverInfo.ts:10-13` (contract says plain text, no Markdown renderer)
- `views/console/sqlHover.ts:36-58` (lines built from table/column names, types and `col.description`)
- `views/console/ddl.ts:345-347` (`description` from `COMMENT ON COLUMN … IS '…'`)
- `api/state/variableCompletion.ts:170-185` (`value` is a variable's resolved value)

Bug (code-read): `supportHtml: false` blocks raw HTML only. Markdown still renders:
- A column comment `[docs](https://…)` becomes a clickable link.
- `_x_` and `__init__` style names render as italic or bold.
- A backslash or backtick in a name or type changes the text shown.
- A variable value containing a triple backtick closes the fence early, and the rest renders as
  Markdown.

The column comment comes from the DDL document or the server catalog, so anyone with COMMENT rights
on a shared database controls it. The CSP `img-src 'self' data:` (`index.html:7`) blocks remote image
beacons. `isTrusted` is unset (false), so `command:` links stay inert.

Fix: escape Markdown syntax in every `lines` entry (backslash-escape ``\`*_{}[]()#+-.!|<>~``, the rule
VS Code's `escapeMarkdownSyntaxTokens` applies). Fence `value` with a backtick run one longer than the
longest run inside it (CommonMark rule). Keep `isTrusted` false.

## F9 (Medium) — Format can merge statements through a trailing line comment

Sites:
- `views/console/format.ts:179-200` (per-statement format, `out.join(';\n\n')`)
- `views/console/format.ts:68-105` (`formatMongoStatement` rebuilds from the call's arguments only)

Bug: `stmt.text` excludes its `;`. When a statement's last line is a `--` comment, the rejoin puts
the separator inside that comment. That happens both when the statement formats (sql-formatter keeps
the comment last) and when it fails (it is emitted verbatim).

Reachable (verified with the real sql-formatter): `SELECT 1 -- first\n;\nSELECT 2;` formats to
`SELECT\n  1 -- first;\n\nSELECT\n  2;`. The splitter then sees one statement. Format silently
changed what Run all and Run statement execute, and a second Format cannot undo it.

Also (code-read): the Mongo branch drops anything after the call's closing paren. It emits
`db.<c>.<m>(args)` only, so `db.c.find({}).limit(5)` becomes `db.c.find({})`. The Go console rejects
the trailing content (`internal/adapters/mongo/console.go:154`), so Format turns an error into a
different, valid query.

Fix:
- Join with `'\n;\n\n'` after any statement whose last line holds a `--` comment, or always put the
  `;` on its own line in that case.
- In `formatMongoStatement`, refuse (return a reason) when non-whitespace text follows the closing
  paren, so the statement stays verbatim.
- A format spec for the comment case meets the bar (splitter rules interacting with the rejoin).

## F10 (Medium) — Stream resize cancel leaves a column stuck at its live width

Sites:
- `packages/kira-ui/src/KuiColumnResizeHandle.vue:59-61` (`onCancel` cleans up and emits nothing)
- `packages/kira-ui/src/KuiColumnResizeHandle.vue:33-39` (no `e.button` filter)
- `views/stream/StreamView.vue:566-585` (`liveResizeWidth`, `widthFor`, `onResizeLive`, `onResizeCommit`)
- `views/stream/StreamView.vue:1089-1141` (four handles)
- `packages/git-ui/src/components/CommitGrid.vue:1268-1296` (listens to `update:value` only)

Bug (code-read): a drag ended by `pointercancel` or `lostpointercapture` never emits `change`.
`liveResizeWidth` keeps the aborted width. The column shows a width that is not saved. The next drag
on another column overwrites `liveResizeWidth`, and the first column snaps back. A right-button
`pointerdown` also starts a drag and captures the pointer.

Unmount mid-drag does not leak: removing the capture target fires `lostpointercapture` at the
document, which reaches the window listener, so `cleanup` runs.

Fix (KU edit allowed, B7 closed):
- Add a `cancel` emit (or emit `change` with the last live value) from `onCancel`. StreamView resets
  `liveResizeWidth` on cancel. CommitGrid ignores the new event, so its contract holds.
- Return early from `onPointerDown` when `e.button !== 0`.

## F11 (Medium) — Two runs overlap while the console reconnects

Sites:
- `views/console/ConsoleView.vue:347-349` (`ensureConnectedForRun`), `:351-377` (`runStatement`, `runAll`), `:442-451` (`onExplain`)
- `views/console/state.ts:394-401` (`run()` sets `status = 'running'` only when called)

Bug (code-read): the `running` guard runs before `await ensureConnectedForRun()`. `run()` marks the
tab running only after the reconnect resolves. During the reconnect wait, a second click,
Ctrl+Enter or palette command passes the guard, and the toolbar button is still enabled. Both runs
execute server-side. The first run's result is discarded as superseded. An INSERT pressed twice
during a slow reconnect inserts twice.

Fix: keep a view-local `starting` flag set before the reconnect await and cleared once `run()` or
`explain()` has taken over. Read it in the three guards and the buttons' `:disabled`. The alternative
is setting runtime status to `'running'` before reconnect.

## F12 (Low) — Console and documents regex search are uncapped

Sites:
- `views/console/search.ts:50-84` (tabular, document and keyvalue branches pass no `regexTextCap`)
- `views/documents/search.ts:41-45` (`eachMatch` with no `maxLength`)
- `editor/findRanges.ts:47-76` (`matchPositions`, response and definition find bars)
- `views/shared/page/scan.ts:71` (`REGEX_SCAN_TEXT_CAP`), `:79` (`eachMatch`)

Bug: Part 10 F16's partial mitigation (commit `3e96d1b`) capped grid and keyvalue only. It left
these call sites uncapped on purpose ("out of this finding's scope"). `(a+)+$` against one long
console cell, document body or response body still blocks the main thread.

Fix: pass `q.regex ? REGEX_SCAN_TEXT_CAP : undefined` at the three console branches and the documents
scanner, same as `grid/search.ts:34-40`. Apply the same cap to `findRanges.ts` regex mode.

## F13 (Low) — Format discards text typed during the formatter load

Sites: `views/console/ConsoleView.vue:388-413` (`originalText` captured, `await formatConsoleText`,
then `setText(props.tab.id, result.text)` unconditionally)

Bug (code-read): the first Format press awaits a dynamic `import('sql-formatter')`. Keystrokes typed
before it resolves are overwritten by the formatted version of the older text.

Fix: after the await, return when `props.tab.state.text !== originalText`. Optionally show "text
changed, format again".

## F14 (Low) — Stream `load()` hand-writes the `runPagedLoad` frame

Sites:
- `views/stream/state.ts:116-158` (`load()`)
- `views/shared/page/load.ts` (`runPagedLoad`), adopted by `views/documents/state.ts:94-127`

Bug: Part 10 F20 carry-over. The stream `load()` repeats the frame: `beginOp`, read, the
`!runtime[tabId]` and opId guards, the page-kind check, `setPage`, `applyLoadFailure`. Only the apply
body differs. That is no shape difference, so nothing justifies the copy.

Fix: call `runPagedLoad` with `expectKind: 'stream'` and move the stream-specific assignments into
`apply`.

## F15 (Low) — A failed count is silent on stream and document tabs

Sites:
- `views/stream/state.ts:258-279` (`applyStreamFilter` clears `count`/`countOpId`, not `countError`)
- `views/stream/StreamView.vue` (never reads `countError`)
- `views/documents/DocumentView.vue:720`, `:756` (count shown and run; `countError` never rendered)
- `views/grid/DataToolbar.vue` (the only view that renders `countError`)

Bug (code-read): when the Σ count fails, the stream and document toolbars show no count and no
reason. After a filter change, the stream tab keeps the old filter's `countError`.
`documents/state.ts:175` clears it; the stream does not.

Fix: clear `countError` in `applyStreamFilter`. Render `countError` in both toolbars the way
`DataToolbar.vue` does.

## F16 (Low) — Disabled buttons in a plain `TooltipTrigger`; two dead Stop buttons

Sites:
- `views/console/ConsoleView.vue:607` (Refresh), `:623` (Stop)
- `views/stream/StreamView.vue:655` (Refresh), `:671` (Stop)
- `views/documents/DocumentView.vue:695` (Stop)
- `views/browse/BrowseView.vue:323` (Stop, `disabled` always)
- `views/definition/DefinitionView.vue:266` (Stop, `disabled` always)

Bug: a disabled button emits no pointer events, so its tooltip never shows. That breaks the P105
`TooltipDisabledTrigger` convention the same toolbars already follow for Run, Explain and paging. The
Browse and Definition Stop buttons are disabled permanently: `kira:tree:children` and the definition
fetch are not cancellable ops (browse `state.ts:12-14`, D16), so they can never be enabled.

Fix: move the five conditional buttons to `TooltipDisabledTrigger`. Remove the two permanently
disabled Stop buttons. If the "same toolbar shape" was the reason to keep them, give them a tooltip
through `TooltipDisabledTrigger` naming why ("listing is not cancellable").

## F17 (Low) — Document row menu offers Delete regardless of write gates

Sites:
- `views/documents/menu.ts:135-155` (Delete item has no `disabled`)
- `views/documents/DocumentView.vue:104-117` (`canDelete` folds caps and `readOnly`; used by the row button only)
- `apps/kira-studio/internal/adapters/mongo/adapter.go:346` (server refuses a mutate on a read-only connection)

Bug (code-read): on a read-only connection, or an adapter whose caps lack delete, the toolbar and row
buttons are disabled with a reason. The context menu still offers Delete, asks for confirmation, then
shows the server's refusal. The Edit item beside it already takes `editGate`.

Fix: pass a delete gate (`{ enabled: canDelete, label: deleteTooltip }`) into `rowMenu`, and
disable the item with the same label the button uses.

## Examined, nothing real

- Auto-explain page slicing (`state.ts:188-236`): adapters return all pages or throw (P5.5
  all-or-nothing), and errors are swallowed to "no strip", so there is no misattribution.
- Auto-explain skip above 10 statements shows no strip: documented D19 behavior.
- Stop during auto-explain, a superseding run, and the `explainOpId` identity guards
  (`state.ts:416-441`): correct. `explain()` after tab close: `pushPlanResult` returns on a missing
  tab (`state.ts:380-381`).
- Result eviction (`state.ts:120-141`): `releaseResult` drops the page, plan, document rows and
  expanded ids. The new batch is protected, and `activeKey` moves to the new result. Tab cleanup
  releases every result, including those added after registration.
- `scanDollarQuote`'s `source.slice(i)` per `$`: V8 and JSC use substring views, so it is not quadratic
  (code-read estimate).
- Tokenizer paren recovery: one unclosed `(` makes `scanParenGroup`/`scanLevel`
  (`sql-tokens.ts:281-340`) swallow the rest of the document (verified). Hover and schema diagnostics
  for later statements go dark only until the paren closes, and lint's `flushParens` still flags the
  paren. Transient while typing, so not reported.
- Formatter dialects: ClickHouse maps to sql-formatter's own `clickhouse` (`format.ts:38-39`). A
  throw is caught per statement and reported by index (`format.ts:167-176`, `:419-424`).
- DDL `COMMENT … IS '…'` unescapes `''` only (`ddl.ts:345`). A backslash-escaped comment shows its
  raw text in hover. Cosmetic.
- `paintSpans.ts:177` class attribute: classes come from Monaco `mtkN` and constant provider classes
  (`classFor`, `findRanges.ts:108`), never from data. `v-html` appears only in
  `AutocompleteField.vue:518`. The Part 10 overlay conclusion holds.
- `findQueryIsInvalid` returns true for a half-typed regex and `matchPositions` returns no matches
  without caching (`findRanges.ts:54-61`). `POSITION_CACHE_SIZE = 4` holds at most four position
  arrays, keyed by document identity.
- MonacoHost lifecycle (`MonacoHost.vue:392-442`): Vue nulls `rootRef` on unmount, so the post-import
  return is clean. The lint timer is cleared on unmount, and the timer callback checks
  `isDisposed()`. Providers filter by `candidateModel !== model`, so two consoles answer only for
  their own model.
- Browse `load` after tab close writes to the detached runtime only. `ensureKeyTypes` clears pending
  on success, failure and missing tab (`browse/state.ts:235-258`). Cleanup deletes both maps
  (`:78-81`).
- `buildConstraintRows` FK dedupe by name (`definition/structure.ts:40-50`): constraint names are
  unique per table on Postgres and per database on MySQL, and inbound references are never deduped.
  "Open in console" passes the path only; no identifier text is built.
- Documents `setSearch`/`setProjection`/`setSort`/`setPageSize` revert `pageIndex` only when not
  superseded (`runPagedLoad`'s `onFailure(superseded)`, `documents/state.ts:122-126`).
- Documents `expanded` map growth: Collapse all adds one `false` per id on the page
  (`documents/state.ts:249-258`), and Expand all clears the map. Growth is bounded by pages the user
  collapses by hand. Not reported.
- Stream offset stays a string. The only `Number()` in `views/stream` converts partition names
  (`StreamView.vue:432`).
- SQS Refresh: `onRefresh` refuses for batch kinds on both the button and the command-registry path
  (`StreamView.vue:274-277`, `:596`). Confirm dialogs render through `{{ }}`.
- `<style>` blocks with `@apply` in 17 files of this chunk: P99 Part 4's recorded decision, same as
  Part 10. `MonacoHost.vue`'s block styles Monaco DOM.
- `beautify.ts` hand-rolled XML scanner: same losslessness requirement as JSON (text reproduced
  byte for byte, which a DOM parser round trip does not keep). Not reported.
- `docs/ARCHITECTURE.md` EXPLAIN sections (`:2148-2162`, `:3429-3446`) match the code, including the
  `planParsers/*.ts` paths.
- `hover-value-caption.spec.ts` and `document-byte-label.spec.ts` sit below the CLAUDE.md bar. The
  rule applies going forward, same as Part 10. Not reported.
