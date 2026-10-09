# P228 plan: git graph breaks after column resizes

Base: `428cb2b03` (P228-P230 SPEC rows), branch `v2.0`.

## Ask (user's words)

"the git graph is still broken, but try resizing some columns as I think that breaks it."
Symptoms carried from P225: commits, dots and lines disappear on click and scroll; Show more broke.

One sequential Sonnet implementer. No stream split: both fixes meet in `CommitGrid.vue`'s column
model (`currentColumns`, `computeMessageWidth`, `updateHandlePositions`, the graph formatter's
width accessor) and share one spec file.

## Reproduction (done while planning, on this tree)

Scratch Playwright specs in `apps/kira-space/tests/ui/` against the real Space bundle
(`build:test:space`), real layout worker, real SlickGrid, the P225 paging fixture
(`support/graphPagingFixture.ts`: 2000 commits, 500-row chunks, two 1000-row pages; page 1 needs 2
lanes, page 2 needs 5). Run in WebKit (the `ui` project) and again in Chromium
(`test.use({ browserName: 'chromium' })`). Window 1440x960, so grid viewport 1148px with the detail
pane closed, 768px open.

Steps covered: every resize handle the grid has (graph, author, date; the message column has no
handle, it takes the remainder; the sha column was deleted in G21) by pointer drag, narrow and
wide, and the detail pane's own handle; resize before and after Load more; resize then wheel, then
row click, then Escape; samples taken mid-drag with the button still down. There is no
double-click autosize on any handle (`KuiColumnResizeHandle` has pointer and Arrow keys only).
Per step, per fully visible row: node count, whether `elementFromPoint` at each node's centre hits
its own row, cell lefts and widths, SVG width; plus viewport `scrollLeft`, `scrollWidth`,
`clientWidth`, canvas size, and gaps or overlaps between consecutive rows.

Two faults, both deterministic, both engines.

**Cause 1. Wide columns overflow the viewport; a sideways wheel scrolls the graph off screen.**
Detail pane closed. Drag graph +300, author +300, date +300.
- WebKit: `scrollWidth 1355 > clientWidth 1148`, then 10 wheel steps of (dx 40, dy 60):
  `scrollLeft 193`, `graph cell at x -193`. All 40 visible rows: every node's `elementFromPoint`
  misses (`circleVisible [0]`). Screenshot: no graph at all, message text starts mid-panel.
- Chromium: `scrollWidth 1355 > clientWidth 1160`, `scrollLeft 195`, `graph cell at x -195`.
- A row click opens the detail pane (compact columns fit, graph returns); Escape brings the overflow
  back. That matches "disappears on scroll, comes back or goes on click".
- The three resize handles are siblings of SlickGrid's viewport, so they do not scroll with it:
  after the wheel they sit 193px right of the column edges they move.

Code path: `computeMessageWidth` floors the message column at `MIN_MESSAGE_WIDTH` (120) and
`setColumnWidth` clamps each column only to `[min, MAX_COLUMN_WIDTH 600]`, independent of the
others. Once `graph + author + date + 120 > availableWidth()`, `buildColumns` sums wider than the
viewport, SlickGrid sets the canvas to that sum and the viewport's inline `overflow-x: auto`
(`setOverflow`) lets a trackpad or Shift+wheel scroll it. A narrower window, a wider left panel, or
persisted wide author/date widths reach the same state with no drag at all.

**Cause 2. Any graph-column drag freezes the column below what later lanes need; outer nodes clip.**
Drag graph -100 (stops at the 40px floor), scroll page 1 (no clipping: 2 lanes fit), Load more,
sweep page 2 every 30 rows.
- WebKit and Chromium identical, 61 clipped nodes: `row 1001: cx 43.5`, `row 1002: cx 56.5`,
  `row 1003: cx 69.5`, `row 1004: cx 82.5`, `row 1052: cx 43.5`, `row 1053: cx 56.5`,
  `row 1054: cx 69.5`, `row 1102: cx 43.5`, ... (every fan block).
- Widening is no better: drag +20 (43 to 63px), Load more: `1354:69.5`, `1404:69.5` clipped in the
  rendered window alone.
- This is P225's own pre-fix failure list, line for line. P225 fixed it only while the column is
  in auto mode; `setColumnWidth('graph', …)` sets `graphAutoWidth = false` and nothing ever widens
  the column again.

Code path: the row SVG (`rowSvg.buildRowSvg`) is exactly the column width with
`clip-path: inset(-2px 0)`; lane x comes from `laneX(lane)` with no reference to that width. Three
routes leave the column narrower than `graphColumnWidth(laneCount)`:
1. A user drag (above), any direction, before lanes grow (Load more, later chunks).
2. Every mount with persisted view state: `initialScrollRow` is defined, so auto mode never starts
   and the persisted width (95 by default) stays.
3. Auto mode itself caps at `DEFAULT_GRAPH_LANE_CAP` (6 lanes, 95px); lane 7+ (x 95.5 and up)
   clips on a repo with more open branches. `docs/ARCHITECTURE.md` documents this as intended
   ("Lanes past six clip until the user drags wider"); the user reads it as broken.

**Not reproduced.** No row gaps or overlaps, no missing rows, no lost nodes mid-drag (30 samples
across a 300px drag), none after detail-pane drags of -300/+250/-100/+400, none after a
row click alone. Load more ("Show more") completed after every resize sequence, canvas grew
19476px to 38935px, last row rendered. P225's open item (Refresh after Load more re-walks one page)
still has no SPEC row; this phase does not touch it.

## Fix design

### F1. Effective column widths always fit the viewport (cause 1)

New pure module `packages/git-ui/src/components/columnFit.ts`:

```ts
export interface ColumnFitInput {
  readonly stored: ColumnWidths;   // user preference, persisted, unchanged by fitting
  readonly available: number;      // availableWidth()
  readonly graphFloor: number;     // F2
  readonly graphAuto: boolean;     // F2
  readonly minAuthor: number;
  readonly minDate: number;        // minWidthFor('date')
  readonly minMessage: number;     // MIN_MESSAGE_WIDTH
  readonly compact: boolean;       // detailOpen
}
export interface ColumnFit { graph: number; author: number; date: number; message: number }
export function fitColumns(input: ColumnFitInput): ColumnFit;
export function maxDragWidth(column: keyof ColumnWidths, fit: ColumnFit, input: ColumnFitInput): number;
```

Rules, in order:
1. `graph` = F2's effective graph width. Never reduced to fit.
2. Compact: `message = max(0, available - graph)`; author/date pass through (not rendered).
3. Full: `excess = graph + author + date + minMessage - available`. While `excess > 0`, take it
   from author down to `minAuthor`, then from date down to `minDate`. Then
   `message = max(0, available - graph - author - date)`. Only a viewport smaller than
   `graph + minAuthor + minDate` can still overflow; F1c covers that.
4. `maxDragWidth(column)` = `available - minMessage - (sum of the other rendered effective
   columns)`, clamped to `[that column's min, MAX_COLUMN_WIDTH]`. A drag stops where the message
   column reaches 120px instead of pushing the canvas past the viewport.

`CommitGrid.vue`:
- One `fit()` helper builds `ColumnFitInput` from `widths.value`, `availableWidth()`,
  `props.detailOpen`, `laneFloor`, `graphAuto`, `minWidthFor`. `currentColumns`,
  `updateHandlePositions` and the graph formatter's width accessor all read `fit()`;
  `computeMessageWidth` is deleted (its only callers are those two).
- Handles: `:value` and `left` read effective widths; `:max` binds new refs `maxGraph`,
  `maxAuthor`, `maxDate` that `updateHandlePositions` sets from `maxDragWidth`.
  `KuiColumnResizeHandle.clamp` reads `props.max` per move, so a drag stops live.
- `setColumnWidth` clamps to `maxDragWidth` as well as `[min, MAX_COLUMN_WIDTH]`, so the emitted
  and persisted width never exceeds what fits now.
- Stored widths stay the user's preference: a window that shrinks then grows gets the old author
  and date widths back. Nothing new is persisted; `PersistedViewState` stays version 8.

F1c, the guarantee: style rule
`.kv-commit-grid .slick-viewport { overflow-x: hidden !important; }` in `CommitGrid.vue`'s style
block, next to the existing `.slick-viewport` rules. `!important` because SlickGrid writes
`overflowX` inline in `setOverflow()` on every `resizeCanvas`; there is no option for hidden
(`alwaysAllowHorizontalScroll` only toggles between `auto` and `hidden` for frozen rows). The comment
says why. With F1 rules 1-4 it only matters in the sub-minimum viewport, where the date column
then clips at the right edge instead of the graph scrolling away at the left.

### F2. The graph column is never narrower than its lanes (cause 2)

State in `CommitGrid.vue` replaces `graphAutoWidth`, `graphAutoSeeded`, `graphSeedWidth`,
`growGraphColumn`:
- `laneFloor`: grow-only high-water of `graphColumnWidth(graphView.laneCount)` for this mount
  (0 until the first lane-aware layout). Grow-only keeps P225's "a refresh restarting at
  `laneCount` 0 never makes the column jump back". A repo switch remounts the component, so it
  resets there.
- `graphAuto`: true on a first-ever mount (`initialScrollRow === undefined`, as today) until the
  user drags the graph handle.
- Effective graph width: `graphAuto && laneFloor > 0` gives `max(MIN_COLUMN_WIDTH, laneFloor)`
  (P225's lane-fit width, first one may shrink from the 95 default); otherwise
  `max(MIN_COLUMN_WIDTH, widths.graph, laneFloor)`.
- `raiseLaneFloor()` (from `handleChunkLayout` and once in `onMounted` when `laneCount > 0`):
  raises `laneFloor`; if the effective graph width changed, `rebuildColumns()`. Same call site and
  cost as today's `growGraphColumn`.
- Graph handle `:min` is the effective floor `max(MIN_COLUMN_WIDTH, laneFloor)`, so a drag cannot
  go below the lanes in view.
- The auto cap at six lanes goes: `graphColumnWidth` already clamps at `GEOMETRY.maxLanes` (12,
  173px), and `laneX` clamps lanes past 12 to the twelfth, so every drawn node fits by
  construction. `DEFAULT_GRAPH_LANE_CAP` stays for `DEFAULT_COLUMN_WIDTHS.graph` only.
- `widths.value.graph` (stored) is written only by a drag; the floor never writes it, so nothing
  new persists. Restoring a persisted 40px or 17px width paints a lane-wide column.

### F3. Uncommitted strip follows the effective graph width

`UncommittedChangesStrip` sizes its graph cell from `App.vue`'s persisted `columnWidths.graph`
(P225 noted it, open since P92). F2 makes the effective width differ from the persisted one far more
often, so the strip's node would sit off the grid's lane. `CommitGrid` emits
`(e: 'graphWidth', px: number)` whenever the effective graph width changes (from `rebuildColumns`,
deduped); `App.vue` holds it in a plain `ref` bound to the strip's `:graph-width`. Not part of
`columnWidths`, not persisted.

## Files touched

- `packages/git-ui/src/components/columnFit.ts` (new), `columnFit.test.ts` (new).
- `packages/git-ui/src/components/CommitGrid.vue` (F1, F1c, F2, F3 emit).
- `packages/git-ui/src/App.vue` (F3 binding).
- `apps/kira-space/tests/ui/repo-graph-paging.spec.ts` (regression tests below).
- `docs/ARCHITECTURE.md` (commit-grid paragraph), `docs/v2.2/SPEC.md` (P228 result, row status).
- Not touched: `rowSvg.ts`, `graphColumn.ts`, `geometry.ts`, `columns.ts`, `viewState.ts`,
  `KuiColumnResizeHandle.vue`.

## Regression specs (write first, see them fail, then fix)

Add to `apps/kira-space/tests/ui/repo-graph-paging.spec.ts` (same fixture and helpers; no second
copy of `openRepo`/`sweep`/`clippedNodes`). New helpers in that file: `drag(page, handleName, dx)`
(pointer down at the handle's centre, 10 moves, up), `overflow(page)` (returns `scrollWidth >
clientWidth`, non-zero `scrollLeft`, and the first graph cell's x relative to the viewport, as
strings), `diagonalWheel(page)` (10 x `mouse.wheel(40, 60)` over the viewport). Handles by role:
`getByRole('separator', { name, exact: true })`.

Test R1: "columns resized wide never push the graph out of view".
1. Open repo, press Escape (detail pane closed; the three handles render).
2. Drag graph +300, author +300, date +300; `expect(await overflow(win)).toEqual([])`.
3. Focus the date handle, press ArrowRight 80 times; overflow empty.
4. `diagonalWheel`; overflow empty; `clippedNodes` empty.
5. Click a row (pane opens), Escape; overflow empty.
6. `win.setViewportSize({ width: 1000, height: 960 })`; overflow empty.
7. Load more; `diagonalWheel`; overflow empty; `errors` empty.

Expected failure on the unfixed tree (measured): step 2
`['scrollWidth 1355 > clientWidth 1148']` (Chromium `1160`). If step 2 is skipped, step 4 gives
`scrollLeft 193`, `graph cell at x -193`.

Test R2: "a resized graph column keeps every node after Load more".
1. Open repo, drag graph -100 (lane floor).
2. `scrollToRow(PAGE_SIZE - 1)`, `clippedNodes` empty.
3. Load more; `sweep(range(PAGE_SIZE, PAGING_ROWS, 30), clippedNodes)` empty;
   `widestNode > 60` (sweep reached outer lanes).
4. Drag graph +20 (still below the 5-lane need), re-sweep the same rows: empty.

Expected failure on the unfixed tree (measured): step 3, 61 entries starting
`row 1001: cx 43.5`, `row 1002: cx 56.5`, `row 1003: cx 69.5`, `row 1004: cx 82.5`,
`row 1052: cx 43.5`, `row 1053: cx 56.5`, `row 1054: cx 69.5`, `row 1102: cx 43.5`.

Record both failures in the result section from a run on the unfixed tree (stash the fix, or run the
spec commit alone before the fix commits).

Unit test `columnFit.test.ts`, one table-driven `describe`: it guards a decision structure with
interacting rules (lane floor vs stored width vs auto mode, two-step shrink order with two
different minimums, compact pass-through, sub-minimum viewport, drag max per column). Cases: fits
untouched; window shrink takes author first then date, stops at each min; sub-minimum viewport
leaves message 0 and never shrinks graph; compact ignores author/date; auto mode uses floor even
below stored; user mode uses `max(stored, floor)`; `maxDragWidth` for each column in full and
compact mode. Nothing else gets a unit test.

## Docs

- `docs/ARCHITECTURE.md`, the paragraph starting "`CommitGrid` auto-sizes the graph column":
  rewrite to: auto mode on a first-ever mount tracks lanes; the graph column never renders
  narrower than `graphColumnWidth(laneCount)` (grow-only per mount, at most 12 lanes) in any mode;
  stored widths are preferences, effective widths come from `columnFit.ts` and always fit the
  viewport (author then date shrink, message floor 120 for drags); the viewport's horizontal
  overflow is forced hidden; the uncommitted strip reads the effective graph width. Delete the
  "too narrow a column hides nodes" and "Lanes past six clip" sentences.
- `docs/v2.2/SPEC.md`: P228 result section (causes, measured failing lines, deviations, checks, Mac
  handover); row status Done only after the orchestrator verifies. Leave P225's result text as is.
- This plan file is deleted when its result is folded in (README rule), not by the implementer.

## Checks

1. Fast, per commit: `bun run typecheck`, `bun run lint`, `bun run lint:dead`.
2. `bun test packages/git-ui/src/components/columnFit.test.ts`, then `bun run test:unit`.
3. `bun run build:test:space`, then targeted:
   `node node_modules/.bin/playwright test --config=apps/kira-space/playwright.config.ts --project=ui repo-graph-`
   (all `repo-graph-*` specs, WebKit). Also R1 and R2 once in Chromium via a temporary
   `--project` override or a local `test.use`, not committed.
4. Once, near the end: full Space UI suite `bun run test:ui:space`.
5. `bun run test:webview` (same `CommitGrid`; `graph-columns.spec.ts` drags and keys the graph
   handle and asserts no horizontal scrollbar; its one-lane fixture floor is 40px, so its
   4-widen/2-narrow sequence still moves linearly).
6. Not needed: `test:visual:space` unless a baseline shows the graph column (none at a changed
   width today); run it if any visual spec renders the repo graph.

## Commits (Conventional Commits, in order)

1. `test(space): graph resize regression specs` (R1, R2; fails on this tree, commit with the
   recorded failure in the body). The pre-commit hook does not run Playwright, so this commit lands
   clean.
2. `feat(git-ui): fit commit-grid columns to the viewport` (columnFit.ts + test, CommitGrid F1, F1c).
3. `fix(git-ui): graph column never narrower than its lanes` (F2).
4. `fix(git-ui): uncommitted strip follows the graph column` (F3).
5. `docs: P228 result` (ARCHITECTURE, SPEC).

## Mac handover (real WKWebView, trackpad)

On a repo with 5000+ commits and more than 6 concurrent branches:
1. Close the detail pane. Drag author and date as wide as they go: the drag stops when the
   message column is about 120px wide; no horizontal scrollbar appears.
2. Swipe diagonally on the trackpad over the graph: rows scroll vertically only; graph and dots
   stay put.
3. Shrink the window: author shrinks first, then date; the graph column keeps its width.
4. Drag the graph column as narrow as it goes: it stops at the width of the lanes in view.
   Load more: the column widens as deeper rows add lanes; no dot is cut at the right edge.
5. Rows with lane 7 or more (many branches): the dot is visible without any drag.
6. The uncommitted-changes strip's dot lines up with the first row's lane.
7. Quit and reopen: widths persist; a column the window cannot fit shrinks, then comes back when
   the window grows.

## Deferred decisions (implementer takes the default; the user can overrule)

- D1 Lane floor over user width. Default: the graph column cannot be narrower than its lanes (up
  to 173px at 12 lanes). Alternative: keep a narrower user width and compress lane spacing or pile
  outer lanes onto the last visible one. Rejected as default: compression below about 8px per lane
  makes nodes overlap, and piling draws lines on top of each other (P225 cause B's symptom).
- D2 Shrink order on a small viewport: author first, then date. Alternative: proportional.
- D3 Auto mode's six-lane cap removed; a first-ever mount on a 12-lane repo opens at 173px.
- D4 `overflow-x: hidden !important` on SlickGrid's viewport as the last guard.
- D5 Stored widths stay preferences (restored when the window grows) rather than being rewritten
  to the fitted value.
