<script setup lang="ts">
import { decodePath } from '@shared/domain/tree';
import type { ColumnDescriptor } from '@shared/protocol/page';
import { type Range, useVirtualizer } from '@tanstack/vue-virtual';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { copyText } from '../../clipboard';
import { shortcutFor } from '../../shortcuts/keys';
import {
  clearSelectedCellFor,
  publishSelectedCell,
  type SelectedCell,
} from '../../state/cellSelection';
import { connectionRecord, connectionsState } from '../../state/connections';
import { type MenuItem, openContextMenu, runMenuShortcut } from '../../state/contextMenu';
import { appearanceVersion, settingsState } from '../../state/settings';
import { findDataTab, patchDataTabState } from '../../state/tabs';
import CodiconIcon from '../../theme/CodiconIcon.vue';
import { cellClass } from '../../theme/cellClass';
import { typeClassColor } from '../../theme/icons';
import AppButton from '../../theme/primitives/AppButton.vue';
import EmptyState from '../../theme/primitives/EmptyState.vue';
import { wrapSelectionOnType } from '../../theme/wrapSelection';
import {
  alignmentFor,
  columnOffsets,
  columnRangeExtractor,
  initialWidths,
  pageColumnIndexFor,
  resetMeasureCtx,
  resolveColumnOrder,
} from '../shared/page/columns';
import { setSearchFiltering } from '../shared/page/searchFilter';
import { setVisibleRows } from '../shared/page/visibleRows';
import { sqlDialectFor } from '../shared/sqlIdent';
import { typeDescription } from '../shared/typeGlossary';
import {
  columnsToTsv,
  parseDelimited,
  type RowSnapshot,
  rangeToTsv,
  rowsToTsv,
} from './clipboardFormats';
import { cellMenu, foreignKeyNavItems, headerMenu, referencedByItems, rowMenu } from './menu';
import { cell, getPage, pageVersion, setVisibleWindow } from './page';
import {
  addInsertRow,
  discardCellEdit,
  isPendingDelete,
  pendingFor,
  stagedValue,
  stageEdit,
  stageInsertValue,
} from './pendingChanges';
import { matchedRows, searchState } from './search';
import { parseTextSortTerms } from './sortTerms';
import { runtime, setSort } from './state';

const props = defineProps<{ tabId: string }>();

const GUTTER_WIDTH = 56;
/** How far the compositor may outrun the main thread before a gap can show. 560 px = the row
 *  axis's own overscan since P12 (20 rows x 28 px at comfortable density), now applied to the
 *  column axis too (P29 D2). */
const OVERSCAN_PX = 560;
/** Per side. Bounds the DOM when columns are narrow enough that 560 px is a dozen of them. */
const MAX_OVERSCAN_COLUMNS = 12;

const rowHeight = computed(() => (settingsState.appearance.rowDensity === 'compact' ? 22 : 28));

function tab() {
  return findDataTab(props.tabId);
}

const page = computed(() => {
  // Establishes the reactive dependency — the page object itself is frozen and non-reactive.
  void pageVersion.n;
  return getPage(props.tabId);
});

const columnOrder = computed<string[]>(() => {
  const p = page.value;
  if (!p) return [];
  return resolveColumnOrder(p, tab()?.state.columnOrder ?? null);
});

const columnByName = computed(() => {
  const map = new Map<string, ColumnDescriptor>();
  for (const c of page.value?.columns ?? []) map.set(c.name, c);
  return map;
});

// The DESCRIBE-derived metadata (rt().meta), not the page's own ColumnDescriptor — a comment
// only ever lives on ObjectMeta.columns (ColumnMeta), never on the per-query page column shape.
const columnMetaByName = computed(() => {
  const map = new Map<string, { dataType: string; comment: string | null }>();
  for (const c of rt()?.meta?.columns ?? []) map.set(c.name, c);
  return map;
});

// The DESCRIBE-derived dataType (columnMetaByName) when it has loaded, else the page's own
// ColumnDescriptor — shared by the header tooltip and the body cells' own type colour below so
// the two can never show a column two different colours depending on which one asked first.
function dataTypeFor(name: string): string {
  return columnMetaByName.value.get(name)?.dataType ?? columnByName.value.get(name)?.dataType ?? '';
}

// Item (regression pass, task batch P46-7): the *colour* always reads the page's own
// ColumnDescriptor.typeClass — the adapter's own authoritative typeClassFor() verdict — rather
// than re-deriving one from dataTypeFor's display string above. Re-guessing independently in the
// renderer is exactly how "datetime" and "longtext" both fell through to no colour at all; this
// can't drift the same way because it never re-parses anything the server didn't already decide.
function colorForColumn(name: string): string {
  const typeClass = columnByName.value.get(name)?.typeClass;
  return typeClass ? typeClassColor(typeClass) : '';
}

// Header hover: data type always (falls back to the page's own descriptor if DESCRIBE metadata
// hasn't loaded yet), plus the column's DB comment when it has one.
// P31 D29/F29: name, then dataType, then the glossary description (if any), then the DB comment
// (if any), each on its own line — the header is where a type is actually read while working;
// AppTooltip is pre-wrap, so this renders as one line per populated field.
// P42 D19/D20: structured for AppTooltip.vue's title/meta/body rendering — no import of
// TooltipContent itself (views/* may not import workbench/*, §11); the object literal's shape
// alone is what v-tooltip's own type checks against, the same way every plain-string call site
// already satisfies that directive with no import of its own.
function headerTitleFor(name: string): {
  title: string;
  meta?: string;
  metaColor?: string;
  body?: string;
} {
  const dataType = dataTypeFor(name);
  const description = dataType ? typeDescription(dataType) : null;
  const comment = columnMetaByName.value.get(name)?.comment;
  return {
    title: name,
    meta: dataType || undefined,
    // Item (regression pass, task batch P46-7): colorForColumn's own typeClass-backed colour —
    // the same one the cell editor's badge and this column's own body cells below use.
    metaColor: colorForColumn(name) || undefined,
    body: [description, comment].filter((line): line is string => !!line).join('\n') || undefined,
  };
}

// P31 D11: a font change drops columns.ts's memoized measuring context (so the next measurement
// re-reads the current --kira-font-family/--kira-font-size tokens instead of the ones baked into
// it at first use) and this computed takes appearanceVersion.n as an explicit dependency so it
// re-measures right after, rather than reusing widths sized for the previous font indefinitely.
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
  for (const name of columnOrder.value) out[name] = stored[name] ?? measured[name] ?? 96;
  return out;
});

const offsets = computed(() => columnOffsets(columnOrder.value, widths.value));
// P47 D6/D7: colVirtualizer's paddingStart is GUTTER_WIDTH, so its own getTotalSize() already
// is what the template used to compute by hand as `totalWidth + GUTTER_WIDTH`.
const totalWidth = computed(() => colVirtualizer.value.getTotalSize());

const pending = computed(() => pendingFor(props.tabId));
const insertRows = computed(() => pending.value?.inserts ?? []);

// "Add row" appends a synthetic row past the last real one, out of view whenever the page is
// more than a screenful — scroll it into view the same way search's goToMatch does, rather than
// leaving the user to notice a new row was added below the fold.
watch(
  () => insertRows.value.length,
  (count, previousCount) => {
    if (count > previousCount) {
      const newRowIndex = (page.value?.rowCount ?? 0) + count - 1;
      void nextTick(() => scrollCellIntoView(newRowIndex, 0));
    }
  },
);

const hasPrimaryKey = computed(() => page.value?.columns.some((c) => c.isPrimaryKey) ?? false);

// FIX-8 (design system): "keys are labelled PK / FK, never inferred from colour alone" — the FK
// side reads the same describe-derived `meta.foreignKeys` the cell-nav buttons already use, just
// flattened once into a name set instead of walking every edge per cell.
const foreignKeyColumnNames = computed(() => {
  const names = new Set<string>();
  for (const fk of runtime[props.tabId]?.meta?.foreignKeys ?? []) {
    for (const c of fk.columns) names.add(c);
  }
  return names;
});
function keyLabelFor(displayCol: number): 'PK' | 'FK' | null {
  const name = columnOrder.value[displayCol];
  if (!name) return null;
  if (columnByName.value.get(name)?.isPrimaryKey) return 'PK';
  if (foreignKeyColumnNames.value.has(name)) return 'FK';
  return null;
}
function isForeignKeyDisplayCol(displayCol: number): boolean {
  const name = columnOrder.value[displayCol];
  return !!name && foreignKeyColumnNames.value.has(name);
}

// The design's `.tr.dirty .td.gutter` rail: a row with a staged edit, drawn once on the gutter
// cell rather than re-deriving it per visible column. P31 D31: narrowed to `edits` only — a row
// staged for deletion (isDeleted below) gets its own red rail instead, mutually exclusive with
// this one, since a row headed for deletion will not have its edits applied and painting it
// "edited" yellow described an outcome that would never happen.
function isDirtyRow(row: number): boolean {
  const p = pendingFor(props.tabId);
  return !!p && p.edits.has(row);
}
const isWritable = computed(() => {
  const t = tab();
  if (!t?.connectionId) return false;
  return !connectionRecord(t.connectionId)?.readOnly;
});
// P36 D26: mirrors DataToolbar.vue's own caps computed — ClickHouse is the first tabular engine
// with canUpdate/canDelete both false alongside canInsert:true (a MergeTree PRIMARY KEY is a
// sparse index, not a unique key, so there is no addressable row to UPDATE/DELETE), so "writable"
// alone can no longer stand in for "this row-level action is actually offered".
const caps = computed(() => {
  const connectionId = tab()?.connectionId;
  return connectionId ? (connectionsState.states[connectionId]?.caps ?? null) : null;
});
// Gates whether double-click/Enter starts an inline edit (D2/D14) — the toolbar's add/preview/
// commit/discard buttons are gated on writability alone, never on hasPrimaryKey.
const canEditTable = computed(
  () => isWritable.value && hasPrimaryKey.value && !!caps.value?.canUpdate,
);
// P36 D26: Delete row(s)/Delete row's own gate — deliberately not folded into canEditTable, since
// an engine could in principle offer one of canUpdate/canDelete without the other.
const canDeleteRows = computed(
  () => isWritable.value && hasPrimaryKey.value && !!caps.value?.canDelete,
);

const dialect = computed(() => sqlDialectFor(connectionRecord(tab()?.connectionId)?.kind));

// Produced locally from the path, never round-tripped to the engine for a string join —
// the same discipline project/menus.ts's own qualifiedNameFor uses (§9b).
const QUALIFIED_KINDS = new Set(['schema', 'table', 'view', 'matview']);
function qualifiedName(): string {
  const t = tab();
  if (!t?.connectionId) return '';
  return decodePath(t.connectionId, t.path)
    .segments.filter((s) => QUALIFIED_KINDS.has(s.kind))
    .map((s) => s.name)
    .join('.');
}

// P24 D2/D3: the find widget's "hide non-matching rows" toggle, read as a plain row-index list —
// `null` means unfiltered, and every expression below short-circuits to today's arithmetic in
// that case, so the frame budget is unchanged by construction on the common (unfiltered) path.
const displayRows = computed<number[] | null>(() => matchedRows(props.tabId));
const displayRowCount = computed(() =>
  displayRows.value ? displayRows.value.length : (page.value?.rowCount ?? 0),
);

// P24 D3/D5/D6/D11: converts between a *page row index* (what selection/pending-changes/search
// identify a row by) and its *display position* (its 0-based rank among the rows actually
// rendered) — the indirection virtualization, scroll-into-view and arrow-key nav all need once
// rows can be hidden. `displayRows` is always ascending (matchedRows' own contract), so this is a
// binary search: an exact hit is the common case (the row is visible), and a miss (the row was
// just filtered out from under a live selection) falls through to the position it would sort
// into, so nav/scroll lands on the nearest visible row instead of doing nothing.
function displayPositionOf(row: number): number {
  const rowCount = page.value?.rowCount ?? 0;
  if (row >= rowCount) return displayRowCount.value + (row - rowCount); // pending insert (D5)
  const dr = displayRows.value;
  if (!dr) return row; // unfiltered: identity
  let lo = 0;
  let hi = dr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((dr[mid] as number) < row) lo = mid + 1;
    else hi = mid;
  }
  return Math.min(lo, Math.max(0, dr.length - 1));
}
function rowAtDisplayPosition(pos: number): number {
  const dr = displayRows.value;
  return dr ? (dr[pos] ?? pos) : pos;
}

// P47 D7: pending-insert rows stay outside rowVirtualizer's count (they're never filtered, so
// there's nothing to virtualize), but still contribute to the sizer's total height.
const totalHeight = computed(
  () => rowVirtualizer.value.getTotalSize() + insertRows.value.length * rowHeight.value,
);

// The gutter shows the row's position in the whole result set, not just this page's fetched
// window (`r` is a local index into the current page's rows) — so it must add back the rows
// skipped by earlier pages.
const rowNumberBase = computed(() => {
  const t = tab();
  return t ? t.state.pageIndex * t.state.pageSize : 0;
});

const containerRef = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const scrollLeft = ref(0);

function syncScrollState(): void {
  const el = containerRef.value;
  if (!el) return;
  scrollTop.value = el.scrollTop;
  scrollLeft.value = el.scrollLeft;
}

// P47 D10: the app's own scroll-work perf mark moved into markScrollWork, called from each
// virtualizer's onChange — this rAF now only feeds the 300ms scroll-position persistence watcher
// below. A fling can fire many native `scroll` events within a single frame; coalescing
// syncScrollState to one call per animation frame keeps that watcher in step with what actually
// painted instead of firing on every event.
let scrollRaf = 0;
function onScroll(): void {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    syncScrollState();
  });
}

// P47 D10: called synchronously from each virtualizer's onChange — after both of Chromium's
// scheduling hops and before Vue's render job, the same point onScroll's rAF marked before.
function markScrollWork(): void {
  window.__kiraGridScrollWorkStart?.(performance.now());
}

// TanStack's default observeElementRect reports the scroll element's border-box size
// (ResizeObserver's borderBoxSize / getBoundingClientRect), which does NOT subtract a visible
// scrollbar's own thickness the way clientWidth/clientHeight do. On a wide table (a horizontal
// scrollbar present) that ~12-15px discrepancy put the vertical overscan window's end boundary
// exactly on a knife's edge, flipping a row in/out of the DOM for a 4px sub-row scroll —
// budgets.spec.ts's zero-mutation assertion (:336). Measuring clientWidth/clientHeight instead
// keeps outerSize identical to the pre-migration viewportWidth/viewportHeight (:308-309, deleted).
function observeScrollElementRect(
  instance: { scrollElement: Element | null },
  cb: (rect: { width: number; height: number }) => void,
): (() => void) | undefined {
  const el = instance.scrollElement as HTMLElement | null;
  if (!el) return undefined;
  const handler = () => cb({ width: el.clientWidth, height: el.clientHeight });
  handler();
  const observer = new ResizeObserver(handler);
  observer.observe(el);
  return () => observer.disconnect();
}

onMounted(() => {
  const el = containerRef.value;
  if (!el) return;
  const t = tab();
  if (t) {
    el.scrollTop = t.state.scrollTop;
    el.scrollLeft = t.state.scrollLeft;
  }
  syncScrollState();
});
onUnmounted(() => {
  if (scrollRaf) cancelAnimationFrame(scrollRaf);
  // D9: the pending write is a scroll offset patchDataTabState would discard anyway once the
  // tab is gone — clearing it just stops the timer firing against an unmounted component.
  if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
  // P42 D16: a tab closed mid-drag (e.g. Ctrl/Cmd+W) must not leave a document-level listener or
  // an animation-frame loop running against an unmounted component.
  onDragMouseUp();
});

// P24 D3: in *display-position* space (0..displayRowCount), not page-row space — the rows a
// filter hides are never virtualized at all, which is what keeps the unfiltered path's arithmetic
// untouched (displayRowCount === page.rowCount when there's no filter).
// P47 D6: paddingStart reserves the sticky header's rowHeight band / the gutter's GUTTER_WIDTH
// band, since the virtualizers read raw scrollTop/scrollLeft (.grid-sizer content space), where
// row 0 starts one row down and column 0 starts at GUTTER_WIDTH.
const rowVirtualizer = useVirtualizer(
  computed(() => ({
    count: displayRowCount.value, // display-position space (P29 D11), NOT page rows
    getScrollElement: () => containerRef.value,
    estimateSize: () => rowHeight.value,
    overscan: Math.ceil(OVERSCAN_PX / rowHeight.value),
    paddingStart: rowHeight.value,
    observeElementRect: observeScrollElementRect,
    onChange: markScrollWork,
  })),
);
// P47 D5: overscan: 0 because the pixel budget is applied by columnRangeExtractor instead —
// TanStack's own item-count overscan is the wrong unit for a 40-480px column (P29 D2).
const colVirtualizer = useVirtualizer(
  computed(() => ({
    horizontal: true,
    count: columnOrder.value.length,
    getScrollElement: () => containerRef.value,
    estimateSize: (i: number) => (offsets.value[i + 1] ?? 0) - (offsets.value[i] ?? 0),
    overscan: 0,
    paddingStart: GUTTER_WIDTH,
    rangeExtractor: (range: Range) =>
      columnRangeExtractor(range, offsets.value, OVERSCAN_PX, MAX_OVERSCAN_COLUMNS),
    observeElementRect: observeScrollElementRect,
    onChange: markScrollWork,
  })),
);

// P47 D3: the visible window stays four *numbers*, not the virtualizers' own item arrays — the
// library re-notifies Vue on every isScrolling transition and on every options-object recompute
// even when the index range hasn't moved (F8/F9); a primitive computed only notifies its own
// dependents when the number itself changes, exactly as rowRange/colRange did pre-migration.
const rowStart = computed(() => rowVirtualizer.value.getVirtualItems()[0]?.index ?? 0);
const rowEnd = computed(() => {
  const items = rowVirtualizer.value.getVirtualItems();
  const last = items[items.length - 1];
  return last ? last.index + 1 : 0; // exclusive, matching the old rowRange contract
});
const colStart = computed(() => colVirtualizer.value.getVirtualItems()[0]?.index ?? 0);
const colEnd = computed(() => {
  const items = colVirtualizer.value.getVirtualItems();
  const last = items[items.length - 1];
  return last ? last.index + 1 : 0;
});

// P47 D9: estimateSize is read during a measurements recompute but is not itself a dependency
// that triggers one, so a column-width drag or a density switch must invalidate by hand or the
// overscan window is computed from stale sizes.
watch(offsets, () => colVirtualizer.value.measure());
watch(rowHeight, () => rowVirtualizer.value.measure());

const visibleRows = computed<{ row: number; pos: number }[]>(() => {
  const out: { row: number; pos: number }[] = [];
  for (let pos = rowStart.value; pos < rowEnd.value; pos++) {
    out.push({ row: rowAtDisplayPosition(pos), pos });
  }
  return out;
});

// F3: setVisibleWindow is a cache-clearing hint, not a correctness contract — the min/max page
// row of a (possibly non-contiguous, while filtering) visible slice can only make page.ts's
// decode cache live slightly longer, never decode a cell nobody rendered.
const visiblePageRowBounds = computed(() => {
  const rows = visibleRows.value;
  if (rows.length === 0) return { start: 0, end: 0 };
  let min = rows[0]?.row ?? 0;
  let max = min;
  for (const { row } of rows) {
    if (row < min) min = row;
    if (row > max) max = row;
  }
  return { start: min, end: max + 1 };
});
watch(visiblePageRowBounds, (r) => setVisibleWindow(props.tabId, r.start, r.end));
// P42 D39: the same bounds, reported into the search-priority registry too — a decode-cache hint
// and a scan's own starting point are different concerns (F31a) even though they share an input.
// `immediate: true` (unlike the cache-hint watch above) so a search started before the first
// scroll event still has a real window to prioritize, rather than falling back to none.
watch(visiblePageRowBounds, (r) => setVisibleRows(props.tabId, r.start, r.end), {
  immediate: true,
});

const visibleColumnIndices = computed(() => {
  const out: number[] = [];
  for (let c = colStart.value; c < colEnd.value; c++) out.push(c);
  return out;
});

let scrollSaveTimer: ReturnType<typeof setTimeout> | null = null;
watch([scrollTop, scrollLeft], () => {
  if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
  scrollSaveTimer = setTimeout(() => {
    patchDataTabState(props.tabId, { scrollTop: scrollTop.value, scrollLeft: scrollLeft.value });
  }, 300);
});

function cellAt(row: number, displayCol: number) {
  const p = page.value;
  if (!p) return { text: '', isNull: true, truncated: false };
  const pageCol = pageColumnIndexFor(p, columnOrder.value, displayCol);
  if (pageCol < 0) return { text: '', isNull: true, truncated: false };
  return cell(props.tabId, row, pageCol);
}

function alignFor(displayCol: number): 'left' | 'right' {
  const name = columnOrder.value[displayCol];
  const descriptor = columnByName.value.get(name);
  return descriptor ? alignmentFor(descriptor) : 'left';
}

const sortTerms = computed(() => {
  const sort = tab()?.state.sort;
  if (!sort) return [];
  if (sort.kind === 'structured') return sort.terms;
  return parseTextSortTerms(sort.text, columnOrder.value);
});

function currentSortDirection(name: string): 'asc' | 'desc' | null {
  return sortTerms.value.find((t) => t.column === name)?.direction ?? null;
}

// Only worth a number once there's more than one active sort key — a lone chevron already says
// everything a "1" badge would.
function sortOrderIndex(name: string): number | null {
  if (sortTerms.value.length < 2) return null;
  const index = sortTerms.value.findIndex((t) => t.column === name);
  return index === -1 ? null : index + 1;
}

// Cycles asc -> desc -> none and mirrors into the ORDER BY box via setSort (D6).
function onHeaderClick(name: string): void {
  const current = currentSortDirection(name);
  const next: 'asc' | 'desc' | null = current === null ? 'asc' : current === 'asc' ? 'desc' : null;
  const sort =
    next === null
      ? null
      : { kind: 'structured' as const, terms: [{ column: name, direction: next }] };
  void setSort(props.tabId, sort);
}

let resizing: { name: string; startX: number; startWidth: number } | null = null;

function onResizeStart(e: PointerEvent, name: string): void {
  e.stopPropagation();
  resizing = { name, startX: e.clientX, startWidth: widths.value[name] ?? 96 };
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}
function onResizeMove(e: PointerEvent): void {
  if (!resizing) return;
  const width = Math.max(40, resizing.startWidth + (e.clientX - resizing.startX));
  const t = tab();
  if (t)
    patchDataTabState(props.tabId, {
      columnWidths: { ...t.state.columnWidths, [resizing.name]: width },
    });
}
function onResizeEnd(e: PointerEvent): void {
  resizing = null;
  (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
}

function rt() {
  return runtime[props.tabId];
}

function isSelected(row: number, displayCol: number): boolean {
  const sel = rt()?.selection;
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

// P43 iter3 D45/F33: the perimeter-edge probe's own neighbour check, bounded by the grid's own
// extents — a `row`/`column` selection's `isSelected` (above) answers a row or column membership
// question with no notion of the *other* axis, so `isSelected(3, -1)` and `isSelected(3,
// columnCount)` both read as "selected" today, and the row's first/last cells think they have a
// selected neighbour just past the edge and draw no end cap there. Fixed at this probe, not
// inside `isSelected` itself: `isSelected` answers "is this cell in the selection", and (3, -1)
// isn't a cell, so teaching it geometry it has no other use for would add a bounds check to every
// one of the O(rows × cols) calls rowVms already makes (F14a's own concern) rather than only the
// narrow path a *selected* cell's own four neighbour probes run on, below.
function isSelectedNeighbor(row: number, displayCol: number): boolean {
  const rowCount = page.value?.rowCount ?? 0;
  if (row < 0 || row >= rowCount || displayCol < 0 || displayCol >= columnOrder.value.length) {
    return false;
  }
  return isSelected(row, displayCol);
}

// A 'cell' selection publishes itself. A genuine multi-cell 'range' (drag-select, select-all) has
// no single value to render, same as 'row'/'column' — only a degenerate one-cell range (e.g.
// shift-clicking the already-selected cell) still counts as "one cell selected" and publishes its
// focus end, the moving end the arrow keys move and the one the user last touched (D13).
function selectionTarget(): { row: number; col: number } | null {
  const sel = rt()?.selection;
  if (!sel) return null;
  if (sel.kind === 'cell') return { row: sel.row, col: sel.col };
  if (sel.kind === 'range' && sel.anchorRow === sel.row && sel.anchorCol === sel.col) {
    return { row: sel.row, col: sel.col };
  }
  return null;
}

// Publishes the cell editor's target (D1). Depends on selection, page version and tab id —
// deliberately never on scroll offsets, so scrolling never puts a decode on the frame budget
// §2.1 forbids. `pageVersion` in the dependency list is what makes the still-highlighted cell
// republish against a *new* page after paging/filtering/refreshing, so the panel and the grid
// never disagree about which cell is shown.
//
// Reactive twin of `dragMode === 'cell'` below (that one stays a plain variable, read on every
// pointer event during a drag and never itself rendered) — this watch needs to react to a cell
// drag starting/ending. Without it, dragging back over the press cell mid-drag briefly re-creates
// a degenerate `{anchor…} === {row,col}` range (extendSelectionTo has no way to tell "passing
// through" from "landed here"), which selectionTarget() reads as a completed one-cell selection —
// flashing the cell editor open and shut for that one frame before the drag continues past it.
const cellDragActive = ref(false);
watch(
  [() => rt()?.selection, () => pageVersion.n, () => props.tabId, cellDragActive],
  () => {
    // A live cell drag mutates `selection` on every pointer move (extendSelectionTo) — including,
    // transiently, back into the degenerate one-cell shape selectionTarget() below treats as a
    // completed selection whenever the pointer passes back over the press cell. Skipping entirely
    // while the drag is active (re-evaluated once it ends, since cellDragActive is itself a
    // dependency here) leaves the panel showing whatever it showed before the drag started.
    if (cellDragActive.value) return;
    const p = page.value;
    const t = tab();
    const target = selectionTarget();
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
    const column = p.columns[pageCol];
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
      hasPrimaryKey: hasPrimaryKey.value,
      // Same eligibility as the grid's own inline (double-click) edit (D2/D6): writable
      // connection, a primary key to identify the row, and the row isn't already staged for
      // delete. Stages into the exact same pending-change set `stageEdit` already feeds, so the
      // panel's save and the grid's own inline edit can never disagree about a cell's value.
      onEdit:
        canEditTable.value && !isDeleted(targetRow)
          ? (newValue: string) => stageEdit(props.tabId, targetRow, column.name, newValue)
          : undefined,
      // Sibling to onEdit — the panel's Revert button un-stages this cell's pending edit (if any)
      // rather than only resetting its own display buffer (see discardCellEdit's own doc comment).
      onRevert:
        canEditTable.value && !isDeleted(targetRow)
          ? () => discardCellEdit(props.tabId, targetRow, column.name)
          : undefined,
    };
    publishSelectedCell(selected);
  },
  { immediate: true },
);

// Rebuilt only when the search result changes (a completed scan or prev/next), not per cell —
// matches are keyed by the page's own column index, not display position.
const matchIndex = computed(() => {
  const entry = searchState[props.tabId];
  if (!entry) return null;
  const set = new Set<string>();
  for (const m of entry.matches) set.add(`${m.row}:${m.col}`);
  return { set, current: entry.index >= 0 ? entry.matches[entry.index] : undefined };
});

function isSearchMatch(row: number, displayCol: number): boolean {
  const p = page.value;
  if (!p) return false;
  const pageCol = pageColumnIndexFor(p, columnOrder.value, displayCol);
  return matchIndex.value?.set.has(`${row}:${pageCol}`) ?? false;
}
function isCurrentSearchMatch(row: number, displayCol: number): boolean {
  const p = page.value;
  if (!p) return false;
  const pageCol = pageColumnIndexFor(p, columnOrder.value, displayCol);
  const current = matchIndex.value?.current;
  return !!current && current.row === row && current.col === pageCol;
}

function isDeleted(row: number): boolean {
  return isPendingDelete(props.tabId, row);
}

// Merges a staged edit over the real page value for display — never touches the underlying
// page/decode cache, which stays the server's own last-read value until commit/discard.
function displayCell(
  row: number,
  displayCol: number,
): {
  text: string;
  isNull: boolean;
  truncated: boolean;
  staged: boolean;
} {
  const name = columnOrder.value[displayCol];
  const staged = name ? stagedValue(props.tabId, row, name) : undefined;
  if (staged !== undefined) {
    return { text: staged ?? '', isNull: staged === null, truncated: false, staged: true };
  }
  const base = cellAt(row, displayCol);
  return { ...base, staged: false };
}

// Inline cell editor (D2/D6): a plain <input> overlaid on the cell, opened by double-click or
// Enter on a selected cell. It stages text verbatim on commit — it can never express SQL NULL
// (D14's documented scope limit for this phase; retype the whole value, no "set to NULL"
// affordance yet).
const editingCell = ref<{ row: number; col: number } | null>(null);
const editingBuffer = ref('');

function isEditing(row: number, displayCol: number): boolean {
  return editingCell.value?.row === row && editingCell.value?.col === displayCol;
}

function startEdit(row: number, displayCol: number): void {
  if (!canEditTable.value || isDeleted(row)) return;
  const current = displayCell(row, displayCol);
  // P24 D27: a value the engine cut at MAX_CELL_BYTES is not editable — committing the buffer
  // verbatim (stageEdit's own contract) would write the truncated text over the real value.
  if (current.truncated) return;
  editingCell.value = { row, col: displayCol };
  editingBuffer.value = current.isNull ? '' : current.text;
}

function commitEdit(): void {
  const e = editingCell.value;
  if (!e) return;
  const name = columnOrder.value[e.col];
  editingCell.value = null;
  if (name) stageEdit(props.tabId, e.row, name, editingBuffer.value);
}

function cancelEdit(): void {
  editingCell.value = null;
}

function onCellDblClick(row: number, displayCol: number): void {
  startEdit(row, displayCol);
}

// The input is a descendant of the grid's own keydown-handling container, so without stopping
// propagation Enter/Escape would also fall through to onKeydown and move the selection.
function onEditKeydown(e: KeyboardEvent): void {
  wrapSelectionOnType(e);
  if (e.key === 'Enter') {
    e.preventDefault();
    commitEdit();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    cancelEdit();
  }
  e.stopPropagation();
}

function onInsertInput(e: Event, insertId: string, column: string): void {
  stageInsertValue(props.tabId, insertId, column, (e.target as HTMLInputElement).value);
}

// ctrl/cmd-click a disjoint cell is folded into a plain cell selection — multi-cell disjoint
// selection has no consumer until P6's copy/paste, so a second selected-cell set is not built here.
function onCellClick(row: number, displayCol: number, e: MouseEvent): void {
  // P42 D15: the trailing click a real drag still fires (mousedown -> mouseup -> click, same
  // target) would otherwise collapse the range it just built back down to a single cell.
  if (dragProducedRange) {
    dragProducedRange = false;
    return;
  }
  const runtimeEntry = rt();
  if (!runtimeEntry) return;
  const sel = runtimeEntry.selection;
  if (e.shiftKey && sel && (sel.kind === 'cell' || sel.kind === 'range')) {
    const anchor =
      sel.kind === 'range'
        ? { row: sel.anchorRow, col: sel.anchorCol }
        : { row: sel.row, col: sel.col };
    runtimeEntry.selection = {
      kind: 'range',
      anchorRow: anchor.row,
      anchorCol: anchor.col,
      row,
      col: displayCol,
    };
  } else {
    runtimeEntry.selection = { kind: 'cell', row, col: displayCol };
  }
}
// D2: Shift extends a contiguous range from the last plain/ctrl click (not updated by the
// extension itself, matching cell/range's own fixed-anchor precedent); Ctrl/Cmd toggles one row
// into a disjoint set. A plain click still replaces the selection with a single row, as before.
const rowAnchor = ref<number | null>(null);
const colAnchor = ref<number | null>(null);

// P42 D15/D16: press-drag across cells extends the selection, writing the exact same
// `{ kind: 'range', anchorRow, anchorCol, row, col }` shape shift-click already writes — so
// copy, the cell menu and the cell-editor publish above need no changes at all. Plain variables,
// not refs: this is read on every pointer event during a drag, and none of it is ever rendered.
// `dragMode` covers both cell-range drag (extends via extendSelectionTo) and gutter row-range
// drag (extends via extendRowSelectionTo) — only one can ever be active, and both share the same
// pointer-tracking/auto-scroll plumbing below.
let dragMode: 'cell' | 'row' | null = null;
let dragProducedRange = false;
let rowDragProducedRange = false;
let dragPointerX = 0;
let dragPointerY = 0;
let autoScrollRaf = 0;
const AUTO_SCROLL_EDGE = 24;
const AUTO_SCROLL_STEP = 12;
// `cellDragActive` (the one reactive exception to this block's "plain variables" rule) is
// declared above, near the cell-editor publish watch that's its only reader — see the comment
// there for why it needs to be reactive at all.

// The cell a `cell`-mode drag started on. Set on mousedown and read as the range's fixed anchor
// for the rest of that drag — kept separate from `runtimeEntry.selection` itself so a press that
// never turns into a drag leaves the selection (and so the cell-editor publish above) untouched
// until the click actually completes; see onCellMouseDown.
let cellDownRow: number | null = null;
let cellDownCol: number | null = null;

function extendSelectionTo(row: number, displayCol: number): void {
  const runtimeEntry = rt();
  if (!runtimeEntry || cellDownRow === null || cellDownCol === null) return;
  const sel = runtimeEntry.selection;
  if (sel?.kind !== 'range' && cellDownRow === row && cellDownCol === displayCol) return;
  dragProducedRange = true;
  runtimeEntry.selection = {
    kind: 'range',
    anchorRow: cellDownRow,
    anchorCol: cellDownCol,
    row,
    col: displayCol,
  };
}

// Mirrors extendSelectionTo/onGutterClick's own shift-range shape: every row between the drag's
// starting row (rowAnchor, set on mousedown) and the row now under the pointer.
function extendRowSelectionTo(row: number): void {
  const runtimeEntry = rt();
  if (!runtimeEntry || rowAnchor.value === null) return;
  const [a, b] = [rowAnchor.value, row].sort((x, y) => x - y);
  const rows: number[] = [];
  for (let r = a; r <= b; r++) rows.push(r);
  rowDragProducedRange = true;
  runtimeEntry.selection = { kind: 'row', rows };
}

// The pointer's own position, re-checked against whatever cell/row is now underneath it — needed
// because auto-scroll moves cells under a pointer that never itself moves, which fires no native
// mouseenter at all (the browser only re-hit-tests on real pointer movement).
function extendFromPoint(x: number, y: number): void {
  if (dragMode === 'row') {
    const rowEl = document.elementFromPoint(x, y)?.closest<HTMLElement>('.grid-row[data-row]');
    if (!rowEl) return;
    const row = Number(rowEl.dataset.row);
    if (Number.isNaN(row)) return;
    extendRowSelectionTo(row);
    return;
  }
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('.grid-cell[data-row]');
  if (!el) return;
  const row = Number(el.dataset.row);
  const col = Number(el.dataset.colIndex);
  if (Number.isNaN(row) || Number.isNaN(col)) return;
  extendSelectionTo(row, col);
}

function autoScrollTick(): void {
  if (!dragMode) {
    autoScrollRaf = 0;
    return;
  }
  const el = containerRef.value;
  if (el) {
    const rect = el.getBoundingClientRect();
    let scrolled = false;
    if (dragPointerY - rect.top < AUTO_SCROLL_EDGE && el.scrollTop > 0) {
      el.scrollTop -= AUTO_SCROLL_STEP;
      scrolled = true;
    } else if (rect.bottom - dragPointerY < AUTO_SCROLL_EDGE) {
      el.scrollTop += AUTO_SCROLL_STEP;
      scrolled = true;
    }
    if (dragPointerX - rect.left < AUTO_SCROLL_EDGE && el.scrollLeft > 0) {
      el.scrollLeft -= AUTO_SCROLL_STEP;
      scrolled = true;
    } else if (rect.right - dragPointerX < AUTO_SCROLL_EDGE) {
      el.scrollLeft += AUTO_SCROLL_STEP;
      scrolled = true;
    }
    if (scrolled) extendFromPoint(dragPointerX, dragPointerY);
  }
  autoScrollRaf = requestAnimationFrame(autoScrollTick);
}

function onDragMouseMove(e: MouseEvent): void {
  if (!dragMode) return;
  dragPointerX = e.clientX;
  dragPointerY = e.clientY;
}

function onDragMouseUp(): void {
  dragMode = null;
  cellDragActive.value = false;
  if (autoScrollRaf) {
    cancelAnimationFrame(autoScrollRaf);
    autoScrollRaf = 0;
  }
  document.removeEventListener('mousemove', onDragMouseMove);
  // Idempotent — this is also called directly from onUnmounted for a tab closed mid-drag, when
  // this listener (registered `{ once: true }`) may never actually have fired.
  document.removeEventListener('mouseup', onDragMouseUp);
}

// Shift falls through to onCellClick's own extend path unchanged — this only ever starts a drag
// on a plain primary-button press. `.grid-cell` is already `user-select: none`, so there is no
// native text selection to fight. Deliberately does NOT commit `runtimeEntry.selection` itself:
// doing so here published the cell editor on mere press, before the click was ever released. The
// press cell is only recorded (cellDownRow/Col) as the drag's anchor; a plain click's own
// selection commit — and so the cell-editor publish — happens in onCellClick once the click
// actually completes, and a real drag commits progressively via extendSelectionTo instead.
function onCellMouseDown(row: number, displayCol: number, e: MouseEvent): void {
  if (e.button !== 0 || e.shiftKey) return;
  const runtimeEntry = rt();
  if (!runtimeEntry) return;
  dragMode = 'cell';
  cellDragActive.value = true;
  dragProducedRange = false;
  dragPointerX = e.clientX;
  dragPointerY = e.clientY;
  cellDownRow = row;
  cellDownCol = displayCol;
  document.addEventListener('mousemove', onDragMouseMove);
  document.addEventListener('mouseup', onDragMouseUp, { once: true });
  autoScrollRaf = requestAnimationFrame(autoScrollTick);
}

function onCellMouseEnter(row: number, displayCol: number): void {
  if (dragMode !== 'cell') return;
  extendSelectionTo(row, displayCol);
}

// Shift/Ctrl/Cmd fall through to onGutterClick's own shift-range/ctrl-toggle paths unchanged —
// this only ever starts a drag on a plain primary-button press against the gutter.
function onGutterMouseDown(row: number, e: MouseEvent): void {
  if (e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey) return;
  const runtimeEntry = rt();
  if (!runtimeEntry) return;
  dragMode = 'row';
  rowDragProducedRange = false;
  dragPointerX = e.clientX;
  dragPointerY = e.clientY;
  runtimeEntry.selection = { kind: 'row', rows: [row] };
  rowAnchor.value = row;
  document.addEventListener('mousemove', onDragMouseMove);
  document.addEventListener('mouseup', onDragMouseUp, { once: true });
  autoScrollRaf = requestAnimationFrame(autoScrollTick);
}

function onGutterMouseEnter(row: number): void {
  if (dragMode !== 'row') return;
  extendRowSelectionTo(row);
}

// P42 D15's trailing-click guard (dragProducedRange), mirrored for the gutter: mousedown -> mouseup
// -> click still fires on a real drag's own target, which would otherwise collapse the just-built
// row range back down to a single row.
function onGutterClick(row: number, e: MouseEvent): void {
  if (rowDragProducedRange) {
    rowDragProducedRange = false;
    return;
  }
  const runtimeEntry = rt();
  if (!runtimeEntry) return;
  const sel = runtimeEntry.selection;
  if (e.shiftKey && rowAnchor.value !== null) {
    const [a, b] = [rowAnchor.value, row].sort((x, y) => x - y);
    const rows: number[] = [];
    for (let r = a; r <= b; r++) rows.push(r);
    runtimeEntry.selection = { kind: 'row', rows };
    return;
  }
  if ((e.ctrlKey || e.metaKey) && sel?.kind === 'row') {
    runtimeEntry.selection = {
      kind: 'row',
      rows: sel.rows.includes(row) ? sel.rows.filter((r) => r !== row) : [...sel.rows, row],
    };
    rowAnchor.value = row;
    return;
  }
  runtimeEntry.selection = { kind: 'row', rows: [row] };
  rowAnchor.value = row;
}
function onHeaderSelectClick(displayCol: number, e: MouseEvent): void {
  const runtimeEntry = rt();
  if (!runtimeEntry) return;
  const sel = runtimeEntry.selection;
  if (e.shiftKey && colAnchor.value !== null) {
    const [a, b] = [colAnchor.value, displayCol].sort((x, y) => x - y);
    const cols: number[] = [];
    for (let c = a; c <= b; c++) cols.push(c);
    runtimeEntry.selection = { kind: 'column', cols };
    return;
  }
  if ((e.ctrlKey || e.metaKey) && sel?.kind === 'column') {
    runtimeEntry.selection = {
      kind: 'column',
      cols: sel.cols.includes(displayCol)
        ? sel.cols.filter((c) => c !== displayCol)
        : [...sel.cols, displayCol],
    };
    colAnchor.value = displayCol;
    return;
  }
  runtimeEntry.selection = { kind: 'column', cols: [displayCol] };
  colAnchor.value = displayCol;
}

// P42 D17: the corner cell selects everything, as a `range` — never a `row` selection, which
// `isSelected` resolves with `Array.includes` (O(rows) per rendered cell per render, F14a). A
// range spanning the whole page is O(1) per cell, same as copy/paste and the cell menu already
// assume. No keyboard shortcut (§9): Ctrl/Cmd+A already means something else inside an open
// inline editor and inside the cell editor's own CodeMirror, and choosing between them is a real
// focus-scope decision this phase doesn't make on its own.
function onSelectAll(): void {
  const runtimeEntry = rt();
  if (!runtimeEntry) return;
  const lastRow = (page.value?.rowCount ?? 0) - 1;
  const lastCol = columnOrder.value.length - 1;
  if (lastRow < 0 || lastCol < 0) return;
  runtimeEntry.selection = {
    kind: 'range',
    anchorRow: 0,
    anchorCol: 0,
    row: lastRow,
    col: lastCol,
  };
}

// The row's effective values across the whole display column order (D6) — reused by row copy
// and Duplicate row.
function rowSnapshot(row: number): RowSnapshot {
  const values: Record<string, string | null> = {};
  for (let c = 0; c < columnOrder.value.length; c++) {
    const name = columnOrder.value[c];
    const dc = displayCell(row, c);
    values[name] = dc.isNull ? null : dc.text;
  }
  return { columns: [...columnOrder.value], values };
}

// P29 D6: the cheap precheck that makes cellNavEntry affordable — exactly the two predicates
// grid/menu.ts already applies (foreignKeyNavItems filters on `fk.columns.includes(columnName)`;
// referencedByItems requires `meta.primaryKey.includes(columnName)` and a non-empty
// `referencedBy`), so a column outside both sets provably yields no items, with no snapshot
// built. `valueNames` is the union of `columns` over BOTH edge lists — the only names
// foreignKeyValueFilter (grid/menu.ts) ever reads out of a row's values.
const navColumns = computed<{ fk: Set<string>; pk: Set<string>; valueNames: string[] }>(() => {
  const meta = rt()?.meta ?? null;
  const fk = new Set<string>();
  const pk = new Set<string>();
  const valueNames = new Set<string>();
  if (meta) {
    for (const edge of meta.foreignKeys) {
      for (const name of edge.columns) {
        fk.add(name);
        valueNames.add(name);
      }
    }
    if (meta.primaryKey && meta.referencedBy.length > 0) {
      for (const name of meta.primaryKey) pk.add(name);
      for (const edge of meta.referencedBy) {
        for (const name of edge.columns) valueNames.add(name);
      }
    }
  }
  return { fk, pk, valueNames: [...valueNames] };
});

// `rowSnapshot(row)` narrowed to `navColumns.valueNames`, memoised per row for one render via the
// optional cache renderRows passes — a table with no FK and no inbound reference (the common
// case) never builds one at all, since valueNames is then empty.
function navValuesFor(
  row: number,
  cache?: Map<number, Record<string, string | null>>,
): Record<string, string | null> {
  const cached = cache?.get(row);
  if (cached) return cached;
  const out: Record<string, string | null> = {};
  for (const name of navColumns.value.valueNames) {
    const c = columnOrder.value.indexOf(name);
    if (c < 0) continue;
    const dc = displayCell(row, c);
    out[name] = dc.isNull ? null : dc.text;
  }
  cache?.set(row, out);
  return out;
}

// P7 D3/D5/D7: the single source of truth for a cell's nav affordance — both the button's
// v-if/icon and its click handler read this, so they can never disagree about what's showing.
// 'fk' wins over 'pk' when a cell is somehow both (D7); null while editing (D8), before meta has
// loaded, or when there's nothing navigable.
function cellNavEntry(
  row: number,
  displayCol: number,
  navCache?: Map<number, Record<string, string | null>>,
): { kind: 'fk' | 'pk'; items: MenuItem[] } | null {
  if (isEditing(row, displayCol)) return null;
  const name = columnOrder.value[displayCol];
  const meta = rt()?.meta ?? null;
  const t = tab();
  if (!name || !meta || !t?.connectionId) return null;
  const { fk, pk } = navColumns.value;
  if (!fk.has(name) && !pk.has(name)) return null;
  const fkCtx = {
    connectionId: t.connectionId,
    dialect: dialect.value,
    rowValues: navValuesFor(row, navCache),
  };
  const fkItems = foreignKeyNavItems(name, meta, fkCtx).filter(
    (i) => i.type === 'item' && !i.disabled,
  );
  if (fkItems.length) return { kind: 'fk', items: fkItems };
  const refItems = referencedByItems(name, meta, fkCtx).filter(
    (i) => i.type === 'item' && !i.disabled,
  );
  if (refItems.length) return { kind: 'pk', items: refItems };
  return null;
}

// P29 D5: every rendered cell's state, computed exactly once per render instead of the 7-11
// function calls per cell the template made before this — displayCell/cellClass/isSelected/
// isSearchMatch/isCurrentSearchMatch/alignFor/isForeignKeyDisplayCol/isEditing/cellNavEntry keep
// their signatures and are called from here instead of the template. Changes no rendered
// attribute, class name or data-testid — the existing suite is the regression guard for it.
interface CellVM {
  col: number; // display column index — what selection/copy address
  name: string; // column name — the v-for :key, unchanged
  left: number;
  width: number;
  text: string;
  isNull: boolean;
  truncated: boolean;
  staged: boolean;
  editing: boolean;
  navKind: 'fk' | 'pk' | null;
  classes: Record<string, boolean>;
  /** '' when nothing should override the cell's own CSS-driven colour (NULL, an FK link, a
   *  pending edit, or the current search match all already carry their own meaningful colour via
   *  .grid-cell's class rules — a data-type colour stacked on top of any of those would silently
   *  replace a higher-priority signal, since an inline style always wins over a class). Otherwise
   *  the column's own colorForColumn. */
  color: string;
}

interface RowVM {
  /** The page row index (P24 D3/D4): gutter number, selection, pending changes and search
   *  matches all address a row by this, unchanged by filtering. */
  row: number;
  /** The display position: pixel placement only — identical to `row` when nothing is filtered
   *  (P29 D11, preserving P24 D3/D4's split literally). */
  pos: number;
  gutterNumber: number;
  dirty: boolean;
  deleted: boolean;
  cells: CellVM[];
}

const renderRows = computed<RowVM[]>(() => {
  const cols = visibleColumnIndices.value;
  const names = columnOrder.value;
  const offs = offsets.value;
  const base = rowNumberBase.value;
  // Per-render only, keyed by row: cellNavEntry's own narrow value map (P29 D6), built at most
  // once even though several columns of the same row can each carry a nav affordance.
  const navCache = new Map<number, Record<string, string | null>>();
  // Item (regression pass, task batch P46-6/7): once per column, not once per cell —
  // colorForColumn is a pure function of the column name, so every row of the same column shares
  // one answer; a whole viewport's worth of rows re-deriving it per cell would be the same
  // 7-11-calls-per-cell problem P29 D5 (this computed's own comment above) already fixed once.
  const colorByCol = new Map<number, string>();
  for (const c of cols) {
    colorByCol.set(c, colorForColumn(names[c] ?? ''));
  }
  const out: RowVM[] = [];
  for (const { row, pos } of visibleRows.value) {
    const cells: CellVM[] = [];
    for (const c of cols) {
      const name = names[c] ?? '';
      const dc = displayCell(row, c);
      const nav = cellNavEntry(row, c, navCache);
      const selected = isSelected(row, c);
      const isFk = isForeignKeyDisplayCol(c) && !dc.isNull;
      const isCurrentMatch = isCurrentSearchMatch(row, c);
      cells.push({
        col: c,
        name,
        left: GUTTER_WIDTH + (offs[c] ?? 0),
        width: (offs[c + 1] ?? 0) - (offs[c] ?? 0),
        text: dc.text,
        isNull: dc.isNull,
        truncated: dc.truncated,
        staged: dc.staged,
        editing: isEditing(row, c),
        navKind: nav?.kind ?? null,
        // NULL, an FK link, a pending edit and the current search match each already carry their
        // own meaningful colour via .grid-cell's own class rules (.cell-null, .fk, .pending-edit,
        // .search-match-current) — skipped here so the inline style never silently outranks one.
        color: dc.isNull || isFk || dc.staged || isCurrentMatch ? '' : (colorByCol.get(c) ?? ''),
        classes: cellClass({
          alignRight: alignFor(c) === 'right',
          selected,
          // P42 D21: an edge is drawn only where it sits on the selection's own outer
          // perimeter — computed only for a selected cell, since an unselected one never draws
          // any of these regardless. P43 iter3 D45: bounded by the grid's own extents, so a
          // whole-row/whole-column selection's outermost cells draw their own end caps too.
          selEdgeTop: selected && !isSelectedNeighbor(row - 1, c),
          selEdgeRight: selected && !isSelectedNeighbor(row, c + 1),
          selEdgeBottom: selected && !isSelectedNeighbor(row + 1, c),
          selEdgeLeft: selected && !isSelectedNeighbor(row, c - 1),
          searchMatch: isSearchMatch(row, c),
          searchMatchCurrent: isCurrentMatch,
          pendingEdit: dc.staged,
          fk: isFk,
          hasNav: !!nav,
        }),
      });
    }
    out.push({
      row,
      pos,
      gutterNumber: base + row + 1,
      dirty: isDirtyRow(row),
      deleted: isDeleted(row),
      cells,
    });
  }
  return out;
});

// D6: exactly one candidate navigates immediately; more than one opens the same ContextMenu
// popup the right-click cell menu uses, anchored at the click.
function onCellNavClick(row: number, displayCol: number, e: MouseEvent): void {
  const entry = cellNavEntry(row, displayCol);
  if (!entry) return;
  if (entry.items.length === 1) {
    const only = entry.items[0];
    if (only?.type === 'item') void only.run();
    return;
  }
  openContextMenu(e, entry.items);
}

// P24 D10: while filtering, both this and onCopy's column branch below walk the *visible* rows
// only — the column the user can see has N rows, and copying every loaded row from a grid
// showing 12 would be a silent mismatch pasted straight into a spreadsheet.
function rowsForColumnOps(rowCount: number): number[] {
  return displayRows.value ?? Array.from({ length: rowCount }, (_, i) => i);
}

// The loaded page's values only for one column (§8.5's own scope boundary) — used by the header
// menu's "Copy column values".
function columnValuesFor(displayCol: number): string[] {
  const p = page.value;
  if (!p) return [];
  const out: string[] = [];
  for (const r of rowsForColumnOps(p.rowCount)) {
    const dc = displayCell(r, displayCol);
    out.push(dc.isNull ? '' : dc.text);
  }
  return out;
}

// D3: right-clicking a row already in the selection acts on the whole selection; right-clicking
// outside it replaces the selection with just that row first. Cell/header menus have no
// multi-target actions, so those two always collapse to a single-item selection.
function onGutterContextMenu(row: number, e: MouseEvent): void {
  const p = page.value;
  if (!p || row >= p.rowCount) return; // pending insert rows have no row menu yet
  const runtimeEntry = rt();
  if (!runtimeEntry) return;
  const sel = runtimeEntry.selection;
  const inSelection = sel?.kind === 'row' && sel.rows.includes(row);
  if (!inSelection) {
    runtimeEntry.selection = { kind: 'row', rows: [row] };
    rowAnchor.value = row;
  }
  const rows = inSelection && sel.kind === 'row' ? sel.rows : [row];
  openContextMenu(
    e,
    rowMenu({
      tabId: props.tabId,
      rows,
      qualifiedName: qualifiedName(),
      snapshot: rowSnapshot,
      canEdit: canEditTable.value,
      canDelete: canDeleteRows.value,
    }),
  );
}

function onCellContextMenu(row: number, displayCol: number, e: MouseEvent): void {
  const runtimeEntry = rt();
  if (runtimeEntry) runtimeEntry.selection = { kind: 'cell', row, col: displayCol };
  const dc = displayCell(row, displayCol);
  const name = columnOrder.value[displayCol];
  const t = tab();
  openContextMenu(
    e,
    cellMenu({
      tabId: props.tabId,
      row,
      columnName: name,
      isNull: dc.isNull,
      text: dc.text,
      dialect: dialect.value,
      canEdit: canEditTable.value,
      canDelete: canDeleteRows.value,
      isDeleted: isDeleted(row),
      startEdit: () => startEdit(row, displayCol),
      onPaste: () => void onPaste(),
      meta: rt()?.meta ?? null,
      connectionId: t?.connectionId ?? '',
      rowValues: rowSnapshot(row).values,
    }),
  );
}

function onHeaderContextMenu(displayCol: number, e: MouseEvent): void {
  const runtimeEntry = rt();
  if (runtimeEntry) runtimeEntry.selection = { kind: 'column', cols: [displayCol] };
  const name = columnOrder.value[displayCol];
  openContextMenu(
    e,
    headerMenu({
      tabId: props.tabId,
      columnName: name,
      currentSort: currentSortDirection(name),
      currentProjection: tab()?.state.projection ?? null,
      allColumnNames: page.value?.columns.map((c) => c.name) ?? [],
      columnValues: () => columnValuesFor(displayCol),
    }),
  );
}

// D1: local, DOM-focus-scoped copy/paste — never a native Electron accelerator (see the ground
// rules note at the top of docs/v1/plans/P6-interaction-completeness.md for why).
function onCopy(): void {
  const sel = rt()?.selection;
  const p = page.value;
  if (!sel || !p) return;
  if (sel.kind === 'cell') {
    const dc = displayCell(sel.row, sel.col);
    copyText(dc.isNull ? '' : dc.text);
    return;
  }
  if (sel.kind === 'range') {
    const [r0, r1] = [sel.anchorRow, sel.row].sort((a, b) => a - b);
    const [c0, c1] = [sel.anchorCol, sel.col].sort((a, b) => a - b);
    copyText(rangeToTsv(r0, r1, c0, c1, displayCell));
    return;
  }
  if (sel.kind === 'row') {
    copyText(rowsToTsv(sel.rows.map(rowSnapshot)));
    return;
  }
  copyText(columnsToTsv(rowsForColumnOps(p.rowCount), sel.cols, displayCell));
}

// D13: TSV-if-tab-else-CSV, applied column-by-column from the selection's anchor across the
// current display column order — existing rows become stageEdit calls, rows past the loaded
// page become new pending inserts (one addInsertRow per pasted row, reused across its columns).
async function onPaste(): Promise<void> {
  if (!canEditTable.value) return;
  const sel = rt()?.selection;
  const p = page.value;
  if (!sel || !p) return;
  if (sel.kind !== 'cell' && sel.kind !== 'range' && sel.kind !== 'row') return;

  let clipboardText: string;
  try {
    clipboardText = await navigator.clipboard.readText();
  } catch {
    return;
  }
  if (!clipboardText) return;

  const grid = parseDelimited(clipboardText);
  const startRow =
    sel.kind === 'row' ? Math.min(...sel.rows) : sel.kind === 'range' ? sel.anchorRow : sel.row;
  const startCol = sel.kind === 'row' ? 0 : sel.kind === 'range' ? sel.anchorCol : sel.col;
  const columns = columnOrder.value;
  // P36 D28: the server computes a generated column's value — an explicit paste into one is
  // silently dropped rather than staged into an insert the server would then reject outright.
  const insertColumns = columns.filter((name) => !columnByName.value.get(name)?.generated);
  const insertIds = new Map<number, string>();

  for (let ri = 0; ri < grid.length; ri++) {
    const row = startRow + ri;
    if (row < 0) continue;
    const isNewRow = row >= p.rowCount;
    let insertId = insertIds.get(row);
    if (isNewRow && insertId === undefined) {
      insertId = addInsertRow(props.tabId, insertColumns);
      insertIds.set(row, insertId);
    }
    const cols = grid[ri];
    for (let ci = 0; ci < cols.length; ci++) {
      const name = columns[startCol + ci];
      if (!name) continue;
      if (isNewRow) {
        if (insertId && !columnByName.value.get(name)?.generated) {
          stageInsertValue(props.tabId, insertId, name, cols[ci]);
        }
      } else {
        stageEdit(props.tabId, row, name, cols[ci]);
      }
    }
  }
}

function scrollCellIntoView(row: number, displayCol: number): void {
  const el = containerRef.value;
  if (!el) return;
  // Every row's own `top` style is offset by one rowHeight for the header row above it (see the
  // header-row/grid-row template bindings) — this has to match or the target lands one row short.
  // P24 D6: `row` is a page-row index (what search/PK-FK-nav/add-row all address a row by); the
  // pixel position it scrolls to is the row's *display* position, which collapses to identity
  // when nothing is filtered.
  const rowTop = rowHeight.value + displayPositionOf(row) * rowHeight.value;
  const rowBottom = rowTop + rowHeight.value;
  if (rowTop < el.scrollTop) el.scrollTop = rowTop;
  else if (rowBottom > el.scrollTop + el.clientHeight) el.scrollTop = rowBottom - el.clientHeight;

  const colStart = offsets.value[displayCol] ?? 0;
  const colEnd = offsets.value[displayCol + 1] ?? colStart;
  if (colStart < el.scrollLeft) el.scrollLeft = colStart;
  else if (colEnd > el.scrollLeft + el.clientWidth) el.scrollLeft = colEnd - el.clientWidth;
  // A one-shot programmatic jump (search/PK-FK nav/add-row), not a scroll gesture — update
  // immediately rather than waiting a frame for onScroll's rAF coalescing.
  syncScrollState();
}

function onKeydown(e: KeyboardEvent): void {
  const runtimeEntry = rt();
  const p = page.value;
  if (!runtimeEntry || !p) return;

  // D1: fires only while the grid container itself has DOM focus (this handler is bound to
  // it) — every plain <input> in the app keeps using Electron's native role:'copy'/'paste'
  // instead, since `user-select: none` on .grid-cell leaves it nothing to act on here.
  const key = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && key === 'c') {
    e.preventDefault();
    onCopy();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && key === 'v') {
    e.preventDefault();
    void onPaste();
    return;
  }

  // P21 D5: dispatched through rowMenu() itself (the same builder onGutterContextMenu calls) so
  // the printed shortcut and the executed action can't drift, and `disabled: !canEdit` is honoured
  // for free — inert on a read-only table without restating that guard here.
  const rowShortcut = shortcutFor(e, ['grid.duplicateRows', 'grid.deleteRows']);
  if (rowShortcut && runtimeEntry.selection?.kind === 'row') {
    const { rows } = runtimeEntry.selection;
    const ran = runMenuShortcut(
      rowMenu({
        tabId: props.tabId,
        rows,
        qualifiedName: qualifiedName(),
        snapshot: rowSnapshot,
        canEdit: canEditTable.value,
        canDelete: canDeleteRows.value,
      }),
      rowShortcut,
    );
    if (ran) e.preventDefault();
    return;
  }

  // P31 D32/F31: Delete/Cmd+Backspace also fires from a cell or range selection, not just a row
  // selection (which requires a gutter click) — clicking a cell is the ordinary way a row gets
  // picked. Duplicate stays row-selection-only (D32 doesn't ask for a cell/range form of it).
  // Still dispatched through rowMenu() for the same reasons as above.
  const deleteShortcut = shortcutFor(e, ['grid.deleteRows']);
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
        canEdit: canEditTable.value,
        canDelete: canDeleteRows.value,
      }),
      deleteShortcut,
    );
    if (ran) e.preventDefault();
    return;
  }

  const sel = runtimeEntry.selection;
  if (!sel || (sel.kind !== 'cell' && sel.kind !== 'range')) return;
  let { row, col } = sel.kind === 'range' ? { row: sel.row, col: sel.col } : sel;
  if (e.key === 'Enter') {
    e.preventDefault();
    startEdit(row, col);
    return;
  }
  switch (e.key) {
    // P24 D11: steps by *display* position and clamps to the visible row count, so ArrowDown
    // never walks into a row the filter hid — otherwise the selection would vanish (it publishes
    // for a row nothing renders) with no visible cause.
    case 'ArrowUp':
      row = rowAtDisplayPosition(Math.max(0, displayPositionOf(row) - 1));
      break;
    case 'ArrowDown':
      row = rowAtDisplayPosition(Math.min(displayRowCount.value - 1, displayPositionOf(row) + 1));
      break;
    case 'ArrowLeft':
      col = Math.max(0, col - 1);
      break;
    case 'ArrowRight':
      col = Math.min(columnOrder.value.length - 1, col + 1);
      break;
    default:
      return;
  }
  e.preventDefault();
  if (e.shiftKey) {
    const anchor =
      sel.kind === 'range'
        ? { row: sel.anchorRow, col: sel.anchorCol }
        : { row: sel.row, col: sel.col };
    runtimeEntry.selection = {
      kind: 'range',
      anchorRow: anchor.row,
      anchorCol: anchor.col,
      row,
      col,
    };
  } else {
    runtimeEntry.selection = { kind: 'cell', row, col };
  }
  scrollCellIntoView(row, col);
}

defineExpose({ scrollCellIntoView });
</script>

<template>
  <div
    ref="containerRef"
    class="data-grid"
    data-testid="data-grid"
    :data-pagination="rt()?.lastStrategy"
    tabindex="0"
    @scroll="onScroll"
    @keydown="onKeydown"
  >
    <EmptyState
      v-if="page && page.rowCount === 0"
      class="no-rows"
      icon="table"
      label="No rows"
      data-testid="grid-no-rows"
    />
    <!-- P24 D8: filtering to zero matches is a distinct empty state from "the table is empty"
         (LAW 15 names both by name) — but a pending insert row is work in progress, not a search
         result, so its presence keeps the grid itself on screen even with zero real matches. -->
    <EmptyState
      v-else-if="page && displayRows && displayRowCount === 0 && insertRows.length === 0"
      class="no-rows"
      icon="search"
      label="No matching rows"
      data-testid="grid-no-matching-rows"
    >
      <AppButton data-testid="grid-show-all-rows" @click="setSearchFiltering(props.tabId, false)">
        Show all rows
      </AppButton>
    </EmptyState>
    <div
      v-else-if="page"
      class="grid-sizer"
      :style="{ width: `${totalWidth}px`, height: `${totalHeight}px` }"
    >
      <div class="header-row" :style="{ height: `${rowHeight}px` }">
        <div
          class="gutter-cell header-gutter"
          role="button"
          aria-label="Select all cells"
          data-testid="grid-select-all"
          :style="{ width: `${GUTTER_WIDTH}px` }"
          @click="onSelectAll"
        />
        <div
          v-for="c in visibleColumnIndices"
          :key="columnOrder[c]"
          class="header-cell"
          data-testid="grid-header-cell"
          :data-column="columnOrder[c]"
          :data-sort="currentSortDirection(columnOrder[c]) ?? undefined"
          v-tooltip="headerTitleFor(columnOrder[c])"
          :style="{
            left: `${GUTTER_WIDTH + offsets[c]}px`,
            width: `${offsets[c + 1] - offsets[c]}px`,
          }"
          @click="onHeaderClick(columnOrder[c])"
          @contextmenu.prevent="onHeaderContextMenu(c, $event)"
        >
          <span class="header-label">{{ columnOrder[c] }}</span>
          <span
            v-if="keyLabelFor(c)"
            class="header-key mono"
            :class="{ 'is-fk': keyLabelFor(c) === 'FK' }"
            >{{ keyLabelFor(c) }}</span
          >
          <!-- P31 D34/F33: a 13px codicon pinned to the cell's right edge, out of the label's own
               flow (LAW 02 — every other state indicator in the app is a codicon; this was the
               last text-drawn one). Rendered in a font-independent glyph, unlike the old ▲/▼
               characters, which sized and reshaped with item 3's data-font setting. -->
          <span v-if="currentSortDirection(columnOrder[c])" class="sort-indicator">
            <span v-if="sortOrderIndex(columnOrder[c])" class="sort-order">{{
              sortOrderIndex(columnOrder[c])
            }}</span>
            <CodiconIcon
              :name="currentSortDirection(columnOrder[c]) === 'asc' ? 'arrow-up' : 'arrow-down'"
              :size="13"
            />
          </span>
          <span
            role="button"
            aria-label="Select column"
            class="header-select-zone"
            data-testid="grid-header-select"
            :data-column="columnOrder[c]"
            @click.stop="onHeaderSelectClick(c, $event)"
          />
          <span
            class="resize-handle"
            @pointerdown="onResizeStart($event, columnOrder[c])"
            @pointermove="onResizeMove"
            @pointerup="onResizeEnd"
            @click.stop
          />
        </div>
      </div>

      <!-- P29 D5/D11: each rowVm/cellVm is built once per render (renderRows above) — the
           template only reads fields. `rowVm.row` is the page-row index (selection/gutter
           number/pending changes/search all address a row by it, unchanged by filtering);
           `rowVm.pos` is separately its display position, used only for pixel placement, so the
           gutter still reads the row's true number (`3, 17, 84, …`) even while filtered. -->
      <div
        v-for="rowVm in renderRows"
        :key="rowVm.row"
        class="grid-row"
        data-testid="grid-row"
        :data-row="rowVm.row"
        :class="{ 'pending-delete': rowVm.deleted }"
        :style="{ top: `${rowHeight + rowVm.pos * rowHeight}px`, height: `${rowHeight}px` }"
      >
        <!-- scroll-margin-top = rowHeight on gutter/grid cells below: `.header-row` is
             position: sticky, which a native scrollIntoView(IfNeeded) call doesn't otherwise know
             to leave room for — without it, scrolling row 0's cell "into view" can land it flush
             against the container's top, right underneath the sticky header. -->
        <div
          class="gutter-cell"
          data-testid="grid-gutter-cell"
          :data-row="rowVm.row"
          :class="{ dirty: rowVm.dirty, deleted: rowVm.deleted }"
          :style="{ width: `${GUTTER_WIDTH}px`, scrollMarginTop: `${rowHeight}px` }"
          @mousedown="onGutterMouseDown(rowVm.row, $event)"
          @mouseenter="onGutterMouseEnter(rowVm.row)"
          @click="onGutterClick(rowVm.row, $event)"
          @contextmenu.prevent="onGutterContextMenu(rowVm.row, $event)"
        >
          {{ rowVm.gutterNumber }}
        </div>
        <div
          v-for="cellVm in rowVm.cells"
          :key="cellVm.name"
          class="grid-cell"
          data-testid="grid-cell"
          :data-row="rowVm.row"
          :data-col-index="cellVm.col"
          :data-column="cellVm.name"
          :data-null="cellVm.isNull"
          :class="cellVm.classes"
          :style="{
            left: `${cellVm.left}px`,
            width: `${cellVm.width}px`,
            scrollMarginTop: `${rowHeight}px`,
            color: cellVm.color || undefined,
          }"
          @mousedown="onCellMouseDown(rowVm.row, cellVm.col, $event)"
          @mouseenter="onCellMouseEnter(rowVm.row, cellVm.col)"
          @click="onCellClick(rowVm.row, cellVm.col, $event)"
          @dblclick="onCellDblClick(rowVm.row, cellVm.col)"
          @contextmenu.prevent="onCellContextMenu(rowVm.row, cellVm.col, $event)"
        >
          <input
            v-if="cellVm.editing"
            v-model="editingBuffer"
            class="cell-input"
            data-testid="grid-cell-input"
            autofocus
            @keydown="onEditKeydown"
            @blur="commitEdit"
            @click.stop
            @mousedown.stop
          />
          <template v-else-if="cellVm.isNull">
            <span class="cell-null">NULL</span>
          </template>
          <template v-else>
            {{ cellVm.text
            }}<span
              v-if="cellVm.truncated"
              class="truncated-marker"
              v-tooltip="'value truncated at 64 KB'"
              >…</span
            >
          </template>
          <button
            v-if="cellVm.navKind"
            type="button"
            class="cell-nav-btn"
            data-testid="cell-nav-button"
            :data-nav-kind="cellVm.navKind"
            :aria-label="cellVm.navKind === 'fk' ? 'Go to referenced row' : 'Referenced by'"
            @click.stop="onCellNavClick(rowVm.row, cellVm.col, $event)"
          >
            <CodiconIcon :name="cellVm.navKind === 'fk' ? 'arrow-right' : 'references'" :size="13" />
          </button>
        </div>
      </div>

      <!-- P24 D5: a pending insert is never hidden by the filter, whatever the query says — its
           *pixel* position follows the display row count (renders after the last visible row),
           but its *identity* (the pseudo row index the gutter click and pendingChanges use) stays
           `page.rowCount + idx`, unchanged. -->
      <div
        v-for="(insert, idx) in insertRows"
        :key="insert.id"
        class="grid-row pending-insert"
        data-testid="grid-row-insert"
        :data-insert-id="insert.id"
        :style="{
          top: `${rowHeight + displayPositionOf((page?.rowCount ?? 0) + idx) * rowHeight}px`,
          height: `${rowHeight}px`,
        }"
        @click="onGutterClick((page?.rowCount ?? 0) + idx, $event)"
      >
        <div class="gutter-cell inserted" :style="{ width: `${GUTTER_WIDTH}px` }">+</div>
        <div
          v-for="c in visibleColumnIndices"
          :key="columnOrder[c]"
          class="grid-cell insert-cell"
          data-testid="grid-cell-insert"
          :style="{ left: `${GUTTER_WIDTH + offsets[c]}px`, width: `${offsets[c + 1] - offsets[c]}px` }"
          @click.stop
        >
          <input
            class="cell-input"
            :value="insert.values[columnOrder[c]] ?? ''"
            @input="onInsertInput($event, insert.id, columnOrder[c])"
            @keydown="wrapSelectionOnType"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.data-grid {
  position: relative;
  height: 100%;
  overflow: auto;
  outline: none;
  font-size: var(--kira-t-md);
}

.grid-sizer {
  position: relative;
}

/* P16 design system's .p-thead/.p-th, adapted for this grid's virtualised (position: absolute)
   rows instead of the primitive's plain flex row — same tokens, same border-strong divider. */
.header-row {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--kira-bg-elevated);
  border-bottom: var(--kira-border-width) solid var(--kira-border-strong);
}

.header-gutter {
  position: sticky;
  left: 0;
  z-index: 3;
  height: 100%;
  background: var(--kira-bg-elevated);
  border-right: var(--kira-border-width) solid var(--kira-border);
  cursor: pointer;
}

.header-gutter:hover {
  background: var(--kira-hover);
}

.header-cell {
  position: absolute;
  top: 0;
  height: 100%;
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
  padding: 0 var(--kira-s-4);
  box-sizing: border-box;
  border-right: var(--kira-border-width) solid var(--kira-border);
  color: var(--kira-fg-muted);
  font-size: var(--kira-t-sm);
  cursor: pointer;
  user-select: none;
}

.header-label {
  color: var(--kira-fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* FIX-8: PK/FK stated as a label, never inferred from colour alone (p-th's own .key). PK stays
   the original warn/yellow; FK is the only one that reads as info/blue. */
.header-key {
  color: var(--kira-warn);
  font-size: var(--kira-t-xs);
  flex-shrink: 0;
}
.header-key.is-fk {
  color: var(--kira-info);
}

/* P31 D34: pinned to the header cell's right edge, out of .header-label's flow, so a long/
   truncated column name never has to share space with it. */
.sort-indicator {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
  flex-shrink: 0;
  color: var(--kira-accent);
}

.sort-order {
  color: var(--kira-accent-fg);
  background: var(--kira-accent);
  font-size: var(--kira-t-xs);
  line-height: 1;
  min-width: 12px;
  height: 12px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 2px;
  flex-shrink: 0;
}

/* A narrow strip at the header cell's left edge, not the sort target (the label/chevron) nor
   the resize handle (the right edge) — click it to select the whole column, mirroring the row
   gutter's click-to-select-row. Kept out of the label's flow so it can never swallow the sort
   click that covers the rest of the cell. */
.header-select-zone {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 10px;
  cursor: pointer;
}

.resize-handle {
  position: absolute;
  top: 0;
  right: -2px;
  width: 4px;
  height: 100%;
  cursor: col-resize;
  z-index: 1;
}

.grid-row {
  position: absolute;
  left: 0;
  right: 0;
  /* Scopes a row's layout invalidation to the row (P29 D8) — not `paint` (the cells already clip
     their own overflow, and the sticky gutter/absolutely-positioned nav button both sit inside
     this box) and not `will-change` (this compositing a ~280 000px-tall sizer trades §2.1 for
     §2.2, the way P12's memory findings warn against). */
  contain: layout;
}

/* No zebra striping — the design's own _gridrows.html/_style.css draws no alternating row
   colour, only the hover state below. */
.grid-row:hover .grid-cell:not(.selected),
.grid-row:hover .gutter-cell {
  background: var(--kira-hover);
}

.gutter-cell {
  position: sticky;
  left: 0;
  z-index: 1;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-right: var(--kira-s-4);
  box-sizing: border-box;
  background: var(--kira-bg-elevated);
  color: var(--kira-fg-disabled);
  font-size: var(--kira-t-xs);
  border-right: var(--kira-border-width) solid var(--kira-border-strong);
  border-bottom: var(--kira-border-width) solid var(--kira-border);
  cursor: pointer;
}

/* README/FIX: a row with a staged edit gets the same 2px warn rail the mockup's
   .tr.dirty .td.gutter::before draws — never a background tint across the whole row.
   `.gutter-cell` is already `position: sticky` (a valid containing block for an absolutely
   positioned child in its own right) — an added `position: relative` here used to override that
   sticky positioning outright (a two-class selector beats the base rule's one), unpinning a
   dirty/deleted/inserted row's index cell so it scrolled away horizontally with the rest of the
   row instead of staying put. */
.gutter-cell.dirty::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--kira-warn);
}

/* P31 D31/F30: a row staged for deletion gets its own red rail — mutually exclusive with .dirty
   above (isDirtyRow no longer counts a delete), since a row headed for deletion will not have any
   staged edits applied. */
.gutter-cell.deleted::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--kira-error);
}

/* A pending-insert row is not "edited" (nothing existing changed) — same 2px rail treatment,
   coloured ok/green instead of warn/yellow so the two staged-change kinds read apart at a glance. */
.gutter-cell.inserted::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--kira-ok);
}

.grid-cell {
  position: absolute;
  top: 0;
  height: 100%;
  display: flex;
  align-items: center;
  padding: 0 var(--kira-s-4);
  box-sizing: border-box;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  border-right: var(--kira-border-width) solid var(--kira-border);
  border-bottom: var(--kira-border-width) solid var(--kira-border);
  cursor: default;
  /* D1: guarantees the native role:'copy'/'paste' accelerators have nothing to act on while
     the grid has focus, so they never race the grid's own local Ctrl+C/Ctrl+V handler. */
  user-select: none;
}

.grid-cell.align-right {
  justify-content: flex-end;
  font-variant-numeric: tabular-nums;
}

.grid-cell.fk {
  color: var(--kira-info);
}

/* The nav button only shows on hover/selected, but the text always truncates before its slot —
   otherwise it's only "over the text" once you're already hovering to click it. */
.grid-cell.has-nav {
  padding-right: calc(var(--kira-s-4) + 18px);
}

/* P42 D21/F15: a per-cell `outline` drew a complete ring around every selected cell — two
   adjacent selected cells' touching edges were two separate 1px lines, one pixel apart, both
   focus-coloured. Each of the four sides is now its own inset box-shadow layer, switched on only
   when that side sits on the selection's own outer perimeter (.sel-t/.sel-r/.sel-b/.sel-l,
   renderRows above) — an internal seam between two selected cells gets no shadow from either
   side, so the selection's outer boundary reads as one uniform 1px line. Custom properties (not
   four separate declarations) are what make this compose: box-shadow's four layers are always
   present, each independently no-op (transparent, zero-sized) until its own edge class overrides
   just that one variable. */
.grid-cell.selected {
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

.grid-cell.selected.sel-t {
  --sel-t: 0 var(--kira-border-width) 0 0 var(--kira-focus);
}

.grid-cell.selected.sel-r {
  --sel-r: calc(-1 * var(--kira-border-width)) 0 0 0 var(--kira-focus);
}

.grid-cell.selected.sel-b {
  --sel-b: 0 calc(-1 * var(--kira-border-width)) 0 0 var(--kira-focus);
}

.grid-cell.selected.sel-l {
  --sel-l: var(--kira-border-width) 0 0 0 var(--kira-focus);
}

.grid-cell.search-match {
  background: var(--kira-search-match);
}

.grid-cell.search-match-current {
  background: var(--kira-search-match-current);
  color: var(--kira-bg);
}

.cell-null {
  color: var(--kira-fg-disabled);
  font-style: italic;
}

.truncated-marker {
  color: var(--kira-fg-muted);
  margin-left: 2px;
  flex-shrink: 0;
}

/* p-td.edited: the warn colour is the whole affordance, never a background tint (that's reserved
   for selection/search) — a selected+edited cell still shows both, exactly like _gridrows.html's
   "sel edited" row. */
.grid-cell.pending-edit {
  color: var(--kira-warn);
}

/* P7 D5/D8: pure-CSS hover/selection affordance, no JS-tracked hover state — mirrors
   .header-select-zone/.resize-handle's own absolute-inside-absolute precedent above. */
.cell-nav-btn {
  display: none;
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: var(--kira-border-width) solid var(--kira-border);
  border-radius: var(--kira-radius-sm);
  background: var(--kira-bg-elevated);
  color: var(--kira-fg-muted);
  cursor: pointer;
  z-index: 1;
}

.cell-nav-btn:hover {
  background: var(--kira-hover);
  color: var(--kira-fg);
}

.grid-cell:hover .cell-nav-btn,
.grid-cell.selected .cell-nav-btn {
  display: flex;
}

.grid-row.pending-delete {
  text-decoration: line-through;
  opacity: 0.5;
}

.grid-row.pending-insert {
  background: color-mix(in srgb, var(--kira-accent) 8%, transparent);
}

/* Transparent, not an opaque fill: this input always sits inside a .grid-cell that already
   carries its own background (blue .selected for a normal edit, the accent-tinted row for an
   insert) — an opaque --kira-bg-input here just blotted out that cell's own colour with plain
   grey the instant you started typing. */
.cell-input {
  width: 100%;
  height: 100%;
  padding: 0;
  margin: 0;
  border: none;
  outline: 1px solid var(--kira-accent);
  outline-offset: -1px;
  background: transparent;
  color: var(--kira-fg);
  font: inherit;
}

/* An outline per input reads fine for the single active inline-edit cell, but every column of a
   freshly-added row gets one at once — the row's own accent tint (.pending-insert above) is
   already enough of a "this is new" signal without every cell boxed in blue too. */
.insert-cell .cell-input {
  outline: none;
}

.no-rows {
  position: absolute;
  inset: 0;
}
</style>
