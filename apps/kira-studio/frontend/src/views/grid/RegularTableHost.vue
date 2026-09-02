<script setup lang="ts">
import { decodePath } from '@shared/domain/tree';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { copyText } from '../../clipboard';
import {
  clearSelectedCellFor,
  publishSelectedCell,
  type SelectedCell,
} from '../../state/cellSelection';
import { connectionRecord } from '../../state/connections';
import { openContextMenu } from '../../state/contextMenu';
import { appearanceVersion, settingsState } from '../../state/settings';
import { findDataTab, patchDataTabState } from '../../state/tabs';
import { typeClassColor } from '../../theme/icons';
import {
  alignmentFor,
  DEFAULT_COLUMN_WIDTH,
  initialWidths,
  pageColumnIndexFor,
  resetMeasureCtx,
  resolveColumnOrder,
} from '../shared/page/columns';
import { createMatchIndex } from '../shared/page/search';
import { setVisibleRows } from '../shared/page/visibleRows';
import { sqlDialectFor } from '../shared/sqlIdent';
import { columnsToTsv, type RowSnapshot, rangeToTsv, rowsToTsv } from './clipboardFormats';
import { cellMenu, headerMenu, rowMenu } from './menu';
import { cell, getPage, pageVersion, setVisibleWindow } from './page';
import { isPendingDelete, pendingFor } from './pendingChanges';
import { columnSizeOverrides, createDataListener } from './regular/dataSource';
import { KIRA_REGULAR_TABLE_TAG, type KiraRegularTable } from './regular/element';
import {
  buildSnapshot,
  displayPositionOf,
  EMPTY_SNAPSHOT,
  type GridSnapshot,
  rowAtDisplayPosition,
  valueAt,
} from './regular/snapshot';
import * as scrollTrace from './scrollTrace';
import { matchedRows, searchState } from './search';
import { runtime } from './state';

// P22 regular-table spike — the Vue host for `<kira-regular-table>`, on the shape
// editor/CodeMirrorHost.vue established for wrapping an imperative library: Vue owns the mount
// point, the props and the teardown; the library owns everything inside it, and nothing the
// library can reach is ever a `ref`/`reactive` (docs/ARCHITECTURE.md's "no Vue reactivity on row
// data"). Reached only via `window.__kiraGridEngine = 'regular'` (DataView.vue) — DataGrid.vue is
// untouched and stays the default.
//
// See docs/v1.1/plans/P22-regular-table-spike.md for what is wired, what is deliberately not, and
// the real-Mac A/B protocol this host's scrollTrace wiring exists to serve.
const props = defineProps<{ tabId: string }>();

// ---------------------------------------------------------------------------------------------
// Non-reactive render state. Read inside regular-table's own render pass (the `DataListener` and
// the style pass), where touching a Vue proxy could re-enter the render — the seam the SlickGrid
// plan's §6 D1 states as a rule precisely because it is invisible at the call site.
// ---------------------------------------------------------------------------------------------

interface Decoration {
  selection: NonNullable<(typeof runtime)[string]>['selection'] | undefined;
  edits: ReadonlySet<number>;
  deletes: ReadonlySet<number>;
  fkColumns: ReadonlySet<string>;
  matches: {
    has(row: number, col: number): boolean;
    isCurrent(row: number, col: number): boolean;
  } | null;
}

const EMPTY_DECORATION: Decoration = Object.freeze({
  selection: undefined,
  edits: new Set<number>(),
  deletes: new Set<number>(),
  fkColumns: new Set<string>(),
  matches: null,
});

const rootRef = ref<HTMLElement | null>(null);
let table: KiraRegularTable | null = null;
let snapshot: GridSnapshot = EMPTY_SNAPSHOT;
let decoration: Decoration = EMPTY_DECORATION;
/** The band actually committed to the DOM, in display positions — set by the style pass. */
let renderedBand = { first: 0, last: -1, rows: 0 };

// ---------------------------------------------------------------------------------------------
// Reactive inputs. Every one of these is resolved *out* of Vue into `snapshot`/`decoration`.
// ---------------------------------------------------------------------------------------------

const rowHeight = computed(() => (settingsState.appearance.rowDensity === 'compact' ? 22 : 28));

function tab() {
  return findDataTab(props.tabId);
}
function rt() {
  return runtime[props.tabId];
}

const page = computed(() => {
  void pageVersion.n;
  return getPage(props.tabId);
});

const columnOrder = computed<string[]>(() => {
  const p = page.value;
  return p ? resolveColumnOrder(p, tab()?.state.columnOrder ?? null) : [];
});

watch(
  () => appearanceVersion.n,
  () => resetMeasureCtx(),
);

const widths = computed<Record<string, number>>(() => {
  void appearanceVersion.n;
  const p = page.value;
  if (!p) return {};
  const stored = tab()?.state.columnWidths ?? {};
  const measured = initialWidths(p);
  const out: Record<string, number> = {};
  for (const name of columnOrder.value)
    out[name] = stored[name] ?? measured[name] ?? DEFAULT_COLUMN_WIDTH;
  return out;
});

const displayRows = computed<number[] | null>(() => matchedRows(props.tabId));

const rowNumberBase = computed(() => {
  const t = tab();
  return t ? t.state.pageIndex * t.state.pageSize : 0;
});

const hasPrimaryKey = computed(() => page.value?.columns.some((c) => c.isPrimaryKey) ?? false);

const foreignKeyColumnNames = computed(() => {
  const names = new Set<string>();
  for (const fk of rt()?.meta?.foreignKeys ?? []) {
    for (const c of fk.columns) names.add(c);
  }
  return names;
});

const typeColors = computed(() => {
  const map = new Map<string, string>();
  if (!settingsState.appearance.rowColoring) return map;
  for (const c of page.value?.columns ?? []) map.set(c.name, typeClassColor(c.typeClass));
  return map;
});

const dialect = computed(() => sqlDialectFor(connectionRecord(tab()?.connectionId)?.kind));

const matchIndex = createMatchIndex(searchState, () => props.tabId);

// P36 D26 mirrored: this spike renders no inline editor and no pending-insert rows, so it
// declares itself non-editable — `cellMenu`'s Edit / Set NULL / Paste come up disabled rather
// than half-working. Deleting rows *is* fully wired (a `pendingChanges` call plus a row class),
// and so is the cell-editor dock, which DataView.vue mounts outside this component and which this
// host feeds through `publishSelectedCell` exactly as DataGrid.vue does.
const canDeleteRows = computed(() => {
  const t = tab();
  if (!t?.connectionId || connectionRecord(t.connectionId)?.readOnly) return false;
  return hasPrimaryKey.value && !!page.value;
});

function rebuildSnapshot(): void {
  const colors = typeColors.value;
  snapshot = buildSnapshot({
    tabId: props.tabId,
    page: page.value,
    columnOrder: columnOrder.value,
    displayRows: displayRows.value,
    rowNumberBase: rowNumberBase.value,
    rowHeight: rowHeight.value,
    colorForColumn: (name) => colors.get(name) ?? '',
    alignmentFor,
  });
}

function rebuildDecoration(): void {
  const pending = pendingFor(props.tabId);
  decoration = {
    selection: rt()?.selection,
    edits: pending ? new Set(pending.edits.keys()) : EMPTY_DECORATION.edits,
    deletes: pending ? new Set(pending.deletes) : EMPTY_DECORATION.deletes,
    fkColumns: foreignKeyColumnNames.value,
    matches: matchIndex.value,
  };
}

// ---------------------------------------------------------------------------------------------
// Selection — the app's own `{ kind, anchorRow, anchorCol, row, col }` shapes, unchanged, so
// menu.ts, clipboardFormats.ts and the cell-editor publish all work against them as-is.
// ---------------------------------------------------------------------------------------------

function isSelected(row: number, displayCol: number): boolean {
  const sel = decoration.selection;
  if (!sel) return false;
  if (sel.kind === 'cell') return sel.row === row && sel.col === displayCol;
  if (sel.kind === 'range') {
    const [r0, r1] = [sel.anchorRow, sel.row].sort((a, b) => a - b);
    const [c0, c1] = [sel.anchorCol, sel.col].sort((a, b) => a - b);
    return row >= r0 && row <= r1 && displayCol >= c0 && displayCol <= c1;
  }
  if (sel.kind === 'row') return sel.rows.includes(row);
  if (sel.kind === 'column') return sel.cols.includes(displayCol);
  return false;
}

// P43 iter3 D45's perimeter probe, bounded by the grid's own extents: `(3, -1)` is not a cell, so
// a row selection must not report it selected and rob the row's first cell of its end cap.
function isSelectedNeighbor(row: number, displayCol: number): boolean {
  if (row < 0 || row >= (snapshot.page?.rowCount ?? 0)) return false;
  if (displayCol < 0 || displayCol >= snapshot.columnOrder.length) return false;
  return isSelected(row, displayCol);
}

// P42 D15's fixed-anchor drag, reproduced against regular-table's own cell markup. `cellDown*` is
// the press cell; a plain click that never becomes a drag commits on `mouseup`, so a mere press
// never publishes the cell editor.
let dragMode: 'cell' | 'row' | null = null;
let dragProducedRange = false;
let cellDownRow: number | null = null;
let cellDownCol: number | null = null;
let rowAnchor: number | null = null;
let colAnchor: number | null = null;

function extendSelectionTo(row: number, displayCol: number): void {
  const entry = rt();
  if (!entry || cellDownRow === null || cellDownCol === null) return;
  const sel = entry.selection;
  if (sel?.kind !== 'range' && cellDownRow === row && cellDownCol === displayCol) return;
  dragProducedRange = true;
  entry.selection = {
    kind: 'range',
    anchorRow: cellDownRow,
    anchorCol: cellDownCol,
    row,
    col: displayCol,
  };
}

function extendRowSelectionTo(row: number): void {
  const entry = rt();
  if (!entry || rowAnchor === null) return;
  const [a, b] = [rowAnchor, row].sort((x, y) => x - y);
  const rows: number[] = [];
  for (let r = a; r <= b; r++) rows.push(r);
  dragProducedRange = true;
  entry.selection = { kind: 'row', rows };
}

function selectCell(row: number, displayCol: number): void {
  const entry = rt();
  if (entry) entry.selection = { kind: 'cell', row, col: displayCol };
}

// ---------------------------------------------------------------------------------------------
// The per-renderer adapter — a DOM event target -> `{ row, col }`, and the whole of what a
// different renderer costs the app's existing, library-agnostic feature code.
//
// regular-table records a `CellMetadata` per pooled cell in a WeakMap and exposes it as
// `getMeta(td)` (regular-table.d.ts:107): `type` discriminates body / row_header / column_header,
// `x` is the display column and `y` the display position. That is a stronger seam than
// DataGrid.vue's own `closest('.grid-cell[data-row]')` + `dataset` read, because it is the
// library's own record rather than this host's annotation of it.
// ---------------------------------------------------------------------------------------------

type CellTarget =
  | { kind: 'cell'; row: number; col: number }
  | { kind: 'gutter'; row: number }
  | { kind: 'header'; col: number };

function targetOf(event: Event): CellTarget | null {
  const el = (event.target as Element | null)?.closest<HTMLTableCellElement>('td, th');
  if (!el || !table?.contains(el)) return null;
  const meta = table.getMeta(el);
  if (meta?.type === 'body') {
    return { kind: 'cell', row: rowAtDisplayPosition(snapshot, meta.y), col: meta.x };
  }
  if (meta?.type === 'row_header') {
    return { kind: 'gutter', row: rowAtDisplayPosition(snapshot, meta.y) };
  }
  if (meta?.type === 'column_header') return { kind: 'header', col: meta.x };
  return null;
}

function onMouseDown(e: MouseEvent): void {
  if (e.button !== 0) return;
  // The header's own resize grip is regular-table's `.rt-column-resize`, which the library drives
  // itself (events.ts `_on_resize_column`) — never a column selection.
  if ((e.target as Element).classList.contains('rt-column-resize')) return;
  const target = targetOf(e);
  const entry = rt();
  if (!target || !entry) return;

  if (target.kind === 'header') {
    if (e.shiftKey && colAnchor !== null) {
      const [a, b] = [colAnchor, target.col].sort((x, y) => x - y);
      const cols: number[] = [];
      for (let c = a; c <= b; c++) cols.push(c);
      entry.selection = { kind: 'column', cols };
      return;
    }
    entry.selection = { kind: 'column', cols: [target.col] };
    colAnchor = target.col;
    return;
  }

  if (target.kind === 'gutter') {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      if (e.shiftKey && rowAnchor !== null) extendRowSelectionTo(target.row);
      return;
    }
    dragMode = 'row';
    dragProducedRange = false;
    rowAnchor = target.row;
    entry.selection = { kind: 'row', rows: [target.row] };
    beginDrag();
    return;
  }

  if (e.shiftKey) {
    const sel = entry.selection;
    const anchor =
      sel?.kind === 'range'
        ? { row: sel.anchorRow, col: sel.anchorCol }
        : sel?.kind === 'cell'
          ? { row: sel.row, col: sel.col }
          : null;
    if (anchor) {
      entry.selection = {
        kind: 'range',
        anchorRow: anchor.row,
        anchorCol: anchor.col,
        row: target.row,
        col: target.col,
      };
    }
    return;
  }

  dragMode = 'cell';
  dragProducedRange = false;
  cellDownRow = target.row;
  cellDownCol = target.col;
  beginDrag();
}

function beginDrag(): void {
  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragEnd, { once: true });
}

function onDragMove(e: MouseEvent): void {
  const target = targetOf(e);
  if (!target) return;
  if (dragMode === 'row' && target.kind !== 'header') extendRowSelectionTo(target.row);
  else if (dragMode === 'cell' && target.kind === 'cell') {
    extendSelectionTo(target.row, target.col);
  }
}

// P42 D15's trailing-click guard, applied at `mouseup` rather than at a later `click`: a press
// that never moved commits the plain single-cell selection here, and a real drag leaves the range
// it built alone.
function onDragEnd(e: MouseEvent): void {
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup', onDragEnd);
  if (dragMode === 'cell' && !dragProducedRange && cellDownRow !== null && cellDownCol !== null) {
    const target = targetOf(e);
    if (target?.kind === 'cell' && target.row === cellDownRow && target.col === cellDownCol) {
      selectCell(cellDownRow, cellDownCol);
    }
  }
  dragMode = null;
  cellDownRow = null;
  cellDownCol = null;
}

function onContextMenu(e: MouseEvent): void {
  const target = targetOf(e);
  const entry = rt();
  if (!target || !entry) return;
  // Only prevented once a cell actually matched — a right-click on the table's own background
  // keeps the native menu, matching DataGrid.vue's own F5 detail.
  e.preventDefault();

  if (target.kind === 'header') {
    entry.selection = { kind: 'column', cols: [target.col] };
    const name = snapshot.columnOrder[target.col] ?? '';
    openContextMenu(
      e,
      headerMenu({
        tabId: props.tabId,
        columnName: name,
        currentSort: currentSortDirection(name),
        currentProjection: tab()?.state.projection ?? null,
        allColumnNames: snapshot.page?.columns.map((c) => c.name) ?? [],
        columnValues: () => columnValuesFor(target.col),
      }),
    );
    return;
  }

  if (target.kind === 'gutter') {
    const sel = entry.selection;
    const inSelection = sel?.kind === 'row' && sel.rows.includes(target.row);
    if (!inSelection) {
      entry.selection = { kind: 'row', rows: [target.row] };
      rowAnchor = target.row;
    }
    openContextMenu(
      e,
      rowMenu({
        tabId: props.tabId,
        rows: inSelection && sel.kind === 'row' ? sel.rows : [target.row],
        qualifiedName: qualifiedName(),
        snapshot: rowSnapshot,
        canEdit: false,
        canDelete: canDeleteRows.value,
      }),
    );
    return;
  }

  entry.selection = { kind: 'cell', row: target.row, col: target.col };
  const value = valueAt(snapshot, target.row, target.col);
  const t = tab();
  openContextMenu(
    e,
    cellMenu({
      tabId: props.tabId,
      row: target.row,
      columnName: snapshot.columnOrder[target.col] ?? '',
      isNull: value.isNull,
      text: value.text,
      dialect: dialect.value,
      // See `canDeleteRows` above: no inline editor and no insert rows in this spike, so Edit /
      // Set NULL / Paste present as disabled rather than as half-working affordances, and neither
      // callback below is reachable from the rendered menu. `startEdit` is still wired to the one
      // real "edit this cell" behaviour this host has — selecting it publishes it into the
      // cell-editor dock — rather than to an empty function standing in for one.
      canEdit: false,
      canDelete: canDeleteRows.value,
      isDeleted: isPendingDelete(props.tabId, target.row),
      startEdit: () => selectCell(target.row, target.col),
      onPaste: () => selectCell(target.row, target.col),
      meta: rt()?.meta ?? null,
      connectionId: t?.connectionId ?? '',
      rowValues: rowSnapshot(target.row).values,
    }),
  );
}

function currentSortDirection(name: string): 'asc' | 'desc' | null {
  const sort = tab()?.state.sort;
  if (sort?.kind !== 'structured') return null;
  return sort.terms.find((term) => term.column === name)?.direction ?? null;
}

const QUALIFIED_KINDS = new Set(['schema', 'table', 'view', 'matview']);
function qualifiedName(): string {
  const t = tab();
  if (!t?.connectionId) return '';
  return decodePath(t.connectionId, t.path)
    .segments.filter((s) => QUALIFIED_KINDS.has(s.kind))
    .map((s) => s.name)
    .join('.');
}

function rowSnapshot(row: number): RowSnapshot {
  const values: Record<string, string | null> = {};
  for (let c = 0; c < snapshot.columnOrder.length; c++) {
    const name = snapshot.columnOrder[c] ?? '';
    const value = valueAt(snapshot, row, c);
    values[name] = value.isNull ? null : value.text;
  }
  return { columns: [...snapshot.columnOrder], values };
}

function columnValuesFor(displayCol: number): string[] {
  const out: string[] = [];
  for (let row = 0; row < (snapshot.page?.rowCount ?? 0); row++) {
    const value = valueAt(snapshot, row, displayCol);
    out.push(value.isNull ? '' : value.text);
  }
  return out;
}

// D1's local, DOM-focus-scoped copy: the same dispatch DataGrid.vue does, over the same
// clipboardFormats.ts helpers, against the same selection shapes — reused, not reimplemented.
function copySelection(): void {
  const sel = rt()?.selection;
  const p = snapshot.page;
  if (!sel || !p) return;
  const cellAt = (row: number, displayCol: number) => valueAt(snapshot, row, displayCol);
  if (sel.kind === 'cell') {
    const value = cellAt(sel.row, sel.col);
    copyText(value.isNull ? '' : value.text);
    return;
  }
  if (sel.kind === 'range') {
    const [r0, r1] = [sel.anchorRow, sel.row].sort((a, b) => a - b);
    const [c0, c1] = [sel.anchorCol, sel.col].sort((a, b) => a - b);
    copyText(rangeToTsv(r0, r1, c0, c1, cellAt));
    return;
  }
  if (sel.kind === 'row') {
    copyText(rowsToTsv(sel.rows.map((row) => rowSnapshot(row))));
    return;
  }
  const rows = snapshot.displayRows ?? Array.from({ length: p.rowCount }, (_, i) => i);
  copyText(columnsToTsv(rows, sel.cols, cellAt));
}

function onKeydown(e: KeyboardEvent): void {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
    e.preventDefault();
    copySelection();
  }
}

// ---------------------------------------------------------------------------------------------
// The style pass — the only work this host adds on top of regular-table's own render.
// ---------------------------------------------------------------------------------------------

const FLAG_SELECTED = 1;
const FLAG_SEL_TOP = 2;
const FLAG_SEL_RIGHT = 4;
const FLAG_SEL_BOTTOM = 8;
const FLAG_SEL_LEFT = 16;
const FLAG_NULL = 32;
const FLAG_PENDING_EDIT = 64;
const FLAG_ALIGN_RIGHT = 128;
const FLAG_SEARCH_MATCH = 256;
const FLAG_SEARCH_CURRENT = 512;
const FLAG_FK = 1024;

// The class names are cellClass.ts's own vocabulary verbatim (`.null`, `.selected`, `.sel-t`,
// `.pending-edit`, …) — several are asserted on by the existing suite, so this is the same
// mapping, applied imperatively rather than through a `:class` object.
const FLAG_CLASSES: readonly (readonly [number, string])[] = [
  [FLAG_SELECTED, 'selected'],
  [FLAG_SEL_TOP, 'sel-t'],
  [FLAG_SEL_RIGHT, 'sel-r'],
  [FLAG_SEL_BOTTOM, 'sel-b'],
  [FLAG_SEL_LEFT, 'sel-l'],
  [FLAG_NULL, 'null'],
  [FLAG_PENDING_EDIT, 'pending-edit'],
  [FLAG_ALIGN_RIGHT, 'align-right'],
  [FLAG_SEARCH_MATCH, 'search-match'],
  [FLAG_SEARCH_CURRENT, 'search-match-current'],
  [FLAG_FK, 'fk'],
];

interface Applied {
  row: number;
  col: number;
  flags: number;
  color: string;
}

// Mirrors regular-table's own `if (metadata.value !== val)` discipline (tbody.ts:58) one level up:
// a pooled cell whose logical identity and decoration are unchanged since the last pass takes zero
// attribute writes and zero `classList` calls. Without this the annotation pass would dominate the
// very frame budget this spike exists to measure, and the A/B would be measuring the adapter.
const appliedCells = new WeakMap<HTMLElement, Applied>();
const appliedRows = new WeakMap<HTMLElement, number>();

function cellFlags(row: number, displayCol: number, isNull: boolean, staged: boolean): number {
  let flags = 0;
  if (isNull) flags |= FLAG_NULL;
  if (staged) flags |= FLAG_PENDING_EDIT;
  if (snapshot.alignRight[displayCol]) flags |= FLAG_ALIGN_RIGHT;
  if (decoration.fkColumns.has(snapshot.columnOrder[displayCol] ?? '')) flags |= FLAG_FK;

  const pageCol = snapshot.pageColumns[displayCol] ?? -1;
  if (pageCol >= 0 && decoration.matches?.has(row, pageCol)) {
    flags |= decoration.matches.isCurrent(row, pageCol) ? FLAG_SEARCH_CURRENT : FLAG_SEARCH_MATCH;
  }

  if (isSelected(row, displayCol)) {
    flags |= FLAG_SELECTED;
    if (!isSelectedNeighbor(row - 1, displayCol)) flags |= FLAG_SEL_TOP;
    if (!isSelectedNeighbor(row + 1, displayCol)) flags |= FLAG_SEL_BOTTOM;
    if (!isSelectedNeighbor(row, displayCol - 1)) flags |= FLAG_SEL_LEFT;
    if (!isSelectedNeighbor(row, displayCol + 1)) flags |= FLAG_SEL_RIGHT;
  }
  return flags;
}

const COLOR_SUPPRESSING = FLAG_NULL | FLAG_FK | FLAG_PENDING_EDIT | FLAG_SEARCH_CURRENT;

function applyCell(td: HTMLTableCellElement, row: number, displayCol: number): void {
  const value = valueAt(snapshot, row, displayCol);
  const flags = cellFlags(row, displayCol, value.isNull, value.staged);
  // rowVm.ts's own rule: a data-type colour must never silently replace a higher-priority signal,
  // since an inline style always wins over a class.
  const color = flags & COLOR_SUPPRESSING ? '' : (snapshot.columnColors[displayCol] ?? '');

  const prev = appliedCells.get(td);
  if (
    prev &&
    prev.row === row &&
    prev.col === displayCol &&
    prev.flags === flags &&
    prev.color === color
  ) {
    return;
  }

  if (!prev) td.dataset.testid = 'grid-cell';
  if (!prev || prev.row !== row) td.dataset.row = String(row);
  if (!prev || prev.col !== displayCol) {
    td.dataset.colIndex = String(displayCol);
    td.dataset.column = snapshot.columnOrder[displayCol] ?? '';
  }
  const changed = flags ^ (prev?.flags ?? 0);
  if (changed || !prev) {
    for (const [flag, name] of FLAG_CLASSES) {
      if (changed & flag) td.classList.toggle(name, (flags & flag) !== 0);
    }
    if (!prev || changed & FLAG_NULL) {
      td.dataset.null = (flags & FLAG_NULL) !== 0 ? 'true' : 'false';
    }
  }
  if (!prev || prev.color !== color) td.style.color = color;

  if (prev) {
    prev.row = row;
    prev.col = displayCol;
    prev.flags = flags;
    prev.color = color;
  } else {
    appliedCells.set(td, { row, col: displayCol, flags, color });
  }
}

function applyGutter(th: HTMLTableCellElement, tr: HTMLTableRowElement, row: number): void {
  const dirty = decoration.edits.has(row);
  const deleted = decoration.deletes.has(row);
  const selected = decoration.selection?.kind === 'row' && decoration.selection.rows.includes(row);
  const key = (row << 3) | (dirty ? 1 : 0) | (deleted ? 2 : 0) | (selected ? 4 : 0);
  const prev = appliedRows.get(th);
  if (prev === key) return;

  if (prev === undefined) {
    th.dataset.testid = 'grid-gutter-cell';
    tr.dataset.testid = 'grid-row';
  }
  th.dataset.row = String(row);
  tr.dataset.row = String(row);
  th.classList.toggle('dirty', dirty);
  th.classList.toggle('deleted', deleted);
  th.classList.toggle('selected', selected);
  tr.classList.toggle('pending-delete', deleted);
  appliedRows.set(th, key);
}

/**
 * Runs inside regular-table's synchronous commit (as its `style_callback`), and again on its own
 * whenever only decoration changed. Also the one place `renderedBand` is derived — from the DOM
 * regular-table actually committed, not from the window its listener was last *asked* for.
 */
function applyStyles(): void {
  const el = table;
  const body = el?.querySelector('tbody');
  if (!el || !body) return;

  let first = Number.POSITIVE_INFINITY;
  let last = -1;
  let rows = 0;

  for (const tr of body.rows) {
    let sawGutter = false;
    for (const td of tr.cells) {
      const meta = el.getMeta(td);
      if (meta?.type === 'row_header') {
        if (meta.y < first) first = meta.y;
        if (meta.y > last) last = meta.y;
        applyGutter(td, tr, rowAtDisplayPosition(snapshot, meta.y));
        sawGutter = true;
      } else if (meta?.type === 'body') {
        applyCell(td, rowAtDisplayPosition(snapshot, meta.y), meta.x);
      }
    }
    if (sawGutter) rows++;
  }

  for (const th of el.querySelectorAll<HTMLTableCellElement>('thead th')) {
    const meta = el.getMeta(th);
    if (meta?.type !== 'column_header' || th.dataset.colIndex === String(meta.x)) continue;
    th.dataset.testid = 'grid-header-cell';
    th.dataset.colIndex = String(meta.x);
    th.dataset.column = snapshot.columnOrder[meta.x] ?? '';
  }

  renderedBand = rows > 0 ? { first, last, rows } : { first: 0, last: -1, rows: 0 };
  reportVisibleWindow();
}

// P5 C1 / P42 D39: the decode-cache pruning hint and the search-priority window — the same pair of
// reports DataGrid.vue makes from `visiblePageRowBounds`. Both are idempotent and short-circuit an
// unchanged window (store.ts), and both are hints: a non-contiguous filtered slice can only make
// the cache live slightly longer, never decode a cell nobody rendered.
function reportVisibleWindow(): void {
  if (renderedBand.rows === 0) return;
  let min = Number.POSITIVE_INFINITY;
  let max = -1;
  for (let pos = renderedBand.first; pos <= renderedBand.last; pos++) {
    const row = rowAtDisplayPosition(snapshot, pos);
    if (row < min) min = row;
    if (row > max) max = row;
  }
  setVisibleWindow(props.tabId, min, max + 1);
  setVisibleRows(props.tabId, min, max + 1);
}

// ---------------------------------------------------------------------------------------------
// Mount / teardown / refresh
// ---------------------------------------------------------------------------------------------

function refreshData(): void {
  rebuildSnapshot();
  rebuildDecoration();
  const el = table;
  if (!el) return;
  el.style.setProperty('--kira-rt-row-height', `${snapshot.rowHeight}px`);
  el.restoreColumnSizes(columnSizeOverrides(snapshot.columnOrder, widths.value));
  void el.draw();
}

function refreshDecoration(): void {
  rebuildDecoration();
  applyStyles();
}

let scrollSaveTimer: ReturnType<typeof setTimeout> | null = null;
function onScroll(): void {
  const el = table;
  if (!el) return;
  scrollTrace.noteScrollEvent(el.scrollTop, performance.now());
  if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
  scrollSaveTimer = setTimeout(() => {
    if (table) {
      patchDataTabState(props.tabId, {
        scrollTop: table.scrollTop,
        scrollLeft: table.scrollLeft,
      });
    }
  }, 300);
}

/**
 * The scroll trace's mounted band, in the scroll container's own content-pixel space.
 *
 * regular-table pins its `<table>` inside a `position: sticky` clip, so a rendered row's
 * `offsetTop` there is a *viewport* offset — `measureMountedBand`'s reading would be meaningless
 * rather than merely different, and `uncoveredPx` would come out a flattering, fabricated zero.
 * The equivalent is derived from the display positions actually committed: the library's own
 * `_calculate_row_range` (scroll_panel.ts) reduces algebraically to `start_row = scrollTop /
 * row_height` for a single header level, so a committed band `[first, last]` covers
 * `[h·(1 + first), h·(2 + last)]` — including the same one-row header offset the incumbent gets
 * from its virtualizer's `paddingStart`.
 *
 * What `uncoveredPx` measures for this engine is therefore *staleness*: because the clip is
 * pinned, a main thread behind the compositor shows rows for an older `scrollTop` rather than
 * empty background. Same metric, same units, different visible symptom — the spike doc says so
 * explicitly so an A/B is not misread.
 */
function mountedBand(): scrollTrace.MountedBand {
  if (renderedBand.rows === 0) return { top: 0, bottom: 0, rows: 0 };
  const h = snapshot.rowHeight;
  return {
    top: h * (1 + renderedBand.first),
    bottom: h * (2 + renderedBand.last),
    rows: renderedBand.rows,
  };
}

onMounted(() => {
  const root = rootRef.value;
  if (!root) return;
  const el = document.createElement(KIRA_REGULAR_TABLE_TAG) as KiraRegularTable;
  el.className = 'kira-rt';
  root.appendChild(el);
  table = el;

  rebuildSnapshot();
  rebuildDecoration();
  el.style.setProperty('--kira-rt-row-height', `${snapshot.rowHeight}px`);

  el.setDataListener(
    createDataListener(() => snapshot),
    { virtual_mode: 'both' },
  );
  el.addStyleListener(applyStyles);
  el.onCommit = (durationMs) => {
    // The same logical point DataGrid.vue's `markScrollWork` marks: after the browser's own
    // scheduling hops, immediately before the render work this frame.
    window.__kiraGridScrollWorkStart?.(performance.now() - durationMs);
    scrollTrace.noteRender(durationMs);
  };
  el.restoreColumnSizes(columnSizeOverrides(snapshot.columnOrder, widths.value));

  el.addEventListener('scroll', onScroll, { passive: true });
  el.addEventListener('mousedown', onMouseDown);
  el.addEventListener('contextmenu', onContextMenu);
  el.addEventListener('keydown', onKeydown);
  scrollTrace.registerGrid(el, 'tbody tr', mountedBand);

  const t = tab();
  void el.draw().then(() => {
    if (!table || !t) return;
    table.scrollTop = t.state.scrollTop;
    table.scrollLeft = t.state.scrollLeft;
  });
});

onUnmounted(() => {
  const el = table;
  if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup', onDragEnd);
  if (el) {
    scrollTrace.unregisterGrid(el);
    el.onCommit = null;
    el.removeEventListener('scroll', onScroll);
    el.removeEventListener('mousedown', onMouseDown);
    el.removeEventListener('contextmenu', onContextMenu);
    el.removeEventListener('keydown', onKeydown);
    el.remove();
  }
  table = null;
  snapshot = EMPTY_SNAPSHOT;
  decoration = EMPTY_DECORATION;
});

// A staged edit changes rendered *text*, not only decoration, so it goes through the data path.
// `deep` because `TabPending.edits` is a reactive `Map` whose per-row `changes` object is mutated
// in place — an identity watch would miss a retyped value.
watch(
  [
    () => pageVersion.n,
    columnOrder,
    widths,
    rowHeight,
    displayRows,
    rowNumberBase,
    typeColors,
    () => pendingFor(props.tabId),
  ],
  () => refreshData(),
  { deep: true },
);

watch([() => rt()?.selection, matchIndex, foreignKeyColumnNames], () => refreshDecoration());

// The cell-editor dock's own feed (D1) — `views/shared/celleditor/` imports nothing from here;
// `publishSelectedCell` is the seam. Identical to DataGrid.vue's own publish except that this host
// sets no `onEdit`/`onRevert`, which is exactly how a publisher declares its cells read-only in
// the panel (see SelectedCell's own doc comment).
watch(
  [() => rt()?.selection, () => pageVersion.n, () => props.tabId],
  () => {
    const sel = rt()?.selection;
    const p = page.value;
    const t = tab();
    const target =
      sel?.kind === 'cell'
        ? { row: sel.row, col: sel.col }
        : sel?.kind === 'range' && sel.anchorRow === sel.row && sel.anchorCol === sel.col
          ? { row: sel.row, col: sel.col }
          : null;
    if (!p || !t || !target || target.row < 0 || target.row >= p.rowCount) {
      clearSelectedCellFor(props.tabId);
      return;
    }
    const pageCol = pageColumnIndexFor(p, columnOrder.value, target.col);
    if (pageCol < 0) {
      clearSelectedCellFor(props.tabId);
      return;
    }
    const view = cell(props.tabId, target.row, pageCol);
    const selected: SelectedCell = {
      tabId: props.tabId,
      connectionId: t.connectionId,
      path: t.path,
      columnIndex: pageCol,
      column: p.columns[pageCol],
      row: target.row,
      value: view.isNull ? null : view.text,
      truncated: view.truncated,
      hasPrimaryKey: hasPrimaryKey.value,
    };
    publishSelectedCell(selected);
  },
  { immediate: true },
);

/** DataView.vue's `dataGridRef` — the find widget's "go to match". */
function scrollCellIntoView(row: number, displayCol: number): void {
  void table?.scrollToCell(displayCol, displayPositionOf(snapshot, row));
}

defineExpose({ scrollCellIntoView });
</script>

<template>
  <div ref="rootRef" class="regular-table-host" data-testid="regular-table-host" />
</template>

<style scoped>
.regular-table-host {
  position: relative;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
</style>

<style>
/* Unscoped, like GridRow.vue's own: the cells this styles are created by regular-table inside a
   light-DOM `<table>` this component never renders itself, so Vue's scope attribute would never
   reach them. Every selector is anchored on `kira-regular-table.kira-rt`, which nothing else in
   the app uses. */
kira-regular-table.kira-rt {
  --kira-rt-row-height: 28px;
  font-family: var(--kira-font-family);
  font-size: var(--kira-t-sm);
  color: var(--kira-fg);
  background: var(--kira-bg);
  outline: none;
  overscroll-behavior: none;
}

kira-regular-table.kira-rt table {
  position: absolute;
  border-collapse: separate;
  border-spacing: 0;
  outline: none;
}

kira-regular-table.kira-rt table * {
  box-sizing: border-box;
}

kira-regular-table.kira-rt td,
kira-regular-table.kira-rt th {
  height: var(--kira-rt-row-height);
  padding: 0 var(--kira-s-4);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  border-right: var(--kira-border-width) solid var(--kira-border);
  border-bottom: var(--kira-border-width) solid var(--kira-border);
  font-weight: normal;
  text-align: left;
  user-select: none;
}

kira-regular-table.kira-rt thead th {
  position: relative;
  background: var(--kira-bg-elevated);
  color: var(--kira-fg-muted);
  border-bottom: var(--kira-border-width) solid var(--kira-border-strong);
  cursor: pointer;
}

kira-regular-table.kira-rt tbody th {
  position: relative;
  background: var(--kira-bg-elevated);
  color: var(--kira-fg-disabled);
  font-size: var(--kira-t-xs);
  text-align: right;
  border-right: var(--kira-border-width) solid var(--kira-border-strong);
  cursor: pointer;
}

kira-regular-table.kira-rt tbody th.dirty::before,
kira-regular-table.kira-rt tbody th.deleted::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
}

kira-regular-table.kira-rt tbody th.dirty::before {
  background: var(--kira-warn);
}

kira-regular-table.kira-rt tbody th.deleted::before {
  background: var(--kira-error);
}

kira-regular-table.kira-rt tbody th.selected {
  background: var(--kira-select);
}

kira-regular-table.kira-rt tbody tr:hover td:not(.selected),
kira-regular-table.kira-rt tbody tr:hover th {
  background: var(--kira-hover);
}

kira-regular-table.kira-rt td.align-right {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* The incumbent renders `<span class="cell-null">NULL</span>`; this renders the literal text and
   colours it here, because a per-NULL-cell child element would be exactly the per-cell DOM
   construction this spike exists to avoid (see regular/snapshot.ts's `textAt`). */
kira-regular-table.kira-rt td.null {
  color: var(--kira-fg-disabled);
  font-style: italic;
}

kira-regular-table.kira-rt td.fk {
  color: var(--kira-info);
}

kira-regular-table.kira-rt td.pending-edit {
  color: var(--kira-warn);
}

kira-regular-table.kira-rt td.search-match {
  background: var(--kira-search-match);
}

kira-regular-table.kira-rt td.search-match-current {
  background: var(--kira-search-match-current);
  color: var(--kira-bg);
}

/* P42 D21's four-layer perimeter shadow, verbatim from GridRow.vue — an internal seam between two
   selected cells gets no shadow from either side, so the outer boundary reads as one 1px line. */
kira-regular-table.kira-rt td.selected {
  background: var(--kira-select);
  --sel-t: 0 0 0 0 transparent;
  --sel-r: 0 0 0 0 transparent;
  --sel-b: 0 0 0 0 transparent;
  --sel-l: 0 0 0 0 transparent;
  box-shadow:
    inset var(--sel-t),
    inset var(--sel-r),
    inset var(--sel-b),
    inset var(--sel-l);
}

kira-regular-table.kira-rt td.selected.sel-t {
  --sel-t: 0 var(--kira-border-width) 0 0 var(--kira-focus);
}

kira-regular-table.kira-rt td.selected.sel-r {
  --sel-r: calc(-1 * var(--kira-border-width)) 0 0 0 var(--kira-focus);
}

kira-regular-table.kira-rt td.selected.sel-b {
  --sel-b: 0 calc(-1 * var(--kira-border-width)) 0 0 var(--kira-focus);
}

kira-regular-table.kira-rt td.selected.sel-l {
  --sel-l: var(--kira-border-width) 0 0 0 var(--kira-focus);
}

kira-regular-table.kira-rt tbody tr.pending-delete {
  text-decoration: line-through;
  opacity: 0.5;
}

/* regular-table's own column-resize grip (events.ts `_on_resize_column`) — free column resizing,
   at the cost of one rule. */
kira-regular-table.kira-rt .rt-column-resize {
  position: absolute;
  top: 0;
  right: 0;
  height: 100%;
  width: 8px;
  cursor: col-resize;
}

/* dist/css/sub-cell-scrolling.css, re-anchored on this host's own tag name — without it the
   fractional part of the scroll offset is never applied and the grid steps a whole row at a time.
   The custom properties themselves are written by the library, onto its shadow root's
   `:host ::slotted(table)` rule, so only these selectors need restating here. */
kira-regular-table.kira-rt tbody td,
kira-regular-table.kira-rt thead th {
  transform: translate(var(--regular-table--transform-x, 0px), 0);
}

kira-regular-table.kira-rt tbody {
  transform: translate(0, var(--regular-table--transform-y, 0px));
}

kira-regular-table.kira-rt tbody tr:first-child td,
kira-regular-table.kira-rt tbody tr:first-child th {
  clip-path: polygon(
    0 var(--regular-table--clip-y, 0),
    0 100%,
    100% 100%,
    100% var(--regular-table--clip-y, 0)
  );
}

kira-regular-table.kira-rt tbody tr td:first-of-type {
  clip-path: polygon(
    var(--regular-table--clip-x, 0) 0,
    var(--regular-table--clip-x, 0) 100%,
    100% 100%,
    100% 0
  );
}

kira-regular-table.kira-rt tbody tr:first-child td:first-of-type {
  clip-path: polygon(
    var(--regular-table--clip-x, 0) var(--regular-table--clip-y, 0),
    var(--regular-table--clip-x, 0) 100%,
    100% 100%,
    100% var(--regular-table--clip-y, 0)
  );
}
</style>
