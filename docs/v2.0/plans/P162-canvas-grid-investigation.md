# P162 investigation: canvas grid instead of SlickGrid DOM

Investigation only. No product code changed. Base: `de291795` (v2.0). Question: replace DOM SlickGrid
with a canvas grid for SQL tables? Full feature parity possible? Does the Mongo document view gain?

## Verdict

**Do not migrate. Fix per-cell paint cost in SlickGrid first, then confirm on a real Mac.**

- JS render is not the cost. In-app trace: `renderMs` p95 2.0 ms, mean 0.4 ms, against frame p95
  55-65 ms (20 columns, headless WPE). Frame time goes to WebKit style/paint/raster.
- Stock SlickGrid with 20 columns in the same engine runs at 53-61 fps (p95 20-30 ms). The DOM model
  is not intrinsically too slow; this app's grid configuration is.
- Two CSS changes alone moved the app from 33-35 fps (p95 60-63 ms) to 39-40 fps (p95 48-50 ms).
- Canvas can at best lower the macOS scroll-memory plateau toward the empty-scroller floor (+427 MB
  per `docs/v1.1/WEBVIEW-SCROLL-MEMORY.md` §6), never remove it. That is inferred, not measured.
- Migration cost is large (L-XL, 5-7 phases), loses screen-reader and DOM test surface, and the only
  credible candidate (Glide Data Grid) is React-only with slowing maintenance.

## 1. Feature inventory (current grid layer)

Source: `codegraph_explore` over `SlickGridHost.vue`, `ConsoleSlickGrid.vue`, `kiraSlickGrid.ts`,
`views/grid/slick/*`, `views/shared/slick/*`, `cellSelection.ts`, `CellEditorView.vue`.

**Grid-agnostic, survives any engine swap.** Page store and decode cache (`views/grid/page.ts`,
`console/resultPages.ts` `cell()`), staged-value merge (`rowValues.ts displayCell`), mask preview
transform (`maskPreview.ts`), pending changes store, menu builders (`grid/menu.ts`,
`console/resultMenu.ts`), clipboard formats (`clipboardFormats.ts`: TSV rows/columns, `parseDelimited`),
paste target logic (`paste.ts`), column order/hide (`resolveColumnOrder` + `ColumnsMenu.vue`, data
level), width measurement (`columns.ts initialWidths`, canvas-measured already), search state and
`matchedRows` filter, FK preview fetch (`fkPreview.ts`), focus request handshake (`focusRequest.ts`).
The cell editor dock (`CellEditorView.vue`: JSON/binary/temporal formats, beautify, validate,
generators, timestamp pane) is outside the grid. It only reads the `SelectedCell` Pinia record
(`state/cellSelection.ts`). JSON/binary/temporal formatting is therefore not a grid concern.

**Engine-coupled, must be rebuilt on a canvas grid.**

- Cell rendering (`cellFormatter`): plain text; `NULL` marker (`.cell-null`); truncation marker
  (`.cell-truncated::after` pseudo-element plus `title` "value truncated at 64 KB"); mask suffix
  styling (`.cell-masked`); per-column type colour (`tc-<category>`) and right-align for numerics;
  insert-row cells as live `<input>` elements (`grid-cell-insert-input`). No empty-string marker in
  the grid: `''` renders blank.
- FK/PK nav: per-rendered-cell imperative buttons (`placeNavButtonsForRenderedCells`, aria-labelled),
  click opens `FkPreviewPopover.vue` anchored to the cell rect.
- Gutter: frozen column 0 (`frozenColumn: 0`), row numbers with page offset, `+` for inserts,
  select-all corner, gutter click = row selection, pending-row rail classes
  (`kira-row-inserted`/`-deleted`/`-dirty`, `pendingRowClasses`).
- Selection: `SlickHybridSelectionModel` (cell, range, ctrl/shift disjoint rows, column via header
  select zone); four-sided outline via `setCellCssStyles` edge layers (`selectionEdges.ts`);
  drag-fill twin (`computeCellFillHash`); remap on filter change.
- CSS layers via `setCellCssStyles`: `kira-staged`, `kira-search`, `kira-search-current`,
  `kira-sel-edges` x4, selection fill.
- Keyboard: SlickGrid `enableCellNavigation` (arrows, Tab, Enter to edit, Esc), plus `onKeydown`
  (copy, paste, row shortcuts via `runMenuShortcut`, delete row).
- Inline edit: `KiraCellEditor` (`<input>` inside the cell, `editorCtx` bridge to `stageEdit`),
  `onBeforeEditCell` vetoes (generated, truncated, deleted, masked, no PK, read-only).
- Context menus: cell, row (gutter), range, header (sort, copy column, hide), all through the
  workbench `contextMenu` store.
- Header: sort cycle and numbered multi-sort badge, PK/FK badge, select zone, tooltip attributes
  (`data-kira-tip`, `aria-label`) read by `AttributeTooltip.vue`, resize (`onColumnsResized`,
  persisted, header-aware floor). No header drag reorder (`enableColumnReorder: false`). No user
  column pinning beyond the gutter.
- Hover row highlight (CSS `:hover`). Row density 22/28 px from settings.
- Find: highlight layers plus `goToMatch` scroll-into-view; "hide non-matching rows" filter.
- Empty states (no rows, no matching rows) as Vue overlays.
- Scroll machinery: velocity-scaled runway, per-render cell budget, chase scheduling, column
  overscan (`kiraSlickGrid.ts`), scroll persistence, `__kiraScrollTrace`, `__kiraGridTuning`.
  A canvas grid makes all of this obsolete, not ported.
- Theming: `slickTheme.css` (748 lines, 75 `var(--kira-*)` uses), so dark/light follows tokens for
  free. A canvas grid needs a JS theme object rebuilt from computed CSS variables on theme change.
- Accessibility: SlickGrid's own `role=grid/row/gridcell`, `tabIndex`, `aria-describedby`; app adds
  `aria-label` on gutter corner, sort buttons, nav buttons, select zones. Focus ring is CSS.
- Text selection: no native text selection in cells; copy goes through grid selection.
- Console result grid (`ConsoleSlickGrid.vue`) reuses the same layer minus FK/PK nav, editing and
  insert rows.

**Blast radius.** `slickgrid` imports: 12 files. Studio: `SlickGridHost.vue` (2659 lines),
`ConsoleSlickGrid.vue` (862), `views/shared/slick/` (10 files, about 1830 lines incl. 748 CSS),
`views/grid/slick/` (3 files, 477 lines), `tests/unit/slick-selection.spec.ts`. Kira Space:
`packages/git-ui` `CommitGrid.vue`, `columns.ts`, `graphColumn.ts` also use SlickGrid, so the
dependency stays in the repo whatever Studio does. Dependents: `DataView.vue` (2 call sites),
`ConsoleResultGrid.vue`, `FkPreviewPopover.vue`. About 4 000 lines of engine-coupled Studio code to
rewrite.

## 2. Test impact

Grid DOM dependents (`.slick-*`, `grid-cell`, `grid-row`, `console-result-*`, `support/grid.ts`):
27 files. `tests/ui`: 15 specs plus `support/grid.ts` (168 lines) and `support/measure.ts`.
`tests/visual/data-view.spec.ts` (screenshot). `tests/e2e-real`: postgres, sqlite, mariadb. `tests/ipc`
frontend specs: mysql, mariadb, clickhouse. `tests/unit`: 3 (runway math, visible span, row menu).
Helper call counts: `gridCell` 94, `cellText` 38, `headerCell` 23, `gutterCell` 23, `cellNavButton`
14, `gridScroller` 7, plus `nullMarker`, `gridRow`, `clickCellNav`, `sortIndicators`. Raw grid
selector hits: 213. `slick-grid.spec.ts` (17 tests) and `scroll-trace.spec.ts` test SlickGrid
mechanics and would be deleted, not ported.

On canvas there is no DOM cell to locate, read, hover or double-click. Replacements:

- Accessibility overlay. Glide renders a hidden `<table role="grid">` for the visible window, cells
  `id`/`data-testid="glide-cell-<col>-<row>"`, `aria-selected`. Locators can target it for text, but
  clicks must go to the canvas at computed coordinates.
- Test hook: a debug-gated `window.__kiraGrid` exposing `cellBounds(row, col)`, `cellText`,
  `selection`, `activeCell`. `support/grid.ts` becomes coordinate-based; the helper API can keep its
  names, so spec bodies change less than the helper.
- Visual: screenshot tests keep working; they become the only check of rendered markers (NULL,
  truncation, mask, type colour), which today are asserted by class.

Estimated rewrite: `support/grid.ts` fully, about 25 spec files touched, 2 deleted. Medium-large on
its own, and flakier (pixel coordinates, DPR).

## 3. Candidate libraries

Checked on npm and upstream, 2026-10-05.

**Glide Data Grid** (`@glideapps/glide-data-grid`). MIT; every feature in the package and
`glide-data-grid-cells` is MIT, no paid tier. React-only (peer `react`, `react-dom`, plus `lodash`,
`marked`, `react-responsive-carousel` for optional cells); Vue needs a React island mounted from a
`<script setup>` host. Editors are React overlays (`provideEditor`). Native scrolling via an
overflow scroller, canvas draws from offsets. Selection (cell, range, rows, columns), copy/paste,
frozen columns, column resize/move, custom canvas cell renderers, theme object, variable row height,
search UI, hidden accessibility table. Maintenance slowing: latest stable 6.0.3 published 2024-02-03,
6.0.4 alphas to 2025-10, last `main` commit 2026-01-21, 94 open issues. WKWebView behaviour not
verified. **Most viable, but foreign stack and stalled releases.**

**VisActor VTable** (`@visactor/vtable`, `@visactor/vue-vtable`). MIT across core, editors and
plugins, no paid tier. Official Vue wrapper. Very active (1.26.8, 2026-09-11, about 285 releases since
2025). Editing, frozen columns, copy/paste, custom render, themes, pivot features. Heavy:
`vtable.min.js` 2.3 MB, 547 KB gzipped. No ARIA tree found (no a11y issues filed, canvas only).
**Viable on paper; declined: bundle 5-10x any reasonable budget and no screen-reader story.**

**Cheetah Grid** (`cheetah-grid`, `vue-cheetah-grid`). MIT. Vue 3 wrapper. 2.2.0, 2026-08-20.
Frozen columns, keyboard options, range paste, input editing, themes. No ARIA tree known. Smaller
community, styling via theme objects, editing model less flexible than Glide. **Viable fallback;
declined as first choice: weaker a11y and editor story.**

Declined:

- **canvas-datagrid**: BSD-3-Clause. Released 0.4.7 (2023-12) then 0.26.0 (2026-09) after a long gap.
  Web component, no ARIA tree. Maintenance too uncertain.
- **FINOS Perspective / regular-table**: Apache-2.0, but `regular-table` is a DOM virtual table, not
  canvas, and Perspective brings a WASM analytics engine. Wrong tool.
- **RevoGrid**: DOM (MIT core, paid Pro tier). Not canvas.
- **AG Grid**: DOM; needed clipboard/range/context menu are Enterprise-only (already declined in
  `CLAUDE.md`).
- **Handsontable**: not open source for commercial use.
- **Univer**: spreadsheet engine with paid Pro features; overkill.
- **AntV S2**: MIT canvas, pivot/analysis tables, not an editable data grid.
- **x-data-spreadsheet**: unmaintained since 2022.

## 4. Feature parity (native / custom S-M-L / impossible)

Columns: Glide, VTable, Cheetah.

| Feature | Glide | VTable | Cheetah |
|---|---|---|---|
| Text, NULL, truncated, masked markers | custom S (draw) | custom S | custom S |
| Type colour, numeric right-align | native theme per column | native | native |
| FK/PK nav button + preview popover | custom M (hit-test, anchor from bounds) | custom M | custom M |
| Frozen gutter, row numbers, pending rail | native freeze, custom S rail | native, S | native, S |
| Cell/range/row/column selection | native | native | native (no column select: M) |
| Four-sided selection outline, fill-on-drag | native outline, fill M | native, M | M |
| Staged/search highlight layers | custom S (`getCellContent` themeOverride) | S | S |
| Keyboard nav | native | native | native |
| Inline edit + veto rules | native overlay, React editor M | native editors, S | native input, S |
| Insert rows as live inputs | M (editor always open is not a model) | M | M |
| Context menus (cell/row/range/header) | custom S (events give cell) | S | S |
| Copy TSV rows/columns, paste | native copy/paste hooks, S to route to `clipboardFormats` | S | S |
| Column resize + persisted width + header floor | native, S | native | native |
| Column hide/reorder via `ColumnsMenu.vue` | data level, S | S | S |
| Sort cycle, numbered multi-sort badge | custom header draw M | M | M |
| PK/FK header badge, header tooltips | custom header draw M, tooltip M (no DOM attribute bridge) | M | M |
| Find highlight + go-to-match | native search UI or custom S | S | S |
| Hover row | native | native | native |
| Theming via `--kira-*`, dark mode | custom M (JS theme from computed vars) | M | M |
| Screen reader, focus ring | native hidden table; focus ring drawn | impossible without own overlay (L) | L |
| Native text selection | impossible (not present today either) | same | same |
| Truncation tooltip | custom S (hover event + Vue tooltip) | S | S |
| Console grid reuse | S once data grid done | S | S |
| Masks | data level, none | none | none |
| Vue integration | L (React island, React editors) | native wrapper | native wrapper |
| UI test surface | L (overlay + test hook rewrite) | L (no overlay at all) | L |

Nothing current is strictly impossible on Glide. Screen-reader parity is impossible on VTable and
Cheetah without building an overlay ourselves.

## 5. Performance: measured versus inferred

**Measured, this container, Playwright WebKit (WPE, software rendering).**

- App data grid, 10 000 x 20 (`NCOLS=20 grid-scroll`, unmodified probe): 30-35 fps, p95 59-71 ms.
  Console grid, same shape: 38-43 fps, p95 43-50 ms. Matches the SPEC row.
- In-app trace (scratch copy of the probe calling `__kiraScrollTrace`): `renderMs` p95 2.0 ms, mean
  0.4 ms; one render per frame at most. Mounted 897 cells / 138 rows for about 200 visible cells.
  Disabling the lead runway (`leadFramesOverride: 0`, `maxLeadPxOverride: 0`) changed nothing.
- CSS A/B on the live app (stylesheets edited at runtime, same flicks):
  baseline 33-35 fps, p95 60-63 ms, 90-132 frames over 50 ms;
  no row `:hover` rule: 35-36 fps, p95 57-60 ms;
  plus no cell borders: 39-40 fps, p95 48-50 ms, 13-20 frames over 50 ms;
  plus `display:block` cells: no further gain;
  plus row `contain: none`: 21-25 fps, worse (confirms `contain: layout` is load-bearing).
- Standalone scratch page, 1400x860 viewport, 10 000 rows: stock SlickGrid 20 cols 53-61 fps,
  p95 20-30 ms; minimal hand-written canvas grid 20 cols 61-62 fps, p95 17-18 ms; both at 2 cols
  62 fps, p95 17 ms. Process RSS rise per flick similar (+24 to +32 MB first flick).

**What that means.** Per-frame cost is paint/raster, driven by how much painted DOM the app mounts
and how it is styled (cell borders, hover invalidation, an estimated 4.5x visible cells mounted via column
overscan and trail runway), not by DOM construction in JS. A canvas also pays raster (`fillText`)
on the CPU in WPE, but only for the viewport. The best-case canvas beat stock SlickGrid by a few ms
of p95 in this engine; both were at frame rate. Gap between stock SlickGrid (about 60 fps) and the
app (about 35 fps) is the real target, and it is reachable inside SlickGrid.

**Inferred, not measured: macOS memory spike.** The 1 GB+ plateau is WKWebView tile backing store
for a natively scrolled area; velocity drives it. Empty scroller +427 MB, any painted content about
+910 MB, Kira grid +980-1015 MB (`WEBVIEW-SCROLL-MEMORY.md` §6). The app is already within about 11 %
of the painted-content floor. A canvas grid with native scrolling scrolls an empty sizer while a
viewport-sized canvas redraws, so it could land near the empty-scroller tier, plus the canvas
backing store (1600x900 CSS px at DPR 2 is about 23 MB per buffer, likely 2-3 buffers). Plausible
best case: roughly half the plateau. Not eliminated. A canvas grid with its own wheel handling
avoids tiles entirely but loses native momentum, which P22 found users notice (SlickGrid's own wheel
handler was turned off for exactly that).

**Spike that would prove it.** The scratch page used above (stock SlickGrid vs minimal canvas, same
data) loaded in the real macOS app WebView or Safari, measured with the `WEBVIEW-SCROLL-MEMORY.md`
Appendix A harness (`proc_pid_rusage`, 40-100 px/frame band) plus an empty-scroller control, and a
Web Inspector timeline for frame cost. If canvas does not cut the plateau by well over the 11 %
app-attributable headroom, memory is no argument for migrating.

## 6. Mongo / document view

`DocumentView.vue` is not a grid. It is a `useVirtualRows` (TanStack virtual) list, `role=listbox`,
with variable per-row heights (`rowHeights`): collapsed head (`_id`, field count, size) or expanded
`DocumentTree.vue` flat line list, plus inline `MonacoHost` for edit and raw modes and per-row
actions. No table mode exists. A canvas grid does not help: rows are nested, expandable, variable
height, and host Monaco editors and Vue controls; a canvas grid would mean re-implementing the tree
renderer on canvas. Its macOS memory spike is the same WKWebView scroller phenomenon, so a canvas
SQL grid changes nothing there. A Mongo aggregation result opened in the grid view uses the SQL grid
and would follow whatever the SQL grid does.

## 7. Recommendation and estimate

**Do first (P162 itself, small).**

1. Replace per-cell borders with a cheaper construct (row bottom border plus column separators as
   one background on the row or canvas), measure.
2. Drop or narrow the row `:hover` rule during active scroll (class toggled by the existing scroll
   listener), measure.
3. Cut mounted cells: reduce column overscan (`OVERSCAN_PX` 560 per side) and trail runway on the
   column axis; add a `__kiraGridTuning` override first so it A/Bs without rebuilds.
4. Find the residual gap against stock SlickGrid (about 49 ms vs 20-30 ms p95): global stylesheet
   selector cost, per-cell `title`/attributes, type-colour classes. One variable per run.
5. Confirm on a real Mac (the SPEC row's own gate). Close as no-change if the Mac shows no real
   slowdown.

**Prototype canvas only if** the Mac still shows a real slowdown after steps 1-4, or the memory
spike above shows a large canvas win. Prototype scope: Glide in a scratch Vue host, read-only data
grid, 20 columns, Mac timeline + memory harness. About one phase.

**Full migration, if ever justified.** L-XL, about 5-7 phases: (1) React island host, theme bridge
from `--kira-*`, read-only render with markers; (2) selection, keyboard, context menus, clipboard;
(3) inline edit, vetoes, insert rows, pending layers, FK nav + preview; (4) header furniture: sort
badges, PK/FK badges, select zones, tooltips; (5) console grid; (6) test hook and `support/grid.ts`
rewrite, about 25 specs; (7) a11y verification. Risks: React plus Vue in one app (two reactivity
systems, React editors); Glide release cadence stalled; WKWebView canvas text quality and DPR on
external displays; flakier coordinate-based UI tests; screen-reader regression if the hidden table
falls short; memory win unproven.
