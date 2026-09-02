<script setup lang="ts">
import type { Column, CustomDataView } from 'slickgrid';
import { SlickEventHandler } from 'slickgrid';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { appearanceVersion, settingsState } from '../../state/settings';
import { findDataTab, patchDataTabState } from '../../state/tabs';
import { categoryForTypeClass } from '../../theme/icons';
import {
  alignmentFor,
  DEFAULT_COLUMN_WIDTH,
  GUTTER_WIDTH,
  initialWidths,
  resetMeasureCtx,
  resolveColumnOrder,
} from '../shared/page/columns';
import { matchedRows } from './search';
import {
  createDisplayValueExtractor,
  createGridDataSource,
  pendingRowClasses,
  type RowHandle,
} from './slick/dataSource';
import { KiraSlickGrid } from './slick/kiraSlickGrid';
import './slick/slickTheme.css';
import 'slickgrid/dist/styles/css/slick.grid.css';
import { setVisibleRows } from '../shared/page/visibleRows';
import { getPage, pageVersion, setVisibleWindow } from './page';
import { pendingFor } from './pendingChanges';
import * as scrollTrace from './scrollTrace';

// P22 spike (§6 D3) — a from-scratch Vue host for SlickGrid, on editor/CodeMirrorHost.vue's own
// established shape for wrapping an imperative library: one ref root div, the instance held in a
// plain `let` (never a ref/shallowRef/reactive — see that file's own comment for why: Vue must not
// see the grid, its rowsCache or its DOM, or every internal object SlickGrid touches on every
// render gets proxied), constructed in onMounted, destroyed in onUnmounted.
//
// Pass A's own scope boundary (§7.1): no editing, no menus, no clipboard, no drag-select, no insert
// rows, no keyboard beyond what SlickGrid gives for free (here: none — enableCellNavigation is
// off). This file is deliberately NOT a feature-complete replacement for DataGrid.vue; it exists
// behind window.__kiraGridEngine === 'slick' so a real A/B can be run against DataGrid.vue on the
// same build (docs/PERF.md §2.1a's protocol, extended by this phase's own C7).
const props = defineProps<{ tabId: string }>();

// See kiraSlickGrid.ts's own comment: Column<T>'s `field` type is a recursive
// PathsToStringProps<T>, which RowHandle's own shape can't satisfy for the app's arbitrary db
// column names — the column generic is deliberately widened to `any` here too, matching the
// grid class's own escape hatch.
// biome-ignore lint/suspicious/noExplicitAny: see comment above.
type KiraColumn = Column<any>;

function tab() {
  return findDataTab(props.tabId);
}

const rowHeight = computed(() => (settingsState.appearance.rowDensity === 'compact' ? 22 : 28));

// Same P24 D3/D4 split DataGrid.vue's own displayRows/displayRowCount use — kept as a plain,
// non-reactive read at mount and on an explicit page reload (below), not a live `watch` on the
// search state: Pass A's own thick-spike list (§7.0) is decode/bridge/gutter/colour/theme/runway,
// not live search-filter wiring, which stays Pass B scope. The un-filtered common case (the vast
// majority of a session) is unaffected either way.
function currentDisplayRows(): number[] | null {
  return matchedRows(props.tabId);
}

const GUTTER_FIELD = '__kira_gutter';

// Read fresh by the gutter formatter on every cell it builds — a plain object the host reassigns,
// never a Vue ref (§6 D1's own rule: the formatter runs *during* SlickGrid's own render). Mirrors
// dataSource.ts's own GridDataSourceState in spirit: one mutable snapshot, swapped wholesale.
const formatterCtx = { rowNumberBase: 0 };

function gutterFormatter(
  _row: number,
  _cell: number,
  _value: unknown,
  _columnDef: KiraColumn,
  dataContext: RowHandle,
): string {
  if (dataContext.insertId !== undefined) return '+';
  return String(formatterCtx.rowNumberBase + dataContext.row + 1);
}

// §6 D6 point 2 — structure is per-cell: a plain string for the common case (-> textContent, F6),
// an HTMLElement/DocumentFragment for NULL and truncated. `value` is exactly what the grid's own
// dataItemColumnValueExtractor (below) returned for this cell — the CellView the app's existing
// decode/cache/staged-edit pipeline produced, never re-derived here.
function cellFormatter(_row: number, _cell: number, value: unknown): string | DocumentFragment {
  const view = value as { text: string; isNull: boolean; truncated: boolean };
  if (view.isNull) {
    const span = document.createElement('span');
    span.className = 'cell-null';
    span.textContent = 'NULL';
    const frag = document.createDocumentFragment();
    frag.appendChild(span);
    return frag;
  }
  if (view.truncated) {
    const frag = document.createDocumentFragment();
    frag.appendChild(document.createTextNode(view.text));
    const marker = document.createElement('span');
    marker.className = 'truncated-marker';
    marker.title = 'value truncated at 64 KB';
    marker.textContent = '…';
    frag.appendChild(marker);
    return frag;
  }
  return view.text;
}

/** §6 D6 point 1 — colour and alignment are per-column and static: a `tc-<category>` class plus
 *  `kira-align-right` where the column's own descriptor says numeric. Nine categories collapse to
 *  the five `categoryForTypeClass` can actually return; slickTheme.css carries all five anyway
 *  (that file's own comment says why). */
function buildColumns(
  page: ReturnType<typeof getPage>,
  order: string[],
  storedWidths: Record<string, number>,
): KiraColumn[] {
  const cols: KiraColumn[] = [
    {
      id: GUTTER_FIELD,
      field: GUTTER_FIELD,
      name: '',
      width: GUTTER_WIDTH,
      minWidth: GUTTER_WIDTH,
      maxWidth: GUTTER_WIDTH,
      resizable: false,
      sortable: false,
      focusable: false,
      selectable: false,
      cssClass: 'kira-gutter',
      formatter: gutterFormatter,
    },
  ];
  if (!page) return cols;
  const measured = initialWidths(page);
  const byName = new Map(page.columns.map((c) => [c.name, c]));
  for (const name of order) {
    const descriptor = byName.get(name);
    const classes = [`tc-${descriptor ? categoryForTypeClass(descriptor.typeClass) : 'other'}`];
    if (descriptor && alignmentFor(descriptor) === 'right') classes.push('kira-align-right');
    cols.push({
      id: name,
      field: name,
      name,
      width: storedWidths[name] ?? measured[name] ?? DEFAULT_COLUMN_WIDTH,
      // Item 10 (column resize) is Pass B (§7.1) — resizable defaults true on SlickGrid's own
      // Column shape, so this is explicit, not an omission: a half-working resize affordance
      // (drags visually, never persists via patchDataTabState) would look like a bug, not a scope
      // boundary.
      resizable: false,
      sortable: false,
      cssClass: classes.join(' '),
      formatter: cellFormatter,
    });
  }
  return cols;
}

const rootRef = ref<HTMLElement | null>(null);

// Never a ref/shallowRef/reactive (CodeMirrorHost.vue's own rule, restated here — D3).
let grid: KiraSlickGrid | null = null;
let eventHandler: SlickEventHandler | null = null;
let dataSource: ReturnType<typeof createGridDataSource> | null = null;
let viewportEl: HTMLElement | null = null;

// Mirrors DataGrid.vue's own onScroll velocity sampler (rowVelocity()) verbatim — plain variables,
// not refs, read only from KiraSlickGrid's own `velocity` callback, itself called only from inside
// getRenderedRange (entirely outside Vue's reactivity graph). See that file's own comment for why a
// discrete jump (a scrollbar click, a test driving scrollTop directly) must not be read as a fling.
let lastOffset = 0;
let lastOffsetT = 0;
let prevOffset = 0;
let prevOffsetT = 0;
const MAX_PLAUSIBLE_ROW_VELOCITY_PX_PER_FRAME = 800;

function velocity(): { pxPerFrame: number; direction: 1 | -1 | 0 } {
  const dt = lastOffsetT - prevOffsetT;
  if (!prevOffsetT || dt <= 0 || performance.now() - lastOffsetT > 150) {
    return { pxPerFrame: 0, direction: 0 };
  }
  const delta = lastOffset - prevOffset;
  const pxPerFrame = Math.abs(delta);
  if (pxPerFrame > MAX_PLAUSIBLE_ROW_VELOCITY_PX_PER_FRAME) return { pxPerFrame: 0, direction: 0 };
  return { pxPerFrame, direction: delta > 0 ? 1 : delta < 0 ? -1 : 0 };
}

// §6 D9 — called from the host's own viewport scroll listener, the same logical point
// markScrollWork marks in DataGrid.vue today (before the render work, after the browser's own
// scheduling hops). P22 iter2-scroll-gaps D1: the render timing itself is reported by
// scrollTrace.noteRenderMs(), called from KiraSlickGrid's own `render()` override
// (kiraSlickGrid.ts) — not from getRenderedRange, which only computes the range and runs *before*
// the work that override times has happened.
function onViewportScroll(): void {
  const el = viewportEl;
  if (!el) return;
  const now = performance.now();
  scrollTrace.noteScrollEvent(el.scrollTop, now);
  window.__kiraGridScrollWorkStart?.(now);
  prevOffset = lastOffset;
  prevOffsetT = lastOffsetT;
  lastOffset = el.scrollTop;
  lastOffsetT = now;
}

let scrollSaveTimer: ReturnType<typeof setTimeout> | null = null;
function onViewportScrollPersist(): void {
  const el = viewportEl;
  if (!el) return;
  if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
  scrollSaveTimer = setTimeout(() => {
    patchDataTabState(props.tabId, { scrollTop: el.scrollTop, scrollLeft: el.scrollLeft });
  }, 300);
}

// §6 D2 — the visible-window report drives P5 C1's pruning. KiraSlickGrid.lastRenderedRowBounds is
// the *rendered* (overscanned) range, not the strictly-visible one grid.onRendered's own
// {startRow, endRow} carries (see kiraSlickGrid.ts's own comment on why the difference matters) —
// this reads the wider one so a row still inside the runway keeps its decode cache alive.
function onGridRendered(): void {
  if (!grid || !dataSource) return;
  const { start, end } = grid.lastRenderedRowBounds;
  const length = dataSource.getLength();
  if (length <= 0 || end < start) return;
  const first = dataSource.getItem(Math.max(0, Math.min(start, length - 1)));
  const last = dataSource.getItem(Math.max(0, Math.min(end, length - 1)));
  const lo = Math.min(first.row, last.row);
  const hi = Math.max(first.row, last.row);
  setVisibleWindow(props.tabId, lo, hi + 1);
  setVisibleRows(props.tabId, lo, hi + 1);
}

/** §7.0's own "representative static selection/search CSS layer" — a fixed, deterministic pair of
 *  cells, never produced by a click or a drag (that's Pass B's own interaction layer, §7.1). This
 *  exists to prove the setCellCssStyles seam (D5) actually renders, so a thin spike that skipped it
 *  entirely couldn't produce a false-positive "it's fast" result by rendering less than the real
 *  design would. */
function applyStaticCssLayers(): void {
  if (!grid) return;
  const cols = grid.getColumns();
  const firstDataField = cols[1]?.field;
  const secondDataField = cols[2]?.field;
  if (firstDataField) {
    grid.setCellCssStyles('kira-selection', { 0: { [firstDataField]: 'kira-cell-selected' } });
  }
  if (secondDataField) {
    grid.setCellCssStyles('kira-search', { 0: { [secondDataField]: 'kira-cell-search-match' } });
  }
}

function currentWidths(): Record<string, number> {
  return tab()?.state.columnWidths ?? {};
}

function rebuildAndSetColumns(): void {
  if (!grid) return;
  const p = getPage(props.tabId);
  const order = p ? resolveColumnOrder(p, tab()?.state.columnOrder ?? null) : [];
  grid.setColumns(buildColumns(p, order, currentWidths()));
}

onMounted(() => {
  const el = rootRef.value;
  if (!el) return;

  const t = tab();
  const p = getPage(props.tabId);
  const order = p ? resolveColumnOrder(p, t?.state.columnOrder ?? null) : [];
  formatterCtx.rowNumberBase = t ? t.state.pageIndex * t.state.pageSize : 0;

  dataSource = createGridDataSource({
    index: { displayRows: currentDisplayRows(), pageRowCount: p?.rowCount ?? 0 },
    inserts: pendingFor(props.tabId)?.inserts ?? [],
    rowClasses: (row) => pendingRowClasses(props.tabId, row),
    extractValue: p
      ? createDisplayValueExtractor(props.tabId, p, order)
      : () => ({ text: '', isNull: true, truncated: false }),
  });

  // getCellValue's return type is a compatibility shim only (F1's own insurance, never the real
  // render path — dataItemColumnValueExtractor, below, is) so it deliberately returns `unknown`
  // rather than CustomDataView<RowHandle>'s own narrower `T[keyof T]`; the cast reflects that.
  // dataItemColumnValueExtractor is bound to `dataSource.extractValue`, not a locally captured
  // closure — see GridDataSourceState's own comment on why a captured closure went stale after the
  // first page reload (every cell after it kept reading this construction's original, often
  // `page === null`, "everything is NULL" extractor, since this grid option is fixed at
  // construction and a captured closure can't see a later `dataSource.setState` call).
  grid = new KiraSlickGrid(
    el,
    dataSource as CustomDataView<RowHandle>,
    buildColumns(p, order, currentWidths()),
    {
      rowHeight: rowHeight.value,
      // F7 — Sortable.js is never loaded or bundled; this app reorders columns via ColumnsMenu.vue,
      // never by dragging a header, so the default (true, which hard-throws without a global
      // `Sortable`) must be off.
      enableColumnReorder: false,
      // F6 — cell text is untrusted database content; this removes the innerHTML branch entirely.
      enableHtmlRendering: false,
      // F1 — this app measures column widths itself (columns.ts's own canvas-based initialWidths);
      // leaving autosizeColumns() unused also keeps getCellValue off the render path entirely.
      autosizeColsMode: 'LegacyOff',
      // D5 — SlickGrid's own selection-highlight layer must never compete with the app's own
      // 'kira-selection' setCellCssStyles layer.
      selectedCellCssClass: '',
      // §5 item 5 — the sticky row-number gutter, as a real frozen pane rather than one
      // position:sticky box per mounted row (the per-frame cost P22-…-iter2-rendering.md F12 flagged).
      frozenColumn: 0,
      // F3 addendum (real-Mac finding) — SlickGrid's own wheel handler quantizes every
      // wheel/trackpad tick to `deltaY * rowHeight` in JS, discarding WebKit's native momentum
      // physics; that's what read on macOS as the fluid trackpad scroll going away. The viewport's
      // already-native `overflow:auto` plus the already-bound native `scroll` listener (F3) are
      // sufficient on their own — frozen-pane sync and this host's own velocity/runway logic both
      // already run off native scroll, never off this handler.
      enableMouseWheelScrollHandler: false,
      // P22 iter2-scroll-gaps D3 — safe, and only safe, now that D2 (kiraSlickGrid.ts's
      // getRenderedRange) bounds a single render() call's own synchronous cost independent of fling
      // distance. Without D2 this would be a regression: SlickGrid's default `_handleScroll` defers
      // to a 10ms-windowed `scrollThrottle.enqueue()` whenever a single frame's delta exceeds one
      // full viewport height (`dy >= this.viewportH`), which at least caps how *often* the old
      // unbounded batch ran; forcing every large-delta scroll to call render() immediately, before
      // D2 existed, would have run that same unbounded batch on every such frame instead. Landed as
      // its own commit, after D2, specifically so it stays bisectable from the batch cap.
      //
      // Real-hardware update: unconditional `true` (this commit's original value, `0865ef6`) coupled
      // main-thread render work to *every* native scroll-event tick during a fling, which real-macOS
      // testing found produces visible stutter (the motion itself hitching) — a less forgivable
      // failure than the incumbent tanstack grid's own "content lags, motion stays smooth" gap
      // symptom. Defaulted back to `false` (D2's batch cap alone) pending a real A/B on whether D3 is
      // actually the cause; kept overridable from the console (see main.ts's own doc comment on
      // `forceSyncScrollingOverride`) so both variants can be compared without a rebuild per variant.
      // Read once here, at construction — this option is construction-time only, same as
      // `frozenColumn`/`enableColumnReorder`/etc. above.
      forceSyncScrolling: window.__kiraGridTuning?.forceSyncScrollingOverride ?? false,
      // §7.1 — no keyboard/click-navigation beyond the static demonstration above; Pass B territory.
      enableCellNavigation: false,
      enableAddRow: false,
      editable: false,
      explicitInitialization: false,
      dataItemColumnValueExtractor: (item: RowHandle, columnDef: KiraColumn) =>
        dataSource?.extractValue(item, String(columnDef.field)),
    },
  );
  grid.velocity = velocity;

  eventHandler = new SlickEventHandler();
  eventHandler.subscribe(grid.onRendered, onGridRendered);

  viewportEl = grid.getViewports()[1] ?? grid.getViewports()[0] ?? null;
  if (viewportEl && t) {
    viewportEl.scrollTop = t.state.scrollTop;
    viewportEl.scrollLeft = t.state.scrollLeft;
  }
  grid.render();
  applyStaticCssLayers();

  if (viewportEl) {
    scrollTrace.registerGrid(viewportEl, '.slick-row');
    viewportEl.addEventListener('scroll', onViewportScroll, { passive: true });
    viewportEl.addEventListener('scroll', onViewportScrollPersist, { passive: true });
  }
});

onUnmounted(() => {
  // Order matters (§6 D3): stop everything that could still fire into a half-torn-down grid before
  // tearing it down.
  if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
  if (viewportEl) {
    viewportEl.removeEventListener('scroll', onViewportScroll);
    viewportEl.removeEventListener('scroll', onViewportScrollPersist);
    scrollTrace.unregisterGrid(viewportEl);
  }
  eventHandler?.unsubscribeAll();
  eventHandler = null;
  // F8 — `true` also nulls SlickGrid's own ~60 internal element references; its own destroy()
  // unbinds every listener it registered, unregisters every plugin, cancels any in-flight edit and
  // removes its per-instance injected <style> element. The only real risk was ever this app
  // forgetting to call it (F8's own finding) — this call is the named, gated acceptance item (§9.1).
  grid?.destroy(true);
  grid = null;
  dataSource = null;
  viewportEl = null;
});

watch(
  () => pageVersion.n,
  () => {
    if (!grid || !dataSource) return;
    const p = getPage(props.tabId);
    const t = tab();
    const order = p ? resolveColumnOrder(p, t?.state.columnOrder ?? null) : [];
    formatterCtx.rowNumberBase = t ? t.state.pageIndex * t.state.pageSize : 0;
    dataSource.setState({
      index: { displayRows: currentDisplayRows(), pageRowCount: p?.rowCount ?? 0 },
      inserts: pendingFor(props.tabId)?.inserts ?? [],
      rowClasses: (row) => pendingRowClasses(props.tabId, row),
      extractValue: p
        ? createDisplayValueExtractor(props.tabId, p, order)
        : () => ({ text: '', isNull: true, truncated: false }),
    });
    grid.setColumns(buildColumns(p, order, currentWidths()));
    grid.updateRowCount();
    grid.invalidateAllRows();
    grid.render();
    applyStaticCssLayers();
  },
);

watch(rowHeight, (h) => {
  if (!grid) return;
  grid.setOptions({ rowHeight: h });
  grid.updateRowCount();
  grid.render();
});

watch(
  () => appearanceVersion.n,
  () => {
    resetMeasureCtx();
    rebuildAndSetColumns();
    grid?.render();
  },
);

defineExpose({
  // DataView.vue's own contract (matching DataGrid.vue's identical export): `row` is a *page* row
  // index, `col` a *display* column index. SlickGrid's own scrollCellIntoView wants its own display
  // *position* and a column index that accounts for the frozen gutter occupying slot 0. Pass A never
  // reactively filters (this file's own currentDisplayRows() comment), so page row === display
  // position by construction — the identity pass-through below is exact, not an approximation, for
  // as long as that stays true; a live filter wired in Pass B must translate through the data
  // source's own row<->position mapping here instead.
  scrollCellIntoView(row: number, col: number): void {
    grid?.scrollCellIntoView(row, col + 1);
  },
});
</script>

<template>
  <!-- §6 D6 point 1: the P9 rowColoring setting is one class toggle on the host root — Vue's own
       reactivity on this binding (not a watch) is what keeps it live, since settingsState is a
       reactive object and this is the template's own ordinary :class binding. -->
  <div
    ref="rootRef"
    class="slick-grid-host"
    data-testid="data-grid"
    :class="{ 'kira-grid--row-coloring': settingsState.appearance.rowColoring }"
  ></div>
</template>
