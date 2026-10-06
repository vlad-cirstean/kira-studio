# P168 Part 12 findings: Studio console, editor, parse worker, per-kind views

Plan: `P168-part12-console.md`. Base `8b20119`; HEAD reviewed `54b5c10` (plan commit only on top).
Reviewer reports only; fixer follows plan §8. Paths as in plan (`SF`, `ST`, `SD`, `PW`, …).

## Checks (baseline at `54b5c10`)

- `bun test` 40 own unit specs together: 310 pass, 0 fail.
- Each spec alone: 39 green, 1 red: `document-console-row-menu-lazy-snapshot.spec.ts` 3 fail
  (`getActivePinia()` from `documents/menu.ts:59`). Reported as a finding (block 7).
- `bun run typecheck:web:studio`: clean. `bun run typecheck:unit:studio`: clean.
- `bunx biome check` over own source paths (124 files): clean.

## Findings

### Block 1: parse worker and editor core

**F1. Aborted in-flight parse job re-runs inline on the main thread after a worker error.** Low.
Verified (scratch probe, fake worker: abort job, then fire worker `error`; handler ran inline once).
`SF/workers/parse/client.ts:71-77` (`onWorkerFailure`), `:49-64` (`settle`/`runInline`).
- Scenario: Copy all on a multi-MB console result posts `ejson.copyAll`; user closes the tab (scope
  abort; `running` stays set, queue empty, worker not killed). The worker then dies (OOM on that
  same input, or any error). `onWorkerFailure` re-queues `running` and runs it inline: the
  multi-MB copy/format runs synchronously on the main thread for a caller that is gone, freezing UI.
  `settle` also runs `run` for a job already aborted before the microtask starts.
- Fix: in `onWorkerFailure` skip jobs with `aborted` (`pending.filter((j) => !j.aborted)`); in
  `settle` check `job.aborted` before calling `run`. Add the abort-then-error case to
  `parse-worker-client.spec.ts` (concurrency ordering: qualifies).

**F2. Deep nesting throws `RangeError` out of the JSON/XML scanners; inline callers crash, worker
callers degrade.** Medium. Verified (scratch probe under Bun/JSC: `'['.repeat(20000)+…` 40 KB
throws from `beautifyJson` and `scanJson`; `<a>` x 100 000 throws from `beautifyXml`; V8 in
WebView2 overflows earlier).
`SF/beautify.ts:73-133` (recursive `parseJsonValue` via `parseContainer`), `:371-380`
(`tryParseXml` rethrows non-`XmlScanError`), `:391-428` (recursive XML render);
`SF/views/shared/document/rawTree.ts:208-224` (`tryParse` rethrows anything not `ErrorClass`).
- Scenario: an HTTP response body `[[[[…]]]]` 20 000 deep (40 KB, under `INLINE_CHARS`) hits
  `useResponseBody.request` inline `parseInline('body.format', …)` with no catch: the watcher throws,
  response pane breaks. Same body above 64 KiB goes to the worker, posts `ok:false`, and degrades to
  `format: null`. Inline vs worker parity broken; cell editor `detect.ts:63,83`/`validate.ts:18,25`
  (`scanJson`/`scanXml`) throw the same way on a JSON/XML DB value. Console Copy all is not
  exposed in practice (Mongo caps document nesting at 100).
- Fix: catch `RangeError` in `tryParse` (Part 11 file, editable in Stream C, state why) and in
  `tryParseXml`, returning `{ ok: false, offset/reason: 'nesting too deep' }`; wrap the XML render
  (`collectXmlIndentedLines`/`renderXmlCompact`) the same way inside `beautifyXml`. One unit test
  over the depth guard (parser edge: qualifies).

**F3. `MonacoHost` `filling` flag stays `true` after a chunked read-only fill is cancelled by the
editable external-write path.** Low. Code-read.
`SF/editor/MonacoHost.vue:439-483` (`fillModel` `finally` resets flags only when
`fillCtrl === ctrl`), `:594-606` (editable `applyExternalDoc`: `cancelFill()` nulls `fillCtrl`,
never resets `filling`), `:505-506` (`onDidChangeContent` returns early while `filling`).
- Scenario: cell editor dock (`CellEditorView.vue:668-676`, `:read-only="!isEditable"`, one host
  instance reused across cells) shows a read-only cell over 256 KiB chars (chunked fill, several
  frames). User selects an editable grid cell inside that window: `doc` and `readOnly` change in the
  same flush, `applyExternalDoc` takes the editable branch, `cancelFill()` aborts the fill, whose
  `finally` sees `fillCtrl !== ctrl` and skips the reset. `filling` stays `true`: every later
  keystroke skips `emit('update:doc')`, lint and range repaint. The edit never reaches the owner
  (Save sees no change).
- Fix: in the editable branch reset `filling = false` after `cancelFill()` (or make `cancelFill`
  reset `filling`/`applyingExternal` itself).

Block 1 otherwise clean:
- `client.ts` abort of running job with empty queue: next `run` kills the worker in `pump`
  (`:100-104`), no blocking. Stale reply (`:84`) cannot strand the queue: only the running job is
  ever posted to a live worker, and replies from a killed worker are dropped by `w !== worker`.
  Dropped suspect.
- `useParseWorker` scope abort and `runLatest` key reuse correct. `AbortSignal.any` available on
  both WebViews.
- Worker in built app: `dist/assets/parse.worker-*.js` is an IIFE with `sql-formatter` inlined (no
  runtime `import()`), so `console.format` works in the worker under `wails://`. Verified by
  inspecting the bundle.
- `chunkedText.ts` boundaries (surrogate, CRLF, line-aligned) correct; `pumpChunks` contract holds.
- `paintOverlayHtml` escapes every text run; class names come only from `mtkN` and internal
  range classes. `hoverInfo.ts` escape and fence correct. `findRanges` regex cap and zero-width
  guard hold; cache is bounded (4).
- `MonacoHost` mount/unmount ordering, provider model scoping, lint timer guard, language/readOnly
  changes during import window: correct. Scoped `<style>` is the named exception.

### Block 2: SQL language

**F4. Mongo console lint flags valid input and ignores every statement after the first.** Medium.
Verified (scratch probe over `consoleLintSource('mongodb')`).
`SF/views/console/lint.ts:115-164` (`lintMongoConsole`), `:60-104` (`lintMongoBrackets` skips `//`
only), `SF/views/console/mongoStatement.ts:4` (`MONGO_STATEMENT_RE` anchored at `^\s*db\.`).
- Scenario: Go's `mongo/literal.go:95-102` skips `//` and `/* */` comments, and Run all/Format
  split on `;` (`splitSqlStatements` with `slashSlashComments`). Lint treats the whole document as
  one statement with no comment handling:
  - `// users\ndb.users.find({})` runs fine but gets one error over the whole document
    (`expected db.<collection>.<method>(...)`).
  - `/* don't */ db.a.find({})` gets `unterminated string literal` (quote inside block comment).
  - `db.a.find({});\ndb.b.nope({})` and `db.a.find({}); db.b.find({x: })`: no diagnostic; the
    second statement's unsupported method or bad argument is never reported.
- Fix: lint per statement over `splitSqlStatements(text, { …lexOptionsFor(undefined),
  slashSlashComments: true })` (same split as Run all; offsets from `stmt.start`), skip leading
  `//`/`/* */` comments before `MONGO_STATEMENT_RE`, and skip block comments in
  `lintMongoBrackets`. Keep `lintMongoBrackets`'s table test current.

**F5. SQLite `[bracket]` identifiers keep their brackets in DDL parse, diagnostics and hover.** Low.
Verified (scratch probe: `parseDdl('sqlite', 'CREATE TABLE [order items] ([qty] INTEGER)')` yields
table `[order items]`, column `[qty]`; `SELECT [users].[name] FROM [users]` against
`CREATE TABLE users (…)` warns `unknown table "[users]"`; `SELECT u.[name] FROM users u` warns
`"users" has no column "[name]"`).
`SF/views/console/sqlNodes.ts:37-46` (`unquotedName` strips only `"`/`` ` ``),
`SF/views/console/sqlDiagnostics.ts:72-75` (own `replace(/^["`]|["`]$/g, '')`).
- Scenario: any SQLite schema or query using bracket quoting (common in SQLite tooling output)
  gets false "unknown table/column" warnings, and completion/hover for such tables miss.
- Fix: in `unquotedName` handle `[`: `raw.slice(1, -1).replaceAll(']]', ']')`; use `unquotedName`
  (not the ad-hoc regex) in `unknownColumnDiagnostics`. Check `sqlSchemaCompletion.ts`
  `QUALIFIED_RE` in block 3.

**F6. Format failures outside the formatter are silent, and a failed `sql-formatter` chunk load is
memoised forever.** Low. Code-read.
`SF/views/console/format.ts:18-21` (`loadSqlFormatter` caches the rejected promise),
`SF/views/console/ConsoleView.vue:432-438` (inline path: `await formatConsoleText` inside
`void (async…)` with no catch; worker path `.catch(() => null)` maps every rejection to "unmounted").
- Scenario: the lazy `sqlFormatterEntry` chunk fails to load once (asset fetch error in a dev
  reload, a stale build). The inline press becomes an unhandled rejection with no strip; every later
  press reuses the rejected promise and fails the same silent way until restart. Above
  `INLINE_CHARS` the worker posts `ok:false` and the view shows nothing, as if unmounted.
- Fix: reset `sqlFormatterModule = undefined` on rejection (`.catch((e) => { sqlFormatterModule =
  undefined; throw e; })`); in `onFormat` catch both paths, treat only `AbortError` as silent, and
  set `formatError` to the message otherwise.

**F7. Format maps the caret by a different statement rule than Run, and a second press during the
first reports a phantom edit.** Low. Code-read.
`SF/views/console/ConsoleView.vue:428-430` (`beforeIndex` uses `cursor >= s.start && cursor <=
s.end`), `:446-448` (stale check), versus `statementAtOffset` (`SD/sql-split.ts:77-90`, P108 Part
11 F3 rule used by Run/Explain at `:254`).
- Scenario A: `SELECT 1;\nSELECT 2;` with the caret right after the first `;` (where typing `;`
  leaves it). Run would run `SELECT 1`. Format: `s.start` of statement 2 equals the caret, so
  `beforeIndex` is 1 and the caret lands in `SELECT 2`; the next Run runs `SELECT 2`. A caret on the
  trailing blank line after the last `;` gives `-1` (no remap at all).
- Scenario B: first Format press on a cold app awaits the `sql-formatter` import; a second press
  (key repeat, double click) captures the same `originalText`. The first applies; the second then
  sees changed text and shows "Text changed while formatting — press Format again." though the user
  typed nothing.
- Fix: A: `beforeIndex = before.indexOf(statementAtOffset(before, originalText, cursorPos.value))`.
  B: a `formatting` flag (component-local) that ignores a press while one is in flight (or disables
  the button), cleared in `finally`.

Block 2 otherwise clean:
- Splitter/lexer dialect flags, `statementAtOffset`/`trimmedStatementStart`, `lintSql` stop at the
  first unterminated span and paren reset at `;`: correct. Compound statement bodies (`BEGIN … END`)
  are a known open item (`docs/ARCHITECTURE.md`), not re-reported.
- `formatConsoleText` split options match `ConsoleView.splitOptionsFor`; per-statement verbatim
  fallback, terminator preservation, trailing-comment join, Mongo trailing-content refusal hold.
- `sqlHover` fence/escape, `tokenizeSql` memo (2 entries, reference-compared options) correct.

### Block 3: autocomplete

**F8. Relation names from the tree cache are unreachable whenever a DDL document or cached columns
exist.** Low. Verified (scratch probe: `sqlCompletionSources('postgres', empty DDL,
['orders_archive'], cached [orders])`; at `SELECT * FROM or` and at explicit `SELECT * FROM `, the
first non-null source offers `orders`, `ORDER`, `OR`; `orders_archive` never appears).
`SF/views/console/sqlLanguageService.ts:80-96` (relation source composed third),
`SF/views/console/sqlSchemaCompletion.ts:121-133` (bare-word branch always returns non-null once a
word is typed or Ctrl+Space pressed), `SF/editor/MonacoHost.vue:245-274` (first non-null source
wins, no merge).
- Scenario: root-opened console with one container's columns cached (the case the P4 comment at
  `sqlLanguageService.ts:91-93` names). Tables the user expanded in other containers never show at
  `FROM`/`JOIN`, though the comment says they were added for exactly that. The relation source only
  runs after an unresolved `foo.` (schema source null, keyword source null), where it then replaces
  `foo.` with a bare relation name.
- Fix: in `sqlSchemaCompletionSource` take `relations` as an extra input and, when
  `RELATION_POSITION_RE` matches the text before `from`, merge relation names not already in the
  namespace into `tableOptions` (deduped, quoted via `toOption`); drop the separately composed
  relation source from the two schema branches. Keep the relations-only branch as is.

Block 3 otherwise clean:
- `QUALIFIED_RE` has no `[bracket]` qualifier: SQLite `[t].` gets no completion (no wrong one); fold
  into F5's fix if cheap (`\[(?:[^\]]|\]\])*\]` alternative plus `unquote`).
- Alias resolution, CTE shadowing, `toOption` quoting, keyword dedupe and memo, Redis first-token
  rule, Mongo positions: correct. Per-keystroke cost: sources slice `doc` once and reuse the
  memoised tokenize for alias lookups only at qualified positions.
- `MonacoHost` providers are model-scoped and disposed on prop change and unmount; two hosts with
  one language id do not cross-feed.

### Block 4: console run and results

**F9. Shared page-version counter used as "this tab's page changed": other tabs' loads and closes
clear this tab's cell dock and restart its search.** Medium. Code-read (the F4 spill from Part 11,
plan §1, confirmed and widened).
- `SF/views/console/search.ts:110-117`: `createPageSearch` gets no `pageOf`, so
  `SearchToolbar.vue:184-195` restarts on every `resultPages` `pageVersion` bump. That store is
  shared by every console tab (`resultPages.ts:13`).
- `SF/views/console/ConsoleResultGrid.vue:191-194`: `watch([pageKey, pageVersion.n])` clears
  `selected` and calls `cellSelectionStore.clearSelectedCellFor(tabId)` on any bump.
- `SF/views/stream/StreamSearchToolbar.vue:53-58` and `SF/views/stream/StreamView.vue:252-255`:
  same two patterns over the stream store (shared by every stream tab).
- Scenario: user has console tab B open with the cell editor dock showing a value and a search with
  "show only matching rows" on. They middle-click-close console tab A in the strip (`dropForTab`
  bumps the counter), or a run started in A finishes in the background (`setPage` bumps it). B's
  dock closes, B's selection clears, and B's scan restarts: matches reset to `pending`, so the
  filtered grid flashes every row (`matchedRows` returns null while pending) and the current-match
  index snaps back. Same for two stream tabs (close one, or a Fetch more / Poll finishing in the
  other after a tab switch).
- Fix (own files): console `pageOf: (tabId) => useConsoleViewStore().activePage(tabId)` (page
  identity changes on run, active-result switch and close; the explicit `bumpPageVersion` in
  `setActiveResult` then stays only for readers without `pageOf`); stream `StreamSearchToolbar`
  watch `() => (void pageVersion.n, getPage(props.tabId))`. In `ConsoleResultGrid` and `StreamView`
  watch page identity (`getPage(pageKey)` / `getPage(tab.id)`, reading `pageVersion.n` first for
  the dependency) instead of the raw counter. No unit test (single condition).

**F10. Clipboard writes left bare: a rejected write is an unhandled rejection with no feedback.**
Low. Code-read (plan §5.3 and §5.6 suspects confirmed).
`SF/views/console/resultMenu.ts:37,44,51,86,93,100,128,134,140,163,169` (every tabular cell, range,
row and column item), `SF/views/console/ConsoleSlickGrid.vue:522,527,531,534` (Cmd+C),
`SF/views/stream/menu.ts:15,23`, `SF/views/browse/menu.ts:33`,
`SF/views/definition/DefinitionView.vue:68`, `SF/views/definition/columnsMenu.ts:53`.
- Scenario: window not focused or clipboard permission denied (WebKit rejects
  `navigator.clipboard.writeText`). `contextMenu`'s `void item.run()` drops the promise: nothing is
  copied and nothing says so. The Mongo/kv items in the same file (`:199-300`) and
  `documents/menu.ts` already route through `copyOrReportError`; Part 10 fixed this class in its
  views (`510214f`).
- Fix: route each through `copyOrReportError(text, onError)`; console tabular builders take an
  `onError` in their context (ConsoleResultGrid's existing `onCopyError` strip; thread it to
  `ConsoleSlickGrid` as a prop or emit); stream/browse/definition report through their existing
  `setActionError` (stream, browse) or a local strip (definition).

**F11. Run/Run all/Explain proceed after a failed reconnect.** Low. Code-read.
`SF/views/console/ConsoleView.vue:371-373` (`ensureConnectedForRun` drops
`onReconnectAndLoad`'s `Promise<boolean>`), `:386-394`, `:403-411`, `:508-517`.
- Scenario: restored console tab, server down. Run: `connectConnection` resolves with an error
  state (`useConnectionGate.ts:41-49` returns `false`), then `run()` still fires `data.execute`,
  which fails `E_ENGINE_DOWN`; `applyLoadFailure`'s disconnected branch sets `idle` with no error,
  so the console shows nothing at all for the press. A `connectConnection` rejection escapes the
  `void (async…)` IIFE as an unhandled rejection.
- Fix: `ensureConnectedForRun` returns the boolean (catching a rejection as `false`); each caller
  returns early on `false` and shows the connection's own error (`connectionsStore.states[id]
  ?.error`, or a console-local strip like `explainError`).

**F12. A Stop that reaches Go before the op registers is lost; the statement still runs.** Low.
Code-read. `needs-other-part-file: apps/kira-studio/internal/adapterhost/host.go (Part 5)`.
`SI/adapterhost/host.go:306-311` (`CancelOp` returns `false, nil` for an unknown id, remembers
nothing), `:201-207` (`RunOp` registers on arrival); renderer `SF/views/console/state.ts:530-543`.
- Scenario: Run an `UPDATE`, press Stop at once. `stop()` marks `cancelled` and sends
  `opsCancel(opId)`; if the cancel IPC lands before `RunOp` registers `opId`, it is a no-op, the
  update commits, `run()` then lands results and flips `cancelled` back to `idle`. Window is IPC
  latency only (auto-explain's window is covered client-side by the `status` check).
- Fix (Go): keep a short-TTL set of cancelled-but-unknown op ids in `Host`; `RunOp` fails a
  matching id with `E_CANCELLED` before running. Routed to `P168-routed-from-streamC.md`.

**F13. Saved-query menu actions fail silently.** Low. Code-read.
`SF/views/console/ConsoleSavedMenu.vue:31-72` (`reload`, `togglePin`, `rename`, `remove`,
`saveCurrent`: no catch; emitted from `SavedListMenu` and a button `@click`, never awaited).
- Scenario: `queriesSaveConsole` rejects (storage error): the prompt closes, nothing is saved, an
  unhandled rejection is logged, the user sees nothing. Same for pin/rename/delete.
- Fix: one local `error` ref shown in the menu (an `Alert` in the footer), set from a catch in each
  action. A TanStack Query migration of this list is not needed for the fix (the sibling
  `FilterHistoryMenu.vue` keeps the same hand-rolled shape, Part 11 accepted).

Block 4 otherwise clean:
- `run` opId supersession, detached runtime on tab close (`registerTabRuntimeCleanup` cancels both
  ids and flips status), auto-explain gate (`stop`, overlap, clobber, run-after-close), result cap
  and `releaseResult` on every removal path: correct, and the five race specs drive current code.
- `explain` after a lost Stop race pushes the plan: matches `console-stop-explain-resolves-anyway`
  intent; tab closed mid-explain is caught by `pushPlanResult`'s `findConsoleTab`.
- `dropForPrefix` matches `prefix` or `prefix:` only; tab ids are UUIDs, no prefix collision.
- `ConsoleSlickGrid` keyed by `pageKey`; teardown order (P99 §9.3 decline) correct.
- Copy all inline/worker split and abort-on-unmount (reported into an unmounted strip, harmless);
  out-of-range `$date` goes raw per Part 11's `ejson.ts`.
- Explain parsers and `SI/queryplan` agree on all 15 fixture pairs (`go test ./internal/queryplan`
  green, `explain-plan.spec.ts` parity block green).

### Block 5: documents and key-value

**F14. Editing a truncated document is allowed; a hand-closed buffer replaces the whole document
with its first 64 KiB.** Medium. Verified (scratch probe: `toShellText` on a body cut mid-string
returns the cut text unchanged) plus code-read.
`SF/views/documents/DocumentView.vue:128-143` (`editGate` checks caps, read-only, projection; never
`isTruncated`), `:585-591` (`startEdit` seeds `toShellText(body)` from the page's truncated body),
`:1086-1094` (Edit button), `SF/views/documents/menu.ts:133-139` (menu Edit uses the same gate),
`SF/views/documents/mutations.ts:16-24` (whole-document `$document` replace).
- Scenario: a 90 KB document arrives truncated at 64 KiB (`isTruncated`, the row shows its
  truncated badge). Edit opens the cut text. Save as is fails to parse (safe), but a user who
  closes the dangling string and braces to make it save sends a valid literal: `replaceOne` drops
  every field past the cut. The plan names this as a must-refuse.
- Fix: make the gate per row: `editGateFor(row)` returns `{ editable: false, label: 'Document
  truncated at 64 KB — not editable' }` when `documentRow(tab.id, row)?.isTruncated`, before the
  projection check; use it for the row button and pass it to `rowMenu`. `startEdit` re-checks.

**F15. The open editor stays on a row index after the page changes under it.** Low. Code-read.
`SF/views/documents/DocumentView.vue:343-355,585-609` (`editingRow`/`editingId` are reset only by
cancel and a successful save; nothing watches the page).
- Scenario: user edits row 3, then deletes row 1 from its menu (immediate mutation, reload) or pages
  forward. Row 3 now holds a different document; the "editing" badge and the editor with document
  A's buffer render under document B's header. Save writes A (by `editingId`), but the screen says
  B. After paging, Save from page 2 still overwrites A.
- Fix: watch page identity (`() => (void pageVersion.n, getPage(props.tab.id))`); on change,
  re-resolve `editingRow` by `editingId` on the new page (scan the loaded ids) and cancel the edit
  when it is gone. Same treatment for `rt.selectedRow` is already done by the store.

**F16. `RowActionButton` puts two tab stops on every row action.** Low. Code-read.
`SF/views/documents/RowActionButton.vue:17-21` (`<span tabindex="0">` wrapping an enabled `Button`).
- Scenario: keyboard user tabs through the document list: each Edit/Delete takes two stops, the first
  (the span) does nothing on Enter/Space and announces no role. Four dead stops per row.
- Fix: put `tabindex="0"` on the span only while the button is disabled (the case that needs a live
  ancestor for the tooltip), e.g. a `disabled` prop that drives both `:tabindex="disabled ? 0 :
  undefined"` and the `Button`'s `disabled`.

Block 5 otherwise clean:
- F4 double check (plan §1): every documents path that changes rows on screen goes through
  `setPage` (load, reload after mutation, projection, filter, sort, page size) and gets a new frozen
  page; `onSet` resets the row parse cache. A `drop` on tab close runs one empty scan before the
  toolbar unmounts and `clearSearchState` runs: harmless.
- `fieldNamesOnPage` memo per frozen page, expansion state (absent = expanded), projection close
  decision, sort text round trip, new-document buffer, delete confirm: correct.
- `KeyValueView.vue` is a thin shell; host key `tab.id` matches `KeyValuePane`'s contract.
- `SD/queries.ts` (zod schemas) matches its importers; no defect.

### Block 6: stream, browse, definition

**F17. Kafka tombstone (null body) renders, copies and docks as an empty string.** Medium.
Code-read. Source: Part 4 F12 / Part 5 F4 renderer half (routed to Part 12; must fix).
`SF/views/stream/page.ts:17-24,40` (`StreamRow.body: string`; `body: cached('body', page.bodies)`
with no `isNull` check, unlike `key`/`timestamp` above it), `SF/views/stream/StreamView.vue:1191`
(body cell text), `:215` (`rowAt(i)?.body ?? ''` into the row menu), `:235,244` (dock gets `''`, so
`?? null` never fires), `SF/views/stream/menu.ts:20-24` (Copy body always offered),
`SF/views/stream/search.ts:66` (null body decodes to `''`; never matches a non-empty needle, so
search is already correct). Contract: Part 5 `21c1338` sets the body null bit for a tombstone
(`SI/page/builder.go:325-353`, `kafka/read.go:116-120`).
- Scenario: a compacted topic with delete markers. Each tombstone shows a blank body cell, the dock
  shows an empty value, Copy body copies `''`: indistinguishable from a message whose value is the
  empty string, which is a different thing in Kafka (compaction deletes the key only for a null).
- Fix (own files): `StreamRow.body: string | null` with `isNull(page.bodies, row) ? null :
  cached('body', page.bodies)`. Body cell: when null render `NULL` with the grid's NULL treatment
  (`text-subtle italic`, the `cell-null` look) and `aria-label="null (tombstone)"`. Dock: pass
  `row.body` (now `null`) so the cell editor shows its NULL state. Menu: `rowMenu(key, body: string
  | null)` omits Copy body for null, same as Copy key for a null key. Search: add an explicit
  `!isNull(page.bodies, row)` guard for clarity. `StreamComposeMessage.vue:30` refuses an empty
  body, so nothing ever resends a tombstone as `''` (verified). Kafka UI coverage lives in Part 5's
  `ST/ipc/kafka/kafka.frontend.spec.ts`: route the assertion there
  (`needs-other-part-file: apps/kira-studio/tests/ipc/kafka/kafka.frontend.spec.ts (Part 5)` for the
  test only); the renderer fix itself needs no other Part's file. No unit test (single condition).

**F18. Stream search rescans the whole page synchronously on every keystroke.** Low. Code-read.
`SF/views/stream/StreamSearchToolbar.vue:44-48` (`watch(query, …)` calls `runSearch` per input
event, no debounce), `SF/views/stream/search.ts:69-82` (decodes and lowercases every key, header,
attr, timestamp and body of every row in one synchronous loop).
- Scenario: Kafka page of 5 000 messages with large JSON bodies (up to 64 KiB each, hundreds of
  MB decoded). Typing "order" runs five full decode-and-lowercase passes on the main thread back to
  back; each keystroke stalls input. The shared `SearchToolbar` debounces 150 ms and scans in rAF
  chunks; this view's own copy does neither.
- Fix: debounce the query watch with `useDebounceFn(…, 150)` (cancel on close/unmount), matching
  `SearchToolbar.vue:171-175`. Moving onto the shared chunked scanner is a larger refactor, not
  needed for the fix.

Block 6 otherwise clean:
- Stream `load`/`poll` (SQS invalidates first, never auto-polls), `reload` for batch tabs drops to
  the placeholder, `runCount` sends the browse filter, `setPageSize`, `applyStreamFilter` clears
  count state, SQS delete captures the row before the confirm await: correct. Selection-clear on
  page change is covered by F9 (counter vs identity).
- Browse `loadSeq` supersession, windowed and debounced `ensureKeyTypes` with in-flight dedupe,
  `${tabId}::preview` host registration and unregister on unmount, level-change resets, S3
  previewable gate, delete with confirm and `setActionError`: correct.
- Definition: no supersession by design; no concrete wrong-screen race found (mount load and Refresh
  write the same object; a failed Refresh shows its error above the previous definition, which is
  the data views' convention). `onCopy` is in F10. Structure filter and Source find bar correct.
- `SD/streamFilter.ts`, `SD/definition.ts`: correct for their callers.

### Block 6 addendum (found during the coverage pass)

**F19. Re-applying a pinned stream filter unpins it.** Low. Verified (scratch probe: record, pin,
record the same filter again; `pinned` goes `[true]` to `[false]`).
`SF/views/stream/streamFilterHistory.ts:59-73` (`recordStreamFilterUse` drops the matching entry
and unshifts a fresh `pinned: false` one).
- Scenario: user pins a Kafka offset/partition filter, later applies it again from the history menu
  (`applyStreamFilter` records every use). The pin is gone, and the entry can now age out of the
  20-entry cap.
- Fix: keep the matched entry's pin: `const prior = existing.find((e) => sameFilter(filter, e));`
  then `pinned: prior?.pinned ?? false` on the new entry.

### Block 7: tests

**F20. `document-console-row-menu-lazy-snapshot.spec.ts` fails when run alone (no active Pinia).**
Low. Verified (alone: 3 fail, `getActivePinia()` thrown from `useDocumentViewStore()` at
`SF/views/documents/menu.ts:59`, reached from the spec's `run()` at `:71`; in the 40-spec subset it
passes because an earlier spec leaves a Pinia active). Same shape as Part 11 F2.
`ST/unit/document-console-row-menu-lazy-snapshot.spec.ts:12-25` (no Pinia setup).
- Scenario: `bun test` on this file alone, or any reorder of the subset, goes red.
- Fix: `setActivePinia(createPinia())` at module top (or `beforeEach`), as the other own specs that
  reach a store do. Re-run each own spec alone and the subset.

Block 7 otherwise clean:
- All 40 own unit specs plus `support/consoleHarness.ts` drive current code: the race specs
  (`console-{auto-explain-race,overlapping-explain-clobber,run-after-tab-close,stop-auto-explain,
  stop-explain-resolves-anyway}`) exercise `run`/`stop`/`explain` through the harness; the thin
  specs (`console-explain-embedded-semicolon`, `hover-value-caption`, `console-mongo-brackets`,
  `sql-cte-shadow`, `sql-lint`, `sql-keywords`) import live exports and assert current rules.
- `ST/perf/parse-callers.spec.ts` measures real callers end to end (opt-in, asserts nothing); not a
  duplicate of `parse-worker-client.spec.ts` (client ordering with a fake worker).
- Gaps a fix needs: F1 (abort-then-worker-error ordering in `parse-worker-client.spec.ts`), F2 (depth
  guard). F17 assertion routed to Part 5's Kafka frontend spec. No other new test warranted
  (single-condition fixes).
- `waitForTimeout` in own UI specs (`autocomplete:741,850,929`, `sql-schema:466`, `definition:184`)
  assert an absence after a quiet period; none races a fixed mock delay against Stop.
- Fixtures: 162 JSON (30 `explain-plans`, 132 `mask`) all parse, every `*.input.json` has its
  `*.expected.json`; `go test ./internal/queryplan` and `./internal/mask -run Parity` green,
  `mask-parity.spec.ts` green (67), `explain-plan.spec.ts` parity block green. Sampled
  `postgres-join`, `mysql-truncated`, `clickhouse-with-estimate` and three `mask` pairs by eye.

## Routing

- F12 (Go cancel-before-register) and the F17 test assertion are appended to
  `P168-routed-from-streamC.md` (`## From Part 12 F12`, `## From Part 12 F17`). The fixer lands the
  F17 renderer fix itself and does not re-append.
- Part 13 tags: none. Every other fix is in own files, plus the Part 11 file `rawTree.ts` for F2
  (allowed in Stream C, state why in the commit).
- DESIGN-DECISION: none.

## Coverage

Base `8b20119`; HEAD reviewed `54b5c10`. Checks: see top. UI, perf and visual specs not run (no
claim needed a run; plan forbids the full UI suite).

- Block 1 reviewed: `workers/parse/*` (6), `editor/{chunkedText,paintSpans,findRanges,hoverInfo,
  searchPattern,monacoLanguages,completion,ranges,diagnostics}.ts`, `edDecorations.css`,
  `MonacoHost.vue`, `beautify.ts`.
- Block 2 reviewed: `SD/{sql-lex,sql-split,sql-lint}.ts`, `console/{format,sqlFormatterEntry,lint,
  sqlDiagnostics,sqlNodes,sqlRefs,sqlHover,mongoStatement}.ts`, `ddl.ts` (`parseDdl`, namespace
  builders, `findTable`; statement handlers skimmed: data-driven, exercised by `ddl-schema` and
  `schema-*` specs), `SD/{console,schema,editor}.ts`. Skimmed: `SD/sql-tokens.ts` (span/identifier
  scanners, memo; grouping read via `statementsWithRefs`), `SD/sql-keywords.ts` (word lists).
- Block 3 reviewed: `console/{completion,sqlLanguageService,sqlSchemaCompletion,
  sqlKeywordCompletion}.ts`, MonacoHost provider glue.
- Block 4 reviewed: `console/{state,resultPages,search,resultMenu,copyAll,explain,explainResults,
  plan,planIssues,planModel}.ts`, `ConsoleView.vue`, `ConsoleResultGrid.vue`, `ConsoleSlickGrid.vue`
  (lifecycle, copy, menus, watches; column building skimmed), `ConsoleSavedMenu.vue`. Skimmed:
  `planParsers/*` (5) and `ExplainResultView.vue` (no `v-html`; renders parsed model): covered by the
  green two-sided fixture parity.
- Block 5 reviewed: `documents/{state,page,search,menu,mutations,projection,sortDocument}.ts`,
  `RowActionButton.vue`, `ProjectionMenu.vue`, `DocumentView.vue` (edit, gate, rows, menus, search,
  watches; toolbar markup skimmed), `keyvalue/KeyValueView.vue`, `SD/queries.ts`.
- Block 6 reviewed: `stream/{page,state,search,menu,mutations,streamFilterHistory}.ts`,
  `StreamSearchToolbar.vue`, `StreamComposeMessage.vue` (submit path), `StreamView.vue` (cells,
  menus, dock, delete, watches; filter-row markup skimmed), `browse/{state,menu}.ts`,
  `BrowseView.vue` (host, key types, row actions), `definition/{state,structure,columnsMenu}.ts`,
  `DefinitionView.vue`, `SD/{streamFilter,definition}.ts`. Skimmed: `StreamFilterHistoryMenu.vue`,
  `definition/{Columns,Constraints,Validation,Indexes,Properties}Section.vue` (presentational, no
  `v-html`, props only).
- Block 7 reviewed: 40 unit specs and harness (each run alone and together), perf spec structure,
  UI spec timing waits, fixtures (all 162 parsed and paired, six sampled by eye, both parity suites
  run). Not reached line by line: UI spec bodies (7), visual specs (2), `ST/perf/{documents-*,
  console-grid-scroll,pureFns.entry,documentsFixture}.ts` (measurement harnesses; nothing to judge
  without a run, none needed).

Counts: high 0, medium 5 (F2, F4, F9, F14, F17), low 15.
