<script setup lang="ts">
import type { TabularPage } from '@shared/protocol/page';
import type {
  Column,
  CustomDataView,
  FormatterResultWithText,
  OnClickEventArgs,
  SlickEventData,
} from 'slickgrid';
import { SlickEventHandler } from 'slickgrid';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { publishSelectedCell } from '../../state/cellSelection';
import { appearanceVersion, settingsState } from '../../state/settings';
import { type CellClassFlags, cellClass } from '../../theme/cellClass';
import { categoryForTypeClass } from '../../theme/icons';
import {
  alignmentFor,
  columnHeaderTooltip,
  DEFAULT_COLUMN_WIDTH,
  GUTTER_WIDTH,
  initialWidths,
  resetMeasureCtx,
} from '../shared/page/columns';
import {
  createGridDataSource,
  type DisplayRowIndex,
  displayPositionOf,
  type GridDataSourceState,
  type RowHandle,
} from '../shared/slick/dataSource';
import { KiraSlickGrid } from '../shared/slick/kiraSlickGrid';
import '../shared/slick/slickTheme.css';
import 'slickgrid/dist/styles/css/slick.grid.css';
import { cell, getPage } from './resultPages';
import { type Match, matchedRows, searchState } from './search';

// P30 §3 — the console result grid's tabular branch, migrated off @tanstack/vue-virtual onto the
// same KiraSlickGrid/dataSource.ts/slickTheme.css layer views/grid/SlickGridHost.vue already uses
// (F1's own table: that host itself is bound to a data tab and cannot be reused directly, but the
// layer beneath it has no such dependency). A console result has no pager, no sort, no
// pending-changes, no persisted column widths/order and no selection *ranges* — every one of
// SlickGridHost.vue's other features exists to serve those, so this file only wires the handful
// that a read-only result set actually needs: gutter, cell colour/alignment, a one-cell selection
// highlight, and (added across §3.6's later commits) search and the decode-window report.
//
// §3.5 rule 1: the scroll mechanism (KiraSlickGrid's runway/budget/chase) is inherited, never
// re-derived — `grid.velocity`/`lastScrollEventAt`/`scrollEventSeq` are wired the same four-field
// way SlickGridHost.vue's own onMounted does, from a velocity sampler copied structurally from
// that file (`:532-623`).
// §3.5 rule 2: no Vue reactivity on row data — grid/dataSource/viewport/handlers below are plain
// `let`s, never `ref`/`shallowRef`/`reactive`; every imperative call into the grid happens from a
// `watch` callback or a DOM event handler, never from inside a `computed`.
// §3.5 rule 3: a formatter returns text, never DOM.
const props = defineProps<{
  pageKey: string;
  tabId: string;
  connectionId: string | null;
  path: string;
}>();

// Column<T>'s own `field` type can't be satisfied by RowHandle's shape (arbitrary db column
// names) — same escape hatch kiraSlickGrid.ts/SlickGridHost.vue already use.
// biome-ignore lint/suspicious/noExplicitAny: see comment above.
type KiraColumn = Column<any>;

const GUTTER_FIELD = '__kira_gutter';

function gutterFormatter(
  _row: number,
  _cell: number,
  _value: unknown,
  _columnDef: KiraColumn,
  dataContext: RowHandle,
): string {
  return String(dataContext.row + 1);
}

// §3.5 rule 3 / `-iter2-pacing` D5: NULL and truncated fold onto the cell's own className via
// `FormatterResultWithText.addClasses` rather than building a child node — mirrors
// SlickGridHost.vue's own cellFormatter, minus the FK/PK nav and pending-insert branches (a
// console result has neither).
function cellFormatter(
  _row: number,
  _cell: number,
  value: unknown,
  _columnDef: KiraColumn,
  _dataContext: RowHandle,
): string | FormatterResultWithText {
  const view = value as { text: string; isNull: boolean; truncated: boolean };
  if (view.isNull) return { text: 'NULL', addClasses: 'cell-null' };
  if (view.truncated) {
    return { text: view.text, addClasses: 'cell-truncated', toolTip: 'value truncated at 64 KB' };
  }
  return view.text;
}

// P42 D19/D20 — the header tooltip has to be written as attributes by hand (SlickGrid's own
// `Column` shape carries no child markup), mirroring SlickGridHost.vue's own `tooltipAttrs`: the
// hover controller (`workbench/state/tooltip.ts`) triggers off `data-kira-tip` (the plain,
// newline-joined text) and only then reads `data-kira-tip-parts` for the structured content, so
// both attributes are required, not just the structured one.
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

// §3.4: no persisted column widths — always the measured/default width, reset on every remount
// (`:key="pageKey"` in ConsoleResultGrid.vue). §3.4: every column gets `sortable: false` (no
// re-query path); the gutter alone is unselectable/unfocusable ("nothing selects a row here").
function buildColumns(page: TabularPage): KiraColumn[] {
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
      cellAttrs: { 'data-testid': 'console-result-gutter-cell' },
    },
  ];
  const measured = initialWidths(page);
  page.columns.forEach((col, i) => {
    const classes = [`tc-${categoryForTypeClass(col.typeClass)}`];
    if (alignmentFor(col) === 'right') classes.push('kira-align-right');
    const tooltip = columnHeaderTooltip(col, col.dataType);
    cols.push({
      id: col.name,
      field: col.name,
      name: col.name,
      width: measured[col.name] ?? DEFAULT_COLUMN_WIDTH,
      minWidth: 40,
      resizable: true,
      sortable: false,
      cssClass: classes.join(' '),
      formatter: cellFormatter,
      cellAttrs: {
        'data-testid': 'console-result-cell',
        'data-column': col.name,
        'data-col-index': String(i),
      },
      headerCellAttrs: {
        'data-testid': 'console-result-header-cell',
        'data-column': col.name,
        ...tooltipAttrs(tooltip),
      },
    });
  });
  return cols;
}

const rowHeight = computed(() => (settingsState.appearance.rowDensity === 'compact' ? 22 : 28));

const rootRef = ref<HTMLElement | null>(null);

// §3.5 rule 2 — never a ref/shallowRef/reactive (CodeMirrorHost.vue's/SlickGridHost.vue's own
// rule, restated here).
let grid: KiraSlickGrid | null = null;
let eventHandler: SlickEventHandler | null = null;
let dataSource: ReturnType<typeof createGridDataSource> | null = null;
let viewportEl: HTMLElement | null = null;
let resizeObserver: ResizeObserver | null = null;
let page: TabularPage | null = null;
let fieldToCol = new Map<string, number>();

// Mirrors SlickGridHost.vue's own onScroll velocity sampler verbatim (`:528-603`) — plain
// variables, not refs, read only from KiraSlickGrid's own `velocity` callback, itself called only
// from inside getRenderedRange (entirely outside Vue's reactivity graph).
let lastOffset = 0;
let lastOffsetT = 0;
let prevOffset = 0;
let prevOffsetT = 0;
let scrollEventSeq = 0;
const MAX_PLAUSIBLE_ROW_VELOCITY_PX_PER_FRAME = 800;

function freshVelocitySample(): boolean {
  return window.__kiraGridTuning?.freshVelocitySampleOverride ?? true;
}

function recordOffsetSample(offset: number, now: number): void {
  if (freshVelocitySample() && offset === lastOffset) return;
  prevOffset = lastOffset;
  prevOffsetT = lastOffsetT;
  lastOffset = offset;
  lastOffsetT = now;
}

function velocity(): { pxPerFrame: number; direction: 1 | -1 | 0 } {
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

function onViewportScroll(): void {
  const el = viewportEl;
  if (!el) return;
  scrollEventSeq++;
  recordOffsetSample(el.scrollTop, performance.now());
}

// P22 Pass B, C1/§5 D10 — the one per-render DOM pass this migration still needs: a row's own
// `data-row` (SlickGrid writes the *display position* there) is corrected to the *page* row every
// other subsystem (the cell editor panel, search) addresses a row by. Idempotent by construction:
// a `.slick-row` already carrying `data-kira-row-tagged` is skipped. F4/D10 — the row div is
// cloned per frozen pane; only the right (data) pane's clone gets
// `data-testid="console-result-row"`, matching the incumbent VirtualList's own one-testid-per-row.
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
    if (el.closest('.grid-canvas-right')) {
      el.dataset.testid = 'console-result-row';
    }
  }
}

function fieldAtCol(colIdx: number): string | undefined {
  const c = grid?.getColumns()[colIdx];
  return c ? String(c.field) : undefined;
}

// §3.4: no `SlickHybridSelectionModel` (a console result never has more than one cell selected at
// once — P43 iter2 D22's own finding, carried over) — `enableCellNavigation: true` (below) plus
// this click handler plus a single-entry `setCellCssStyles` layer give the same visual result at
// O(1) instead of registering the full selection-range plugin for a shape it never needs.
function onGridClick(_e: SlickEventData, args: OnClickEventArgs): void {
  if (!grid || !dataSource || !page || args.cell === 0) return; // the gutter selects nothing
  const field = fieldAtCol(args.cell);
  if (!field) return;
  const pageCol = fieldToCol.get(field);
  if (pageCol === undefined) return;
  const column = page.columns[pageCol];
  if (!column) return;
  const handle = dataSource.getItem(args.row);
  grid.setCellCssStyles('kira-cell-selected', { [args.row]: { [field]: 'kira-cell-selected' } });
  const view = cell(props.pageKey, handle.row, pageCol);
  publishSelectedCell({
    tabId: props.tabId,
    connectionId: props.connectionId,
    path: props.path,
    columnIndex: pageCol,
    column,
    row: handle.row,
    value: view.isNull ? null : view.text,
    truncated: view.truncated,
    hasPrimaryKey: column.isPrimaryKey,
    // No onEdit/onRevert: a console result has no addressable row/table to write a change back
    // to, so this stays view-only in the cell editor panel — same as ConsoleResultGrid.vue's own
    // former `selectTabularCell`.
  });
}

// P40 D10/D17: the same "hide non-matching rows" toggle grid/documents/keyvalue share (P24 D2) —
// `matchedRows(tabId)` is the filter *and* the data source (C12/§5 D12's own precedent in
// SlickGridHost.vue): a filtered row keeps its real page-row number in the gutter.
function dataSourceState(): GridDataSourceState {
  return {
    index: { displayRows: matchedRows(props.tabId), pageRowCount: page?.rowCount ?? 0 },
    inserts: [],
    extractValue: (item, field) => cell(props.pageKey, item.row, fieldToCol.get(field) ?? -1),
  };
}

function classesFrom(flags: CellClassFlags): string[] {
  return Object.keys(cellClass(flags));
}

// §3.5: "the highlight is two keyed setCellCssStyles layers" — every match, and (if any) the
// current one. Not clipped to the rendered band (unlike the one-cell selection layer's neighbour
// in SlickGridHost.vue, `kira-search` there is deliberately unclipped too — D5's own table): a
// search result is not bounded the way a rendered band is.
function refreshSearchLayer(): void {
  if (!grid || !page) return;
  const entry = searchState[props.tabId];
  const matches = entry?.matches ?? [];
  const matchHash: Record<number, Record<string, string>> = {};
  const currentHash: Record<number, Record<string, string>> = {};
  if (matches.length > 0) {
    const idx: DisplayRowIndex = {
      displayRows: matchedRows(props.tabId),
      pageRowCount: page.rowCount,
    };
    const matchClass = classesFrom({ searchMatch: true })[0] ?? 'search-match';
    const currentClass = classesFrom({ searchMatchCurrent: true })[0] ?? 'search-match-current';
    for (const m of matches) {
      const name = page.columns[m.col]?.name;
      if (!name) continue;
      const pos = displayPositionOf(idx, m.row);
      matchHash[pos] ??= {};
      (matchHash[pos] as Record<string, string>)[name] = matchClass;
    }
    const current = entry && entry.index >= 0 ? matches[entry.index] : undefined;
    const currentName = current && page.columns[current.col]?.name;
    if (current && currentName) {
      currentHash[displayPositionOf(idx, current.row)] = { [currentName]: currentClass };
    }
  }
  grid.setCellCssStyles('kira-search', matchHash);
  grid.setCellCssStyles('kira-search-current', currentHash);
}

// The find toolbar's go-to-match (P40 D10) — ConsoleResultGrid.vue delegates here for the tabular
// branch. `rowIndices`' own position lookup (the incumbent VirtualList's approach) has no
// counterpart here: SlickGrid addresses a row by display *position*, so this goes straight through
// the same displayPositionOf arithmetic the search layer above uses.
function goToMatch(match: Match): void {
  if (!grid || !page) return;
  const idx: DisplayRowIndex = {
    displayRows: matchedRows(props.tabId),
    pageRowCount: page.rowCount,
  };
  const pos = displayPositionOf(idx, match.row);
  grid.scrollRowIntoView(pos);
  grid.setActiveCell(pos, match.col + 1); // +1: the frozen gutter occupies display column 0
}
defineExpose({ goToMatch });

onMounted(() => {
  const el = rootRef.value;
  if (!el) return;

  const p = getPage(props.pageKey);
  // The caller only mounts this component for a tabular result (ConsoleResultGrid.vue's own
  // `page.kind === 'tabular'` gate) — this narrows the type, it never fires in practice.
  if (p?.kind !== 'tabular') return;
  page = p;
  fieldToCol = new Map(p.columns.map((c, i) => [c.name, i]));

  dataSource = createGridDataSource(dataSourceState());

  el.style.setProperty('--kira-header-row-height', `${rowHeight.value}px`);

  grid = new KiraSlickGrid(el, dataSource as CustomDataView<RowHandle>, buildColumns(p), {
    rowHeight: rowHeight.value,
    // F7 — Sortable.js is never loaded; this app never drags a header to reorder.
    enableColumnReorder: false,
    // F6 — cell text is untrusted database content.
    enableHtmlRendering: false,
    // F1 — this app measures column widths itself (columns.ts's own canvas-based initialWidths).
    autosizeColsMode: 'LegacyOff',
    // §5 item 5 (SlickGridHost.vue) — the sticky row-number gutter as a real frozen pane, which is
    // F4's own fix for the incumbent VirtualList's row-number-scrolls-away defect.
    frozenColumn: 0,
    // F3 addendum — the viewport's native `overflow:auto` plus its native `scroll` listener are
    // sufficient on their own; SlickGrid's own wheel handler would discard native momentum.
    enableMouseWheelScrollHandler: false,
    // §3.4 — the one *addition* over the incumbent: keyboard cell navigation, free once a data
    // column's own default `focusable`/`selectable` (both true) let it hold the active cell.
    enableCellNavigation: true,
    enableAddRow: false,
    // §3.4: read-only, no editor, no inline edit trigger.
    editable: false,
    autoEdit: false,
    autoCommitEdit: true,
    asyncEditorLoading: false,
    editorCellNavOnLRKeys: false,
    explicitInitialization: false,
    dataItemColumnValueExtractor: (item: RowHandle, columnDef: KiraColumn) =>
      dataSource?.extractValue(item, String(columnDef.field)),
  });
  grid.velocity = velocity;
  grid.lastScrollEventAt = () => lastOffsetT;
  grid.scrollEventSeq = () => scrollEventSeq;

  eventHandler = new SlickEventHandler();
  eventHandler.subscribe(grid.onRendered, tagRenderedRows);
  eventHandler.subscribe(grid.onClick, onGridClick);

  viewportEl = grid.getViewports()[1] ?? grid.getViewports()[0] ?? null;
  if (viewportEl) {
    lastOffset = viewportEl.scrollTop;
    lastOffsetT = performance.now();
    viewportEl.addEventListener('scroll', onViewportScroll, { passive: true });
  }
  grid.render();
  // C12/§5 D12 precedent (SlickGridHost.vue) — a tab switch (not a fresh run) can remount this
  // component onto a result that already has a completed search from before it was last hidden.
  refreshSearchLayer();

  resizeObserver = new ResizeObserver(() => grid?.resizeCanvas());
  resizeObserver.observe(el);
});

onUnmounted(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (viewportEl) viewportEl.removeEventListener('scroll', onViewportScroll);
  eventHandler?.unsubscribeAll();
  eventHandler = null;
  // §9.1/F8 (SlickGridHost.vue) — `true` also nulls SlickGrid's own internal element references
  // and unbinds every listener the library itself registered; the app forgetting this call was
  // the whole risk (KiraSlickGrid's own `destroy` override additionally fixes the library's
  // capture-flag `bindAncestorScrollEvents` leak — inherited here for free).
  grid?.destroy(true);
  grid = null;
  dataSource = null;
  viewportEl = null;
  page = null;
});

watch(rowHeight, (h) => {
  if (!grid) return;
  rootRef.value?.style.setProperty('--kira-header-row-height', `${h}px`);
  grid.setOptions({ rowHeight: h });
  grid.updateRowCount();
  grid.render();
});

// P31 D11/F13 — a font change leaves every unstored column sized for whatever font was active
// when columns.ts's shared measuring context was first created, for the rest of the session.
watch(
  () => appearanceVersion.n,
  () => {
    if (!grid || !page) return;
    resetMeasureCtx();
    grid.setColumns(buildColumns(page));
    grid.render();
  },
);

// C12/§5 D12 precedent — the filter *is* the data source: `matchedRows(tabId)` tracks both the
// search toolbar's own scan result and its "filter to matches" toggle reactively.
watch(
  () => matchedRows(props.tabId),
  () => {
    if (!grid || !dataSource) return;
    dataSource.setState(dataSourceState());
    grid.updateRowCount();
    grid.invalidateAllRows();
    grid.render();
    refreshSearchLayer();
  },
);

// C12/§5 D5 precedent — `kira-search`'s own trigger: a scan publishing a new/updated result, or
// goNext/goPrev moving the current match. The signature is result identity + current index +
// pending, not the matches themselves — rebuilding the whole hash is refreshSearchLayer's own job.
watch(
  () => {
    const entry = searchState[props.tabId];
    return entry ? `${entry.matches.length}:${entry.index}:${entry.pending ? 1 : 0}` : '';
  },
  () => refreshSearchLayer(),
);
</script>

<template>
  <!-- §3.7 item 1: type-based cell colour is new for the console — the same class toggle
       SlickGridHost.vue's own root carries, extending P9's rowColoring setting to console results
       (this migration's own recommendation; see the plan's §3.7/§12). `.slick-grid-host` is what
       scopes every rule in slickTheme.css — imported globally by this file, not relied on from
       SlickGridHost.vue, so a console panel never depends on a data tab having been opened first. -->
  <div
    class="slick-grid-host"
    :class="{ 'kira-grid--row-coloring': settingsState.appearance.rowColoring }"
  >
    <div ref="rootRef" class="slick-grid-mount"></div>
  </div>
</template>
