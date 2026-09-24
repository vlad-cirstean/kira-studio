# P108 Part 10 — Studio grid and shared view machinery review findings

Scope: `apps/kira-studio/frontend/src/views/grid/**` and `views/shared/**`, plus their unit and UI
tests. Plan: `P108-part10-studio-grid-shared-view.md`. Review only; fixer applies each finding as its
own commit. Paths below are relative to `apps/kira-studio/frontend/src/` unless they start with
`apps/`, `docs/` or `packages/`. Items already in `docs/ARCHITECTURE.md` Known open items are not
re-reported.

Severity count: 1 High, 9 Medium, 11 Low.

## F1 (High) — Sibling reload silently discards another tab's staged edits

Sites:
- `views/grid/state.ts:142` (`load()` calls `clearPending(tabId)` unconditionally)
- `views/grid/state.ts:215-230` (`reloadAfterMutation` ends with `reloadTabsForTarget(…, tabId)`)
- `state/viewCommands.ts:93-110` (`reloadTabsForTarget` reloads every hydrated `data` tab on the same
  connection and path)
- `views/shared/immediateMutation.ts:32` (same sibling fan-out after a document/keyvalue/stream write)
- `workbench/GenerateDataDialog.vue:173`, `:191` (call `reloadAfterMutation` on the dialog's own tab)
- `views/grid/DataToolbar.vue:130-134` (`canGenerateData` has no pending-changes gate)

Bug: every sibling `load()` clears that sibling's pending set. No path checks `hasPending` first or
asks.

Reachable:
1. Open one table in two data tabs. Stage edits in tab B. Commit anything in tab A. Tab B reloads in
   the background and its staged edits vanish with no message.
2. Stage edits in tab A, then run Generate Data from tab A's own toolbar. The dialog's
   `reloadAfterMutation(A)` clears tab A's own staged edits.

D3's rationale (`state.ts:139-141`: staged edits no longer identify real rows once the page changes)
covers a user's own navigation. It does not cover a background refresh the user never asked for.
`menu.ts:115-117` already names this hazard for FK edit and works around it with `newTab: true`.

Fix:
- In `reloadTabsForTarget`, skip a `data` tab whose pending set is non-empty. Mark it stale instead
  (reuse the count's `stale` idea or a runtime flag) and let the user refresh.
- Gate Generate Data on `!hasPending`, same as the mask-preview toggle (`DataToolbar.vue:81-83`).

## F2 (Medium) — Failed, cancelled or superseded load still drops staged edits

Sites:
- `views/grid/state.ts:139-142` (`clearPending` before `beginOp`/`runPagedLoad`)
- `views/grid/state.ts:154` onward (`onFailure` only reverts `pageIndex`)
- `views/shared/page/load.ts:20-48` (`runPagedLoad` failure tail)

Bug: pending is cleared before the read starts. If the read fails, is stopped (Stop button,
`E_CANCELLED`) or is superseded, `setPage` never runs. The old page stays on screen with its staged
edits gone. D3's own reason for the discard (the page was replaced) does not hold.

Reachable: stage edits, click Next or Refresh, then Stop. Or page while the connection drops.

Fix: snapshot `pendingFor(tabId)` before the read and clear only inside `apply`, after the new page
lands. Alternative: restore the snapshot in `onFailure`. A unit test for the restore-on-failure
ordering meets the CLAUDE.md bar (cancellation plus ordering).

## F3 (Medium) — Generated columns are editable on existing rows

Sites:
- `views/grid/SlickGridHost.vue:1580-1592` (`onBeforeEditCell`: vetoes gutter, insert rows,
  `!canEditTable()`, deleted rows, truncated cells; no generated veto)
- `views/grid/paste.ts:47-70` (`stagePastedRow`: existing rows get `stageEdit` unconditionally; the
  doc at `:47` says "skipping a generated column either way", which is false)
- `views/grid/menu.ts:311-317` (Set NULL disabled only by `editDisabled`)
- `views/shared/celleditor/state.ts:44-51` (`readOnlyReasonFor`: masked, read-only, truncated,
  no-PK only)
- `apps/kira-studio/internal/adapters/sqlmutate.go:30-32` (`AssertColumnsKnown` does not refuse a
  generated column)

Bug: inline edit, paste and Set NULL all stage an UPDATE into a generated column. The engine rejects
it at commit (Postgres: "column … can only be updated to DEFAULT"; MySQL error 3105). The whole
commit fails and the message does not name the staged cell. The insert paths already skip generated
columns (`duplicateAsInsert`, `applyPastedCells:86-88`, fake data), so the existing-row path is the
inconsistency.

The dock disagrees with the grid too. `readOnlyReasonFor` returns null for a generated column and
for a row pending delete. The dock looks editable. Save on a pending-delete row calls `stageEdit`,
which refuses silently (`pendingChanges.ts:125`).

Fix:
- Veto generated columns in `onBeforeEditCell`, `stagePastedRow` (existing-row branch) and Set NULL.
- Add `generated-column` and `pending-delete` reasons to `readOnlyReasonFor`, checked in the same
  order the grid gate uses.
- Optionally reject a generated column in `AssertColumnsKnown` so the server names it.

## F4 (Medium) — Row- and cell-kind paste ignore the selected rows and the filter

Sites:
- `views/grid/paste.ts:23-40` (`resolvePasteTarget`)
- `views/grid/paste.ts:16-22` (doc claims row paste "targets the user's own explicit gutter-click
  rows" and cell paste is unaffected by the filter)
- `views/grid/paste.ts:64-66` (clipboard wider than remaining columns: extra cells dropped, silent)

Bug: for `row` kind, `startRow = Math.min(...sel.rows)` and `rowAt = startRow + ri`. A ctrl-click
selection of rows 2, 7 and 9 pastes into 2, 3 and 4. For `row` and `cell` kinds with a multi-row
clipboard, `startRow + ri` also lands on rows the active search filter hides. Only `range` kind goes
through `pasteTargetRows`. Staging into hidden rows is invisible until the filter is cleared, and the
commit then updates rows the user never saw.

Fix:
- `row` kind: map clipboard row `ri` to `sortedRows[ri]`, then continue into the insert region past
  the last selected row. When the clipboard has fewer rows than the selection, stop.
- `cell` kind: use `pasteTargetRows(displayRows, rowCount, startRow, n)` like `range`.
- Correct the doc comment. A unit test for the row-kind mapping meets the bar (boundary arithmetic).

## F5 (Medium) — In-app copy then paste corrupts values

Sites:
- `views/shared/clipboardFormats.ts:22-24` (`neutralizeFormulaPrefix`, `/^[=+\-@\t\r]/`)
- `views/shared/clipboardFormats.ts:31-35` (`tsvField` applies it), `:72-76` (`csvField`)
- `views/grid/SlickGridHost.vue:1776-1806` (`onCopy`: single cell raw; range, row and column copies
  neutralized)
- `views/shared/clipboardFormats.ts:130-136` (`parseDelimited`: TSV if a tab is present, else CSV)
- `views/grid/SlickGridHost.vue:1811-1830` (`onPaste` stages parsed text verbatim)

Bug, three parts:
1. A range, row or column copy of `-5`, `+44 20…` or `@handle` writes `'-5`. Pasting it back into
   this grid stages `'-5`. A numeric column fails at commit; a text column silently gains a leading
   quote.
2. A cell copy is raw. The same value copied inside a range, row or column is neutralized. Same data,
   two clipboard texts.
3. A single-cell copy is raw text. Pasting `Main St, Apt 4` or `[1,2]` splits on commas into two
   columns. A multi-line value splits into rows. Copy then paste of one cell is not a round trip.

CWE-1236 applies to text a spreadsheet will evaluate. Plain Copy goes to this app as often as to a
spreadsheet.

Fix:
- Keep `neutralizeFormulaPrefix` only on explicit spreadsheet-bound formats (Copy as CSV, export).
  Plain Copy writes TSV with quoting only.
- On paste, treat clipboard text with no tab and no newline as one value, not CSV.
- Make single-cell copy and one-cell range copy produce the same text.

## F6 (Medium) — Filter-by-value and FK nav build literals from display text

Sites:
- `views/grid/menu.ts:250-252` (`filterExpr` from `ctx.text`), `:332-340` (never disabled)
- `views/grid/SlickGridHost.vue:1712` (`text: dc.text`), `:1721` (`rowValues: rowSnapshot(row).values`)
- `views/grid/SlickGridHost.vue:357-364` (masked `displayCell`), `:371-388` (masked `rowSnapshot`)
- `views/grid/SlickGridHost.vue:1149` (FK nav button uses unmasked `navValuesFor`)
- `views/grid/slick/rowValues.ts:29-46` (`displayCell` returns the staged value when one exists)

Bug: the literal comes from whatever the cell displays.
- Masked cell under preview: the filter compares against the masked text and matches nothing. The
  context-menu FK items get masked values too, so "Go to referenced row" finds nothing. The FK nav
  button on the same cell uses raw values and works. Same cell, two answers.
- Truncated cell: the literal is the 64 KiB prefix and matches nothing.
- Staged cell: the filter uses the uncommitted value. `setFilter` then runs `load()`, which clears
  the staged edit the filter was built from (F1/F2's `clearPending`).

Fix:
- Build filter and FK literals from raw page values (`cell()`), never the masked wrapper.
- Disable Filter by this value for a truncated cell, and for a staged cell (or use the committed
  value and say so in the label).

## F7 (Medium) — Two quick Next clicks under keyset paging show the wrong page number

Sites:
- `views/shared/page/navigation.ts:46-57` (`goNext`)
- `views/shared/page/PagerControls.vue:130` (Next disabled only by `!hasMore`)

Bug: `goNext` reads `rt.nextToken` and bumps `pageIndex` without an in-flight guard. The second click
lands before the first read returns. It reuses page 0's `nextToken`, so it reads page 1 again, while
`pageIndex` is now 2. The pager says page 3 and row numbers start at `2 * pageSize`, over page 2's
rows. Offset paging computes from `pageIndex` and is correct.

A variant: first click superseded, second click fails. `onFailure` reverts to the second click's
`prevIndex` (1), but page 1 never loaded. The pager says page 2 over page 1's rows.

Fix: disable pager buttons while `rt.opId` is set, or have `goNext`/`goPrev` return early when a load
is in flight. Revert on failure to the index of the last page that actually landed, not the
caller's `prevIndex`.

## F8 (Medium) — Generate Data boolean values break on MySQL and SQLite

Sites:
- `views/grid/fakeData/generate.ts:164-165` (`datatype.boolean` emits `"true"`/`"false"`)
- `apps/kira-studio/internal/adapters/mysqlfamily/read.go:47-51` (`tinyint(1)` is boolean)
- `apps/kira-studio/internal/adapters/sqlite/read.go:35` (declared `BOOLEAN` is boolean)
- `apps/kira-studio/internal/adapters/sqlmutate.go:110` (`NewParamRenderer` binds text as-is)

Bug: the value travels as a string parameter. MySQL in strict mode (default since 5.7) rejects
`'true'` for a `TINYINT` ("Incorrect integer value"), so every batch fails with 0 rows committed.
SQLite stores the text `'true'` in a NUMERIC-affinity column instead of `1`. Postgres and ClickHouse
accept `true`/`false`.

Fix: emit `1`/`0` for the `mysql` and `sqlite` dialects, `true`/`false` otherwise.

## F9 (Medium) — Relaxed EJSON copy loses `$numberLong` precision

Site: `views/shared/document/ejson.ts:387-390` (`canonicalToRelaxed`: `Number(value.$numberLong)`)

Bug: an Int64 above 2^53 (`9007199254740993`) becomes `9007199254740992` in the copied text. The
copy looks valid, and a user pasting it into a query or filter targets a different value.
`ejsonToPlain`'s precision loss is a documented accepted tradeoff (`:418-435`); this conversion has
no such note, and Relaxed EJSON is meant to round-trip.

Fix: when `Number(s)` is not a safe integer (`!Number.isSafeInteger`), keep the `{ "$numberLong": s }`
wrapper. Otherwise unwrap.

## F10 (Medium) — FK preview popover hidden from assistive tech

Site: `views/grid/FkPreviewPopover.vue:132` (`aria-hidden="true"` on `.fk-preview-backdrop`)

Bug: the backdrop is the panel's ancestor. `aria-hidden` hides the whole subtree: the title, the
"Open in new tab" button and the preview table. P108 Part 13 F4 fixed the same pattern in
`KuiDialog.vue`/`KuiPopoverPanel.vue` (`docs/v1.9/SPEC.md` "P108 Part 13 result"); this file was not
in Part 13's scope and still carries it.

Fix: drop `aria-hidden` from the backdrop, or make the backdrop a sibling of the panel.

## F11 (Low) — ClickHouse identifier quoting disagrees with Go

Sites:
- `views/shared/sqlIdent.ts:40-43` (`quoteIdent`: mysql and clickhouse only double backticks)
- `apps/kira-studio/internal/adapters/clickhouse/read.go:22-29` (Go: panics on NUL, escapes `\` then
  backtick)
- Callers: `views/shared/clipboardFormats.ts:109` (Copy as INSERT), `views/grid/menu.ts:89`,
  `:251-252` (FK nav, filter-by-value), `views/grid/filterCompletion.ts:48`

Bug: ClickHouse processes backslash escapes inside backtick identifiers. A column named `a\` quotes to
`` `a\` ``, where `` \` `` escapes the closing quote. The filter fails to parse, or the SQL names the
wrong column. MySQL treats backslash literally in identifiers, so it stays correct there.

Fix: split the set. For `clickhouse`, escape `\` to `\\` before doubling backticks, matching Go. Reject
or strip NUL.

## F12 (Low) — Commit that empties the last page leaves an empty page N

Sites:
- `views/grid/state.ts:219` (`load` at `pageIndex * pageSize`, no clamp)
- `views/shared/page/navigation.ts:80-89` (`goLast` trusts `rt.count`)

Bug: delete every row on the last page and commit. The reload reads the same offset, gets 0 rows,
and shows an empty grid labelled page N. When no count ran, nothing corrects it. When a count exists,
`runCount` reads the stale L3 entry (`state.ts:220-225`). The chip greys it, but "of N" and
`goLast` still use the pre-delete total.

Fix: after `reloadAfterMutation`'s load, if the page is empty and `pageIndex > 0`, step back one
page.

## F13 (Low) — Count failure is silent

Site: `views/shared/viewOp.ts:166-184` (`runPagedCount` catch swallows the error)

Bug: `setFilter` nulls the count first (`state.ts:269-282`). A count that then fails leaves the
toolbar blank, as if never requested. The user has no signal it failed or why.

Fix: set a `countError` on the runtime and show it in the count chip. Keep the old count on a failed
refresh as today.

## F14 (Low) — Immediate mutation reports failure after a successful write

Site: `views/shared/immediateMutation.ts:21-34`

Bug: `data.mutate` succeeds, then `opts.reload` throws (for example `data.invalidate` over a dropped
bridge). The caller's catch reports the mutation as failed, and `reloadTabsForTarget` and `after`
(browse invalidation) never run. A user retrying a non-idempotent write (Redis list push, stream
`XADD`) duplicates it.

Fix: wrap the post-mutate steps in their own try/catch. Report "saved, but refresh failed" and still
run the sibling reload and `after`.

## F15 (Low) — Epoch timestamp parsing is too permissive and encoding rounds

Sites:
- `views/shared/celleditor/timestamp.ts:131-145` (`parseTimestamp`: `Number(t)`)
- `views/shared/celleditor/timestamp.ts:152-153` (`encodeTimestamp`: `Math.round(ms / 1000)`)

Bug:
- `Number` accepts `0x10` (16) and `1e9`, and `Number('')` is 0. `validateFormat` pre-checks empty,
  but `parseTimestamp` itself reads an empty or blank value as 1970-01-01 for any other caller.
  Hex and exponent spellings re-encode as plain digits after an edit.
- A fractional epoch-seconds value (`1700000000.5`) parses, then re-encodes rounded after any
  edit in the pane. That breaks the "exact inverse" contract in the `encodeTimestamp` doc (P24 D16).

Fix: parse epoch text with `/^-?\d+(\.\d+)?$/` first. Carry the fractional digit count in the shape
and re-emit it.

## F16 (Low) — A user regex can freeze the UI

Sites:
- `editor/searchPattern.ts:23-28` (`new RegExp(text, 'g' | 'gi')`)
- `views/shared/page/scan.ts:65-77` (`eachMatch`), `:97-171` (`runChunkedScan`)

Bug: chunking bounds rows per frame, not one `exec`. `(a+)+$` against one long cell backtracks on the
main thread with no escape. Stop cannot run because the event loop is blocked. The Go-side git search
uses RE2 for this reason.

Fix: run regex-mode scans in a worker with a per-scan timeout. Cheaper alternative: cap the text length
a regex runs against per cell and document the limit.

## F17 (Low) — Cell editor dock discards a dirty buffer without warning

Sites:
- `views/shared/celleditor/CellEditorView.vue:199-210` (watch on `selectedCell` calls
  `buffer.reseed()` on any key or value change)
- `views/shared/useEditBuffer.ts:91-95` (`reseed` ignores `isDirty`)

Bug: type in the dock, then click another grid cell before Save. The buffer reseeds and the typed
text is gone. A background republish of the same cell with a changed value (a sibling reload, F1) does
the same.

Fix: when `isDirty`, keep the buffer and show a "value changed" or "unsaved edit" chip with Save and
Discard. Alternative: stage the dirty buffer on cell switch, same as the grid's inline editor commits
on blur.

## F18 (Low) — Preview SQL panel shows the previous open's statements

Site: `views/grid/PreviewCommandPanel.vue:24-32` (key `['previewPending', tabId]`, default `staleTime`)

Bug: the key carries no pending-set version. Reopening after more edits shows the cached SQL at once
(`isLoading` is false while data exists) until the refetch lands. For that window the panel shows
statements that do not match what Commit will send. Commit itself rebuilds the plan, so no wrong
write results.

Fix: add a pending-set version (a counter bumped on every stage/discard) to the key, or set
`gcTime: 0` so each open starts empty.

## F19 (Low) — `finance.amount` overflows `numeric(p,p)`

Site: `views/grid/fakeData/generate.ts:144-147`

Bug: `wholeDigits = Math.max(1, …)`. For `numeric(2,2)` (max 0.99) it generates up to 9.99. Every
batch fails with a numeric overflow.

Fix: allow `wholeDigits = 0` and use `max: 1 - 10 ** -dec` in that case.

## F20 (Low) — `load.ts` header claims `stream/state.ts` shares the frame

Sites:
- `views/shared/page/load.ts:4-11`
- `views/stream/state.ts:113-155` (hand-written load with the same supersede and failure tail)

Bug: `runPagedLoad` callers are grid, documents and keyvalue only. The header lists stream too. The
stream load is the same shape (opId supersede, `stillMounted`, kind check, `applyLoadFailure`) and
could adopt the frame; `navigation.ts:6-10`'s reason for excluding stream (no `pageIndex`) applies to
navigation, not to the load frame.

Fix: adopt `runPagedLoad` in `stream/state.ts` (Part 11's file, same stream), or name the real shape
difference and correct the header.

## F21 (Low) — Doc drift: vue-virtual and pager file name

Sites:
- `docs/ARCHITECTURE.md:49` (grid row: "`@tanstack/vue-virtual` is no longer a dependency (P30 §3.6
  C7)")
- `docs/ARCHITECTURE.md:2117` (names `views/shared/page/Pager.vue`)
- `views/shared/page/columns.ts:180-181` (comment: "retired with @tanstack/vue-virtual itself")

Bug: root `package.json:89` pins `@tanstack/vue-virtual` 3.13.39. `views/shared/keyvalue/KeyValuePane.vue:39`
and `views/grpcrequest/ResponsePane.vue:8` import `useVirtualizer`. `ARCHITECTURE.md:35` already says
it is the baseline for row virtualization, contradicting line 49. The pager file is
`views/shared/page/PagerControls.vue`; no `Pager.vue` exists.

Fix: line 49 says the grid no longer uses it (SlickGrid virtualizes), not that the dependency is gone.
Line 2117 names `PagerControls.vue`. The `columns.ts` comment says the column axis retired, not the
library.

## Examined, nothing real

- Mask-preview lockout: `canEditTable`, `canDeleteRows` (`SlickGridHost.vue:267-279`) and
  `DataToolbar` `isWritable` (`:60-65`) all include `!maskPreview`. Toggling preview is refused while
  pending exists. No menu or shortcut stages while masked.
- Navigation discard without a confirm (pager, sort, filter, projection, refresh): intended per D3
  (`state.ts:139-141`, `pendingChanges.ts:8-10`). F1 and F2 cover only background and failed loads.
- Partial PK: a projection hiding PK columns with `loadMeta` failed builds a partial key, but Go's
  `AssertKeyIsPrimaryKey` (`sqlmutate.go:57-74`) rejects any key that is not exactly the PK. A
  truncated PK cell yields a key matching zero rows; the affected-exactly-one assertion rejects it.
  Friendly message only; no wrong write.
- Edits to a PK column: `primaryKeyOf` reads `cell()`, the committed page value, not the staged one.
  Correct.
- No-op updates: the inline editor skips unchanged values (`slick/editor.ts:104-106`). Paste can stage
  a same-value UPDATE; paste is an explicit write, so intended.
- Commit partial failure: `Mutate` is one transaction per adapter contract (`adapters/adapter.go:78-81`)
  and `commitPending` clears only on success (`pendingChanges.ts:295-311`). `DataView.onCommit` shows
  the error (`:125-134`).
- Selection normalization: `selectionFromRanges` builds through `SlickRange`, which normalizes the
  anchor. `selectionCovers`, `selectionEdges`, `visibleRowsInSpan` and `resolvePasteTarget` all see
  anchor at top-left. `Math.min(...[])` is unreachable: a `row` selection always has one row.
- Empty filtered view: `displayPositionOf`/`pageRowAt`/`rowHandleAt` fall back safely; no action
  reaches a real row.
- `GUTTER_OFFSET` arithmetic agrees across `dataSource.ts` and `SlickGridHost.vue`.
- Pager bounds: `PagerControls.onJump` clamps to `pageCount` when a count exists (`:54-69`). Prev and
  First are disabled at index 0, Next by `!hasMore`, Last by `!pageCount`. `goToPage`'s low-only
  clamp is not reachable past the last page from the UI.
- `applyLoadFailure` with a stale `opId` returns before touching status; a superseding op owns the
  status. No stuck `loading`.
- Range paste spilling into insert rows past the filtered rows: intended per the `pasteTargetRows`
  doc (`rowValues.ts:79-85`).
- `useConnectionGate.onReconnectAndLoad` marks hydrated after a connect that lands in an error state
  (`connections/service.go:679-699` returns nil error). `needsReconnect` also checks
  `connectionStatus !== 'connected'`, so the gate stays up. The doomed `load` fails as disconnected
  and `applyLoadFailure` unmarks hydrated. Self-correcting; not reported.
- `ejsonToPlain` Long/Decimal precision loss: documented accepted tradeoff (`ejson.ts:418-435`).
- `rowsToInsert` writes a truncated column as NULL with a leading comment naming it (`clipboardFormats.ts:102-127`).
- `pageColumnIndexFor` last-wins on duplicate names: tables and views cannot expose duplicate column
  names in any supported engine (SQLite renames view duplicates), so the data grid never sees one.
  Console result pages are Part 11.
- `scrollTrace.ts` module-level `gridEl`: `unregisterGrid` only nulls on identity match, so a keyed
  remount in either order is safe. Probe-only code.
- `kiraSlickGrid.ts` teardown: `destroy()` removes the capture-phase scroll listener with the matching
  flag and cancels the chase rAF before `super.destroy()`. `editor.ts` add/remove are paired
  (`:68`, `:120`).
- TanStack Query mask rules (`SlickGridHost.vue:595-600`) and counts (`DataToolbar.vue:73-77`): getter
  form, key reactive to the tab's connection; `setQueryData` writes update them. `retry: false` and no
  focus refetch app-wide (`packages/workbench/src/state/queryClient.ts:20-32`).
- Tab-close cleanup: grid runtime, keyvalue runtime and `::preview` page, document rows, search and
  visible-rows state register `registerTabRuntimeCleanup`. Pending changes clear in
  `state/tabs.ts:149`. The `previewPending` query entry is inactive and expires on default `gcTime`.
- Disabled controls in `TooltipTrigger`: every `:disabled` button in `views/grid` and `views/shared`
  sits inside `TooltipDisabledTrigger`.
- `AutocompleteField.vue` `escapePlain` (`:121-123`) escapes `& < >` for text content; `"` matters only
  in attributes, which `paintOverlayHtml` (Part 11, `editor/paintSpans.ts`) builds from static class
  names.
- `detect.ts` detectors: anchored or linear regexes; no backtracking hazard found on 64 KiB input.
- `validate.ts` accepts an empty value for every format; an empty string on a NOT NULL numeric column
  fails server-side with the engine's message. Not a UI bug.
- Regex mode without the `u` flag can highlight half a surrogate pair for `.`-style patterns.
  Cosmetic only; not reported.
- `fakeData`: generated columns and defaulted PKs skip; `planWarnings` flags unique and FK columns;
  batches are generated one at a time. Bounds parsing handles MariaDB display widths and ClickHouse
  enums.
- `<style>` blocks with `@apply`: P99 Part 4's recorded decision (`docs/v1.9/SPEC.md:461`, `:544-574`).
- Unit tests such as `grid-stage-delete-idempotent.spec.ts` sit below the CLAUDE.md bar, but that rule
  applies going forward, not as retroactive cleanup. Not reported.
