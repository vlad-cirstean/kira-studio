<script setup lang="ts">
import type { ObjectMeta } from '@shared/domain/tree';
import { decodePath } from '@shared/domain/tree';
import type { ColumnDescriptor } from '@shared/protocol/page';
import type {
  Column,
  CustomDataView,
  FormatterResultWithText,
  MultiColumnSort,
  OnBeforeEditCellEventArgs,
  OnBeforeHeaderCellDestroyEventArgs,
  OnHeaderCellRenderedEventArgs,
  OnHeaderClickEventArgs,
  SingleColumnSort,
  SlickEventData,
} from 'slickgrid';
import { SlickEventHandler, SlickHybridSelectionModel, SlickRange } from 'slickgrid';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { copyText } from '../../clipboard';
import { shortcutFor } from '../../shortcuts/keys';
import { connectionRecord, connectionsState } from '../../state/connections';
import { openContextMenu, runMenuShortcut } from '../../state/contextMenu';
import { appearanceVersion, settingsState } from '../../state/settings';
import { findDataTab, patchDataTabState } from '../../state/tabs';
import { type CellClassFlags, cellClass } from '../../theme/cellClass';
import { categoryForTypeClass } from '../../theme/icons';
import {
  alignmentFor,
  columnHeaderTooltip,
  DEFAULT_COLUMN_WIDTH,
  GUTTER_WIDTH,
  initialWidths,
  resetMeasureCtx,
  resolveColumnOrder,
} from '../shared/page/columns';
import { sqlDialectFor } from '../shared/sqlIdent';
import {
  columnsToTsv,
  parseDelimited,
  type RowSnapshot,
  rangeToTsv,
  rowsToTsv,
} from './clipboardFormats';
import { cellMenu, headerMenu, rowMenu } from './menu';
import { addInsertRow, pendingFor, stageEdit, stageInsertValue } from './pendingChanges';
import { matchedRows } from './search';
import {
  createDisplayValueExtractor,
  createGridDataSource,
  displayPositionOf,
  pendingRowClasses,
  type RowHandle,
  rowAtDisplayPosition,
} from './slick/dataSource';
import { editorCtx, KiraCellEditor } from './slick/editor';
import { KiraSlickGrid } from './slick/kiraSlickGrid';
import {
  type DisplayCellView,
  navColumnsFor,
  cellNavEntry as rvCellNavEntry,
  columnValuesFor as rvColumnValuesFor,
  displayCell as rvDisplayCell,
  rowSnapshot as rvRowSnapshot,
  rowsForColumnOps as rvRowsForColumnOps,
} from './slick/rowValues';
import './slick/slickTheme.css';
import 'slickgrid/dist/styles/css/slick.grid.css';
import { setVisibleRows } from '../shared/page/visibleRows';
import { getPage, pageVersion, setVisibleWindow } from './page';
import * as scrollTrace from './scrollTrace';
import { rangesFromSelection, selectionFromRanges } from './slick/selection';
import { parseTextSortTerms } from './sortTerms';
import { runtime, type Selection, setSort } from './state';

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

// §5 D8 — a `computed` purely to trigger the `editable`-sync watch below via `grid.setOptions`
// (rowHeight's own computed+watch pair, just below, is the identical precedent); canEditTable()
// itself deliberately stays a plain function, not a computed, since every other call site is an
// event handler outside SlickGrid's synchronous render path (D0 is about that path specifically).
// `pageVersion.n` is read explicitly (not just through hasPrimaryKey()'s own getPage() call)
// because `page/store.ts`'s `pages` map is a plain `Map`, not `reactive()` — `pageVersion.n` is
// that store's own dedicated reactive signal for "a page was set/dropped", the same one the
// `pageVersion` watch below already keys its own page-dependent rebuild off of; without this read
// here, a tab whose grid mounts before its first page arrives (the common case — connect, then
// load) would stay permanently `editable: false`, since nothing would ever re-run this computed.
const canEditTableReactive = computed(() => {
  void pageVersion.n;
  return canEditTable();
});

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

// C7/§5 D7 — the current display column order, read fresh (not a computed: nothing here may
// create a Vue reactive dependency this file's own imperative calls could re-enter, D0). Every
// menu/clipboard/nav function below takes it as a plain parameter, matching rowValues.ts's own
// signatures (content, no SlickGrid API, §1).
function currentOrder(): string[] {
  const p = getPage(props.tabId);
  return p ? resolveColumnOrder(p, tab()?.state.columnOrder ?? null) : [];
}

// Thin, tabId/page/order-bound wrappers over rowValues.ts's own pure functions — every call site
// in this file already has props.tabId and currentOrder() on hand, so binding them here once
// keeps those call sites reading exactly like DataGrid.vue's own did.
function displayCell(row: number, displayCol: number): DisplayCellView {
  return rvDisplayCell(props.tabId, getPage(props.tabId), currentOrder(), row, displayCol);
}
function rowSnapshot(row: number): RowSnapshot {
  return rvRowSnapshot(props.tabId, getPage(props.tabId), currentOrder(), row);
}

function currentDialect() {
  return sqlDialectFor(connectionRecord(tab()?.connectionId)?.kind);
}

function isDeleted(row: number): boolean {
  return !!pendingFor(props.tabId)?.deletes.has(row);
}

function columnDescriptor(name: string): ColumnDescriptor | undefined {
  return getPage(props.tabId)?.columns.find((c) => c.name === name);
}

// C7/§5 D7 — rowsForColumnOps/columnValuesFor bound to this file's own displayRows/tabId/page/
// order, mirroring the displayCell/rowSnapshot wrappers above.
function rowsForColumnOps(rowCount: number): number[] {
  return rvRowsForColumnOps(currentDisplayRows(), rowCount);
}
function columnValuesFor(displayCol: number): string[] {
  return rvColumnValuesFor(
    props.tabId,
    getPage(props.tabId),
    currentOrder(),
    currentDisplayRows(),
    displayCol,
  );
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
      // D2/D8 — always present, gated by onBeforeEditCell's own veto, not by presence: a column
      // this table can't currently write to still needs the same editor class the moment
      // writability changes (a caps probe resolving after mount), never a rebuild to add one.
      editor: KiraCellEditor,
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
// C4/§5 D0 rule 2 — never a ref/shallowRef/reactive, same as `grid` itself.
let selectionModel: SlickHybridSelectionModel | null = null;
// D4's own one-shot flag, set by the header select zone immediately before it pushes ranges into
// the model — mirrors DataGrid.vue's own `dragProducedRange` shape.
let pendingSelectionKind: 'column' | null = null;
// Shift-range anchor for the header select zone's own click cycle — DataGrid.vue's own `colAnchor`
// ref, kept as a plain variable here since nothing renders from it.
let colAnchor: number | null = null;

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

// C5/§5 D5 — a display column index -> the SlickGrid column *id* (field name) it corresponds to,
// i.e. the key setCellCssStyles' own hash wants (F2's own `hash[j][this.columns[k].id]`).
// `getColumns()` includes the gutter at index 0, hence the +1.
function fieldAtDisplayCol(displayCol: number): string | undefined {
  const c = grid?.getColumns()[displayCol + 1];
  return c ? String(c.field) : undefined;
}

// One class name per FLAG_CLASS_NAMES entry actually set — `setCellCssStyles`'s own hash value
// ultimately reaches a single `classList.add(value)` call (SlickGrid's own
// updateCellCssStylesOnRenderedRows), which throws InvalidCharacterError for a multi-token string
// (the DOM spec's own "no whitespace in one token" rule) — so a cell needing more than one edge
// class can never be expressed as one merged string in one layer. Four separate keyed layers
// below (one per edge) are what keep every hash value a lone token while still letting one cell
// carry all four edges at once.
function classesFrom(flags: CellClassFlags): string[] {
  return Object.keys(cellClass(flags));
}

type EdgeHash = Record<number, Record<string, string>>;
const SEL_EDGE_LAYER_KEYS = ['kira-sel-t', 'kira-sel-r', 'kira-sel-b', 'kira-sel-l'] as const;

/** C5/§5 D5 — the selection's own perimeter, O(perimeter ∩ rendered) by construction: only the
 *  two edge columns (c0/c1, or every selected row's own two edge columns for a row selection, or
 *  every selected column's own two edge rows for a column selection) are ever walked per rendered
 *  row — never the interior. A committed selection is at most one rectangle (or, in row/column
 *  mode, a set of full-width/full-height strips), which is what keeps this bounded regardless of
 *  how large the selection itself is (F2's O(area) cost is `kira-cell-selected`'s own — SlickGrid's
 *  built-in layer, gated separately at C6). Page-row space in, translated once per rendered row via
 *  `dataSource.getItem(pos).row` — the same arithmetic `onGridRendered` already uses.
 */
function computeSelEdgeHashes(): [EdgeHash, EdgeHash, EdgeHash, EdgeHash] {
  const hashes: [EdgeHash, EdgeHash, EdgeHash, EdgeHash] = [{}, {}, {}, {}];
  if (!grid || !dataSource) return hashes;
  const sel = rt()?.selection;
  if (!sel) return hashes;
  const { start, end } = grid.lastRenderedRowBounds;
  if (end < start) return hashes;

  const mark = (pos: number, displayCol: number, flags: CellClassFlags): void => {
    const field = fieldAtDisplayCol(displayCol);
    if (!field) return;
    for (const cls of classesFrom(flags)) {
      const i = SEL_EDGE_LAYER_KEYS.indexOf(`kira-${cls}` as (typeof SEL_EDGE_LAYER_KEYS)[number]);
      if (i < 0) continue;
      const hash = hashes[i] as EdgeHash;
      hash[pos] ??= {};
      (hash[pos] as Record<string, string>)[field] = cls;
    }
  };

  if (sel.kind === 'cell' || sel.kind === 'range') {
    const anchorRow = sel.kind === 'range' ? sel.anchorRow : sel.row;
    const anchorCol = sel.kind === 'range' ? sel.anchorCol : sel.col;
    const r0 = Math.min(anchorRow, sel.row);
    const r1 = Math.max(anchorRow, sel.row);
    const c0 = Math.min(anchorCol, sel.col);
    const c1 = Math.max(anchorCol, sel.col);
    for (let pos = start; pos <= end; pos++) {
      const pageRow = dataSource.getItem(pos).row;
      if (pageRow < r0 || pageRow > r1) continue;
      const isTop = pageRow === r0;
      const isBottom = pageRow === r1;
      mark(pos, c0, {
        selEdgeLeft: true,
        selEdgeRight: c0 === c1,
        selEdgeTop: isTop,
        selEdgeBottom: isBottom,
      });
      if (c1 !== c0)
        mark(pos, c1, { selEdgeRight: true, selEdgeTop: isTop, selEdgeBottom: isBottom });
      // Interior columns of the top/bottom row only — c0/c1 already got their own edge above.
      if (isTop) for (let c = c0 + 1; c <= c1 - 1; c++) mark(pos, c, { selEdgeTop: true });
      if (isBottom) for (let c = c0 + 1; c <= c1 - 1; c++) mark(pos, c, { selEdgeBottom: true });
    }
  } else if (sel.kind === 'row') {
    const rows = new Set(sel.rows);
    const lastCol = grid.getColumns().length - 1 - 1; // minus the gutter, then to a 0-based index
    for (let pos = start; pos <= end; pos++) {
      const pageRow = dataSource.getItem(pos).row;
      if (!rows.has(pageRow)) continue;
      const isTop = !rows.has(pageRow - 1);
      const isBottom = !rows.has(pageRow + 1);
      mark(pos, 0, { selEdgeLeft: true, selEdgeTop: isTop, selEdgeBottom: isBottom });
      if (lastCol > 0)
        mark(pos, lastCol, { selEdgeRight: true, selEdgeTop: isTop, selEdgeBottom: isBottom });
    }
  } else if (sel.kind === 'column') {
    const cols = new Set(sel.cols);
    const pageRowCount = getPage(props.tabId)?.rowCount ?? 0;
    for (let pos = start; pos <= end; pos++) {
      const pageRow = dataSource.getItem(pos).row;
      const isTop = pageRow === 0;
      const isBottom = pageRow === pageRowCount - 1;
      for (const c of cols) {
        mark(pos, c, {
          selEdgeTop: isTop,
          selEdgeBottom: isBottom,
          selEdgeLeft: !cols.has(c - 1),
          selEdgeRight: !cols.has(c + 1),
        });
      }
    }
  }
  return hashes;
}

function refreshSelEdges(): void {
  if (!grid) return;
  const hashes = computeSelEdgeHashes();
  SEL_EDGE_LAYER_KEYS.forEach((key, i) => {
    grid?.setCellCssStyles(key, hashes[i] as EdgeHash);
  });
}

/** C5/§5 D5 — bounded by what the user staged (`pendingFor(tabId).edits`, a handful of rows in
 *  any real session), clipped to the rendered range the same way the edges layer is. */
function computeStagedHash(): Record<number, Record<string, string>> {
  const hash: Record<number, Record<string, string>> = {};
  if (!grid || !dataSource) return hash;
  const p = pendingFor(props.tabId);
  if (!p || p.edits.size === 0) return hash;
  const { start, end } = grid.lastRenderedRowBounds;
  if (end < start) return hash;
  const cls = classesFrom({ pendingEdit: true })[0] ?? 'pending-edit';
  for (let pos = start; pos <= end; pos++) {
    const pageRow = dataSource.getItem(pos).row;
    const edit = p.edits.get(pageRow);
    if (!edit) continue;
    const row: Record<string, string> = {};
    for (const column of Object.keys(edit.changes)) row[column] = cls;
    hash[pos] = row;
  }
  return hash;
}

function refreshStagedLayer(): void {
  grid?.setCellCssStyles('kira-staged', computeStagedHash());
}

// The rendered row *band* (not every render — a sub-row scroll re-renders nothing new, and the
// edges/staged layers only ever depend on what's actually mounted) leaving the previous one is
// the other trigger D5 names for the edges layer, beside a selection change; folded into
// onGridRendered since it already runs on every grid.onRendered and already reads
// lastRenderedRowBounds.
let lastCssLayerBand = { start: 0, end: -1 };

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

  if (start !== lastCssLayerBand.start || end !== lastCssLayerBand.end) {
    lastCssLayerBand = { start, end };
    refreshSelEdges();
    refreshStagedLayer();
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
  // §5 D4 — pushes a `column` selection into both rt().selection and the hybrid selection model
  // (via the pendingKind flag, onHeaderSelectClick) and stops the click from reaching the
  // header's own sort-click handler underneath the strip.
  const zone = document.createElement('span');
  zone.className = 'header-select-zone';
  zone.dataset.testid = 'grid-header-select';
  zone.dataset.column = name;
  zone.dataset.colIndex = args.node.dataset.colIndex ?? '';
  zone.setAttribute('role', 'button');
  zone.setAttribute('aria-label', 'Select column');
  zone.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const displayCol = Number(zone.dataset.colIndex);
    if (Number.isInteger(displayCol)) onHeaderSelectClick(displayCol, ev as MouseEvent);
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

// §4 item 6, §5 D6 — the corner cell selects everything, as a single `range` (never a `row`
// selection, which `isSelected` would resolve with `Array.includes`, F14a's own O(rows) cost).
// **Adopts the selection model** (pushes the full-page range through it, exactly like any other
// drag/click) rather than D6's named bypass: F2's O(rows × cols) hash — ~61 000 iterations on the
// spike_grid fixture (1 000 × 61), ~20 000 on the 10 000-row/2-column big_rows one — is well
// inside T6's own 150ms sandbox gate (slick-grid.spec.ts), so the bypass is written down in the
// plan (§5 D6) and in this comment, not built: nothing here needs it unless a real page size
// someday fails that gate, at which point it's a swap of this one function's body, not a redesign.
function onSelectAll(): void {
  if (!grid || !selectionModel) return;
  const p = getPage(props.tabId);
  const rowCount = p?.rowCount ?? 0;
  const colCount = grid.getColumns().length - 1; // minus the gutter
  if (rowCount <= 0 || colCount <= 0) return;
  selectionModel.setSelectedRanges([new SlickRange(0, 1, rowCount - 1, colCount)]);
}

function onHeaderClick(_e: unknown, args: OnHeaderClickEventArgs): void {
  if (args.column.id === GUTTER_FIELD) onSelectAll();
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

// C4/§5 D4 — `selectionFromRanges`/`rangesFromSelection` (slick/selection.ts) are deliberately
// row-space-agnostic; these two glue functions are the one place that translates between a
// `SlickRange`'s own display-position rows and `Selection`'s page rows, via dataSource.ts's own
// rowAtDisplayPosition/displayPositionOf (identity today, real once C12 wires a live filter).
function toPageRowSelection(sel: Selection): Selection {
  if (!dataSource) return sel;
  const idx = {
    displayRows: currentDisplayRows(),
    pageRowCount: getPage(props.tabId)?.rowCount ?? 0,
  };
  const toPageRow = (pos: number) => rowAtDisplayPosition(idx, Math.max(0, pos));
  switch (sel.kind) {
    case 'cell':
      return { ...sel, row: toPageRow(sel.row) };
    case 'range':
      return { ...sel, anchorRow: toPageRow(sel.anchorRow), row: toPageRow(sel.row) };
    case 'row':
      return { ...sel, rows: sel.rows.map(toPageRow) };
    default:
      return sel;
  }
}
function toPositionSelection(sel: Selection): Selection {
  const idx = {
    displayRows: currentDisplayRows(),
    pageRowCount: getPage(props.tabId)?.rowCount ?? 0,
  };
  const toPos = (row: number) => displayPositionOf(idx, row);
  switch (sel.kind) {
    case 'cell':
      return { ...sel, row: toPos(sel.row) };
    case 'range':
      return { ...sel, anchorRow: toPos(sel.anchorRow), row: toPos(sel.row) };
    case 'row':
      return { ...sel, rows: sel.rows.map(toPos) };
    default:
      return sel;
  }
}

// D4 — the selection model owns the geometry, `rt().selection` owns the meaning. Fires on every
// `setSelectedRanges` call: a click, a drag frame (cell mode: only on drag END — F1's own
// `handleCellRangeSelected` returns early for `caller === 'onCellRangeSelecting'` — §4.1 item 3),
// shift/ctrl accumulation, keyboard extension, and this host's own header-select-zone push below.
function onSelectedRangesChanged(_e: unknown, ranges: SlickRange[]): void {
  const runtimeEntry = rt();
  if (!runtimeEntry) return;
  const rowMode = selectionModel?.currentSelectionModeIsRow() ?? false;
  const kind = pendingSelectionKind;
  pendingSelectionKind = null;
  const posSel = selectionFromRanges(ranges, rowMode, kind);
  runtimeEntry.selection = posSel ? toPageRowSelection(posSel) : null;
  // C5/§5 D5 — the perimeter layer's other trigger, beside a rendered-band change (onGridRendered).
  refreshSelEdges();
}

// D4 — the header select zone's own click semantics (DataGrid.vue's onHeaderSelectClick,
// content — mirrored verbatim): shift extends a contiguous range from the last anchor, ctrl/cmd
// toggles one column into a disjoint set, a plain click replaces the selection with just that
// column. Pushes the resulting range(s) into the selection model (via the pendingKind flag) so
// the model and rt().selection can never disagree about what's painted.
function onHeaderSelectClick(displayCol: number, e: MouseEvent): void {
  if (!grid || !selectionModel) return;
  const sel = rt()?.selection;
  let cols: number[];
  if (e.shiftKey && colAnchor !== null) {
    const [a, b] = [colAnchor, displayCol].sort((x, y) => x - y);
    cols = [];
    for (let c = a; c <= b; c++) cols.push(c);
  } else if ((e.ctrlKey || e.metaKey) && sel?.kind === 'column') {
    cols = sel.cols.includes(displayCol)
      ? sel.cols.filter((c) => c !== displayCol)
      : [...sel.cols, displayCol];
    colAnchor = displayCol;
  } else {
    cols = [displayCol];
    colAnchor = displayCol;
  }
  // Display row count, not the page's own row count — `setSelectedRanges` below is
  // position-space, and the two only coincide because nothing filters yet (C12).
  const displayRowCount = currentDisplayRows()?.length ?? getPage(props.tabId)?.rowCount ?? 0;
  const colCount = grid.getColumns().length - 1; // minus the gutter
  pendingSelectionKind = 'column';
  selectionModel.setSelectedRanges(
    rangesFromSelection({ kind: 'column', cols }, displayRowCount, colCount),
  );
}

// C8/D8 — the cell menu's own "Edit" item and double-click/Enter (SlickGrid's own default
// `editable: true` handling, unported here) now share one real editor, gated by onBeforeEditCell
// below rather than by `editable: false`'s old no-op.
function startEditCell(row: number, displayCol: number): void {
  if (!grid || !dataSource) return;
  const idx = {
    displayRows: currentDisplayRows(),
    pageRowCount: getPage(props.tabId)?.rowCount ?? 0,
  };
  const pos = displayPositionOf(idx, row);
  grid.setActiveCell(pos, displayCol + 1, false, false, true);
  grid.editActiveCell();
}

// §5 D8 — exactly `startEdit`'s own guards (DataGrid.vue:810-818 mirror: not writable, row
// deleted, value truncated) plus the two new predicates (the gutter column; a pending-insert row,
// whose own inputs D9/C9 owns) — one function, so this veto and the cell menu's `Edit` item
// (`disabled: editDisabled`, menu.ts) can never drift apart on what's editable.
function onBeforeEditCell(_e: SlickEventData, args: OnBeforeEditCellEventArgs): boolean {
  if (args.column.id === GUTTER_FIELD) return false;
  const item = args.item as RowHandle | undefined;
  if (item?.insertId !== undefined) return false;
  const row = item?.row ?? args.row ?? -1;
  if (!canEditTable() || isDeleted(row)) return false;
  const displayCol = currentOrder().indexOf(String(args.column.field));
  if (displayCol < 0) return false;
  // P24 D27: a value the engine truncated is not editable — committing the buffer verbatim
  // (stageEdit's own contract) would write the truncated text over the real value.
  if (displayCell(row, displayCol).truncated) return false;
  return true;
}

// D3: right-clicking a row already in the selection acts on the whole selection; right-clicking
// outside it replaces the selection with just that row first (the "replace the selection first"
// rule, §5 D7). Cell/header menus have no multi-target actions, so those two always collapse to a
// single-item selection. Pushed via `grid.setActiveCell` on the gutter column, not a direct
// `rangesFromSelection`/`setSelectedRanges` call — landing the active cell on a
// `rowSelectColumnIds` column is what makes `SlickHybridSelectionModel` itself compute and notify
// the single-row range (`handleActiveCellChange`, F1's own `selectActiveRow` branch), which is
// also what keeps `_activeSelectionIsRow` (and so `onSelectedRangesChanged`'s own `rowMode` read)
// correct — calling `setSelectedRanges` directly here, before anything told the model this is a
// *row* push, would leave it reading whatever mode the *previous* selection left behind.
function onGutterContextMenu(row: number, e: MouseEvent): void {
  const p = getPage(props.tabId);
  if (!p || row >= p.rowCount) return; // pending insert rows have no row menu yet (D9/C9)
  const sel = rt()?.selection;
  const inSelection = sel?.kind === 'row' && sel.rows.includes(row);
  if (!inSelection && grid) {
    const idx = { displayRows: currentDisplayRows(), pageRowCount: p.rowCount };
    grid.setActiveCell(displayPositionOf(idx, row), 0, false, false, false);
  }
  const rows = inSelection && sel.kind === 'row' ? sel.rows : [row];
  openContextMenu(
    e,
    rowMenu({
      tabId: props.tabId,
      rows,
      qualifiedName: qualifiedName(),
      snapshot: rowSnapshot,
      canEdit: canEditTable(),
      canDelete: canDeleteRows(),
    }),
  );
}

function onCellContextMenu(row: number, displayCol: number, e: MouseEvent): void {
  const order = currentOrder();
  if (grid && dataSource) {
    const idx = {
      displayRows: currentDisplayRows(),
      pageRowCount: getPage(props.tabId)?.rowCount ?? 0,
    };
    grid.setActiveCell(displayPositionOf(idx, row), displayCol + 1, false, false, false);
  }
  const dc = displayCell(row, displayCol);
  const name = order[displayCol] ?? '';
  const t = tab();
  openContextMenu(
    e,
    cellMenu({
      tabId: props.tabId,
      row,
      columnName: name,
      isNull: dc.isNull,
      text: dc.text,
      dialect: currentDialect(),
      canEdit: canEditTable(),
      canDelete: canDeleteRows(),
      isDeleted: isDeleted(row),
      startEdit: () => startEditCell(row, displayCol),
      onPaste: () => void onPaste(),
      meta: rt()?.meta ?? null,
      connectionId: t?.connectionId ?? '',
      rowValues: rowSnapshot(row).values,
    }),
  );
}

function onHeaderContextMenuHandler(displayCol: number, e: MouseEvent): void {
  const order = currentOrder();
  const name = order[displayCol] ?? '';
  const displayRowCount = currentDisplayRows()?.length ?? getPage(props.tabId)?.rowCount ?? 0;
  const colCount = (grid?.getColumns().length ?? 1) - 1;
  if (selectionModel) {
    pendingSelectionKind = 'column';
    selectionModel.setSelectedRanges(
      rangesFromSelection({ kind: 'column', cols: [displayCol] }, displayRowCount, colCount),
    );
  }
  openContextMenu(
    e,
    headerMenu({
      tabId: props.tabId,
      columnName: name,
      currentSort: currentSortTerms().find((t) => t.column === name)?.direction ?? null,
      currentProjection: tab()?.state.projection ?? null,
      allColumnNames: getPage(props.tabId)?.columns.map((c) => c.name) ?? [],
      columnValues: () => columnValuesFor(displayCol),
    }),
  );
}

// F7 — `handleContextMenu` resolves nothing itself and does not prevent the native menu; the
// event args are `{}` (resolve the cell with getCellFromEvent), and a right-click on the cell
// currently being edited is deliberately swallowed by SlickGrid itself before this ever fires.
function onGridContextMenu(e: SlickEventData): void {
  if (!grid || !dataSource) return;
  e.preventDefault();
  const hit = grid.getCellFromEvent(e);
  if (!hit) return;
  const pageRow = dataSource.getItem(hit.row).row;
  const nativeLike = e as unknown as MouseEvent;
  if (hit.cell === 0) onGutterContextMenu(pageRow, nativeLike);
  else onCellContextMenu(pageRow, hit.cell - 1, nativeLike);
}

function onGridHeaderContextMenu(e: SlickEventData, args: { column: KiraColumn }): void {
  if (args.column.id === GUTTER_FIELD) return;
  e.preventDefault();
  const displayCol = currentOrder().indexOf(String(args.column.field));
  if (displayCol < 0) return;
  onHeaderContextMenuHandler(displayCol, e as unknown as MouseEvent);
}

// D1: local, DOM-focus-scoped copy/paste — never a native Electron accelerator.
function onCopy(): void {
  const sel = rt()?.selection;
  const p = getPage(props.tabId);
  if (!sel || !p) return;
  if (sel.kind === 'cell') {
    const dc = displayCell(sel.row, sel.col);
    void copyText(dc.isNull ? '' : dc.text);
    return;
  }
  if (sel.kind === 'range') {
    // F14/§4.1 item 1: anchorRow/anchorCol is always the top-left corner now (SlickRange
    // normalises), so this needs no min/max sort the way the incumbent's own drag-anchor did.
    void copyText(rangeToTsv(sel.anchorRow, sel.row, sel.anchorCol, sel.col, displayCell));
    return;
  }
  if (sel.kind === 'row') {
    void copyText(rowsToTsv(sel.rows.map(rowSnapshot)));
    return;
  }
  void copyText(columnsToTsv(rowsForColumnOps(p.rowCount), sel.cols, displayCell));
}

// D13: TSV-if-tab-else-CSV, applied column-by-column from the selection's anchor across the
// current display column order — existing rows become stageEdit calls, rows past the loaded page
// become pending inserts (reusing one already staged at that row, else a fresh addInsertRow).
async function onPaste(): Promise<void> {
  if (!canEditTable()) return;
  const sel = rt()?.selection;
  const p = getPage(props.tabId);
  if (!sel || !p) return;
  if (sel.kind !== 'cell' && sel.kind !== 'range' && sel.kind !== 'row') return;

  let clipboardText: string;
  try {
    clipboardText = await navigator.clipboard.readText();
  } catch {
    return;
  }
  if (!clipboardText) return;

  const parsed = parseDelimited(clipboardText);
  const startRow =
    sel.kind === 'row' ? Math.min(...sel.rows) : sel.kind === 'range' ? sel.anchorRow : sel.row;
  const startCol = sel.kind === 'row' ? 0 : sel.kind === 'range' ? sel.anchorCol : sel.col;
  const columns = currentOrder();
  // P36 D28: the server computes a generated column's value — an explicit paste into one is
  // silently dropped rather than staged into an insert the server would then reject outright.
  const insertColumns = columns.filter((name) => !columnDescriptor(name)?.generated);
  const insertIds = new Map<number, string>();
  const pending = pendingFor(props.tabId);

  for (let ri = 0; ri < parsed.length; ri++) {
    const row = startRow + ri;
    if (row < 0) continue;
    const isNewRow = row >= p.rowCount;
    let insertId = insertIds.get(row);
    if (isNewRow && insertId === undefined) {
      // P2 R2: reuse the PendingInsert already staged at this display row instead of always
      // appending a fresh one — insertRows' identity is positional (pending.inserts[row -
      // p.rowCount]), so a paste landing on an existing staged row must update it, not create a
      // sibling.
      insertId = pending?.inserts[row - p.rowCount]?.id ?? addInsertRow(props.tabId, insertColumns);
      insertIds.set(row, insertId);
    }
    const cols = parsed[ri] as string[];
    for (let ci = 0; ci < cols.length; ci++) {
      const name = columns[startCol + ci];
      if (!name) continue;
      if (isNewRow) {
        if (insertId && !columnDescriptor(name)?.generated) {
          stageInsertValue(props.tabId, insertId, name, cols[ci] as string);
        }
      } else {
        stageEdit(props.tabId, row, name, cols[ci] as string);
      }
    }
  }
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
    onCopy();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && key === 'v') {
    e.preventDefault();
    e.stopImmediatePropagation();
    void onPaste();
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

  // §5 D8 — editor.ts's own `formatterCtx`-style reassigned plain object (its own file-level
  // comment says why: a grid-constructed `KiraCellEditor` cannot close over tabId/displayCell
  // itself). Both callbacks re-resolve the display column / read state fresh on every call, so —
  // unlike `dataItemColumnValueExtractor`'s own captured-closure trap noted just above — this
  // assignment is correct for the tab's whole lifetime and needs no pageVersion-watch counterpart.
  editorCtx.readValue = (row, name) => displayCell(row, currentOrder().indexOf(name));
  editorCtx.commit = (row, name, value) => stageEdit(props.tabId, row, name, value);

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
      // C4/§5 D4 — SlickGrid's own selection-highlight layer now IS the app's own selection
      // paint (replacing Pass A's '' — F2's O(area) hash cost is gated at C6, not avoided here).
      selectedCellCssClass: 'kira-cell-selected',
      // F1 — enables ctrl/shift disjoint *row* selection in SlickHybridSelectionModel's own row
      // branch (handleClick, :539-556) — the grid's own default, stated explicitly.
      multiSelect: true,
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
      // §5 D8 — bound to canEditTable() at construction; the `editable` watch below (after
      // writability-affecting reactive state can change post-mount, e.g. a caps probe resolving)
      // keeps it live via `grid.setOptions`, the same pattern `rowHeight`'s own watch already uses.
      // `isCellPotentiallyEditable`/`makeActiveCellEditable` both read `this._options.editable`
      // fresh on every edit attempt (`slick.grid.ts`) rather than caching it, so `setOptions` alone
      // is sufficient — no `invalidateAllRows`/`render()` call is needed alongside it.
      editable: canEditTable(),
      // F5 — a selected cell never opens its editor just by typing over it; only double-click or
      // Enter does (SlickGrid's own default handling, unported here), matching DataGrid.vue's own
      // `startEdit` trigger set exactly.
      autoEdit: false,
      autoCommitEdit: true,
      asyncEditorLoading: false,
      editorCellNavOnLRKeys: false,
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

  // C4/§5 D4 — F1: near-exact match for this app's four selection kinds; the gutter is the one
  // rowSelectColumnIds entry (clicking it selects the row). enableMultiSelection: false is a
  // parity choice, not a limitation (§4.1 item 4) — multi-cell disjoint selection has no consumer
  // (Selection has no shape for it). showDragHandle: false — no Excel-style fill affordance.
  selectionModel = new SlickHybridSelectionModel({
    selectionType: 'mixed',
    rowSelectColumnIds: [GUTTER_FIELD],
    selectActiveCell: true,
    selectActiveRow: true,
    dragToSelect: true,
    autoScrollWhenDrag: true,
    enableMultiSelection: false,
    showDragHandle: false,
  });
  grid.setSelectionModel(selectionModel);

  eventHandler = new SlickEventHandler();
  eventHandler.subscribe(grid.onRendered, tagRenderedRows);
  eventHandler.subscribe(grid.onRendered, onGridRendered);
  eventHandler.subscribe(grid.onHeaderCellRendered, onHeaderCellRendered);
  eventHandler.subscribe(grid.onBeforeHeaderCellDestroy, onBeforeHeaderCellDestroy);
  eventHandler.subscribe(grid.onSort, onSort);
  eventHandler.subscribe(grid.onHeaderClick, onHeaderClick);
  eventHandler.subscribe(grid.onContextMenu, onGridContextMenu);
  eventHandler.subscribe(grid.onHeaderContextMenu, onGridHeaderContextMenu);
  eventHandler.subscribe(grid.onColumnsResized, onColumnsResized);
  eventHandler.subscribe(grid.onKeyDown, onKeydown);
  eventHandler.subscribe(grid.onBeforeEditCell, onBeforeEditCell);
  eventHandler.subscribe(selectionModel.onSelectedRangesChanged, onSelectedRangesChanged);

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
  // C4 — `grid.destroy()` never calls `this.selectionModel?.destroy()` itself (only its own
  // registered `_selector` plugin, via the plugins-unregister loop it does run) — its own
  // `_eventHandler.unsubscribeAll()` (grid.onActiveCellChanged/onClick/onKeyDown) needs this
  // explicit call, before the grid it's subscribed against goes away.
  selectionModel?.destroy();
  selectionModel = null;
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
    // C5 — the rendered band's own numbers can coincidentally match the pre-reload band (a page
    // reload commonly lands back at scrollTop 0), which would fool onGridRendered's own
    // band-change check into skipping a refresh a genuinely new page needs. The sentinel forces it.
    lastCssLayerBand = { start: 0, end: -1 };
    grid.render();
    syncSortIndicators();
  },
);

watch(rowHeight, (h) => {
  if (!grid) return;
  grid.setOptions({ rowHeight: h });
  grid.updateRowCount();
  grid.render();
});

// §5 D8 — keeps the grid's own `editable` option live across a writability change that happens
// after mount (a caps probe resolving, a connection flipping read-only). No invalidate/render
// needed alongside it: `isCellPotentiallyEditable`/`makeActiveCellEditable` both read
// `this._options.editable` fresh on every edit attempt, never a cached value.
watch(canEditTableReactive, (editable) => {
  grid?.setOptions({ editable });
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

// C8/§5 D8 addendum — every row this watch has ever seen staged, so a discard (which clears
// `p.edits` entirely, outside any SlickGrid commit path) knows which *previously* staged rows
// must be invalidated back to their real page value, not only the newly-staged ones a plain diff
// against the current map would catch.
let lastStagedRows = new Set<number>();

// C5/§5 D5 — the `kira-staged` layer's own trigger: a cell staged or un-staged.
// `pendingFor(tabId)?.edits` is a reactive Map (pendingChanges.ts's own `pendingState`, a Vue
// `reactive()`), so both Map iteration and each entry's own `changes` object track reactively —
// no reference-identity trap the way the TabPending object itself would be (created once per tab
// and mutated in place, never reassigned). The signature is row -> staged *column count*, not
// values: refreshStagedLayer only needs to know *which* cells are staged, never what they hold,
// so a same-column value edit (no key added/removed) correctly does not re-trigger this.
watch(
  () => {
    const p = pendingFor(props.tabId);
    if (!p) return '';
    let sig = '';
    for (const [row, edit] of p.edits) sig += `${row}:${Object.keys(edit.changes).length};`;
    return sig;
  },
  () => {
    refreshStagedLayer();
    // C8 — `dataItemColumnValueExtractor` already merges `stagedValue` over the page (D1), so a
    // committed *edit* renders correctly for free (SlickGrid's own `commitCurrentEdit` calls
    // `updateRow` after `applyValue`, `slick.grid.ts:4136`). Nothing calls that for a *discard*,
    // though — `pendingChanges.ts`'s own discard clears `p.edits` entirely from outside any
    // SlickGrid edit-commit path, so without this the cell keeps showing the just-discarded text
    // until something else happens to re-render it. Invalidate the union of this row's newly- and
    // previously-staged state (not just the new set — a discard's new set is empty) and re-render.
    if (!grid || !dataSource) return;
    const p = pendingFor(props.tabId);
    const rows = new Set(p ? p.edits.keys() : []);
    const touched = new Set<number>([...lastStagedRows, ...rows]);
    lastStagedRows = rows;
    if (touched.size === 0) return;
    const idx = {
      displayRows: currentDisplayRows(),
      pageRowCount: getPage(props.tabId)?.rowCount ?? 0,
    };
    for (const row of touched) grid.invalidateRow(displayPositionOf(idx, row));
    grid.render();
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
