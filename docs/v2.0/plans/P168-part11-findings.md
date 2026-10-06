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
  the returned page object changes.

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
