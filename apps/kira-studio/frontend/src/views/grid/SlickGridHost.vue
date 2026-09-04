<script setup lang="ts">
import type { ObjectMeta } from '@shared/domain/tree';
import { decodePath } from '@shared/domain/tree';
import type { ColumnDescriptor } from '@shared/protocol/page';
import type {
  Column,
  CustomDataView,
  FormatterResultWithText,
  ItemMetadata,
  OnBeforeEditCellEventArgs,
  OnBeforeHeaderCellDestroyEventArgs,
  OnClickEventArgs,
  OnHeaderCellRenderedEventArgs,
  OnHeaderClickEventArgs,
  SlickEventData,
} from 'slickgrid';
import { SlickEventHandler, SlickHybridSelectionModel, SlickRange } from 'slickgrid';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { copyText } from '../../clipboard';
import { shortcutFor } from '../../shortcuts/keys';
import {
  clearSelectedCellFor,
  publishSelectedCell,
  type SelectedCell,
} from '../../state/cellSelection';
import { connectionRecord, connectionsState } from '../../state/connections';
import { openContextMenu, runMenuShortcut } from '../../state/contextMenu';
import { appearanceVersion, settingsState } from '../../state/settings';
import { findDataTab, patchDataTabState } from '../../state/tabs';
import { type CellClassFlags, cellClass } from '../../theme/cellClass';
import { categoryForTypeClass } from '../../theme/icons';
import AppButton from '../../theme/primitives/AppButton.vue';
import EmptyState from '../../theme/primitives/EmptyState.vue';
import { wrapSelectionOnType } from '../../theme/wrapSelection';
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
import { setSearchFiltering } from '../shared/page/searchFilter';
import { type EdgeHash, searchCellLayers } from '../shared/slick/cssLayers';
import { KiraSlickGrid } from '../shared/slick/kiraSlickGrid';
import { sqlDialectFor } from '../shared/sqlIdent';
import { columnsToTsv, parseDelimited, type RowSnapshot, rowsToTsv } from './clipboardFormats';
import { cellMenu, headerMenu, rowMenu } from './menu';
import {
  addInsertRow,
  discardCellEdit,
  pendingFor,
  stageEdit,
  stageInsertValue,
} from './pendingChanges';
import { matchedRows, searchState } from './search';
import {
  createDisplayValueExtractor,
  createGridDataSource,
  displayPositionOf,
  type GridDataSourceState,
  isRowVisible,
  pendingRowClasses,
  type RowHandle,
  rowAtDisplayPosition,
} from './slick/dataSource';
import { editorCtx, KiraCellEditor } from './slick/editor';
import {
  type CellNavEntry,
  type DisplayCellView,
  type NavColumns,
  navColumnsFor,
  pasteTargetRows,
  cellNavEntry as rvCellNavEntry,
  columnValuesFor as rvColumnValuesFor,
  displayCell as rvDisplayCell,
  rowSnapshot as rvRowSnapshot,
  rowsForColumnOps as rvRowsForColumnOps,
  visibleRowsInSpan,
} from './slick/rowValues';
import '../shared/slick/slickTheme.css';
import 'slickgrid/dist/styles/css/slick.grid.css';
import { setVisibleRows } from '../shared/page/visibleRows';
import * as scrollTrace from '../shared/slick/scrollTrace';
import { getPage, pageVersion, setVisibleWindow } from './page';
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
  columnDef: KiraColumn,
  dataContext: RowHandle,
): string | FormatterResultWithText | HTMLElement {
  const view = value as { text: string; isNull: boolean; truncated: boolean };
  // C9/§5 D9 — the one place a formatter returns DOM, against `-iter2-pacing` D5's measured
  // "text, never DOM" rule: bounded to the insert region alone (typically 1-5 rows), and the
  // normal path just above/below is untouched. Self-contained once built: every keystroke stages
  // straight into pendingChanges via the grid root's own delegated `input` listener (onMounted,
  // below), never back through this formatter, so a value survives even if this cell is later
  // invalidated and this branch simply rebuilds a fresh element from the same staged state.
  if (dataContext.insertId !== undefined) {
    const input = document.createElement('input');
    input.className = 'cell-input';
    input.dataset.testid = 'grid-cell-insert-input';
    input.value = view.isNull ? '' : view.text;
    return input;
  }
  // C11/§5 D11c — the *cheap* precheck only (a Set lookup, not the full `cellNavEntry` a click on
  // this column's own nav button computes lazily — navEntryAt, below): whether this column is
  // fk-or-pk and this cell isn't NULL. `placeNavButtonsForRenderedCells` rides on `.has-nav`
  // (below) to know which rendered cells get a button at all (item 12's always-visible redesign);
  // `.fk` no longer carries a colour of its own (item 13), only which icon glyph the button gets.
  const name = String(columnDef.field);
  const isFk = !view.isNull && navColumns.fk.has(name);
  const hasNav = isFk || (!view.isNull && navColumns.pk.has(name));
  const navClasses = hasNav ? (isFk ? 'fk has-nav' : 'has-nav') : '';
  if (view.isNull) return { text: 'NULL', addClasses: 'cell-null' };
  if (view.truncated) {
    return {
      text: view.text,
      addClasses: navClasses ? `cell-truncated ${navClasses}` : 'cell-truncated',
      toolTip: 'value truncated at 64 KB',
    };
  }
  return navClasses ? { text: view.text, addClasses: navClasses } : view.text;
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

// C13/§5 D13 — the two empty states, overlaid as absolutely-positioned siblings over the always-
// mounted grid root (template, below) rather than swapping it out: this host's own root div IS
// what SlickGrid holds references to, and `v-if`-ing it away would unmount the element mid-life.
// Reactive `computed`s are fine here, unlike `currentDisplayRows()`'s own deliberately-plain twin
// above — the template is outside SlickGrid's synchronous render path entirely (D0 is about that
// path specifically), the same reasoning the row-coloring class binding already relies on.
// `pageVersion.n` is read explicitly for the identical reason `canEditTableReactive` reads it,
// just above: `getPage()` itself is not reactive (`page/store.ts`'s own plain `Map`).
const showNoRows = computed(() => {
  void pageVersion.n;
  const p = getPage(props.tabId);
  return !!p && p.rowCount === 0;
});
// P24 D8: filtering to zero matches is a distinct empty state from "the table is empty" (LAW 15
// names both by name) — but a pending insert row is work in progress, not a search result, so its
// presence keeps the grid itself on screen even with zero real matches (DataGrid.vue's own
// identical guard, ported verbatim).
const showNoMatchingRows = computed(() => {
  void pageVersion.n;
  const p = getPage(props.tabId);
  if (!p) return false;
  const rows = matchedRows(props.tabId);
  return rows !== null && rows.length === 0 && (pendingFor(props.tabId)?.inserts.length ?? 0) === 0;
});

// Produced locally from the path, never round-tripped to the engine for a string join — the same
// discipline grid/menu.ts's qualifiedNameForPath and project/menus.ts's qualifiedNameFor use.
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

// C9/§5 D9 — dataSource.ts's own `GridDataSourceState.rowColumns` header comment explains the
// shape and the cost story; built once per column-order rebuild (matches
// `createDisplayValueExtractor`'s own `fieldToPageCol` — cheap, but no reason to redo it per row).
function insertRowColumns(order: readonly string[]): NonNullable<ItemMetadata['columns']> {
  const columns: NonNullable<ItemMetadata['columns']> = {};
  for (const name of order) columns[name] = { editor: null, focusable: false };
  return columns;
}

// C9 — the `GridDataSourceState` builder itself, factored out once this stopped being the single
// mount-time-only object it was through C8: the pageVersion watch already rebuilt it wholesale on
// every reload, and now an insert-count change (below) needs the identical shape for a narrower
// reason. `p`/`order` are passed in rather than re-derived, since every call site has already
// resolved them for its own other purposes (formatterCtx, buildColumns, ...).
function dataSourceState(p: ReturnType<typeof getPage>, order: string[]): GridDataSourceState {
  const inserts = pendingFor(props.tabId)?.inserts ?? [];
  const insertColumns = inserts.length > 0 ? insertRowColumns(order) : undefined;
  return {
    index: { displayRows: currentDisplayRows(), pageRowCount: p?.rowCount ?? 0 },
    inserts,
    rowClasses: (row) => pendingRowClasses(props.tabId, row, p?.rowCount ?? 0),
    rowColumns: insertColumns
      ? (handle) => (handle.insertId !== undefined ? insertColumns : undefined)
      : undefined,
    extractValue: p
      ? createDisplayValueExtractor(props.tabId, p, order)
      : () => ({ text: '', isNull: true, truncated: false }),
  };
}

const rootRef = ref<HTMLElement | null>(null);

// Never a ref/shallowRef/reactive (CodeMirrorHost.vue's own rule, restated here — D3).
let grid: KiraSlickGrid | null = null;
let eventHandler: SlickEventHandler | null = null;
let dataSource: ReturnType<typeof createGridDataSource> | null = null;
let viewportEl: HTMLElement | null = null;
// C9 — the grid root, set at mount for the insert region's own delegated listeners' teardown
// (below); `rootRef.value` is not used there since a template ref is not guaranteed to still
// point at the mounted element by the time `onUnmounted` runs (`viewportEl`'s own identical
// mount-time-capture pattern, just above, is why this follows it rather than `rootRef.value`).
let gridRootEl: HTMLElement | null = null;
// C4/§5 D0 rule 2 — never a ref/shallowRef/reactive, same as `grid` itself.
let selectionModel: SlickHybridSelectionModel | null = null;
// P22 postscript §14.2's "cell-editor dock panel is sometimes missing its header" investigation
// (below, onMounted) surfaced a real, adjacent bug while chasing it: SlickGrid never self-observes
// its own container's size (confirmed reading slick.grid.ts — no ResizeObserver anywhere in the
// library; `resizeCanvas()` is the caller's job entirely). This app never called it when the
// container's *own* size changed post-mount, only implicitly at construction — so opening/closing
// the cell-editor dock (a sibling flex item that shrinks `.grid-area`, CellEditorDock.vue) left the
// grid's internal `.slick-pane`/`.slick-viewport` elements at their stale, pre-shrink inline height,
// genuinely overlapping the dock panel now painted below and intercepting its own clicks — the
// concrete mechanism behind `cell-editor.spec.ts`'s pre-existing "Target page ... has been closed"
// timeouts (a `.grid-canvas` element, still full-height, sat on top of the dock's own controls).
let resizeObserver: ResizeObserver | null = null;
// D4's own one-shot flag, set by the header select zone immediately before it pushes ranges into
// the model — mirrors DataGrid.vue's own `dragProducedRange` shape.
let pendingSelectionKind: 'column' | null = null;
// Shift-range anchor for the header select zone's own click cycle — DataGrid.vue's own `colAnchor`
// ref, kept as a plain variable here since nothing renders from it.
let colAnchor: number | null = null;

// D11c's own cheap precheck's Set membership, cached across the whole meta lifetime — recomputed
// only where `rt()?.meta`'s own watch already rebuilds columns (rebuildAndSetColumns's own call
// site, below), never per cell or per hover.
let navColumns: NavColumns = navColumnsFor(null);
// C11/§5 D11b originally kept a single host-owned FK/PK nav button here (moved on hover) plus a
// `hoveredCell` tracker; superseded by item 12 (a later coordinator round) — see
// `placeNavButtonsForRenderedCells`' own comment — with a real button per nav-eligible rendered
// cell, always visible, no hover tracking left to own.

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
function computeSelEdgeHashes(
  selOverride?: Selection | null,
): [EdgeHash, EdgeHash, EdgeHash, EdgeHash] {
  const hashes: [EdgeHash, EdgeHash, EdgeHash, EdgeHash] = [{}, {}, {}, {}];
  if (!grid || !dataSource) return hashes;
  const sel = selOverride !== undefined ? selOverride : rt()?.selection;
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
      // Real-interaction fix (a later coordinator round, "row selection only shows a border on
      // the first cell") — this loop used to mark only the two edge COLUMNS (c=0, c=lastCol)
      // with selEdgeTop/selEdgeBottom, which is correct for a cell/range rectangle's own top/
      // bottom edge (only the two boundary columns' cells sit on that edge) but wrong for a row
      // selection: every column across the full row width sits on the row's own top/bottom
      // boundary, not just the two ends. Confirmed live: a gutter row-select's fill
      // (`kira-cell-selected`) already covered every cell correctly, but the perimeter's own
      // top/bottom box-shadow line only ever appeared on the leftmost and rightmost columns,
      // leaving a visible gap over every interior column — exactly the "only the first cell"
      // symptom. Every column now gets selEdgeTop/selEdgeBottom; selEdgeLeft/selEdgeRight stay
      // exclusive to column 0 / lastCol, same as before.
      for (let c = 0; c <= lastCol; c++) {
        mark(pos, c, {
          selEdgeLeft: c === 0,
          selEdgeRight: c === lastCol,
          selEdgeTop: isTop,
          selEdgeBottom: isBottom,
        });
      }
    }
  } else if (sel.kind === 'column') {
    const cols = new Set(sel.cols);
    // Display row count, not the page's own row count (same fix as onSelectAll/
    // onHeaderSelectClick's own `displayRowCount`, C12) — `pos` here is already a display
    // position (RowHandle.pos, from dataSource.getItem below), so comparing it against the
    // display-row bounds is correct with or without an active filter; comparing the underlying
    // *page* row against `pageRowCount - 1` was not — under a filter the last row actually
    // rendered can have a page-row index far short of `pageRowCount - 1` (or the filter can even
    // exclude the true first/last page row), so the bottom (and top) selection-perimeter line
    // would fail to draw at all.
    const displayRowCount = currentDisplayRows()?.length ?? getPage(props.tabId)?.rowCount ?? 0;
    for (let pos = start; pos <= end; pos++) {
      const isTop = pos === 0;
      const isBottom = pos === displayRowCount - 1;
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

function refreshSelEdges(selOverride?: Selection | null): void {
  if (!grid) return;
  const hashes = computeSelEdgeHashes(selOverride);
  SEL_EDGE_LAYER_KEYS.forEach((key, i) => {
    grid?.setCellCssStyles(key, hashes[i] as EdgeHash);
  });
}

// D4 (fix) — the drag-in-progress twin of the fill SlickGrid's own selection-model integration
// draws at commit (`this.setCellCssStyles(this._options.selectedCellCssClass, hash)`,
// `slick.grid.ts`'s own `selectedCellCssClass` handling — same layer key as the CSS class value
// itself, `'kira-cell-selected'`, reused here so a commit's own real write and this preview's own
// writes land on the identical `setCellCssStyles` layer and one replaces the other cleanly, never
// both existing at once). Bounded by the rendered range the same way the edge layer already is.
function computeCellFillHash(sel: Selection | null): EdgeHash {
  const hash: EdgeHash = {};
  if (!grid || !dataSource || !sel) return hash;
  const { start, end } = grid.lastRenderedRowBounds;
  if (end < start) return hash;
  const cls = 'kira-cell-selected';
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
      const row: Record<string, string> = {};
      for (let c = c0; c <= c1; c++) {
        const field = fieldAtDisplayCol(c);
        if (field) row[field] = cls;
      }
      hash[pos] = row;
    }
  }
  return hash;
}

// D4 (fix) — live visual feedback for a cell-range drag. SlickHybridSelectionModel's own
// `handleCellRangeSelected` intentionally no-ops for a CELL-mode `onCellRangeSelecting` call
// (only `onCellRangeSelected`, at drag end, calls `setSelectedRanges` — §4.1 item 3's own
// documented reasoning, but that reasoning is about the cell-editor dock's flicker specifically,
// never about the grid's own selection highlight); `dragToSelect: true` (needed for the gutter's
// own *row*-range drag — see its own branch below, which has no such early return and so already
// updates live) also zeroes the stock `SlickCellRangeDecorator`'s own border
// (`selectionCss: {border: 'none'}`), so nothing at all painted during a cell-range drag until
// mouseup — confirmed live with a real mousedown -> mousemove(x2) -> mouseup sequence, not a
// single programmatic selection call.
//
// This paints the SAME fill/edge layers the committed selection uses, from the drag's own
// in-progress `SlickRange` — via `selectionFromRanges`/`toPageRowSelection` (identical translation
// `onSelectedRangesChanged` itself uses) — but deliberately never touches `rt().selection` or the
// cell-editor dock: writing `rt().selection` on every drag tick is exactly what DataGrid.vue's own
// deleted `cellDragActive` flag existed to guard against (a drag passing back over its own anchor
// cell transiently looks like a completed one-cell selection, flashing the dock open and shut),
// and §4.1 item 3 is right that nothing needs it once `rt().selection` itself stays untouched until
// the real commit. The committed `onSelectedRangesChanged` handler (unchanged) supersedes every
// layer this writes the moment the drag actually ends.
function onCellRangeSelecting(_e: unknown, args: { range: SlickRange }): void {
  if (!selectionModel || selectionModel.currentSelectionModeIsRow()) return;
  const posSel = selectionFromRanges([args.range], false, null);
  const pageSel = posSel ? toPageRowSelection(posSel) : null;
  refreshSelEdges(pageSel);
  grid?.setCellCssStyles('kira-cell-selected', computeCellFillHash(pageSel));
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

// C12/§5 D5 — `kira-search`'s own row: "every match", not clipped to the rendered range the way
// `kira-sel-edges`/`kira-staged` are (a rectangle's perimeter, or a handful of staged rows, are
// cheap to re-walk on every render-band change; a search result is neither bounded that way, so
// this only recomputes when D5's own table says to — the result or current match changing, plus
// a live filter shifting every match's own display position, both watched below). T7 (§9.2) is
// this decision's own named gate: with 10 000 matches active, a selection change must still land
// inside the same 150ms sandbox bound this file's other cost gates use; D5 already names the
// fallback (a rendered-range ± hysteresis band) if it doesn't.
function computeSearchHashes(): [EdgeHash, EdgeHash] {
  if (!grid || !dataSource) return [{}, {}];
  const entry = searchState[props.tabId];
  if (!entry || entry.matches.length === 0) return [{}, {}];
  const p = getPage(props.tabId);
  if (!p) return [{}, {}];
  const orderSet = new Set(currentOrder());
  const idx = { displayRows: currentDisplayRows(), pageRowCount: p.rowCount };
  return searchCellLayers(
    entry.matches,
    entry.index,
    (col) => p.columns[col]?.name,
    (name) => orderSet.has(name),
    (row) => displayPositionOf(idx, row),
    classesFrom({ searchMatch: true })[0] ?? 'search-match',
    classesFrom({ searchMatchCurrent: true })[0] ?? 'search-match-current',
  );
}

function refreshSearchLayer(): void {
  if (!grid) return;
  const [matchHash, currentHash] = computeSearchHashes();
  grid.setCellCssStyles('kira-search', matchHash);
  grid.setCellCssStyles('kira-search-current', currentHash);
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
  // D11b originally re-placed a single hover-tracked button here; superseded (item 12, a later
  // coordinator round — see placeNavButtonsForRenderedCells' own comment) by an always-visible
  // button per nav-eligible rendered cell. Still called on every render for the identical reason
  // D11b's own comment gave: a render can rebuild the very cell node a button lives in
  // (`invalidateRow`), silently dropping it, so this has to re-scan rather than run once.
  placeNavButtonsForRenderedCells();
}

// `pos`/`cellIdx` are SlickGrid's own display position / column index (incl. the gutter at 0) —
// `getCellFromEvent`'s and `getActiveCell`'s own shape, not page-row/display-col (D7's own split);
// translated to the latter only here, at the one call site `rowValues.ts`'s `cellNavEntry` needs.
function navEntryAt(pos: number, cellIdx: number): CellNavEntry | null {
  if (!dataSource || cellIdx === 0) return null; // the gutter itself is never navigable
  const handle = dataSource.getItem(pos);
  if (handle.insertId !== undefined) return null; // D9's insert region has no real row to jump to
  return rvCellNavEntry(
    props.tabId,
    getPage(props.tabId),
    currentOrder(),
    rt()?.meta ?? null,
    tab()?.connectionId ?? null,
    currentDialect(),
    navColumns,
    handle.row,
    cellIdx - 1,
  );
}

// Deliberate redesign, not a bug fix (item 12, a later coordinator round): "make the PK/FK nav
// button always visible (not hover-only), and have it overlay on top of the cell's text... rather
// than reserving padding". Supersedes D11b's single host-owned, JS-moved-on-hover button —
// one real <button> per rendered nav-eligible cell instead, built once per cell and left in
// place (idempotent: a cell already carrying `.cell-nav-btn` is skipped) until its row is
// rebuilt, the same per-render-pass discipline `tagRenderedRows`' own `data-kira-row-tagged`
// idempotency already uses, and bounded the identical way that pass already is: the rendered
// window's rows × however many of this table's columns are nav-eligible, never the whole table.
// This is a deliberate departure from §4.1 item 5's own cost note (D11b's comment above used to
// cite it) — the trade this makes explicitly, at the user's own request: `cellNavEntry`'s real,
// row-value-dependent lookup (a referencedBy query, `navEntryAt` above) still only ever runs on
// click, never per render — this only needs the CHEAP, column-level precheck `cellFormatter`
// already classes every cell with (`.fk`/`.has-nav`) to pick which icon glyph to show, so it
// cannot know per-row whether a specific PK value actually has any referencing rows the way the
// old hover path's real `navEntryAt` call did before showing anything — a PK cell in a nav-
// eligible COLUMN always gets a button now, even on a row that turns out (only discoverable by
// clicking) to have no real referencing rows. Accepted trade for "always visible": the button
// still resolves and no-ops harmlessly on click in that case (`onGridClick` below, unchanged).
// A useful side effect, not the primary motivation: this also structurally removes the whole
// class of hover-driven append/remove flicker the old single-button design had (item 4, this same
// coordinator round) — there is no more DOM node being moved on hover at all.
function placeNavButtonsForRenderedCells(): void {
  const root = rootRef.value;
  if (!root) return;
  const cells = root.querySelectorAll<HTMLElement>('.grid-canvas-right .slick-cell.has-nav');
  for (const cellEl of cells) {
    if (cellEl.querySelector('.cell-nav-btn')) continue;
    const isFk = cellEl.classList.contains('fk');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cell-nav-btn';
    btn.dataset.testid = 'cell-nav-button';
    btn.dataset.navKind = isFk ? 'fk' : 'pk';
    btn.setAttribute('aria-label', isFk ? 'Go to referenced row' : 'Referenced by');
    const icon = document.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    icon.style.fontSize = '13px';
    icon.className = `codicon codicon-${isFk ? 'arrow-right' : 'references'}`;
    btn.appendChild(icon);
    cellEl.appendChild(btn);
  }
}

// F13 — a click on a `.cell-nav-btn` (a real child of whichever `.slick-cell` it lives in, one
// per nav-eligible rendered cell since item 12's redesign — placeNavButtonsForRenderedCells'
// own comment) resolves through SlickGrid's own `getCellFromEvent` exactly like any other cell
// click, so `args.row`/`args.cell` already name the right cell without this file tracking
// anything of its own; `stopImmediatePropagation` (checked by `handleClick` right after
// triggering `onClick`, `slick.grid.ts:4611-4614`) is what stops the click from *also* moving the
// active cell there.
function onGridClick(e: SlickEventData, args: OnClickEventArgs): void {
  if (!e.target?.closest('.cell-nav-btn')) return;
  e.stopImmediatePropagation();
  const entry = navEntryAt(args.row, args.cell);
  if (!entry) return;
  // D6: exactly one candidate navigates immediately; more than one opens the same ContextMenu
  // popup the right-click cell menu uses, anchored at the click — onCellNavClick's body, verbatim.
  if (entry.items.length === 1) {
    const only = entry.items[0];
    if (only?.type === 'item') void only.run();
    return;
  }
  openContextMenu(e.getNativeEvent<MouseEvent>(), entry.items);
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
  // D10 — the fresh-render half of the `data-sort` mirror; `syncSortIndicators`'s own direct
  // write (below) covers a plain sort change, which never rebuilds this header cell at all
  // (D2's own point: `setSortColumns` toggles SlickGrid's own indicator classes without a
  // `setColumns` rebuild) — this half only fires when a rebuild (a page reload, a meta/appearance
  // change) discards whatever this node already had and needs it set fresh.
  const sortTerm = currentSortTerms().find((t) => t.column === name);
  if (sortTerm) args.node.dataset.sort = sortTerm.direction;
  const p = getPage(props.tabId);
  const descriptor = p?.columns.find((c) => c.name === name);
  const label = keyLabelFor(descriptor, name, foreignKeyNamesFor(rt()?.meta ?? null));
  if (label) {
    const badge = document.createElement('span');
    badge.className = label === 'FK' ? 'header-key mono is-fk' : 'header-key mono';
    badge.textContent = label;
    args.node.appendChild(badge);
  }
  // Deliberate redesign, not the original port (items 9-11, a later coordinator round): "left-
  // click on a header's body selects that column instead of sorting", "right-click also selects
  // the column" (already true — onHeaderContextMenuHandler, below), and "sorting only happens via
  // a dedicated arrow control" on the right. §5 D4's own zone used to be a narrow 10px strip at
  // the cell's left edge, leaving the rest of the header body to SlickGrid's own native
  // handleHeaderClick/setupColumnSort (slick.grid.ts) — that native click-to-sort binding is
  // UNCHANGED (still reads `column.sortable`, still fires `grid.onSort`), but now it never
  // actually runs from a header-body click: the zone below covers the ENTIRE header cell
  // (`inset: 0`, not just a strip) and stops propagation before a body click can ever bubble up
  // to that delegated listener. The one thing still allowed to sort is the dedicated arrow button
  // built further down, whose own listener stops propagation before THIS zone's listener runs
  // (DOM order: the zone is a lower sibling in paint order via z-index, not later in the
  // listener chain, so both need their own stopPropagation independently).
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

  // Item 11's own dedicated sort control — SlickGrid always builds a `.slick-sort-indicator` div
  // per column regardless of sort state (F8's own comment, above), so this reuses that existing
  // node as the click target rather than adding a second element: it already sits at the header
  // cell's right edge (slickTheme.css's own margin/positioning, unchanged) and `setSortColumns`
  // already drives its `-asc`/`-desc` glyph classes on every sort change (syncSortIndicators) —
  // nothing about that display wiring changes, only that clicking it now also DOES something.
  // `slickTheme.css` gives it a small permanent width so it has a real hit target even at rest
  // (an inactive column's arrow is invisible — no glyph — but still clickable, the same "hidden
  // affordance" trade this whole redesign makes explicit).
  const sortIndicator = args.node.querySelector<HTMLElement>('.slick-sort-indicator');
  if (sortIndicator) {
    sortIndicator.dataset.testid = 'grid-header-sort';
    sortIndicator.setAttribute('role', 'button');
    sortIndicator.setAttribute('aria-label', `Sort by ${name}`);
    sortIndicator.tabIndex = 0;
    sortIndicator.addEventListener('click', (ev) => {
      ev.stopPropagation();
      cycleSortFor(name);
    });
  }
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
  // D10 — the direct-write half of the `data-sort` mirror (`onHeaderCellRendered`'s own comment
  // explains the split): `setSortColumns` only toggles the chevron's own CSS classes, never
  // rebuilds the header cell, so a plain sort change (no page reload) needs this file to write
  // the attribute itself rather than waiting for a render that isn't coming.
  for (const col of grid.getColumns()) {
    if (col.id === GUTTER_FIELD) continue;
    const node = grid.getHeaderColumn(col.id as string);
    if (!node) continue;
    const term = terms.find((t) => t.column === col.id);
    if (term) node.dataset.sort = term.direction;
    else delete node.dataset.sort;
  }
}

// Deliberate redesign, not the original port (items 9-11, a later coordinator round) — supersedes
// F8's own `onSort`/`grid.onSort` wiring. That handler translated SlickGrid's own NATIVE
// click-to-sort event (`tristateMultiColumnSort` + `multiColumnSort: false`'s own asc -> desc ->
// none cycle, fired from `setupColumnSort`'s delegated header-click listener, slick.grid.ts) into
// `setSort` — but a header body click no longer reaches that native listener at all
// (onHeaderCellRendered's own `header-select-zone` now covers the whole cell and stops
// propagation before it can bubble there), so `grid.onSort` can no longer fire from a click; the
// header context menu's own Sort asc/Sort desc/Clear sort items (menu.ts) already call `setSort`
// directly and were never routed through `onSort` either. This function is what the new dedicated
// sort-arrow control (onHeaderCellRendered, above) calls instead — the identical single-column
// asc -> desc -> none tristate cycle `onSort` used to derive from SlickGrid's own bookkeeping,
// computed here directly from `currentSortTerms()` (the same source `syncSortIndicators` already
// reads), so no SlickGrid-internal sort state needs to exist for this to work correctly.
function cycleSortFor(name: string): void {
  const current = currentSortTerms().find((t) => t.column === name);
  if (!current) {
    void setSort(props.tabId, { kind: 'structured', terms: [{ column: name, direction: 'asc' }] });
  } else if (current.direction === 'asc') {
    void setSort(props.tabId, { kind: 'structured', terms: [{ column: name, direction: 'desc' }] });
  } else {
    void setSort(props.tabId, null);
  }
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
  // Display row count, not the page's own row count — `SlickRange` below is position-space, and
  // the two only coincide when nothing is filtered (same fix as onHeaderSelectClick/
  // onHeaderContextMenuHandler's own `displayRowCount`, C12): under an active search filter this
  // used to run the range past the last actually-displayed row into the pending-insert-row
  // address space (`rowAtDisplayPosition` in dataSource.ts maps an out-of-range position to
  // `pageRowCount + (pos - count)`), producing spurious extra lines on copy.
  const displayRowCount = currentDisplayRows()?.length ?? getPage(props.tabId)?.rowCount ?? 0;
  const colCount = grid.getColumns().length - 1; // minus the gutter
  if (displayRowCount <= 0 || colCount <= 0) return;
  selectionModel.setSelectedRanges([new SlickRange(0, 1, displayRowCount - 1, colCount)]);
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

// Finding 1 (round 2) — `selectedCellCssClass: 'kira-cell-selected'` makes SlickGrid itself paint
// the highlight straight off `selectionModel`'s own `SlickRange[]`, which lives in DISPLAY-POSITION
// space and is only recomputed inside `setSelectedRanges` (slick.grid.ts). The filter-toggle watch
// below swaps the data source and re-renders, but a display-position range built under the OLD
// filter keeps pointing at whatever page row now happens to sit at that same position under the
// NEW one — the highlight can visibly land on the wrong row while `rt().selection` (page-row space,
// unaffected) still correctly targets the original one, so a subsequent Ctrl+C/Delete hits the
// right data while the highlight lies about it. Same defect class as ConsoleSlickGrid.vue's own
// finding-6 fix (its `refreshSelectionLayer`) — here the model owns the geometry, so the fix is to
// re-push freshly-translated ranges rather than repaint a CSS layer by hand.
//
// A row/corner that fell out of the new filter (`isRowVisible` — never `displayPositionOf`'s own
// nearest-match fallback, which would just as silently point the highlight at a neighboring row)
// drops out of a 'row' selection, or clears a 'cell'/'range' selection entirely (a 'range' whose
// anchor or focus row is no longer visible can't be re-expressed as one rectangle in the new
// space). 'column' selections need no row-visibility check — they already span every display row.
function refreshSelectionForFilterChange(): void {
  if (!grid || !selectionModel) return;
  const runtimeEntry = rt();
  const sel = runtimeEntry?.selection ?? null;
  if (!sel) return;
  const idx = {
    displayRows: currentDisplayRows(),
    pageRowCount: getPage(props.tabId)?.rowCount ?? 0,
  };

  let visibleSel: Selection | null;
  switch (sel.kind) {
    case 'cell':
      visibleSel = isRowVisible(idx, sel.row) ? sel : null;
      break;
    case 'range':
      visibleSel = isRowVisible(idx, sel.anchorRow) && isRowVisible(idx, sel.row) ? sel : null;
      break;
    case 'row': {
      const rows = sel.rows.filter((row) => isRowVisible(idx, row));
      visibleSel = rows.length > 0 ? { kind: 'row', rows } : null;
      break;
    }
    default:
      visibleSel = sel;
  }

  const displayRowCount = currentDisplayRows()?.length ?? getPage(props.tabId)?.rowCount ?? 0;
  const colCount = grid.getColumns().length - 1; // minus the gutter
  pendingSelectionKind = visibleSel?.kind === 'column' ? 'column' : null;
  // `setSelectedRanges([])`/`setSelectedRanges(ranges)` both fire `onSelectedRangesChanged`
  // (below), which re-derives `rt().selection` from the ranges just pushed and refreshes the
  // perimeter-fill layer — no need to assign `runtimeEntry.selection` or call `refreshSelEdges`
  // here too, only to push the geometry.
  selectionModel.setSelectedRanges(
    visibleSel
      ? rangesFromSelection(toPositionSelection(visibleSel), displayRowCount, colCount)
      : [],
  );
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

// C9/§5 D9 — one delegated listener each on the grid root for the insert region's own `<input>`s
// (`cellFormatter`'s insert branch, above), rather than a per-element listener: the same
// delegation discipline `-iter2-pacing` established for everything else, applied to the one place
// this pass adds DOM. `data-column` already exists on the cell (`cellAttrs`, D2 — a per-column
// constant, unrelated to this row being an insert) and `data-insert-id` on the row
// (`tagRenderedRows`), so no extra data attribute needs baking onto the input itself beyond the
// testid this scopes the delegation to.
function insertInputTarget(
  e: Event,
): { insertId: string; column: string; input: HTMLInputElement } | null {
  const input = e.target;
  if (!(input instanceof HTMLInputElement) || input.dataset.testid !== 'grid-cell-insert-input') {
    return null;
  }
  const insertId = input.closest<HTMLElement>('[data-insert-id]')?.dataset.insertId;
  const column = input.closest<HTMLElement>('.slick-cell[data-column]')?.dataset.column;
  return insertId && column ? { insertId, column, input } : null;
}

function onInsertGridInput(e: Event): void {
  const hit = insertInputTarget(e);
  if (!hit) return;
  stageInsertValue(props.tabId, hit.insertId, hit.column, hit.input.value);
}

function onInsertGridKeydown(e: KeyboardEvent): void {
  if (!insertInputTarget(e)) return;
  wrapSelectionOnType(e);
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
    // Finding 3 (round 2): only the rows actually visible under the current filter within the
    // span, same rule P24 D10 already applies to the column-selection branch below — a range
    // used to copy every page row between its two corners even while the filter hid some of them.
    const cols = Array.from({ length: sel.col - sel.anchorCol + 1 }, (_, i) => sel.anchorCol + i);
    void copyText(
      columnsToTsv(
        visibleRowsInSpan(currentDisplayRows(), sel.anchorRow, sel.row),
        cols,
        displayCell,
      ),
    );
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

  // Finding 3 (round 2) — a `range`-kind paste used to write to `startRow + ri`, a raw contiguous
  // walk that ignores the active filter (a 'cell'-kind paste anchors on one already-visible row
  // and only ever grows downward from it, so it's unaffected; 'row'-kind pastes the user's own
  // explicit gutter-click rows, never a span). `pasteTargetRows` walks only the rows the filter
  // still shows, continuing into the pending-insert region (never filtered) once it runs out.
  const rangeTargetRows =
    sel.kind === 'range'
      ? pasteTargetRows(currentDisplayRows(), p.rowCount, startRow, parsed.length)
      : null;

  for (let ri = 0; ri < parsed.length; ri++) {
    const row = rangeTargetRows ? rangeTargetRows[ri] : startRow + ri;
    if (row === undefined || row < 0) continue;
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

  // C9/§5 D9 rule 1 — a paste landing on an *existing* staged insert row updates its `values` in
  // place via `stageInsertValue`, which never changes `inserts.length` and so never reaches the
  // insert-count watch below; that row's own `<input>` would otherwise keep showing its
  // pre-paste text forever. This is exactly D9's own "the change came from outside the grid"
  // case (a paste, not a keystroke into that row's own input), so invalidating it here is safe —
  // nothing about a paste could be holding focus inside the very input being overwritten.
  // `dataSource.setState` covers the one edge case rebuilding wouldn't otherwise reach until the
  // insert-count watch's own next tick: the tab's *first* ever insert, created moments ago by
  // `addInsertRow` above, whose `state.inserts` this closure captured as a plain `[]` before that
  // row's tab-scoped `TabPending` (and its own real, reactive `inserts` array) existed at all.
  if (insertIds.size > 0 && grid && dataSource) {
    dataSource.setState(dataSourceState(p, currentOrder()));
    grid.updateRowCount();
    const idx = { displayRows: currentDisplayRows(), pageRowCount: p.rowCount };
    for (const row of insertIds.keys()) grid.invalidateRow(displayPositionOf(idx, row));
    grid.render();
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
    // Finding 3 (round 2) — only the rows actually visible under the current filter within the
    // span, same rule the copy branch above now applies: a range used to stage every page row
    // between its two corners for deletion, hidden ones included.
    const rows =
      cellOrRangeSel.kind === 'range'
        ? visibleRowsInSpan(currentDisplayRows(), cellOrRangeSel.anchorRow, cellOrRangeSel.row)
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
  gridRootEl = el;

  const t = tab();
  const p = getPage(props.tabId);
  const order = p ? resolveColumnOrder(p, t?.state.columnOrder ?? null) : [];
  formatterCtx.rowNumberBase = t ? t.state.pageIndex * t.state.pageSize : 0;
  // C11/§5 D11c — meta may already be loaded by mount time (a reopened tab); the `rt()?.meta`
  // watch (below) only fires on a *change*, so the first value needs setting here too.
  navColumns = navColumnsFor(rt()?.meta ?? null);

  dataSource = createGridDataSource(dataSourceState(p, order));

  // Real-interaction fix (§5 D8's own header-height gap, found chasing the header interaction
  // issues, not the original port): slickTheme.css's own `.slick-header-column` rule reads this
  // custom property for its `height`/`line-height` — set here (mount) and in the `rowHeight` watch
  // below (density changing later) so the header row tracks the same 28px/22px toggle the body
  // rows do, matching the incumbent's own `.header-row`'s `:style="{height: rowHeight+'px'}"`.
  // Set on `el` itself (the mount SlickGrid builds its own DOM inside) — ordinary CSS custom-
  // property inheritance carries it down to every header column, wherever in that subtree it ends
  // up.
  el.style.setProperty('--kira-header-row-height', `${rowHeight.value}px`);

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
  // No grid.onSort subscription any more — see cycleSortFor's own comment: a header body click
  // can no longer reach SlickGrid's native click-to-sort handler at all (items 9-11), so that
  // event never fires from a click, and the header context menu's own sort items already call
  // `setSort` directly without going through it either.
  eventHandler.subscribe(grid.onHeaderClick, onHeaderClick);
  eventHandler.subscribe(grid.onContextMenu, onGridContextMenu);
  eventHandler.subscribe(grid.onHeaderContextMenu, onGridHeaderContextMenu);
  eventHandler.subscribe(grid.onColumnsResized, onColumnsResized);
  eventHandler.subscribe(grid.onKeyDown, onKeydown);
  eventHandler.subscribe(grid.onBeforeEditCell, onBeforeEditCell);
  eventHandler.subscribe(grid.onClick, onGridClick);
  eventHandler.subscribe(selectionModel.onSelectedRangesChanged, onSelectedRangesChanged);
  const cellRangeSelector = selectionModel.getCellRangeSelector();
  if (cellRangeSelector) {
    eventHandler.subscribe(cellRangeSelector.onCellRangeSelecting, onCellRangeSelecting);
  }

  // P22 postscript §14.2's two "reported but not reproduced" dock/badge symptoms, root-caused
  // together: `new KiraSlickGrid(...)` above runs synchronously through slick.grid.ts's own
  // `initialize()` -> `finishInitialization()` -> `createColumnHeaders()` (since
  // `explicitInitialization: false`) — i.e. it fires `grid.onHeaderCellRendered` for the FIRST,
  // constructor-built set of header cells *before this file's own `eventHandler.subscribe(grid.
  // onHeaderCellRendered, onHeaderCellRendered)` above has even run* (subscribing needs a `grid`
  // instance to subscribe *to*, so it can only happen after the constructor call that already
  // fired the event). Every DOM addition `onHeaderCellRendered` is responsible for — the PK/FK
  // `.header-key` badge, the `.header-select-zone` click target, the `data-testid`/tooltip
  // attributes the header context menu and this file's own header-click handlers key off — is
  // silently missing from that first build. On a table's first-ever open this goes unnoticed:
  // `rt()?.meta`'s own watch (below) fires moments later, once the async `treeDescribe` resolves
  // (meta genuinely changes from unset), and its own `rebuildAndSetColumns()` call rebuilds every
  // header a second time — this time with the listener attached — papering over the gap. It stops
  // being invisible the moment a tab's `meta` is already cached in its runtime record before this
  // component (re)mounts (state.ts: meta survives a tab switch, cleared only when the tab actually
  // closes) — the *only* case that describes: reopening/switching back to an already-visited tab.
  // Then `rt()?.meta` never changes post-mount, that watch never fires, and the constructor's own
  // listener-less header build is the only one that ever runs — every header stays missing its
  // badge and its select zone for that mount's entire life. This is why the migration's own
  // "close tab, reopen" repro attempts never caught it (closing clears the runtime record, so a
  // reopen re-fetches meta and re-triggers the same rebuild that masks the bug on a first visit) —
  // a plain tab *switch*, not a close, is what exposes it, exactly as originally reported ("PK/FK
  // header badges disappear after switching a tab away and back"). Confirmed live, this session:
  // `.header-select-zone`'s own count went from 1 (fresh mount) to 0 (switch away to a second
  // table, then back) — the same missing element `cell-editor.spec.ts`'s "Target page ... has been
  // closed" timeouts trace back to (clicking a header control that plain doesn't exist yet).
  // Fixed the same way the meta/appearance/columnWidths watches below already fix a *later*
  // change of the same kind: force one more header rebuild, through the now-subscribed listener,
  // unconditionally on every mount — cheap (`rebuildAndSetColumns` is already this file's own
  // steady-state answer to "columns need rebuilding") and idempotent if the meta watch does also
  // fire moments later.
  rebuildAndSetColumns();

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
  // C12 — a tab switch (not a fresh connect) can remount this host onto a tab that already has a
  // completed search from before it was last hidden; searchState isn't cleared until the tab
  // itself closes (registerTabRuntimeCleanup), so this needs the same initial sync `onMounted`
  // already gives every other CSS layer via its own grid.render() call, above.
  refreshSearchLayer();

  if (viewportEl) {
    scrollTrace.registerGrid(viewportEl, '.slick-row');
    viewportEl.addEventListener('scroll', onViewportScroll, { passive: true });
    viewportEl.addEventListener('scroll', onViewportScrollPersist, { passive: true });
  }

  // C9/§5 D9 — the insert region's own delegated listeners, on the grid root rather than the
  // viewport (an insert row's `<input>` needs `keydown` regardless of scroll position, and `el`
  // is stable across a reload the way `viewportEl` — reassigned from `grid.getViewports()` — is
  // not).
  el.addEventListener('input', onInsertGridInput);
  el.addEventListener('keydown', onInsertGridKeydown);

  // See `resizeObserver`'s own declaration for why this exists. `el` (`.slick-grid-mount`) is
  // exactly the container SlickGrid measures itself against (`getViewportHeight`/`getViewportWidth`,
  // `resizeCanvas` — slick.grid.ts), so observing it directly, rather than `.grid-area` a level up,
  // needs no extra plumbing to find the right element. `resizeCanvas()` itself is cheap to call
  // unconditionally (a real height/width remeasure plus one render pass) and is guarded by SlickGrid
  // itself (`!this.initialized` returns immediately) — no debounce needed for a ResizeObserver
  // callback, which already coalesces synchronous layout thrash into one notification per frame.
  resizeObserver = new ResizeObserver(() => {
    grid?.resizeCanvas();
  });
  resizeObserver.observe(el);
});

onUnmounted(() => {
  // Order matters (§6 D3): stop everything that could still fire into a half-torn-down grid before
  // tearing it down.
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
  if (viewportEl) {
    viewportEl.removeEventListener('scroll', onViewportScroll);
    viewportEl.removeEventListener('scroll', onViewportScrollPersist);
    scrollTrace.unregisterGrid(viewportEl);
  }
  gridRootEl?.removeEventListener('input', onInsertGridInput);
  gridRootEl?.removeEventListener('keydown', onInsertGridKeydown);
  gridRootEl = null;
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
  // Finding 7 (round 2) — `editorCtx` (editor.ts) is a module-level singleton; this mount's own
  // closures (§5 D8, above) stay assigned to it after teardown otherwise, retained for nothing —
  // bounded (the next grid to mount overwrites both before a `KiraCellEditor` it constructs could
  // ever call either), but reset explicitly rather than leave a stale closure hanging off a
  // singleton once the last data tab closes.
  editorCtx.readValue = () => ({ text: '', isNull: true });
  editorCtx.commit = () => {};
});

watch(
  () => pageVersion.n,
  () => {
    if (!grid || !dataSource) return;
    const p = getPage(props.tabId);
    const t = tab();
    const order = p ? resolveColumnOrder(p, t?.state.columnOrder ?? null) : [];
    formatterCtx.rowNumberBase = t ? t.state.pageIndex * t.state.pageSize : 0;
    dataSource.setState(dataSourceState(p, order));
    grid.setColumns(buildColumns(p, order, currentWidths(), rt()?.meta ?? null));
    grid.updateRowCount();
    grid.invalidateAllRows();
    // C5 — the rendered band's own numbers can coincidentally match the pre-reload band (a page
    // reload commonly lands back at scrollTop 0), which would fool onGridRendered's own
    // band-change check into skipping a refresh a genuinely new page needs. The sentinel forces it.
    lastCssLayerBand = { start: 0, end: -1 };
    grid.render();
    syncSortIndicators();
    refreshSearchLayer();
  },
);

// C12/§5 D12 — the filter *is* the data source: `matchedRows(tabId)` (via `currentDisplayRows()`,
// already what `dataSourceState()`'s own `index.displayRows` reads) tracks both the search
// toolbar's own scan result and its "filter to matches" toggle reactively (both read a reactive
// `searchState`/`searchFilterState` entry internally), so this watch's getter needs nothing of
// its own beyond calling the same function every other read site already uses.
// `getLength`/`getItem` already do the rest (`dataSource.ts`) once the state is swapped in — the
// same three-call shape the `pageVersion` watch above uses for a full reload, minus rebuilding
// columns (a filter never changes which columns exist, only which rows do). Match positions shift
// under a live filter exactly like selection/staged positions do, so `kira-search` needs its own
// explicit refresh here too — unlike those two, it is not band-scoped, so `onGridRendered`'s own
// band-change check (which the `lastCssLayerBand` sentinel forces below) would never catch it.
watch(
  () => currentDisplayRows(),
  () => {
    if (!grid || !dataSource) return;
    const p = getPage(props.tabId);
    dataSource.setState(dataSourceState(p, currentOrder()));
    grid.updateRowCount();
    grid.invalidateAllRows();
    lastCssLayerBand = { start: 0, end: -1 };
    grid.render();
    refreshSearchLayer();
    // Finding 1 (round 2) — the selection model's own display-position ranges go stale the
    // instant the filter renumbers rows; re-push them (or clear) before anything else reads
    // `rt().selection`/the CSS-painted highlight against the new display space.
    refreshSelectionForFilterChange();
  },
);

// C12/§5 D5 — `kira-search`'s own trigger: a scan publishing a new/updated result, or goNext/
// goPrev moving the current match. The signature is result identity + current index + pending,
// not the matches themselves — rebuilding the whole hash is `computeSearchHashes`' own job once
// this fires, not this getter's.
watch(
  () => {
    const entry = searchState[props.tabId];
    return entry ? `${entry.matches.length}:${entry.index}:${entry.pending ? 1 : 0}` : '';
  },
  () => refreshSearchLayer(),
);

// C9/§5 D9 — an insert row's own count changes independent of `pageVersion` (Add Row, a discard,
// a bulk paste past the loaded page's end, `duplicateAsInsert`), so this needs its own trigger.
// Safe to fully invalidate the touched region unconditionally: `stageInsertValue` (every keystroke
// into an insert's own input) mutates only that insert's `values` in place, never `p.inserts`
// itself, so this watch never fires mid-typing — the only thing that CAN change `inserts.length`
// is a user action outside any insert row's own input (a toolbar click, a menu item), so the
// "never invalidate a focused insert row" rule (D9) has nothing to protect against on this path.
let lastInsertCount = 0;
watch(
  () => pendingFor(props.tabId)?.inserts.length ?? 0,
  (count) => {
    if (!grid || !dataSource) return;
    const p = getPage(props.tabId);
    dataSource.setState(dataSourceState(p, currentOrder()));
    grid.updateRowCount();
    const base = currentDisplayRows()?.length ?? p?.rowCount ?? 0;
    const end = base + Math.max(count, lastInsertCount) - 1;
    lastInsertCount = count;
    for (let pos = base; pos <= end; pos++) grid.invalidateRow(pos);
    grid.render();
  },
);

watch(rowHeight, (h) => {
  if (!grid) return;
  rootRef.value?.style.setProperty('--kira-header-row-height', `${h}px`);
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

// P22 Pass B, C14 — DataGrid.vue's own `selectionTarget()`/publish watch (its own comment: "the
// cell editor's target"), ported: `onSelectedRangesChanged`/`onGridActiveCellChanged` above already
// keep `rt().selection` current for the grid's own visual selection layer, but never told the cell
// editor dock (`state/cellSelection.ts`) what's selected — a gap this migration left open, not a
// deliberate omission (nothing DataGrid.vue-specific in the logic below; it was simply never
// carried over when this host's own selection wiring was built at C4). `selectionTarget()` reads
// only `rt()?.selection`, which both engines populate identically, so it ports unchanged.
function selectionTarget(): { row: number; col: number } | null {
  const sel = rt()?.selection;
  if (!sel) return null;
  if (sel.kind === 'cell') return { row: sel.row, col: sel.col };
  if (sel.kind === 'range' && sel.anchorRow === sel.row && sel.anchorCol === sel.col) {
    return { row: sel.row, col: sel.col };
  }
  return null;
}
watch(
  [() => rt()?.selection, () => pageVersion.n, () => props.tabId],
  () => {
    const p = getPage(props.tabId);
    const t = tab();
    const target = selectionTarget();
    if (!p || !t || !target || target.row < 0 || target.row >= p.rowCount) {
      clearSelectedCellFor(props.tabId);
      return;
    }
    const order = currentOrder();
    const pageCol = pageColumnIndexFor(p, order, target.col);
    if (pageCol < 0) {
      clearSelectedCellFor(props.tabId);
      return;
    }
    const view = displayCell(target.row, target.col);
    const column = p.columns[pageCol];
    if (!column) {
      clearSelectedCellFor(props.tabId);
      return;
    }
    const targetRow = target.row;
    const selected: SelectedCell = {
      tabId: props.tabId,
      connectionId: t.connectionId,
      path: t.path,
      columnIndex: pageCol,
      column,
      row: targetRow,
      value: view.isNull ? null : view.text,
      truncated: view.truncated,
      hasPrimaryKey: hasPrimaryKey(),
      // Same eligibility as the grid's own inline (double-click) edit (D8/C8): writable connection,
      // a primary key to identify the row, and the row isn't already staged for delete. Stages into
      // the exact same pending-change set the inline editor already feeds, so the panel's save and
      // the grid's own inline edit can never disagree about a cell's value.
      onEdit:
        canEditTable() && !isDeleted(targetRow)
          ? (newValue: string) => stageEdit(props.tabId, targetRow, column.name, newValue)
          : undefined,
      onRevert:
        canEditTable() && !isDeleted(targetRow)
          ? () => discardCellEdit(props.tabId, targetRow, column.name)
          : undefined,
    };
    publishSelectedCell(selected);
  },
  { immediate: true },
);

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
// `flush: 'sync'` (not the default 'pre') is load-bearing for the echo guard: `patchDataTabState`
// mutates reactive state synchronously inside onColumnsResized's `suppressWidthEcho = true; ...;
// suppressWidthEcho = false` bracket, but a default-flush watcher runs on Vue's next pre-render
// microtask — strictly after that synchronous reset — so `suppressWidthEcho` always reads back
// `false` by the time this callback runs. That made the guard a no-op: every column-resize drag
// rebuilt the whole grid (setColumns, header/CSS rebuild, resizeCanvas, closing any open inline
// editor) on every echoed width patch. Sync flush runs this callback from inside that same
// Object.assign, while the flag is still `true`.
watch(
  () => tab()?.state.columnWidths,
  () => {
    if (suppressWidthEcho) return;
    rebuildAndSetColumns();
    grid?.render();
  },
  { flush: 'sync' },
);
watch(
  () => rt()?.meta,
  () => {
    // C11/§5 D11c — the cheap precheck's own Set membership, recomputed exactly on a meta change
    // and nowhere else (not per cell, not per hover): `navColumnsFor` is a plain function, so this
    // is the one place that needs to call it, not `rebuildAndSetColumns` itself (also called by
    // the appearance/columnWidths watches below, neither of which changes what's navigable).
    navColumns = navColumnsFor(rt()?.meta ?? null);
    rebuildAndSetColumns();
    grid?.render();
  },
);

// C8/§5 D8 addendum, extended at C10 for `p.deletes`: every row this watch has ever seen staged
// (edited OR marked for delete), so a discard (which clears `p.edits`/`p.deletes` entirely,
// outside any SlickGrid commit path) knows which *previously* staged rows must be invalidated
// back to their real page value/rails, not only the newly-staged ones a plain diff against the
// current map/set would catch.
let lastPendingRows = new Set<number>();

// C5/§5 D5 — the `kira-staged` layer's own trigger: a cell staged or un-staged. C10 extends the
// same watch to `p.deletes` too (§4 item 18's own "the pending-changes watch's invalidateRows
// set"), since `pendingRowClasses`' rail/strike-through classes need the same re-render a staged
// edit already gets — one watch, not two, since both `p.edits` and `p.deletes` land on the same
// row-invalidation need and `toggleDelete` already keeps them mutually exclusive per row.
// `pendingFor(tabId)?.edits`/`.deletes` are a reactive Map/Set (pendingChanges.ts's own
// `pendingState`, a Vue `reactive()`), so both track reactively without a reference-identity trap
// the way the TabPending object itself would be (created once per tab, mutated in place, never
// reassigned). The signature is row -> staged *column count* / delete flag, not values:
// refreshStagedLayer only needs to know *which* cells are staged, never what they hold, so a
// same-column value edit (no key added/removed) correctly does not re-trigger this.
watch(
  () => {
    const p = pendingFor(props.tabId);
    if (!p) return '';
    let sig = '';
    for (const [row, edit] of p.edits) sig += `e${row}:${Object.keys(edit.changes).length};`;
    for (const row of p.deletes) sig += `d${row};`;
    return sig;
  },
  () => {
    refreshStagedLayer();
    // C8 — `dataItemColumnValueExtractor` already merges `stagedValue` over the page (D1), so a
    // committed *edit* renders correctly for free (SlickGrid's own `commitCurrentEdit` calls
    // `updateRow` after `applyValue`, `slick.grid.ts:4136`). Nothing calls that for a *discard*,
    // a delete toggle, or a commit's own reload-free path, though — those all change
    // `pendingRowClasses`' own answer for a row from outside any SlickGrid edit-commit path, so
    // without this the row keeps showing its stale rails/strike-through/text until something else
    // happens to re-render it. Invalidate the union of this row's newly- and previously-staged
    // state (not just the new set — a discard's new set is empty) and re-render.
    if (!grid || !dataSource) return;
    const p = pendingFor(props.tabId);
    const rows = new Set<number>();
    if (p) {
      for (const row of p.edits.keys()) rows.add(row);
      for (const row of p.deletes) rows.add(row);
    }
    const touched = new Set<number>([...lastPendingRows, ...rows]);
    lastPendingRows = rows;
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
  // index, `col` a *display* column index. SlickGrid's own scrollCellIntoView wants its own
  // display *position* and a column index that accounts for the frozen gutter occupying slot 0.
  // C12/§5 D12 — the real translation Pass A's own comment here said a live filter would need:
  // `displayPositionOf` collapses to identity while nothing is filtered (unchanged behaviour for
  // the common case) and only actually shifts anything once C12's own filter watch can make
  // page row and display position diverge.
  scrollCellIntoView(row: number, col: number): void {
    if (!grid) return;
    const idx = {
      displayRows: currentDisplayRows(),
      pageRowCount: getPage(props.tabId)?.rowCount ?? 0,
    };
    grid.scrollCellIntoView(displayPositionOf(idx, row), col + 1);
  },
});
</script>

<template>
  <!-- C13/§5 D13 — the outer div is now the empty-states' own positioning context
       (`.no-rows { position: absolute; inset: 0 }`, slickTheme.css) and `data-testid="data-grid"`'s
       new home; `rootRef` moves to the inner `.slick-grid-mount`, the one div SlickGrid itself ever
       touches, so an empty state overlaying it can never be wiped out by SlickGrid's own DOM writes
       the way a *child* of `rootRef` would be. §6 D6 point 1: the P9 rowColoring setting is one
       class toggle on the host root — Vue's own reactivity on this binding (not a watch) is what
       keeps it live, since settingsState is a reactive object and this is the template's own
       ordinary :class binding. -->
  <div
    class="slick-grid-host"
    data-testid="data-grid"
    :class="{ 'kira-grid--row-coloring': settingsState.appearance.rowColoring }"
  >
    <div ref="rootRef" class="slick-grid-mount"></div>
    <EmptyState
      v-if="showNoRows"
      class="no-rows"
      icon="table"
      label="No rows"
      data-testid="grid-no-rows"
    />
    <EmptyState
      v-else-if="showNoMatchingRows"
      class="no-rows"
      icon="search"
      label="No matching rows"
      data-testid="grid-no-matching-rows"
    >
      <AppButton data-testid="grid-show-all-rows" @click="setSearchFiltering(props.tabId, false)">
        Show all rows
      </AppButton>
    </EmptyState>
  </div>
</template>
