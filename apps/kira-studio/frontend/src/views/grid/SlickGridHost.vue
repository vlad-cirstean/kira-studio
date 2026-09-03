<script setup lang="ts">
import type { ObjectMeta } from '@shared/domain/tree';
import { decodePath } from '@shared/domain/tree';
import type { ColumnDescriptor } from '@shared/protocol/page';
import type {
  Column,
  CustomDataView,
  FormatterResultWithText,
  MultiColumnSort,
  OnBeforeHeaderCellDestroyEventArgs,
  OnHeaderCellRenderedEventArgs,
  SingleColumnSort,
  SlickEventData,
} from 'slickgrid';
import { SlickEventHandler } from 'slickgrid';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { shortcutFor } from '../../shortcuts/keys';
import { connectionRecord, connectionsState } from '../../state/connections';
import { runMenuShortcut } from '../../state/contextMenu';
import { appearanceVersion, settingsState } from '../../state/settings';
import { findDataTab, patchDataTabState } from '../../state/tabs';
import { categoryForTypeClass } from '../../theme/icons';
import {
  alignmentFor,
  columnHeaderTooltip,
  DEFAULT_COLUMN_WIDTH,
  GUTTER_WIDTH,
  initialWidths,
  pageColumnIndexFor,
  resetMeasureCtx,
  resolveColumnOrder,
} from '../shared/page/columns';
import type { RowSnapshot } from './clipboardFormats';
import { rowMenu } from './menu';
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
import { cell, getPage, pageVersion, setVisibleWindow } from './page';
import { pendingFor, stagedValue } from './pendingChanges';
import * as scrollTrace from './scrollTrace';
import { parseTextSortTerms } from './sortTerms';
import { runtime, setSort } from './state';

// P22 spike (§6 D3) — a from-scratch Vue host for SlickGrid, on editor/CodeMirrorHost.vue's own
// established shape for wrapping an imperative library: one ref root div, the instance held in a
// plain `let` (never a ref/shallowRef/reactive — see that file's own comment for why: Vue must not
// see the grid, its rowsCache or its DOM, or every internal object SlickGrid touches on every
// render gets proxied), constructed in onMounted, destroyed in onUnmounted.
//
// Pass A shipped this file scoped to decode/bridge/gutter/colour/theme/runway only (§7.0); Pass B
// (P22-slickgrid-pass-b.md) is building it out to full parity, feature by feature, each landing as
// its own commit per that plan's §9 — this file's own comments cite the commit/decision each piece
// belongs to as they land.
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

// §6 D6 point 2 — structure is per-cell: a plain string for the common case (-> textContent, F6).
// P22 iter2-pacing D5: NULL and truncated no longer build a DocumentFragment — SlickGrid's own
// FormatterResultWithText.addClasses folds straight into the cell's own className
// (appendCellHtml, dist/esm/index.js:9962), so `.cell-null`/`.cell-truncated` land on the
// `.slick-cell` itself, and `.toolTip` becomes a `title` on the cell (:9969) — the truncation
// tooltip is kept, not lost. slickTheme.css's own `.cell-truncated::after` restores the muted
// ellipsis marker as a pseudo-element (zero DOM nodes) in place of the old child <span>. `value`
// is exactly what the grid's own dataItemColumnValueExtractor (below) returned for this cell — the
// CellView the app's existing decode/cache/staged-edit pipeline produced, never re-derived here.
function cellFormatter(
  _row: number,
  _cell: number,
  value: unknown,
): string | FormatterResultWithText {
  const view = value as { text: string; isNull: boolean; truncated: boolean };
  if (view.isNull) return { text: 'NULL', addClasses: 'cell-null' };
  if (view.truncated) {
    return { text: view.text, addClasses: 'cell-truncated', toolTip: 'value truncated at 64 KB' };
  }
  return view.text;
}

function rt() {
  return runtime[props.tabId];
}

// P22 Pass B, C3 — the row-shortcut/copy/paste plumbing needs the same writability/identity
// predicates DataGrid.vue's own computeds provide; plain functions here (not `computed`s) since
// nothing below reads them from inside the render path (D0 is about that path specifically, not
// about app logic in general) and every call site is already an event handler.
function hasPrimaryKey(): boolean {
  return getPage(props.tabId)?.columns.some((c) => c.isPrimaryKey) ?? false;
}
function isWritable(): boolean {
  const t = tab();
  if (!t?.connectionId) return false;
  return !connectionRecord(t.connectionId)?.readOnly;
}
function caps() {
  const connectionId = tab()?.connectionId;
  return connectionId ? (connectionsState.states[connectionId]?.caps ?? null) : null;
}
// Gates whether double-click/Enter starts an inline edit (D8/C8) — the toolbar's own add/preview/
// commit/discard buttons are gated on writability alone, never on hasPrimaryKey.
function canEditTable(): boolean {
  return isWritable() && hasPrimaryKey() && !!caps()?.canUpdate;
}
// P36 D26: deliberately not folded into canEditTable — an engine could offer one of
// canUpdate/canDelete without the other.
function canDeleteRows(): boolean {
  return isWritable() && hasPrimaryKey() && !!caps()?.canDelete;
}

// Produced locally from the path, never round-tripped to the engine for a string join — the same
// discipline DataGrid.vue's own qualifiedName() and grid/menu.ts's qualifiedNameForPath use.
const QUALIFIED_KINDS = new Set(['schema', 'table', 'view', 'matview']);
function qualifiedName(): string {
  const t = tab();
  if (!t?.connectionId) return '';
  return decodePath(t.connectionId, t.path)
    .segments.filter((s) => QUALIFIED_KINDS.has(s.kind))
    .map((s) => s.name)
    .join('.');
}

// Merges a staged edit over the real page value for display — DataGrid.vue's own displayCell,
// content (not mechanism, §1) so it moves into rowValues.ts unchanged at C7 once the menus/
// clipboard land there too; needed now for rowMenu's own row-copy/duplicate snapshot.
function displayCell(
  row: number,
  displayCol: number,
): { text: string; isNull: boolean; truncated: boolean; staged: boolean } {
  const p = getPage(props.tabId);
  if (!p) return { text: '', isNull: true, truncated: false, staged: false };
  const order = resolveColumnOrder(p, tab()?.state.columnOrder ?? null);
  const name = order[displayCol];
  const staged = name ? stagedValue(props.tabId, row, name) : undefined;
  if (staged !== undefined) {
    return { text: staged ?? '', isNull: staged === null, truncated: false, staged: true };
  }
  const pageCol = pageColumnIndexFor(p, order, displayCol);
  if (pageCol < 0) return { text: '', isNull: true, truncated: false, staged: false };
  const view = cell(props.tabId, row, pageCol);
  return { ...view, staged: false };
}

// The row's effective values across the whole display column order — DataGrid.vue's own
// rowSnapshot, reused by rowMenu's own copy/duplicate items.
function rowSnapshot(row: number): RowSnapshot {
  const p = getPage(props.tabId);
  const order = p ? resolveColumnOrder(p, tab()?.state.columnOrder ?? null) : [];
  const values: Record<string, string | null> = {};
  for (let c = 0; c < order.length; c++) {
    const name = order[c];
    const dc = displayCell(row, c);
    values[name] = dc.isNull ? null : dc.text;
  }
  return { columns: [...order], values };
}

// FIX-8: PK/FK stated as a label, never inferred from colour alone — mirrors DataGrid.vue's own
// foreignKeyColumnNames/keyLabelFor, folded to a Set built once per buildColumns call (not once
// per column) since it's the same answer for every column of one call.
function foreignKeyNamesFor(meta: ObjectMeta | null): Set<string> {
  const names = new Set<string>();
  for (const fk of meta?.foreignKeys ?? []) for (const c of fk.columns) names.add(c);
  return names;
}
function keyLabelFor(
  descriptor: ColumnDescriptor | undefined,
  name: string,
  foreignKeyNames: Set<string>,
): 'PK' | 'FK' | null {
  if (descriptor?.isPrimaryKey) return 'PK';
  if (foreignKeyNames.has(name)) return 'FK';
  return null;
}

// P42 D19/D20 — headerCellAttrs is a plain static attribute bag (F3), so this replicates
// workbench/state/tooltip.ts's own updateTip() by hand: data-kira-tip (the plain, newline-joined
// a11y text) and data-kira-tip-parts (the structured JSON `v-tooltip`'s own directive would have
// written) plus aria-label — since nothing runs that directive over SlickGrid-owned DOM.
function tooltipAttrs(content: ReturnType<typeof columnHeaderTooltip>): Record<string, string> {
  const plain = [content.title, content.meta, content.body]
    .filter((v): v is string => !!v)
    .join('\n');
  return {
    'data-kira-tip': plain,
    'data-kira-tip-parts': JSON.stringify(content),
    'aria-label': plain,
  };
}

// The DESCRIBE-derived dataType (meta.columns) when it has loaded, else the page's own
// ColumnDescriptor — mirrors DataGrid.vue's own dataTypeFor, so the header tooltip can never show
// a column two different type strings depending on which one asked first.
function dataTypeFor(
  name: string,
  descriptor: ColumnDescriptor | undefined,
  metaByName: Map<string, { dataType: string; comment: string | null }>,
): string {
  return metaByName.get(name)?.dataType ?? descriptor?.dataType ?? '';
}

/** §6 D6 point 1 — colour and alignment are per-column and static: a `tc-<category>` class plus
 *  `kira-align-right` where the column's own descriptor says numeric. Nine categories collapse to
 *  the five `categoryForTypeClass` can actually return; slickTheme.css carries all five anyway
 *  (that file's own comment says why). */
function buildColumns(
  page: ReturnType<typeof getPage>,
  order: string[],
  storedWidths: Record<string, number>,
  meta: ObjectMeta | null,
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
      // D2 — changed from Pass A's false/false: F1's row-select-on-gutter (§5 D4, C4) requires
      // canCellBeActive(row, 0), which `handleClick`'s row branch checks
      // (slick.hybridselectionmodel.ts:497). Tab/Left-arrow landing on the gutter is the one
      // side effect (D8 vetoes editing there; a gutter active cell becomes a row selection).
      focusable: true,
      selectable: true,
      cssClass: 'kira-gutter',
      formatter: gutterFormatter,
      // P22 Pass B, C1/§5 D10 — F3: cellAttrs/headerCellAttrs are per-column static attribute
      // bags, applied once per cell/header BUILD (alongside SlickGrid's own role/tabIndex/
      // aria-describedby), never per retained row — the whole `data-testid`/`data-*` surface
      // this app's tests/ui/ suite needs is free at this granularity; only the row's own
      // `data-row` correction (below, tagRenderedRows) needs an actual per-render pass, and rows
      // are ~200, not ~2 400 cells.
      cellAttrs: { 'data-testid': 'grid-gutter-cell' },
      headerCellAttrs: {
        'data-testid': 'grid-select-all',
        role: 'button',
        'aria-label': 'Select all cells',
      },
    },
  ];
  if (!page) return cols;
  const measured = initialWidths(page);
  const byName = new Map(page.columns.map((c) => [c.name, c]));
  const metaByName = new Map(meta?.columns.map((c) => [c.name, c]) ?? []);
  order.forEach((name, displayIndex) => {
    const descriptor = byName.get(name);
    const classes = [`tc-${descriptor ? categoryForTypeClass(descriptor.typeClass) : 'other'}`];
    if (descriptor && alignmentFor(descriptor) === 'right') classes.push('kira-align-right');
    const tooltip = columnHeaderTooltip(
      descriptor ?? { name, typeClass: 'other' },
      dataTypeFor(name, descriptor, metaByName),
      metaByName.get(name)?.comment,
    );
    cols.push({
      id: name,
      field: name,
      name,
      width: storedWidths[name] ?? measured[name] ?? DEFAULT_COLUMN_WIDTH,
      // F9 — the app's own resize floor; onColumnsResized persists the drag (below).
      minWidth: 40,
      resizable: true,
      // F8 — creates the sort indicator divs; tristateMultiColumnSort/multiColumnSort (grid
      // options, below) make a click cycle asc -> desc -> none, this app's own header cycle.
      sortable: true,
      cssClass: classes.join(' '),
      formatter: cellFormatter,
      cellAttrs: {
        'data-testid': 'grid-cell',
        'data-column': name,
        'data-col-index': String(displayIndex),
      },
      headerCellAttrs: {
        'data-testid': 'grid-header-cell',
        'data-column': name,
        'data-col-index': String(displayIndex),
        ...tooltipAttrs(tooltip),
      },
    });
  });
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
// P22 iter2-onset D2 — incremented by every native `scroll` event on the viewport, and read by
// KiraSlickGrid's own per-frame chase gate (see `scheduleChase` there). A counter, not a
// timestamp: the wall-clock gate it joins cannot tell "no scroll is driving this frame" from
// "the scroll that is driving this frame arrived in the previous, long, frame".
let scrollEventSeq = 0;
const MAX_PLAUSIBLE_ROW_VELOCITY_PX_PER_FRAME = 800;

/**
 * P22 iter2-onset D1 — the gesture-onset fix. `false` restores the pre-fix behaviour *exactly*
 * (sampling only from `onViewportScroll` below, with no dedupe), so the real-Mac A/B is a console
 * line and not a rebuild — the same contract `chaseQuietMsOverride = 0` already has.
 */
function freshVelocitySample(): boolean {
  return window.__kiraGridTuning?.freshVelocitySampleOverride ?? true;
}

/**
 * P22 iter2-onset D1. The sampler's single write point, so it can be driven from *either* the
 * scroll listener below or — the fix — from `velocity()` itself, at the moment the value is
 * actually consumed.
 *
 * Why the fix is needed at all, read from source this session: SlickGrid binds its own viewport
 * `scroll` listener inside `finishInitialization()` (slickgrid dist/esm/index.js:7572, reached from
 * the constructor because `explicitInitialization: false`), and this host binds `onViewportScroll`
 * on that same element only *after* `new KiraSlickGrid(...)` returns. Two non-capturing listeners
 * on one target fire in registration order, so SlickGrid's `handleScroll` — and the synchronous
 * `render()` → `getRenderedRange()` → `velocity()` it drives (`_handleScroll`, :10589) — always ran
 * one sample *ahead* of this host's own sampling of the very event that triggered it. Mid-fling
 * that staleness is harmless (velocity barely changes frame to frame). At the first render of a
 * fresh gesture it is not: the only sample on hand is the one taken *before* the gesture began, so
 * `performance.now() - lastOffsetT > 150` fires and `velocity()` returns `{0, 0}` — the grid sizes
 * its runway as if standing still, `target` collapses to the base runway, the per-call budget is
 * left entirely unspent, and `getRenderedRange` does not even flag a deficit (`chaseWanted` is
 * false, because the range it returned *does* reach that collapsed target). One whole frame of
 * runway-building is lost at the exact moment a fling needs it most, on every gesture.
 *
 * The dedupe is what makes pulling safe: a scroll event that did not move the vertical offset is
 * not a velocity sample (a *horizontal* scroll fires this same listener), and without it a
 * listener-driven sample landing after a pull of the same position would shift `prev` up to
 * `last` and read the next frame's delta as 0.
 */
function recordOffsetSample(offset: number, now: number): void {
  if (freshVelocitySample() && offset === lastOffset) return;
  prevOffset = lastOffset;
  prevOffsetT = lastOffsetT;
  lastOffset = offset;
  lastOffsetT = now;
}

function velocity(): { pxPerFrame: number; direction: 1 | -1 | 0 } {
  // P22 iter2-onset D1 — sample at the point of consumption, not one listener too late (see
  // recordOffsetSample above). This adds one `scrollTop` read per render pass; it is inside the
  // envelope getRenderedRange already works in, which does its own layout read
  // (`getCanvasNode(1)?.clientWidth`) and is reached from `_handleScroll`, which has just read
  // scrollHeight/clientHeight/scrollWidth/clientWidth off the same element (dist/esm/index.js:10576)
  // — layout is already flushed at this point on the scroll path.
  if (freshVelocitySample() && viewportEl) {
    recordOffsetSample(viewportEl.scrollTop, performance.now());
  }
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
  scrollEventSeq++;
  // P22 iter2-onset D1: still the sampler's other driver, unchanged in effect — but now a no-op
  // whenever velocity() already pulled this very position a moment earlier, from inside the
  // render this same event drove (see recordOffsetSample's own comment).
  recordOffsetSample(el.scrollTop, now);
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
// P22 Pass B, C1/§5 D10 — the one per-render DOM pass this migration still needs: a row's own
// `data-row` (SlickGrid writes the *display position* there, `src/slick.grid.ts`'s own
// `appendRowHtml`) has to be corrected to the *page* row every other subsystem (selection,
// pending changes, search, the gutter number) addresses a row by. The two differ only while a
// search filter is hiding non-matching rows — a trap commented at both ends (D10's own note).
//
// Idempotent by construction, not by re-deriving "did the rendered range change": a `.slick-row`
// already carrying `data-kira-row-tagged` is skipped outright, so a sub-row scroll (no new row
// entering the DOM) touches nothing at all — `slick-grid.spec.ts`'s existing zero-mutation gate
// enforces that for free. A row div SlickGrid later discards and rebuilds (`invalidateRow`) comes
// back with no marker, correctly re-tagged from its own fresh (display-position) `data-row`.
function tagRenderedRows(): void {
  const root = rootRef.value;
  if (!root || !dataSource) return;
  const rowEls = root.querySelectorAll<HTMLElement>('.slick-row:not([data-kira-row-tagged])');
  for (const el of rowEls) {
    const pos = Number(el.dataset.row);
    if (!Number.isFinite(pos)) continue;
    const handle = dataSource.getItem(pos);
    el.dataset.row = String(handle.row);
    el.dataset.kiraRowTagged = '1';
    // F4 — the row div is cloned per frozen pane; only the right (data) pane's clone gets
    // `data-testid="grid-row"` (or `"grid-row-insert"`), so `[data-testid="grid-row"]` counts
    // stay exactly what they were under the incumbent (one per rendered row, not two).
    if (el.closest('.grid-canvas-right')) {
      el.dataset.testid = handle.insertId !== undefined ? 'grid-row-insert' : 'grid-row';
    }
    if (handle.insertId !== undefined) {
      el.dataset.insertId = handle.insertId;
      // `cellAttrs` (buildColumns, D2) is a per-COLUMN constant — it cannot vary per row, so an
      // insert row's own cells (D9's own region) are the one place a per-row cell pass still
      // earns its keep, matching the incumbent's own `data-testid="grid-cell-insert"`.
      for (const cellEl of el.querySelectorAll<HTMLElement>(
        '.slick-cell[data-testid="grid-cell"]',
      )) {
        cellEl.dataset.testid = 'grid-cell-insert';
      }
    }
  }
}

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
  grid.setColumns(buildColumns(p, order, currentWidths(), rt()?.meta ?? null));
  // setColumns rebuilds every header from scratch (F8's own indicator divs included) — restore
  // the sort chevrons the fresh headers just lost.
  syncSortIndicators();
}

// §4 item 7, §5 D2 — the PK/FK badge and the header select zone are the two pieces of header DOM
// SlickGrid's own Column shape can't express (a static `name` string, no child markup), so they're
// appended imperatively once per header cell BUILD. `onHeaderCellRendered` fires once per column
// per `setColumns` call (never per scroll frame — headers aren't virtualized), matching the
// gutter/data-column split cellAttrs/headerCellAttrs already draw.
function onHeaderCellRendered(_e: unknown, args: OnHeaderCellRenderedEventArgs): void {
  const name = String(args.column.field ?? '');
  if (name === GUTTER_FIELD) return;
  const p = getPage(props.tabId);
  const descriptor = p?.columns.find((c) => c.name === name);
  const label = keyLabelFor(descriptor, name, foreignKeyNamesFor(rt()?.meta ?? null));
  if (label) {
    const badge = document.createElement('span');
    badge.className = label === 'FK' ? 'header-key mono is-fk' : 'header-key mono';
    badge.textContent = label;
    args.node.appendChild(badge);
  }
  // D4/C4 owns the select zone's actual click semantics (pushing a `column` selection into both
  // rt().selection and the hybrid selection model, §5 D4's pendingKind) — this only builds the
  // static strip and stops it from reaching the header's own sort-click handler underneath it.
  const zone = document.createElement('span');
  zone.className = 'header-select-zone';
  zone.dataset.testid = 'grid-header-select';
  zone.dataset.column = name;
  zone.dataset.colIndex = args.node.dataset.colIndex ?? '';
  zone.setAttribute('role', 'button');
  zone.setAttribute('aria-label', 'Select column');
  zone.addEventListener('click', (ev) => {
    ev.stopPropagation();
  });
  args.node.appendChild(zone);
}

// Nothing to clean up beyond the header cell's own subtree (destroyed with it, badge/zone and the
// zone's listener included) — subscribed anyway so a future addition (e.g. a listener registered
// *outside* this node) has an obvious place to land, per §5 D2's own header-cell lifecycle pair.
function onBeforeHeaderCellDestroy(_e: unknown, _args: OnBeforeHeaderCellDestroyEventArgs): void {}

// F8 — the app's own asc -> desc -> none cycle, mirrored from `sortTerms`/tab.state.sort (D6's own
// text-sort parse included) into SlickGrid's own indicator DOM via setSortColumns, which redraws
// only the header — no row touched, no setColumns rebuild. Called from a watch callback (D0), not
// a computed: this makes an imperative call into the grid.
function currentSortTerms(): { column: string; direction: 'asc' | 'desc' }[] {
  const t = tab();
  const sort = t?.state.sort;
  if (!sort) return [];
  const p = getPage(props.tabId);
  const order = p ? resolveColumnOrder(p, t.state.columnOrder ?? null) : [];
  if (sort.kind === 'structured') return sort.terms;
  return parseTextSortTerms(sort.text, order);
}
function syncSortIndicators(): void {
  if (!grid) return;
  const terms = currentSortTerms();
  grid.setSortColumns(
    terms.map((term) => ({ columnId: term.column, sortAsc: term.direction === 'asc' })),
  );
}

// tristateMultiColumnSort + multiColumnSort: false (grid options) is what makes a header click
// cycle asc -> desc -> none by itself (F8) — this only translates SlickGrid's own resulting
// `onSort` event into the app's `setSort`, the same single-term-replaces-the-whole-sort semantics
// DataGrid.vue's own onHeaderClick has (never accumulating past one column; only the ORDER BY box
// itself can produce a genuine multi-term sort).
function onSort(_e: unknown, args: SingleColumnSort | MultiColumnSort): void {
  // multiColumnSort: false (grid options, above) — this event is always the single-column shape
  // in practice; the union (and columnId's own `| null` at runtime, despite ColumnSort's type not
  // saying so — F8's own citation) is the library's, not this app's.
  if (args.multiColumnSort) return;
  const columnId = (args as SingleColumnSort).columnId as string | number | null;
  if (columnId === null || columnId === undefined) {
    void setSort(props.tabId, null);
    return;
  }
  void setSort(props.tabId, {
    kind: 'structured',
    terms: [{ column: String(columnId), direction: args.sortAsc ? 'asc' : 'desc' }],
  });
}

// D3 — SlickGrid drags the handle and persists nothing on its own; this app reads the resulting
// widths straight off getColumns() and patches them into tab state (F9). The echo guard is the
// same shape DataGrid.vue's own dragProducedRange uses: without it, the columnWidths watch below
// would call setColumns and rebuild every header (and every rendered row) mid-drag.
let suppressWidthEcho = false;
function onColumnsResized(): void {
  if (!grid) return;
  const t = tab();
  if (!t) return;
  const widths: Record<string, number> = { ...t.state.columnWidths };
  for (const col of grid.getColumns()) {
    if (col.id === GUTTER_FIELD || col.width === undefined) continue;
    widths[String(col.id)] = col.width;
  }
  suppressWidthEcho = true;
  patchDataTabState(props.tabId, { columnWidths: widths });
  suppressWidthEcho = false;
}

// F6 — `handleKeyDown` triggers `onKeyDown` first and honours `stopImmediatePropagation`
// (`isImmediatePropagationStopped()`, checked right after this fires): the app's own handler runs
// before SlickGrid's own default key handling and wins simply by calling it on the branches it
// owns. `enableCellNavigation: true` (above) is what gives the arrow-key/Enter-to-edit path for
// free — DataGrid.vue's own onKeydown arrow block (:1762-1779) has no counterpart here.
function onKeydown(e: SlickEventData): void {
  const runtimeEntry = rt();
  if (!runtimeEntry) return;

  const key = (e.key ?? '').toLowerCase();
  if ((e.ctrlKey || e.metaKey) && key === 'c') {
    e.preventDefault();
    e.stopImmediatePropagation();
    // C7 lands the body (onCopy) — this commit only claims the key.
    return;
  }
  if ((e.ctrlKey || e.metaKey) && key === 'v') {
    e.preventDefault();
    e.stopImmediatePropagation();
    // C7 lands the body (onPaste) — this commit only claims the key.
    return;
  }

  // shortcutFor reads a real KeyboardEvent's own modifier/key fields — SlickEventData copies
  // exactly that subset onto itself from the native event it wraps (slick.core.ts's own
  // constructor), so this is a safe reinterpretation, not an unsafe cast to a different shape.
  const nativeLike = e as unknown as KeyboardEvent;

  // P21 D5: dispatched through rowMenu() itself (the same builder the row/gutter context menu
  // will call, C7) so the printed shortcut and the executed action can't drift, and
  // `disabled: !canEdit` is honoured for free — inert on a read-only table without restating that
  // guard here.
  const rowShortcut = shortcutFor(nativeLike, ['grid.duplicateRows', 'grid.deleteRows']);
  if (rowShortcut && runtimeEntry.selection?.kind === 'row') {
    const { rows } = runtimeEntry.selection;
    const ran = runMenuShortcut(
      rowMenu({
        tabId: props.tabId,
        rows,
        qualifiedName: qualifiedName(),
        snapshot: rowSnapshot,
        canEdit: canEditTable(),
        canDelete: canDeleteRows(),
      }),
      rowShortcut,
    );
    if (ran) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
    return;
  }

  // P31 D32/F31: Delete/Cmd+Backspace also fires from a cell or range selection, not just a row
  // selection (which requires a gutter click) — clicking a cell is the ordinary way a row gets
  // picked. Duplicate stays row-selection-only. Still dispatched through rowMenu() for the same
  // reasons as above.
  const deleteShortcut = shortcutFor(nativeLike, ['grid.deleteRows']);
  const cellOrRangeSel = runtimeEntry.selection;
  if (deleteShortcut && (cellOrRangeSel?.kind === 'cell' || cellOrRangeSel?.kind === 'range')) {
    const rows =
      cellOrRangeSel.kind === 'range'
        ? Array.from(
            { length: Math.abs(cellOrRangeSel.row - cellOrRangeSel.anchorRow) + 1 },
            (_, i) => Math.min(cellOrRangeSel.row, cellOrRangeSel.anchorRow) + i,
          )
        : [cellOrRangeSel.row];
    const ran = runMenuShortcut(
      rowMenu({
        tabId: props.tabId,
        rows,
        qualifiedName: qualifiedName(),
        snapshot: rowSnapshot,
        canEdit: canEditTable(),
        canDelete: canDeleteRows(),
      }),
      deleteShortcut,
    );
    if (ran) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }
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
    buildColumns(p, order, currentWidths(), rt()?.meta ?? null),
    {
      rowHeight: rowHeight.value,
      // F8 — tristateMultiColumnSort + multiColumnSort: false is exactly this app's own header
      // click cycle (asc -> desc -> none), replacing DataGrid.vue's own onHeaderClick entirely;
      // numberedMultiColumnSort + sortColNumberInSeparateSpan renders the order badge for the
      // ORDER BY box's own multi-term sort even though a header click alone never produces one.
      tristateMultiColumnSort: true,
      multiColumnSort: false,
      numberedMultiColumnSort: true,
      sortColNumberInSeparateSpan: true,
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
      // C3/F6 — display-position-correct arrows for free (F6): the app's own onKeydown no longer
      // needs to juggle displayPositionOf/rowAtDisplayPosition (DataGrid.vue:1762-1779) because the
      // data source already indexes display positions; navigateUp/Down/Left/Right and the Enter ->
      // edit path (D8) come from this option, unported.
      enableCellNavigation: true,
      enableAddRow: false,
      editable: false,
      explicitInitialization: false,
      dataItemColumnValueExtractor: (item: RowHandle, columnDef: KiraColumn) =>
        dataSource?.extractValue(item, String(columnDef.field)),
    },
  );
  grid.velocity = velocity;
  // P22 iter2-pacing D1 — the chase's own quiescence gate. `lastOffsetT` is already
  // performance.now() at the last native scroll event (onViewportScroll, above); no new sampling.
  grid.lastScrollEventAt = () => lastOffsetT;
  // P22 iter2-onset D2 — the chase's per-frame gate, beside the wall-clock one above.
  grid.scrollEventSeq = () => scrollEventSeq;

  eventHandler = new SlickEventHandler();
  eventHandler.subscribe(grid.onRendered, tagRenderedRows);
  eventHandler.subscribe(grid.onRendered, onGridRendered);
  eventHandler.subscribe(grid.onHeaderCellRendered, onHeaderCellRendered);
  eventHandler.subscribe(grid.onBeforeHeaderCellDestroy, onBeforeHeaderCellDestroy);
  eventHandler.subscribe(grid.onSort, onSort);
  eventHandler.subscribe(grid.onColumnsResized, onColumnsResized);
  eventHandler.subscribe(grid.onKeyDown, onKeydown);

  viewportEl = grid.getViewports()[1] ?? grid.getViewports()[0] ?? null;
  if (viewportEl && t) {
    viewportEl.scrollTop = t.state.scrollTop;
    viewportEl.scrollLeft = t.state.scrollLeft;
  }
  if (viewportEl) {
    // P22 iter2-onset D1 — seed the sampler's baseline at mount (after the restored scroll position
    // is applied, before the first render), so the *first* gesture in a tab's life has a `prev`
    // sample to diff against. Without it `prevOffsetT` is still 0 when that gesture's first render
    // pulls, velocity() takes its own `!prevOffsetT` branch, and the exact defect this fix exists
    // for survives on one gesture per tab. `grid.render()` just below pulls the same position and
    // dedupes, so this seeding costs nothing and changes nothing at rest.
    lastOffset = viewportEl.scrollTop;
    lastOffsetT = performance.now();
  }
  grid.render();
  applyStaticCssLayers();
  syncSortIndicators();

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
    grid.setColumns(buildColumns(p, order, currentWidths(), rt()?.meta ?? null));
    grid.updateRowCount();
    grid.invalidateAllRows();
    grid.render();
    applyStaticCssLayers();
    syncSortIndicators();
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

// D2(c)/D3 — a columnWidths change that did NOT originate from this host's own resize drag
// (onColumnsResized's echo guard) rebuilds the header/cell width bag; loadMeta (state.ts) resolves
// after the page itself, so the header tooltip/PK-FK badges need their own watch too, independent
// of pageVersion.
watch(
  () => tab()?.state.columnWidths,
  () => {
    if (suppressWidthEcho) return;
    rebuildAndSetColumns();
    grid?.render();
  },
);
watch(
  () => rt()?.meta,
  () => {
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
