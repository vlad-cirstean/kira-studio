# P168 Part 11 findings: Studio grid and shared view machinery

Plan: `P168-part11-studio-grid.md`. Base commit `9c4f0f9` (plan survey). HEAD reviewed `cd8e3e1`
(`p168-stream-c`, rebased on `v2.0`). User grid commits `b088feb`, `0eeedb6`, `4d65b17` are in the
tree: header `will-change: transform` and canvas `contain: layout paint` are back, cell borders stay
transparent. Current `slickTheme.css` is authoritative.

Each finding: severity, `file:line` at HEAD, failure scenario, fix, "verified" (scratch probe or
real run) or "code-read". `DESIGN-DECISION` marks one needing a product call (no fix proposed).
`needs-other-part-file` marks a fix outside Part 11 files; routed to `P168-routed-from-streamC.md`.

## Checks (baseline at `cd8e3e1`)

- `bun run typecheck:web:studio`: pass.
- `bun run typecheck:unit:studio`: pass.
- `bunx biome check` over `views/grid`, `views/shared`, `tests/unit/*.ts`, `tests/ui`, `tests/perf`:
  pass (281 files).
- `bun test` over the 31 own unit specs together: **206 pass, 14 fail** (red, F1). Without
  `grid-rows-for-selection.spec.ts`: 300 pass, 0 fail. Alone, `grid-rows-for-selection` and
  `view-op-disconnected-status` each fail (F1, F2).
- `bun test apps/kira-studio/tests/unit` (whole directory, 97 files): 776 pass, 0 fail. Order luck
  hides F1/F2 there.

## Block 1: shared grid engine and page machinery

### F1. medium. Own unit specs red when run as the plan's subset (verified)

- `apps/kira-studio/tests/unit/grid-rows-for-selection.spec.ts:4-6`.
- Spec imports `rowsForSelection` statically. Its own comment says the chain reaches
  `/wails/runtime.js` at module scope and needs the dynamic-import pattern
  (`grid-commit-composite-pk-guard.spec.ts`). Static imports link before
  `@workbench/testing/unit/window` registers its `mock.module`. Run alone it fails
  `Cannot find module '/wails/runtime.js'`. Run first among the 31 own specs it poisons the module
  graph: 13 more specs report "Unhandled error between tests" (`page-navigation-in-flight-guard`,
  `grid-stage-delete-idempotent`, `grid-commit-*`, `view-state`, ...), 206 pass / 14 fail. Full
  directory passes only because another spec registers the mock first.
- Scenario: the Part 11 fixer's mandated re-run of own unit specs is red before it edits anything;
  a CI shard or `bun test <file>` run gives false failures.
- Fix: `const { rowsForSelection } = await import('../../frontend/src/views/grid/slick/rowValues');`
  after the window import, matching the composite-pk spec. Keep the `Selection` type import static.

### F2. low. `view-op-disconnected-status.spec.ts` depends on another spec's active Pinia (verified)

- `apps/kira-studio/tests/unit/view-op-disconnected-status.spec.ts:14,29`.
- `applyLoadFailure` (`views/shared/viewOp.ts:150`) calls a Pinia store. The spec never calls
  `setActivePinia`. Alone: `getActivePinia() was called but there was no active Pinia`, 1 fail.
  Passes in a group only when an earlier spec left a Pinia active.
- Fix: `setActivePinia(createPinia())` (or the app `pinia` from `state/pinia`, as
  `api-variables-delete-eviction.spec.ts` does) before the dynamic import.

### F3. medium. Search filter mode hides matching rows past the 50 000-match cap (code-read)

- `apps/kira-studio/frontend/src/views/shared/page/searchFilter.ts:462-476`,
  `views/shared/page/scan.ts:50,129-134`, `views/shared/page/SearchToolbar.vue:43,357-358`.
- `runChunkedScan` stops appending at `MAX_SCAN_MATCHES` (50 000) but keeps counting `found`.
  `matchedRowsOf` derives filter rows from the capped `matches` array. A 10k-row page with 10
  text columns, search `e`: matches exceed 50 000 by roughly row 5 000. Filter on: rows past the
  cap vanish though they match. Label reads "showing 5,000 of 10,000 loaded", which looks like a
  real answer. Selection, copy and delete on "all filtered rows" then act on half the true set.
  The match-count line flags capping (`search-capped`); the filter label does not.
- Fix: count matched rows separately from capped matches. `runChunkedScan` already walks every
  row; record a row in a `matchedRows: number[]` (bounded by `rowCount`, at most 10 000) whenever
  `rowBuf.length > 0`, return it in `ScanResult`, publish it in `searchState`, and have
  `matchedRowsOf` read it. Unit guard in `scan.spec.ts`: cap 2, three matching rows, filter rows
  = 3.

### F4. low. Any other tab's page load or tab close restarts this tab's search (code-read)

- `apps/kira-studio/frontend/src/views/shared/page/SearchToolbar.vue:183-188`,
  `views/shared/page/store.ts:106,115`, `state/tabKinds.ts:145`.
- `pageVersion` is one counter per page store, shared by every tab of that kind. `setPage` and
  `drop` bump it for any scope. The watch restarts the scan on every bump. Scenario: user searches
  grid tab A, presses Next to match 40, then closes grid tab B (`dropGridPagesForTab`) or a
  background reload lands on tab C. Tab A's scan restarts: `searchState` is reset to
  `{matches: [], pending: true}` (highlights flicker off), priority tick sets index -1, done sets
  index 0. Current match jumps from 40 to 0 with no user action.
- Fix: watch the page identity for this tab, not the store counter. Add `pageOf(tabId)` to
  `PageSearchApi` (grid/documents/keyvalue each have `getPage`) and watch
  `() => { void props.api.pageVersion.n; return props.api.pageOf(props.tabId); }`; restart only when
  the returned page object changes. Make `pageOf` optional in `createPageSearch` (fall back to
  today's counter watch) so grid (`grid/search.ts`) and keyvalue (`shared/keyvalue/search.ts`)
  wire it now. `needs-other-part-file: apps/kira-studio/frontend/src/views/documents/search.ts
  (Part 12, Stream C)` for documents; Part 12 picks it up, nothing routed to Stream A/B.

### F5. low. Pager jump accepts a fractional page (code-read)

- `apps/kira-studio/frontend/src/views/shared/page/PagerControls.vue:47-57`.
- `type="number"` still yields `"2.5"`. `Number.isFinite(2.5) && 2.5 >= 1` passes; `jump` emits
  1.5; `navigation.goToPage` requests offset `1.5 * pageSize` and stores `pageIndex: 1.5`. Pager
  shows "page 2.5"; with page size 10 the offset is 15, overlapping pages 2 and 3; Next then uses
  `2.5 * 10`. A tiny fraction (`1.0001`) with page size 1000 sends offset 0.1, which a strict
  adapter rejects.
- Fix: require `Number.isInteger(value)` in `valid` (or `Math.floor` before clamping) and add
  `step="1"`.

### Block 1 notes (checked, nothing real)

- `slickTheme.css` (current, after `4d65b17`): the P162 comment at `:216-218` citing "the header
  strip's `will-change` layer" is accurate again (`:116-118` restored by `b088feb`). Plan's stale
  comment lead is moot. Cell `border-color: transparent` (`:229`) keeps stock geometry. No rule that
  belongs in Tailwind; SlickGrid DOM is imperative.
- `KiraSlickGrid`: `destroy` cancels chase rAF and removes the capture listener before
  `super.destroy`; `scheduleChase` cannot re-arm after destroy (`chaseWanted = false`). `growStart`/
  `growEnd` respect `remaining`; `mustEnd < mustStart` handles `dataLength` 0. `lastRenderedRowBounds`
  is not reset on `invalidateAllRows`, so the next pass treats rebuilt rows as cached and skips the
  budget: perf only, inside the user-decided runway area (plan §6), not reported.
- `ensureColumnRules`: append-only, one `<style>` per 256 columns, bounded by the widest grid.
  Accepted P139 trade-off.
- `createPageStore`: `setVisibleWindow` exclusive `endRow`; every caller passes `hi + 1`. `drop` is
  wired for grid/keyvalue/documents/stream/console in `state/tabKinds.ts`.
- `runPagedLoad`: superseded and closed-tab guards correct. `navigation.ts`: `goFirst`/`goLast`/
  `goToPage` lack the in-flight guard by design (they supersede); revert path checked in block 2.
- `subscribeRowHeight`: SlickGrid `setOptions` re-runs `createCssRules` via `updateColumnsInternal`,
  so `--sg-row-h` follows density.
- `scrollTrace.ts`/`scrollVelocity.ts`: every hook returns on `!recording`; no per-frame allocation
  when off.
- `selection.ts`, `selectionEdges.ts`, `cssLayers.ts`, `dataSource.ts`, `rowVisibility.ts`,
  `gridHostShared.ts`: arithmetic consistent with `displayPositionOf`/`isRowVisible`; search
  matches are always visible rows under filter, so `displayPositionOf`'s nearest-row fallback never
  mislabels a match.

## Block 2: data grid core

### F6. high. Commit can run twice; edits staged during a commit are dropped (code-read)

- `apps/kira-studio/frontend/src/views/grid/DataView.vue:117-126,276-283`,
  `views/grid/pendingChanges.ts:295-311`.
- Commit is disabled only on `!isWritable`. `commitPending` builds the plan, awaits `data.mutate`,
  then `clearPending`. Nothing marks the tab as committing.
- Scenario A: user double-clicks Commit on a staged insert. Click 2 runs `buildPlan` while click 1
  awaits `mutate`; pending is not cleared yet, so both send the same ops. Two INSERTs land (a
  serial PK makes both succeed). A staged UPDATE runs twice; a staged DELETE's second run fails the
  adapter's exactly-one-row check and shows an error strip although the first commit succeeded.
- Scenario B: user stages another cell while the commit is in flight (slow network, large plan).
  `clearPending` after the await deletes it, then `reloadAfterMutation` replaces the page. The edit
  vanishes with no message. Discard during the await is also accepted while the ops are already on
  the wire.
- Fix: add per-tab `committing` state to `usePendingChangesStore` (set before `buildPlan`, cleared
  in `finally`). `commitPending` returns early when set. Disable Commit, Discard, Preview while
  set. Fold `!committing` into `canEditTable()` (`SlickGridHost.vue:274`) and the toolbar's
  `isWritable` so no edit path stages during the await. Unit guard (concurrency, meets the test
  bar): fake `data.mutate` that resolves on demand, call `commitPending` twice, assert one
  `mutate` call.

### F7. medium. DESIGN-DECISION: paging, sort, filter, projection and Refresh silently discard staged changes

- `apps/kira-studio/frontend/src/views/grid/state.ts:180` (`load` apply calls `clearPending`),
  callers `navigation.ts:144-200`, `state.ts:208,272-305`; gating present only in
  `DataToolbar.vue:80-137` (mask preview, Generate Data).
- Staged edits are scoped to page-row indices, so a new page must drop them (D3, F2 P108 Part 10).
  But only Generate Data and the mask toggle refuse while changes are pending ("Commit or discard
  pending changes first"). Next/Prev/First/Last/jump, page size, sort header, filter Enter,
  projection, ↻ Refresh and `view.refresh` all reload and drop 20 staged edits without a prompt.
- Decision needed: gate these controls like Generate Data, or confirm before discarding
  (`PW/state/confirmDialog`), or keep staged changes keyed by primary key across reloads. No fix
  proposed.

### F8. medium. Paste stages against a page and selection captured before the clipboard await (code-read)

- `apps/kira-studio/frontend/src/views/grid/SlickGridHost.vue:1794-1826`.
- `sel` and `p` are read, then `await navigator.clipboard.readText()`. WebKit can hold that await
  on its "Paste" callout until the user clicks it. Meanwhile a sibling tab's commit reloads this
  tab (`reloadTabsForTarget`, no pending yet so no stale guard), or a pager/sort load lands. After
  the await, `applyPastedCells` stages `stageEdit(row)` by the old page-row index. `buildPlan`
  later reads keys from the new page, so the UPDATE targets whatever record now sits at that index,
  not the record the user selected. The user may toggle mask preview during the callout too; the
  paste then stages while masked, the invariant `setMaskPreview` guards. If the tab closes during
  the await, `ensure(tabId)` recreates a pending record for a dead tab.
- Fix: after the await, return unless `getPage(props.tabId) === p`, `rt()?.selection === sel`,
  `grid !== null` and `canEditTable()` still hold.

### F9. low. Host `pageVersion` watch rebuilds the grid when any other data tab's page changes (code-read)

- `apps/kira-studio/frontend/src/views/grid/SlickGridHost.vue:2226-2258`, cause shared with F4.
- Grid `pageVersion` counts every tab's `setPage`/`drop`. The active host runs `setColumns`,
  `invalidateAllRows`, full render, `consumeCellFocus` on each bump. Scenario: user types in an
  inline cell editor in tab A; a background load lands in tab B (slow first load, or a sibling
  reload after A's commit). `setColumns`/`invalidateAllRows` destroy the open editor without
  committing: typed text lost. Also: a pending `editReferencedRow` focus request is consumed
  against the wrong page and dropped (`applyCellFocusRequest` result ignored at `:2251`, unlike the
  mount path at `:2172`).
- Fix: keep `lastAppliedPage`; in the watch, return when `getPage(props.tabId) === lastAppliedPage`
  (and the column order is unchanged). On a failed `applyCellFocusRequest`, re-request as the
  mount path does.

### F10. low. Overlapping mask tag refreshes can install the previous page's tag cache (code-read)

- `apps/kira-studio/frontend/src/views/grid/SlickGridHost.vue:613-624,634-653`.
- Two page loads close together with preview on start two `refreshMaskTagCache` calls. If the
  first (old page) resolves last, `maskTagCache` holds old-page values; the current page's
  correlating cells render without their `#TAG` until the next load.
- Fix: sequence token per call; assign `maskTagCache` only when the token is still current and
  `getPage(props.tabId)` is still the page it read.

### F11. low. Insert-row inputs accept typing into generated columns (code-read)

- `apps/kira-studio/frontend/src/views/grid/SlickGridHost.vue:200-206,1586-1590`;
  `DataToolbar.vue:197-205` seeds inserts without generated columns.
- `cellFormatter` renders an `<input>` for every column of an insert row. `onInsertGridInput`
  stages any typed value via `stageInsertValue`, generated columns included. Commit sends the
  generated column in the INSERT; Postgres/MySQL reject it. Every other insert path skips
  generated columns (P36 D28).
- Fix: render generated-column insert cells read-only (`input.readOnly = true`, muted), and skip
  them in `onInsertGridInput`.

### Block 2 notes (checked, nothing real)

- Silent no-op UPDATE/DELETE suspect: dropped. Relational adapters assert exactly one affected row
  per op and roll back (`mysqlfamily/client.go:43-50` comment, `AssertAffectedExactlyOne`);
  MySQL uses `CLIENT_FOUND_ROWS`.
- `buildPlan`: composite/hidden PK guards hold (`missingColumns`); PK value read from the stored
  cell, not a staged edit, so editing a PK column updates the right row. `discardCellEdit` deletes
  an emptied `changes`. `stageDelete` idempotent. `duplicateAsInsert` skips PK, generated and
  truncated values.
- `applyPastedCells`: generated columns skipped on both paths; insert reuse positional and
  consistent; paste into pending-delete rows is ignored by `stageEdit` (documented).
- `onCopy`: masking-aware on every kind; NULL copies as empty (documented, F5 P108 Part 10).
- `menu.ts` filter and FK literals use `quoteIdent`/`quoteLiteral` with per-dialect backslash
  handling; truncated values refuse "Filter by this value".
- `KiraCellEditor`, `onBeforeEditCell`: truncated, generated, deleted, gutter and insert cells
  vetoed. Unmount order in `SlickGridHost` correct; `editorCtx` reset.

## Block 3: grid chrome

### F12. low. Columns menu opened before table meta loads stays empty and stores a bogus order (code-read)

- `apps/kira-studio/frontend/src/views/grid/ColumnsMenu.vue:20,34,39-47,99-106`.
- `meta` arrives from `loadMeta` after the first page (`state.ts:197`). `order` and `selected` are
  seeded once from `columnNames` at setup. Opened during that gap: "Loading columns…" shows, then
  meta lands and the list renders nothing (`order` is still `[]`). On close, `sameOrder([], names)`
  is false, so `setColumnOrder(tabId, [])` persists an empty order; `columnsIndicator` lights the
  "changed" dot for a change nobody made.
- Fix: seed `order`/`selected` when `meta` first becomes non-null (`watch(meta, ..., { once: true })`
  or render the list only under `v-if="meta"` and mount the sortable after), and treat an empty
  `order` as "no change" in `onBeforeUnmount`.

### F13. low. ORDER BY text round trip breaks quoted or mixed-case columns (verified)

- `apps/kira-studio/frontend/src/views/grid/FilterToolbar.vue:38-42`,
  `views/grid/sortTerms.ts:17`.
- `sortToText` writes a header-click sort as `${t.column} DESC` unquoted. Postgres column
  `CreatedAt`: the ORDER BY box shows `CreatedAt DESC`; pressing Enter there (or appending `, id`)
  sends a text sort the server folds to `createdat` and rejects. A name with a space yields invalid
  SQL.
- `parseTextSortTerms` never matches a quoted name: `\b` after a closing `"` or backtick needs a
  word character next. Node check: `'"Created At" DESC'`, `'"a"'`, `` '`b` asc' `` all return
  `null`; only bare `name desc` matches. Header sort indicators vanish for any quoted term.
- Fix: in `sortToText`, `quoteIdent(dialect, t.column)` when `identNeedsQuoting(dialect, t.column)`
  (same rule as `filterCompletion.ts:46`). In the regex, keep `\b` only on the bare-word branch:
  `/^(?:"([^"]+)"|`([^`]+)`|(\w+)\b)\s*(desc|asc)?/i`. Extend the existing unit coverage if any;
  otherwise a three-case table in a new spec qualifies (parser with interacting quote rules).

### Block 3 notes (checked, nothing real)

- `fkPreview.ts`/`FkPreviewPopover.vue`: response after close dropped via `signal.cancelled`; server
  cancel on unmount while loading; one fetch per open, no TanStack Query needed for a one-shot
  read tied to the popover's lifetime.
- `focusRequest.ts`: cleared on failed load and tab close. Wrong-page consumption covered by F9.
- `maskPreview.ts`: transform never mutates the memoised `CellView`; tag cache fails closed.
- `PreviewCommandPanel.vue`: `gcTime: 0`, refetch per open; the popover closes on any outside click
  so staged changes cannot drift under an open preview.
- `filterCompletion.ts`: completions quoted per dialect when needed.
- `fakeData/*`: binary `0x` values decoded by `sqlmutate.go:95`; temporal formatting per dialect;
  numeric bounds from `typeBounds`; batches respect `AbortSignal`. `DataToolbar.vue` gating
  consistent with `canGenerateDataFor` and pending/mask lockouts.

## Block 4: cell editor, clipboard and shared utilities

### F14. medium. Paste parser corrupts text with a mid-field quote or multi-line non-tabular text (verified)

- `apps/kira-studio/frontend/src/views/shared/clipboardFormats.ts:171-180,193-247`; caller
  `views/grid/SlickGridHost.vue:1813`.
- `parseDelimitedText` opens a quoted section on any `"`, not only at field start. Probe
  (`bun`, scratchpad): `'12" ruler\tfoo\nbar\tbaz\n'` parses to one cell
  `["12 ruler\tfoo\nbar\tbaz\n"]`; the quote is dropped and a 2x2 block collapses into one value
  with embedded tabs and newlines.
- No-tab multi-line text goes to the CSV branch. Pasting a JSON snippet into one `jsonb` cell:
  `'{\n  "a": 1,\n  "b": "x, y"\n}'` parses to `[["{"],["  a: 1",""],["  b: x, y"],["}"]]`. The
  paste stages `{` into the target cell and overwrites the same column on the next three rows (or
  creates inserts past the page end), quotes stripped.
- Scenario: user copies a value from a text editor and pastes into a cell; neighbouring rows get
  staged edits they never asked for. Visible before Commit, but easy to miss off-screen.
- Fix: open a quote only when `field === ''` (RFC 4180); a `"` inside an unquoted field is literal.
  For no-tab text, use CSV only when the parse is rectangular with more than one field per row;
  otherwise paste one value. Add both probes to `grid-clipboard-formats-safety.spec.ts`.

### F15. low. Cell editor dock can stage a dirty buffer onto a different record after a page swap (code-read)

- `apps/kira-studio/frontend/src/views/grid/SlickGridHost.vue:2466-2470` (closure stages by
  `targetRow` into whatever page is current), `views/shared/celleditor/CellEditorView.vue:206-240`
  (re-publication with a changed value stages the dirty buffer through `prevCell.onEdit`).
- Scenario: user is typing in the dock for row 5 (record X), focus stays in the dock. A sibling
  tab's commit reloads this tab (no pending yet, so no stale guard) and a row before 5 was
  deleted. `setPage` republishes row 5 (now record Y) with a new value; the watch sees the buffer
  dirty against the old value and calls `prevCell.onEdit(doc)`, staging X's new text onto Y.
- Fix: capture the page in the closure (`const pageAtPublish = p`) and make `onEdit`/`onRevert`
  no-ops when `getPage(props.tabId) !== pageAtPublish`; report "Edit not staged: the page
  reloaded" via `setActionError` so the dropped buffer is not silent.

### Block 4 notes (checked, nothing real)

- `AutocompleteField.vue` `v-html`: `escapePlain` before Monaco loads, `paintOverlayHtml`
  (`editor/paintSpans.ts:171-180`, Part 12) escapes every text run; class names are internal.
  Paint generation counter drops stale paints.
- `clipboardFormats.ts`: `tsvField`/`csvField` quoting, CSV-only formula guard (F5 P108 Part 10
  intent), `rowsToInsert` dialect quoting and truncated-value NULL substitution hold.
  `sqlIdent.ts` backslash handling per dialect correct.
- `CellEditorView.vue`: blur, unmount and cell-switch staging guard against the cell actually
  changing (F17 P108 Part 10); `readOnlyReasonFor` mirrors `onBeforeEditCell`. `binary.ts` decode
  is fatal-UTF-8; hex prefix preserved.
- `useEditBuffer.ts`, `useConnectionGate.ts` (Go `Connect` reports failures as state, not a throw),
  `immediateMutation.ts` ("saved, but refresh failed" keeps the mutation result honest),
  `viewOp.ts`, `typeGlossary.ts`, `targetPath.ts`, `eventCoords.ts`, `mongo*.ts`: no defect.
- Native buttons in `DateTimePicker.vue`, `SavedListMenu.vue`, `DocumentRow.vue`,
  `DocumentTree.vue` carry `type="button"`.

## Block 5: document and key-value

### F16. medium. A BSON date outside JS `Date` range throws in render and in every copy format (verified)

- `apps/kira-studio/frontend/src/views/shared/document/ejson.ts:77-91` (`dateMillis`), throw
  sites `:116-120` (tree render), `:409-411` (relaxed), `:456-458` (plain), reached from
  `views/shared/document/rows.ts:126-128` (`parseRow`).
- BSON dates are int64 milliseconds; JS `Date` holds only ±8.64e15. A "never expires" sentinel
  (`{"$date":{"$numberLong":"9223372036854775807"}}`) passes `Number.isFinite`, then
  `new Date(millis).toISOString()` throws `RangeError: Invalid Date`. Probe (`bun`, scratchpad):
  `parseDocument`, `toShellText`, `toRelaxedText`, `toPlainJson` all throw on such a document.
  `parseRow` runs inside the documents view's row rendering, so one such document breaks the row
  (and the virtual list's render pass); Copy as JSON/shell/relaxed fails; Edit (`DocumentView.vue:589`
  seeds from `toShellText`) throws. A date `_id` hits `parseIdLabel` too.
- Fix: `dateMillis` returns `null` when `Math.abs(n) > 8.64e15`. The render wrapper then returns
  `null` (raw fallback) and relaxed/plain keep the canonical wrapper. Relaxed EJSON v2 also says
  ISO strings only for years 1970-9999; keep canonical outside that range. Add the sentinel case
  to `ejson.spec.ts`.

### Block 5 notes (checked, nothing real)

- `keyvalue/state.ts`: superseded load cancelled server-side (`stopOp`) and dropped client-side;
  cursor-paged keys reset to page one on a cursor-less reload (documented). Tab-close cleanup drops
  `${tabId}::preview`.
- `keyvalue/mutations.ts`: sentinels only used for string-key ops (hash/list/set edits address by
  path); `addKey` returns without opening a tab only when no `database` segment exists, and S3
  pages route Add to the upload dialog first, so that path is unreachable for Redis.
- `KeyValuePane.vue`: S3 object draft cleared on page identity change (`watch(page)` keyed on the
  page object, not the store counter); edit/add popovers guard `saving`; delete confirmed.
  `useVirtualizer` rows keyed by index over a frozen page.
- `document/rows.ts`: `resetRows` on page load; parse cache pruned to the visible window.
  `rawTree.ts`, `DocumentTree.vue`, `DocumentRow.vue`: no defect found.
- `ejson.ts` `$numberLong` beyond 2^53 stays wrapped in relaxed mode (F9 P108 Part 10); plain mode
  rounds by design (documented).

## Block 6: request and fields

Nothing real found.

- `request/resolve.ts`: one `refs` accumulator per substituter; `subUrl` applies
  `sanitizeUrlSpan` (Part 7 contract read); `resolvePairs` drops disabled and blank-name rows.
- `request/useRequestTabSave.ts`: incognito and unresolved guards cover the `api.save` command;
  `void options.save(...)` is safe because both callers' store methods catch and set `state.error`
  (`api/state/collections.ts:613-628` and the gRPC sibling).
- `request/useRequestChrome.ts`: computed reads only; no lifecycle.
- `fields/FieldRowsTable.vue`: write-through index carried through filtering; trailing blank row
  never filtered; arrow navigation skips checkboxes and respects `defaultPrevented` from the
  autocomplete popup. Rows keyed by write-through index (`:280`); a remove shifts keys, but focus
  is on the Remove button at that moment, so no stale-input edit lands on the wrong row.

## Block 7: tests

F1 and F2 (block 1) are the red checks. One more:

### F17. medium. `data-view.spec.ts` Stop step races a fixed 300 ms mock reply; product is not at fault (code-read, mock read)

- `apps/kira-studio/tests/ui/data-view.spec.ts:975-990` (fixture), `:1520-1566` (steps).
- The fixture answers the `pg_sleep(2)` read with `E_CANCELLED` after a fixed `delayMs: 300`,
  whether or not Stop is clicked; `OpsService.Cancel` is a no-op in the mock runtime
  (`ST/ui/support/mockRuntime.ts:249`). Between Enter and the Stop click the test runs
  `toBeEnabled`, `emitWailsEvent`, a `toHaveCSS` poll and a second `emitWailsEvent`. Under
  full-suite load that exceeds 300 ms; the canned `E_CANCELLED` lands, `applyLoadFailure` clears
  `rt.opId`, Stop disables, and `page.click('[data-testid="toolbar-stop"]')` waits on a disabled
  button until it times out. Alone the steps fit inside 300 ms, hence 3/3 passes.
- Product check: `DataView.vue:233-239` binds Stop to `rt.opId`; a click after the op settled is
  simply unavailable, which is correct. No product race.
- The test also never proves Stop causes the cancellation: the error arrives regardless.
- Fix (own file): move the synthetic run-state block (`emitWailsEvent` running/`toHaveCSS`/
  cancelled) before the filter fill, so the Stop click directly follows `toBeEnabled`; raise the
  fixture's `delayMs` to 5000 so the window is not load-sensitive (the final `toBeDisabled` already
  allows 10 s). Stronger, optional: a cancel-gated reply in the mock (send the canned frame when
  `OpsService.Cancel` arrives for that op) plus an assertion that cancel was called —
  `needs-other-part-file: apps/kira-studio/tests/ui/support/mockStream.ts,
  apps/kira-studio/tests/ui/support/mockRuntime.ts (Part 13, Stream C)`; Part 13 picks it up,
  nothing routed to Stream A/B.

### Block 7 notes

- Own unit specs: all 31 drive current code (checked imports against current exports). Thin
  candidates (`grid-sql-literal-escaping`, `view-op-disconnected-status`,
  `fake-data-temporal-format`) guard per-dialect or per-branch rules; `CLAUDE.md`'s bar applies
  going forward, not as a retroactive cleanup, so no prune proposed.
- New guards named in fixes, each meeting the bar: F6 (concurrency, double commit), F3 (scan cap
  vs filter rows), F13 (parser quote rules), F14 (parser quote rules), F16 (date range edge).
- UI specs read for the CSS revert: `slick-grid`, `perf/grid-scroll`, `visual/data-view` assert
  nothing on `will-change`, `contain` or cell borders; the visual baseline was regenerated by the
  user (`60ed063`, `b088feb`). UI suite not run here (plan: targeted runs only; F17 needs no run).

## Routing

No finding needs a Stream A or Stream B file. Nothing appended to
`P168-routed-from-streamC.md`. Two Stream C later-Part tags: F4 (Part 12 `documents/search.ts`),
F17 optional mock change (Part 13 `tests/ui/support/*`).

## Coverage

Every own production file (92) and the test files named in plan §2 were in scope.

- Reviewed in full: `shared/slick/*` (11, incl. current `slickTheme.css`), `shared/page/*` (11),
  `grid/{state,pendingChanges,paste,menu (FK/filter/cell/projection paths),page,search,
  sortTerms,filterCompletion,fkPreview,focusRequest,maskPreview}.ts`, `grid/slick/{dataSource,
  editor}.ts`, `DataView.vue`, `DataToolbar.vue`, `FilterToolbar.vue`, `ColumnsMenu.vue`,
  `FkPreviewPopover.vue`, `PreviewCommandPanel.vue`, `fakeData/generate.ts`,
  `clipboardFormats.ts`, `sqlIdent.ts` (quoting), `immediateMutation.ts`, `useConnectionGate.ts`,
  `useEditBuffer.ts`, `celleditor/{CellEditorView.vue,CellEditorDock.vue,binary.ts,state.ts,
  validate.ts}`, `keyvalue/{state,mutations}.ts`, `request/*`, `ejson.ts` (conversions),
  `document/rows.ts` (parse path), 31 own unit specs (baseline run), `data-view.spec.ts` (Stop
  section).
- Reviewed in part (hot paths only, rest skimmed for structure): `SlickGridHost.vue` (helpers,
  copy/paste/keydown, mount/unmount, page/filter/insert/publication watches, nav buttons, edit
  gating, mask refresh; header/resize/context-menu plumbing skimmed), `grid/slick/rowValues.ts`
  (selection/paste/column helpers), `KeyValuePane.vue` (edit/add/delete/S3 draft paths;
  virtualizer template skimmed), `AutocompleteField.vue` (overlay escaping), `celleditor/detect.ts`
  (`detectFormat`/`describeValue`), `viewOp.ts` (`beginOp`/`applyLoadFailure`/`stopOp`),
  `FieldRowsTable.vue` (logic; template skimmed).
- Skimmed (no hot path for the §5 risks, or covered by passing unit specs): `fakeData/{recipes,
  typeBounds,types,fakerEntry}.ts`, `celleditor/{timestamp.ts (two unit specs),TimestampPane.vue,
  TimestampReading.vue,formats.ts,generate.ts}`, `DateTimePicker.vue`, `FilterHistoryMenu.vue`,
  `SavedListMenu.vue`, `ResponseFindBar.vue`, `EditBufferActions.vue` (button types and listener
  wiring checked), `typeGlossary.ts`, `mongoFieldSample.ts`, `mongoVocabulary.ts`, `eventCoords.ts`,
  `targetPath.ts`, `keyvalue/{host,menu,page,search}.ts`, `document/{rawTree.ts,DocumentRow.vue,
  DocumentTree.vue}`, UI specs other than the `data-view` Stop section, `perf/*`, `visual/*`.
- Not reached: none.
