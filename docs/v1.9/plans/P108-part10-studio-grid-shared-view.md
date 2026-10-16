# P108 Part 10 — review plan: Studio grid and shared view machinery

Chunk A9, stream A position 9 (pre-plan §5.9). One Opus reviewer runs this plan and reports
findings. It fixes nothing. One Sonnet fixer then lands one commit per finding. Tree surveyed:
`ccc9ac0` (Parts 2-9 and 13-19 closed).

Paths repo-relative. `SF` = `apps/kira-studio/frontend/src`, `SI` = `apps/kira-studio/internal`,
`SD` = `packages/shared/domain`, `ST` = `apps/kira-studio/tests`, `PW` = `packages/workbench/src`
(alias `@workbench`), `PT` = `packages/theme/src` (alias `@theme`). `VS` = `SF/views/shared`,
`VG` = `SF/views/grid`.

## 0. Method

- **`codegraph_explore`** for discovery, before any Read. Targets:
  - staged-edit pipeline: `usePendingChangesStore` (`stageEdit`, `stageNull`, `stageDelete`,
    `addInsertRow`, `stageInsertValue`, `duplicateAsInsert`, `primaryKeyOf`, `buildPlan`,
    `previewPending`, `commit`, `clearPending`), `applyPastedCells`/`resolvePasteTarget`
    (`VG/paste.ts`), `pasteTargetRows` (`VG/slick/rowValues.ts`), `onBeforeEditCell`/
    `canEditTable`/`onPaste` (`VG/SlickGridHost.vue`), `readOnlyReasonFor`
    (`VS/celleditor/state.ts`);
  - paging and ops: `createPageNavigation` (`VS/page/navigation.ts`), `useGridViewStore`
    (`load`, `setFilter`, `setSort`, `setProjection`, `setPageSize`, `reloadAfterMutation`,
    `loadMeta`, `runCount`), `runPagedLoad` (`VS/page/load.ts`), `runPagedCount`/
    `applyLoadFailure`/`beginOp` (`VS/viewOp.ts`), `createImmediateMutator`
    (`VS/immediateMutation.ts`), `useConnectionGate`, `reloadTabsForTarget`;
  - page store and caches: `createPageStore` (`setPage`, `cached`, `cachedView`,
    `setVisibleWindow`, `retentionSources`), `VS/document/rows.ts`, `measuredWidths`/
    `pageColumnIndexFor` (`VS/page/columns.ts`), keyvalue `state.ts`/`page.ts`/`host.ts`;
  - selection: `VS/slick/{selection,selectionEdges,selectionModel,dataSource,rowVisibility}.ts`,
    `displayPositionOf`, `pageRowAt`, `rowHandleAt`, `rowsForSelection`;
  - text out: `VS/clipboardFormats.ts` (`neutralizeFormulaPrefix`, `rowsToTsv`, `rowsToCsv`,
    `rowsToJson`, `rowsToInsert`, `parseDelimited`), `VS/sqlIdent.ts` (`quoteIdent`,
    `quoteLiteral`), `cellMenu`/`foreignKeyValueFilter`/`navigateForeignKey` (`VG/menu.ts`),
    `displayCell`/`rowSnapshot`/`navValuesFor` (`VG/slick/rowValues.ts`), `VS/document/ejson.ts`.
  Blast radius of any proposed fix is checked the same way. `VS` has callers in every Studio data
  view; a signature change there needs a caller sweep.
- **Read closed chunks first.** Part 4 (`SI/adapters/sqlmutate.go`: `AssertKeyIsPrimaryKey`,
  `ValidateMutationOps`; ClickHouse `quoteIdent` in `SI/adapters/clickhouse/read.go`) is the Go
  backstop for §4.2 and §4.10. Part 6 closed `SF/bridge` and `@shared/protocol/page`. Part 13's
  result hands one item here: `VG/FkPreviewPopover.vue:132` hand-rolls the backdrop-ancestor
  `aria-hidden="true"` wrapper that Part 13 F4 fixed in `KuiDialog.vue`/`KuiPopoverPanel.vue`
  (SPEC "P108 Part 13 result", note 2). It is in scope here and is a finding by default.
- **Premise correction, stated up front.** The pre-plan's watch line reads "P99 Part 4
  migration" as if server state moved to TanStack Query. For this chunk it did not. P99 Part 4
  (`1056b0d` shared, 13 files; `c05271e` grid, 7 files) moved scoped CSS to `@apply` and swapped
  two timers for `useDebounceFn`. It named three declines in `SlickGridHost.vue`: viewport scroll
  listeners plus the `ResizeObserver` (ordering), header zone/sort-indicator listeners, and
  `onPaste`'s `navigator.clipboard.readText()`. `useQuery` appears in only three own files:
  `SlickGridHost.vue` (mask rules), `DataToolbar.vue` (mask rule counts), `PreviewCommandPanel.vue`
  (`previewPending`). Query-key correctness applies to those three (§4.14). Page data, counts and
  meta stay in hand-rolled Pinia runtimes, with their own supersession (§4.6). No part of the
  watch item is dropped; its subject changes.
- **Scratch replicas** in the session scratchpad, never in the tree, where a claim depends on
  runtime behavior: a `bun test` harness over the Pinia stores with a fake `data` bridge (load
  failure after `clearPending`, supersession order, paste targeting), or a Playwright run against
  `ST/ui`'s static server and bridge mock. Mark each claim "verified" or "code-read".
- **Known open items read first** (`docs/ARCHITECTURE.md` "Known open items"). M5's correlation
  tag not verifying masked-value provenance and F1's JSON/array over-refusal on masked
  connections are documented. Do not re-report either. Uncapped per-tab page RAM (ARCHITECTURE
  §"L2", `P5-ram-usage.md` OQ-2) is a stated trade, not a finding.

## 1. Own file set

96 production files, 20,844 lines (TS, Vue, CSS). 28 unit and 7 UI specs, about 9.3k lines. The
pre-plan §4 estimate of ~24k matches neither figure alone; the difference does not change scope.
The pre-plan's 2,578-line churn figure was not re-derived.

- **`VG` (grid view, ~7.4k)**:
  - `SlickGridHost.vue` (2682: SlickGrid host, editor gate, paste, copy, context menus, FK nav
    button, mask query, column widths);
  - `state.ts` (339, `useGridViewStore`), `pendingChanges.ts` (338, `usePendingChangesStore`),
    `menu.ts` (644), `paste.ts` (107), `page.ts`, `search.ts`, `sortTerms.ts`,
    `filterCompletion.ts`, `focusRequest.ts`, `fkPreview.ts`, `maskPreview.ts`;
  - `slick/{rowValues,dataSource,editor}.ts`;
  - `fakeData/{generate,recipes,typeBounds,types,fakerEntry}.ts`;
  - components: `DataView.vue` (473), `DataToolbar.vue` (440), `FkPreviewPopover.vue`,
    `FilterToolbar.vue`, `ColumnsMenu.vue`, `PreviewCommandPanel.vue`.
- **`VS` (shared machinery, ~13.4k)**:
  - `page/`: `store.ts`, `navigation.ts`, `load.ts`, `scan.ts`, `search.ts`, `searchFilter.ts`,
    `columns.ts`, `visibleRows.ts`, `sizes.ts`, `SearchToolbar.vue`, `PagerControls.vue`;
  - `slick/`: `kiraSlickGrid.ts` (554), `dataSource.ts`, `selection.ts`, `selectionEdges.ts`,
    `selectionModel.ts`, `rowVisibility.ts`, `scrollTrace.ts`, `scrollVelocity.ts`,
    `cssLayers.ts`, `slickTheme.css` (740);
  - `celleditor/`: `CellEditorView.vue` (787), `CellEditorDock.vue`, `TimestampPane.vue`,
    `detect.ts`, `timestamp.ts`, `validate.ts`, `generate.ts`, `formats.ts`, `binary.ts`,
    `state.ts`;
  - `document/`: `ejson.ts` (679), `rows.ts`, `rawTree.ts`, `DocumentTree.vue`,
    `DocumentRow.vue`;
  - `keyvalue/`: `KeyValuePane.vue` (1305), `state.ts`, `menu.ts`, `mutations.ts`, `search.ts`,
    `host.ts`, `page.ts`;
  - `request/{useRequestChrome,useRequestTabSave,resolve}.ts`, `fields/FieldRowsTable.vue`;
  - loose: `AutocompleteField.vue` (654), `DateTimePicker.vue`, `typeGlossary.ts`,
    `ResponseFindBar.vue`, `clipboardFormats.ts`, `FilterHistoryMenu.vue`, `viewOp.ts`,
    `SavedListMenu.vue`, `sqlIdent.ts`, `EditBufferActions.vue`, `useEditBuffer.ts`,
    `mongoFieldSample.ts`, `useConnectionGate.ts`, `mongoVocabulary.ts`, `immediateMutation.ts`,
    `eventCoords.ts`, `targetPath.ts`.
- **`ST/unit`** (28): `column-widths-cache`, `document-row-height-cache`, `ejson`,
  `fake-data-{generator-bounds,recipes,temporal-format}`, `grid-{clipboard-formats-safety,
  commit-composite-pk-guard,commit-pkless-guard,menu-projection-empty-guard,
  row-menu-lazy-snapshot,rows-for-selection,rows-to-insert,sql-literal-escaping,
  stage-delete-idempotent,staged-value-snapshot}`, `kira-slick-grid`, `match-index`,
  `page-store-cell-cache`, `resolve-column-order`, `row-range-bounds`, `row-values-visible-span`,
  `scan`, `slick-data-source`, `slick-selection`, `timestamp-two-digit-year`,
  `view-op-disconnected-status`, `view-state`. Matches pre-plan §5.9.
- **`ST/ui`** (7): `cell-editor`, `data-view`, `fake-data`, `mutations`, `row-coloring`,
  `scroll-trace`, `slick-grid`. Matches pre-plan §5.9.
- **Specs that import this chunk but belong to Part 11** (`ddl-schema`, `document-byte-label`,
  `document-console-row-menu-lazy-snapshot`, `sigma-count-refresh`) and `ST/ui/global.d.ts`
  (Part 12). Read them for the contract. A fix here that breaks one gets fixed in the same
  commit.

## 2. One hop: callers

Edge counts from pre-plan §5.9, confirmed by `codegraph_explore` blast radius.

- **`SF/views/console`** (253 edges): `resultPages.ts` (`createPageStore`), `state.ts`
  (`applyLoadFailure`), `ConsoleSlickGrid.vue`/`resultMenu.ts` (`kiraSlickGrid`, shared
  `dataSource`, `rowsToTsv`, `toShellText`), `ConsoleResultGrid.vue` (`rowHeight`),
  `ConsoleView.vue` (`CellEditorDock`), `search.ts` (`runChunkedScan`, `eachMatch`).
- **`SF/views/documents`** (113): `page.ts`, `state.ts` (`runPagedLoad`, `runPagedCount`),
  `search.ts` (`eachMatch`), `DocumentView.vue` (`AutocompleteField`, `rowHeight`,
  `VS/document/*`).
- **`SF/views/stream`** (64): `page.ts`, `state.ts` (`applyLoadFailure`, `runPagedCount`; hand-
  written load, see §4.6), `StreamView.vue` (`CellEditorDock`).
- **`SF/views/keyvalue`**, **`SF/views/browse`**: `KeyValuePane`, keyvalue host seam
  (`registerKeyValueHost`/`unregisterKeyValueHost`, the only unregister caller is `BrowseView`).
- **`SF/views/httprequest`** (55), **`SF/views/grpcrequest`** (27): `useRequestChrome`,
  `useRequestTabSave`, `VS/request/resolve.ts`, `FieldRowsTable`, `AutocompleteField`
  (`FormDataTable`), `ResponseFindBar`, `useEditBuffer`.
- **`SF/state/*`** (Part 12): `ensureRuntime` has 30 callers across views;
  `registerTabRuntimeCleanup` callers in `VG/state.ts` and keyvalue.
- **`SF/workbench/tabViews.ts`**: `DataView` for the `data` tab kind.

## 3. One hop: callees

- **Settled (closed parts):**
  - `SF/bridge/{data,control}` and `@shared/protocol/page` (Part 6): `TabularPage`, `cellText`,
    `isNull`, `TextColumnChunk`, page kinds.
  - `SI/adapters/sqlmutate.go` and per-adapter mutation validation (Part 4): the server backstop
    for §4.2.
  - `PW` (B1): `state/tabRuntime`, `state/confirmDialog`, `state/contextMenu`, `util/clipboard`
    (`copyText`), `util/format`, `commands`, `state/queryClient`.
  - `PT/components/ui/*` (shadcn-vue: button, tooltip incl. `TooltipDisabledTrigger`, popover,
    dialog, dropdown), `theme/cellClass.ts`, `theme/floatingPosition.ts`.
- **Later in this stream (read for the contract):**
  - Part 11: `SF/editor/{paintSpans,searchPattern,MonacoHost}`, `beautify.ts`,
    `SD/sql-lint`; `SF/api/state/variableCompletion.ts` `classFor` (feeds `AutocompleteField`'s
    overlay, §4.13).
  - Part 12: `SF/state/{tabs,connections,cellSelection,runState,settings,viewCommands,maskRules,
    schemas,objectStore}`.
- Third-party: `slickgrid@5.20.0` core only (subclassed as `KiraSlickGrid`), `@tanstack/vue-query`,
  `@tanstack/vue-virtual` (`KeyValuePane`'s `useVirtualizer`), VueUse, reka-ui, `@faker-js/faker`
  (lazy via `fakerEntry.ts`).

## 4. Edge cases to weight

Correctness of staged writes first. This chunk is where a user edit becomes an UPDATE/DELETE/
INSERT against a real table, and where copied text becomes SQL or spreadsheet input.

1. **Staged-edit loss without a prompt.**
   - `VG/state.ts` `load()` calls `usePendingChangesStore().clearPending(tabId)` before the read.
     A load that fails, is cancelled or is superseded still drops every staged edit, while the old
     page stays on screen. Check whether any path confirms first.
   - `DataToolbar.vue`'s next/prev/first/last/page-size handlers and `FilterToolbar` call the
     store directly. Find the discard-confirm (if any) between a pager click and `clearPending`.
     Check sort header clicks, projection (`ColumnsMenu`), refresh and filter-history picks the
     same way.
   - `reloadAfterMutation` ends with `reloadTabsForTarget(…, tabId)`. Every sibling tab on the
     same table reloads, and each sibling's `load()` clears that sibling's staged edits silently.
     Scenario: two tabs on one table, both with edits, commit one.
   - `setMaskPreview`/`toggleMaskPreview` refuse while pending exists. Check that menu entries
     and keyboard shortcuts cannot stage while preview is on (`canEditTable` includes
     `!maskPreviewOn`; `cellMenu`'s Delete row gates on `canDelete` only).
2. **Row addressing: PK, composite PK, PK-less.**
   - `primaryKeyOf` builds the WHERE key from projected `isPrimaryKey` page columns via `cell()`.
     It ignores `view.truncated`. A PK cell over the 64 KiB cell cap yields a prefix key that
     matches zero rows. Check what `buildPlan` and the commit result report for zero rows
     affected.
   - `missingColumns` comes from `fullPrimaryKeyOf`, which stays null when `loadMeta` fails
     (its error is swallowed). Check whether a composite PK with one column hidden by projection
     is then refused or accepted on the projected subset. `grid-commit-composite-pk-guard` pins
     the meta-loaded case only.
   - `hasPrimaryKey` (`DataToolbar`, `canEditTable`) is page-derived. Check it against
     meta-derived PK after a projection hides every PK column.
   - An edit to a PK column itself: confirm the key uses the original page value, not the staged
     one.
   - No no-op detection. A staged value equal to the original still issues an UPDATE (and may
     fire triggers or bump `updated_at`). Decide finding or intended.
   - `buildPlan` orders delete, update, insert. Check partial-failure handling in `DataView`'s
     `onCommit` (try/catch around commit then `reloadAfterMutation`): which staged entries
     survive a server error, and does the UI say which op failed.
3. **Generated columns.** `onBeforeEditCell` vetoes gutter, insert rows (own `<input>`),
   `!canEditTable()`, deleted rows and truncated cells. It does not veto a generated column.
   `stagePastedRow` skips generated columns for new rows only; an existing row gets `stageEdit`
   into a generated column. `readOnlyReasonFor` (cell editor) has no generated, partial-PK or
   pending-delete reason, so the dock and the grid disagree on editability. `duplicateAsInsert`
   does skip generated. Check what the server does with a generated column in an UPDATE (Part 4
   adapters) and whether the UI can reach that state.
4. **Paste targeting (`VG/paste.ts`).**
   - `row` kind: `startRow = Math.min(...sel.rows)`, then `startRow + ri`. A non-contiguous
     gutter selection (rows 2, 7, 9) pastes into 2, 3, 4, not the selected rows. Under a filter,
     `startRow + ri` is a page row, not the next visible row. An empty `rows` array gives
     `Infinity`.
   - `range` kind: `pasteTargetRows` continues at `Math.max(startRow, rowCount)` when visible
     rows run out, so a range paste under a filter spills into new insert rows. Decide intended.
   - `stageEdit` on a row marked for delete is refused. Confirm the refusal is silent and whether
     the user sees skipped cells.
   - `parseDelimited` picks TSV when the text holds a tab, else CSV. One pasted value containing a
     comma (an address, a JSON array) splits across columns.
   - Clipboard wider than the remaining columns: extra cells drop (`if (!name) continue`).
     Confirm silent.
   - In-app round trip: copy writes `neutralizeFormulaPrefix` output (§4.9), paste stages it
     back verbatim. Copy `-5`, paste it: `'-5` is staged.
5. **Paging arithmetic (`VS/page/navigation.ts`, `VG/state.ts`).**
   - `goToPage`: `Math.max(0, n)` clamps low only. An index past the last page issues an
     out-of-range offset read. Check the pager input's own bound.
   - `goLast`: `Math.max(1, Math.ceil(rt.count / pageSize))` trusts `rt.count`. `setFilter`
     clears the count; `setSort`/`setProjection`/`setPageSize` keep it (row set unchanged, so
     correct). After `reloadAfterMutation` without a count, the count is stale by inserts and
     deletes.
   - `goNext`: token if present, else `nextIndex * pageSize`, with no `hasMore` check. Check the
     button's disabled state covers it.
   - `goPrev` at index 0 still reloads (and so still clears staged edits, §4.1).
   - Optimistic `pageIndex` patch, reverted on failure: check the revert when a second nav
     supersedes the first (the first's revert must not clobber the second).
   - `reloadAfterMutation` reloads at the current offset with no clamp. Deleting every row on the
     last page leaves an empty page with pager "page N".
   - Keyset strategy: tokens reset on sort/filter/projection/page size. Check `goToPage` and
     `goLast` under a keyset strategy, where an offset read may be invalid or silently fall back.
   - keyvalue `load` resets to page 0 on a no-cursor load for a non-offset strategy. Confirm the
     pager index follows.
6. **Supersession and op status (`VS/viewOp.ts`, `VS/page/load.ts`).**
   - `runPagedLoad` checks `stillMounted` and `opId`, and throws on the wrong page kind.
     `applyLoadFailure` no-ops on a stale `opId`; on `E_ENGINE_DOWN`/`E_CONNECT` it sets idle and
     unmarks hydrated. Check a stale-op failure cannot leave `status: 'loading'` forever.
   - `runPagedCount` swallows errors and keeps the old count. A failed count after a filter
     change: `setFilter` already nulled it, so check "count failed" is visible, not blank.
   - `createImmediateMutator` runs mutate, reload, `reloadTabsForTarget`, then `after` with no
     error path. A failed reload skips sibling reload and `after` (browse invalidation). Check
     the caller sees the error and that a succeeded mutation is not reported as failed.
   - `useConnectionGate.onReconnectAndLoad` marks hydrated after `connectConnection` without
     re-checking status. A connect that resolves but lands not-connected marks the tab hydrated
     with no page.
   - `load.ts`'s header says stream/state.ts wrote the same frame. `runPagedLoad` callers are
     grid, documents and keyvalue only; `stream/state.ts` still hand-writes load. Decide missed
     adoption (fix touches Part 11's file, allowed same stream) or a real shape difference, and
     correct the comment either way.
7. **Page store, caches and memory.**
   - `createPageStore.setPage` freezes the page and resets the visible window to 0,0. `cached`/
     `cachedView` decode uncached when the scope is missing; check hot paths (formatter, scan)
     never hit that fallback per cell per frame.
   - `setVisibleWindow` prunes decode caches; `VS/document/rows.ts` keeps parse and line-count
     caches per tab and row. Check invalidation on page replace and cleanup on tab close
     (`registerTabRuntimeCleanup`).
   - keyvalue runtime keyed by `viewKey`, including `${tabId}::preview`. `page.ts` drops the
     preview page on tab close and `searchFilter` clears it. Check the runtime record and the
     host registry (`unregisterKeyValueHost`, called only from `BrowseView`) do not leak for a
     preview that closes any other way.
   - `columns.ts` `measuredWidths` runs canvas `measureText` over up to `SAMPLE_ROWS` cells, each
     up to 64 KiB. Measure only if a wide-text page stalls first paint.
   - `pageColumnIndexFor` resolves by column name; with duplicate names the last wins. A console
     `SELECT a.id, b.id` renders, copies and searches the wrong column. The console is Part 11,
     but the resolver is here.
8. **Selection model (`VS/slick/*`).**
   - `selectionCovers`' range case assumes `anchor <= row` and `anchor <= col`.
     `selectionFromRanges` normalizes via `fromRow`/`fromCell`; `selectionEdges` and
     `visibleRowsInSpan` normalize with min/max; `resolvePasteTarget` uses `anchorRow` raw. Find
     any path that builds a range with anchor past focus (keyboard shift-extend upward), and
     check every consumer.
   - `displayPositionOf` with an empty filter result returns 0; `pageRowAt` falls back to
     `displayRows[pos] ?? pos`; `rowHandleAt` gives `insertId: undefined` when inserts are
     shorter than the insert region. Check right-click and nav in an empty filtered view.
   - `rt.selection` across page change, projection change (column indexes shift) and row delete:
     check nothing acts on a stale selection (toolbar delete, copy, menu).
   - `GUTTER_OFFSET = 1`: check every `cellIdx - 1` and `displayCol + 1` site agrees.
9. **Clipboard format safety (`VS/clipboardFormats.ts`).**
   - `neutralizeFormulaPrefix` matches `/^[=+\-@\t\r]/` and prefixes `'` in TSV and CSV. It hits
     negative numbers (`-5` becomes `'-5`) and signed exponents, and applies to in-app copy
     where no spreadsheet is involved (§4.4). Decide scope: the CWE-1236 guard belongs on
     formats meant for spreadsheets; check whether plain Copy (TSV to clipboard) needs it.
   - TSV/CSV quoting of embedded tabs, newlines, CR and quotes; `parseDelimited` inverse on the
     same inputs. Check round-trip.
   - `rowsToInsert` writes a truncated column as NULL plus a comment. Running that INSERT stores
     NULL. Check the comment is unmissable and that `grid-rows-to-insert` pins it.
   - `rowsToJson` is not neutralized (correct for JSON). `VS/document/ejson.ts` `ejsonToPlain`
     converts `$numberLong` and `$numberDecimal` via `Number()`: silent precision loss past
     2^53 in `toPlainJson` copy.
   - Copy follows display under mask preview (`rowSnapshot`, `columnValuesFor`). Check every copy
     path agrees: cell menu Copy (`ctx.text`), keyboard copy, row copy, column copy, Copy as
     INSERT.
10. **SQL identifier and literal escaping (`VS/sqlIdent.ts`).**
    - `quoteIdent` for mysql/clickhouse doubles backticks only. Go's ClickHouse `quoteIdent`
      (`SI/adapters/clickhouse/read.go`) escapes backslash, then backtick, and panics on NUL. The
      renderer and Go disagree for ClickHouse identifiers holding `\`. Affects Copy as INSERT,
      filter-by-value and FK nav filters.
    - `quoteLiteral` escapes backslash for mysql, clickhouse and undefined dialect, then doubles
      `'`. No NUL handling. Check `grid-sql-literal-escaping` covers ClickHouse.
    - `cellMenu`'s filter-by-value builds `col = 'text'` from `ctx.text`. Check three inputs:
      a truncated cell (a prefix, matches nothing), a masked cell under preview (masked text), a
      staged cell (`displayCell` returns the staged value, not the committed one). The same holds
      for `navValuesFor` feeding FK nav and `FkPreviewPopover`'s `data.read`.
    - Typed columns: binary display text (hex or base64), timestamps formatted client-side, JSON,
      booleans. Check the literal matches what the engine compares against, per dialect.
11. **Cell editor (`VS/celleditor/*`).**
    - `readOnlyReasonFor` order: masked, connection read-only, value truncated, no PK. Parity with
      `onBeforeEditCell` (§4.3).
    - `parseTimestamp` epoch formats use `Number(t)`, which accepts `''` (as 0), fractions and
      `1e9`. `encodeTimestamp` epoch-seconds uses `Math.round(ms / 1000)`, dropping fractional
      seconds: contradicts D16's byte-shape-preserving claim for a fractional epoch value.
    - `validate.ts` skips truncated and empty values. Check an empty string on a NOT NULL numeric
      column.
    - `useEditBuffer` dirty/reset/reseed: switching the active cell while dirty. Check the buffer
      reseeds only when not dirty, and a discard prompt exists or the loss is intended.
    - `detect.ts` format sniffing runs on up to 64 KiB. Check no pathological regex there.
12. **Search scan (`VS/page/scan.ts`, `search.ts`, `searchFilter.ts`).**
    - `compileSearchPattern` always sets `g`, so `eachMatch`'s zero-width `lastIndex++` guard
      terminates (verified by code-read). No `u` flag: `lastIndex++` can split a surrogate pair,
      and highlight offsets are UTF-16. Check emoji-heavy cells highlight correctly.
    - A user regex runs on JS's backtracking engine on the main thread. Chunking bounds rows per
      frame, not one `exec` call; `(a+)+$` against one 64 KiB cell freezes the UI. The Go-side
      file search uses RE2 for exactly this reason. Decide finding (worker, timeout, or
      documented limit).
    - `MAX_SCAN_MATCHES` cap with true `found`; `matchedRowsOf` assumes ascending input;
      `createMatchIndex` memoizes by array identity. Check the priority pass never feeds them an
      unsorted array.
13. **HTML and DOM injection.**
    - SlickGrid `enableHtmlRendering: false` (F6). `cellFormatter` returns a DOM `<input>` only for
      insert rows; check its value is set by property, not markup. Check header names, tooltips
      (`columnHeaderTooltip`) and `FkPreviewPopover` values render as text.
    - `AutocompleteField.vue` binds `v-html="overlayHtml"` from `paintOverlayHtml` (Part 11).
      `escapeHtml` escapes `& < >` only, not `"`. Class names come from Monaco `mtkN` and the
      static `classFor` in `variableCompletion.ts`. Confirm every `rangeHighlights` provider
      stays static, or escape `"` in the class attribute.
14. **TanStack Query keys (the three real queries).**
    - `PreviewCommandPanel`: key `['previewPending', tabId]`, default `staleTime`. The key carries
      no pending-set version, so a reopen after more edits serves the previous SQL until refetch
      lands (`isLoading` is false while cached data exists). No `removeQueries` on tab close.
      Check what the user sees in that window and whether Commit can act on it.
    - `SlickGridHost` mask rules: `staleTime: Infinity`, key `maskRulesQueryKey(connectionId)`.
      `SF/state/maskRules.ts` writes via `setQueryData`, not invalidation (Part 12 owns it).
      Check the key is reactive to the tab's connection and that a rule edit re-renders cells.
    - `DataToolbar` mask rule counts: same `setQueryData` path. Check the toolbar badge updates.
15. **Fake data (`VG/fakeData/*`).** `typeBounds` per type (integer widths, unsigned, decimal
    precision and scale, varchar length, enum sets), `recipes` column-name matching, temporal
    formats per dialect. Check unique and PK columns cannot collide across a batch, generated
    columns are skipped, and a very large row count is capped before staging.
16. **Lifecycle and listeners.**
    - `kiraSlickGrid.ts` is the only `setTimeout` user; check teardown clears it.
      `addEventListener` in `kiraSlickGrid.ts`, `SlickGridHost.vue` and `slick/editor.ts`: check
      each has a matching remove (P99 Part 4's three named declines stay declined; review only
      their teardown).
    - `scrollTrace.ts` holds one module-level `gridEl` via `registerGrid`/`unregisterGrid`. Check
      two mounted grids (data tab plus console, or a split) do not steal or null each other's
      registration.
    - `registerTabRuntimeCleanup` coverage: grid runtime, pending changes, `document/rows.ts`
      caches, keyvalue runtimes, `previewPending` query cache.
17. **Repo conventions.**
    - `<style>` blocks in 23 own files, all `@apply` after P99 Part 4. Check against CLAUDE.md's
      "Tailwind utility classes, not a scoped `<style>` block" rule; `slickTheme.css` targets
      SlickGrid's own DOM and is a real exception.
    - 17 files use `TooltipTrigger` and 8 use `TooltipDisabledTrigger`. Sweep for a `:disabled`
      control inside a plain `TooltipTrigger` (P105).
    - Every SFC is `<script setup lang="ts">` (grep found no `defineComponent` or plain
      `<script>`). One store, one concern: `useGridViewStore` holds view state, mask preview, meta
      and count. Decide whether mask preview is a second concern.
    - `SlickGridHost.vue` at 2682 lines. Report a split only with a concrete seam, not size alone.
18. **Doc drift.** `docs/ARCHITECTURE.md`'s grid row says `@tanstack/vue-virtual` "is no longer a
    dependency (P30 §3.6 C7)". `KeyValuePane.vue` imports `useVirtualizer` and the root
    `package.json` lists `@tanstack/vue-virtual` 3.13.39. Fix the doc. ARCHITECTURE also names
    `views/shared/page/Pager.vue`; the file is `PagerControls.vue`.
19. **Tests against CLAUDE.md's unit-test bar.** Selection edges, row-range bounds, paste and
    PK guards, scan chunking, page-store cache, timestamp parsing and `view-op-disconnected-status`
    qualify. Check `grid-stage-delete-idempotent`, `grid-menu-projection-empty-guard` and
    `resolve-column-order` are not restated function bodies. Name a missing guard only where a
    finding's fix needs one (§4.1 load-failure loss, §4.2 truncated PK, §4.4 row-kind paste).

## 5. Watch items (pre-plan §5.9, verified)

- **P99 Part 4 migration:** premise corrected in §0 (CSS to `@apply` plus VueUse, three named
  declines; TanStack Query only in three files). Query keys: §4.14. Declines: §4.16. `<style>`
  rule: §4.17.
- **Page-store cursor and boundary arithmetic:** confirmed real. §4.5 (upper-bound clamp, stale
  count, empty last page after commit, keyset under jump), §4.1 (staged loss on every reload).
- **Selection-model edges:** confirmed. §4.8 (normalization disagreement, empty filter
  position), §4.4 (row-kind paste targets).
- **Clipboard format safety:** confirmed, with a scope question. §4.9 (negatives and in-app
  round trip), §4.4 (single value split as CSV), §4.9 (Long/Decimal precision in plain JSON).
- **SQL literal escaping:** confirmed, plus a new item. §4.10 (ClickHouse identifier backslash
  divergence from Go; filter-by-value on truncated, masked or staged text).
- **Staged edits against composite and PK-less tables:** guarded on the main path (`buildPlan`
  throws `UnaddressableRowError`; Go `AssertKeyIsPrimaryKey` backstop). Remaining edges §4.2
  (meta-load failure, truncated PK key, no-op updates) and §4.3 (generated columns on existing
  rows).
- **Largest churn area (2,578 lines):** figure not re-derived; §1 gives current size.

## 6. Out of scope

- Generated code (`frontend/bindings`) and P110's `--color-muted` collision.
- Documented known open items: M5 correlation provenance, F1 JSON/array over-refusal, uncapped
  per-tab page RAM.
- **Part 4's adapters** (`sqlmutate.go`, per-engine quoting) and **Part 6's bridge and page
  protocol**. Both closed. Report a defect there with its file; review only the contract.
- **`SF/views/{console,documents,keyvalue,stream,browse,definition}/**`, `SF/editor/**`,
  `beautify.ts`** (Part 11) and **`SF/state/**`, `SF/workbench/**`** (Part 12). Read for the
  contract. Same-stream later chunks, so a fixer may edit them (pre-plan §3.3).
- **`PW`/`PT` (B1, stream B).** Closed. A defect there is reported with its file, not fixed here.
- P99 Part 4's three named `SlickGridHost.vue` declines (§0). They stay declined unless the
  reviewer finds the stated ordering reason no longer holds.
