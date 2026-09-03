<script setup lang="ts">
/**
 * `docs/plans/P4.md` W6: the SlickGrid host. A single `<div ref="host">` and nothing else in the
 * template — every column, row and cell in this panel exists because SlickGrid put it there
 * (§5.3/§5.5), never because a Vue `v-for` iterated the commit set. Everything below the
 * template is `onMounted` construction, `onBeforeUnmount` teardown, and the wires between
 * `GraphViewState`/`SelectionState` (W5) and the grid instance.
 *
 * The grid instance (`grid`) is a plain, `markRaw`'d variable, not a `ref()`: wrapping it in
 * `ref()` would hand Vue's reactivity proxy every DOM node the grid owns, which is the exact
 * mistake §5.3 forbids for the commit store, applied to a grid instead of a store.
 *
 * Selection is *ours*: `SelectionState` (W5), not SlickGrid's own `RowSelectionModel` (which
 * exists for multi-select and cell ranges this app does not want). `getItemMetadata`'s
 * `cssClasses` (`columns.ts`) is what actually paints a selected row; changing selection
 * invalidates exactly the two affected rows (`#watchSelection` below), never the whole grid.
 */
import type { CommitRecord } from "@kira-version/core";
import type { Column } from "slickgrid";
import { SlickGrid } from "slickgrid";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { graphColumnWidth } from "../graph/geometry.ts";
import type { GraphViewState, LayoutRange } from "../state/graphView.ts";
import type { SelectionState } from "../state/selection.ts";
import type { ColumnWidths, DateFormat } from "../state/viewState.ts";
import { rowHeightPx, TokenReader } from "../theme/readTokens.ts";
import { buildColumns, createCommitDataView, DATE_COLUMN_ID } from "./columns.ts";

const props = defineProps<{
  graphView: GraphViewState;
  selection: SelectionState;
  columnWidths: ColumnWidths;
  dateFormat: DateFormat;
  /** A previously persisted scroll target (`viewState.scrollRow`) — applied once, right after
   *  the first paint. Absent on a first-ever mount, where there is nothing to restore. */
  initialScrollRow?: number;
}>();

const emit = defineEmits<{
  (e: "update:columnWidths", widths: ColumnWidths): void;
  (e: "update:dateFormat", format: DateFormat): void;
  /** The top loaded row currently in view — what `viewState.scrollRow` should hold (a row
   *  index, not a pixel offset: it survives a re-walk, a pixel offset does not). */
  (e: "scroll", row: number): void;
  /** A row was clicked twice in a row, or `Enter` was pressed: open the detail pane if it is
   *  closed, close it if it is open. W10/App.vue own the pane's actual open/closed state. */
  (e: "toggleDetail"): void;
  /** `Esc`: close the detail pane unconditionally. */
  (e: "closeDetail"): void;
  /** `F5` or `Ctrl/Cmd+R` while this grid has focus. W10 owns the Refresh action itself. */
  (e: "refresh"): void;
}>();

const MIN_COLUMN_WIDTH = 40;
const MIN_MESSAGE_WIDTH = 120;
const HANDLE_KEY_STEP = 8;

const host = ref<HTMLDivElement | null>(null);
let grid: SlickGrid<CommitRecord> | undefined;
const tokenReader = new TokenReader();

const widths = ref<ColumnWidths>({ ...props.columnWidths });
const dateFormatRef = ref<DateFormat>(props.dateFormat);

// Positions of the three drag handles (message|author, author|date, date|sha), recomputed
// whenever the widths behind them change — see `updateHandlePositions`.
const handleLeftAuthor = ref(0);
const handleLeftDate = ref(0);
const handleLeftSha = ref(0);

let unsubscribeLayout: (() => void) | undefined;
let unsubscribeTokens: (() => void) | undefined;
let resizeObserver: ResizeObserver | undefined;
let resizeRaf = 0;
let scrollRaf = 0;
let previousSelectedRow = -1;

function computeMessageWidth(hostWidth: number, laneCount: number): number {
  const fixed =
    graphColumnWidth(laneCount) + widths.value.author + widths.value.date + widths.value.sha;
  return Math.max(MIN_MESSAGE_WIDTH, hostWidth - fixed);
}

function currentColumns(): Column<CommitRecord>[] {
  const hostWidth = host.value?.clientWidth ?? 0;
  const laneCount = props.graphView.laneCount.value;
  return buildColumns(
    { ...widths.value, laneCount, messageWidth: computeMessageWidth(hostWidth, laneCount) },
    { dateFormat: () => dateFormatRef.value, now: () => Date.now() },
  );
}

function updateHandlePositions(): void {
  const hostWidth = host.value?.clientWidth ?? 0;
  const laneCount = props.graphView.laneCount.value;
  handleLeftAuthor.value = graphColumnWidth(laneCount) + computeMessageWidth(hostWidth, laneCount);
  handleLeftDate.value = handleLeftAuthor.value + widths.value.author;
  handleLeftSha.value = handleLeftDate.value + widths.value.date;
}

function rebuildColumns(): void {
  grid?.setColumns(currentColumns());
  updateHandlePositions();
}

function setColumnWidth(column: keyof ColumnWidths, next: number): void {
  const clamped = Math.max(MIN_COLUMN_WIDTH, Math.round(next));
  if (widths.value[column] === clamped) return;
  widths.value = { ...widths.value, [column]: clamped };
  rebuildColumns();
  emit("update:columnWidths", widths.value);
}

function startDrag(column: keyof ColumnWidths, event: MouseEvent): void {
  event.preventDefault();
  const startX = event.clientX;
  const startWidth = widths.value[column];
  const onMove = (moveEvent: MouseEvent): void => {
    setColumnWidth(column, startWidth + (moveEvent.clientX - startX));
  };
  const onUp = (): void => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

function handleHandleKeydown(column: keyof ColumnWidths, event: KeyboardEvent): void {
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    setColumnWidth(column, widths.value[column] - HANDLE_KEY_STEP);
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    setColumnWidth(column, widths.value[column] + HANDLE_KEY_STEP);
  }
}

function toggleDateFormat(): void {
  dateFormatRef.value = dateFormatRef.value === "relative" ? "absolute" : "relative";
  rebuildColumns();
  grid?.invalidateAllRows();
  grid?.render();
  emit("update:dateFormat", dateFormatRef.value);
}

/** §6.4: "onClick selects the row (and a second click on the selected row toggles the detail
 *  pane closed)". Clicking the date cell specifically also toggles its relative/absolute format
 *  (§6.2) — the two behaviours compose, since a date-cell click is still a row click. */
function handleClick(row: number, cell: number): void {
  const dateColumnIndex =
    grid?.getColumns().findIndex((column) => column.id === DATE_COLUMN_ID) ?? -1;
  if (cell === dateColumnIndex) toggleDateFormat();

  const wasSelected = props.selection.row.value === row;
  props.selection.select(row);
  grid?.focus();
  if (wasSelected) emit("toggleDetail");
}

/** "`onContextMenu` selects the row and does nothing else in P4" (§6.4) — no menu, so the
 *  browser's own context menu is left to appear normally; only selection changes. */
function handleContextMenu(event: MouseEvent): void {
  const cell = grid?.getCellFromEvent(event);
  if (cell) props.selection.select(cell.row);
}

function pageSize(): number {
  if (!grid) return 1;
  const { top, bottom } = grid.getViewport();
  return Math.max(1, bottom - top);
}

function moveSelection(row: number): void {
  const loaded = props.graphView.loadedRows.value;
  const clamped = Math.max(0, Math.min(row, loaded - 1));
  if (clamped < 0) return;
  props.selection.select(clamped);
  grid?.scrollRowIntoView(clamped);
}

/** §6.6's own keyboard model, attached to the grid's host rather than to `grid.onKeyDown` —
 *  `enableCellNavigation: false` means SlickGrid tracks no active cell of its own to key that
 *  event off, and this list is row navigation, not cell navigation, by design (see this file's
 *  own doc comment on why `enableCellNavigation` is off). Listening on `host` rather than one of
 *  the library's internal viewport panes still sees every keydown, since it bubbles. */
function handleKeyDown(event: KeyboardEvent): void {
  const loaded = props.graphView.loadedRows.value;
  const current = props.selection.row.value;
  switch (event.key) {
    case "ArrowUp":
      if (loaded > 0) {
        event.preventDefault();
        moveSelection(current < 0 ? 0 : current - 1);
      }
      break;
    case "ArrowDown":
      if (loaded > 0) {
        event.preventDefault();
        moveSelection(current < 0 ? 0 : current + 1);
      }
      break;
    case "Home":
      if (loaded > 0) {
        event.preventDefault();
        moveSelection(0);
      }
      break;
    case "End":
      if (loaded > 0) {
        event.preventDefault();
        moveSelection(loaded - 1);
      }
      break;
    case "PageUp":
      if (loaded > 0) {
        event.preventDefault();
        moveSelection((current < 0 ? 0 : current) - pageSize());
      }
      break;
    case "PageDown":
      if (loaded > 0) {
        event.preventDefault();
        moveSelection((current < 0 ? 0 : current) + pageSize());
      }
      break;
    case "Enter":
      event.preventDefault();
      emit("toggleDetail");
      break;
    case "Escape":
      event.preventDefault();
      emit("closeDetail");
      break;
    case "F5":
      event.preventDefault();
      emit("refresh");
      break;
    case "r":
    case "R":
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        emit("refresh");
      }
      break;
    default:
      break;
  }
}

/** The row range that just gained lane layout (`GraphViewState.onChunkLayout`, W5) — rebuild the
 *  column set in case `laneCount` grew (the graph column's width formula depends on it), then
 *  invalidate exactly the rows that changed rather than the whole grid. */
function handleChunkLayout(range: LayoutRange): void {
  if (!grid) return;
  rebuildColumns();
  const rows: number[] = [];
  for (let row = range.from; row < range.to; row++) rows.push(row);
  grid.invalidateRows(rows);
  grid.render();
}

function scheduleResize(): void {
  if (resizeRaf !== 0) return;
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = 0;
    grid?.resizeCanvas();
    rebuildColumns();
  });
}

onMounted(() => {
  if (!host.value) return;
  tokenReader.watch();

  const dataView = createCommitDataView({
    store: props.graphView.store,
    loadedRows: () => props.graphView.loadedRows.value,
    isSelected: (row) => props.selection.row.value === row,
  });

  const instance = new SlickGrid<CommitRecord>(host.value, dataView, currentColumns(), {
    rowHeight: rowHeightPx(tokenReader), // §6.1 — never a literal in this file
    enableCellNavigation: false, // §6.6 navigates rows, not cells (see handleKeyDown's doc comment)
    enableColumnReorder: false, // §6.2: resizable, not reorderable — no SortableJS in the loop
    enableHtmlRendering: false, // formatters return elements; no innerHTML, nothing to sanitize
    showColumnHeader: false, // §6.1 — the workbench list this mirrors has no header row
    enableTextSelectionOnCells: true, // subjects/authors/shas are meant to be selectable text
    explicitInitialization: false, // the constructor rendering immediately is what we want here
    minRowBuffer: 3, // render-ahead buffer above/below the viewport, not the whole history
    rowTopOffsetRenderType: "transform", // matches how --kv-row-height drives row positioning
  });
  grid = instance;

  instance.onClick.subscribe((_event, args) => handleClick(args.row, args.cell));
  instance.onScroll.subscribe(() => {
    if (scrollRaf !== 0) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      if (grid) emit("scroll", grid.getViewport().top);
    });
  });

  host.value.addEventListener("keydown", handleKeyDown);
  host.value.addEventListener("contextmenu", handleContextMenu);

  resizeObserver = new ResizeObserver(scheduleResize);
  resizeObserver.observe(host.value);

  unsubscribeLayout = props.graphView.onChunkLayout(handleChunkLayout);

  unsubscribeTokens = tokenReader.onChange(() => {
    if (!grid) return;
    grid.setOptions({ rowHeight: rowHeightPx(tokenReader) });
    grid.invalidateAllRows();
    grid.render();
  });

  updateHandlePositions();
  if (props.initialScrollRow !== undefined) instance.scrollRowIntoView(props.initialScrollRow);
  previousSelectedRow = props.selection.row.value;
});

// `GraphViewState`'s data changes are driven entirely through `onChunkLayout` (registered in
// `onMounted` above) rather than a `watch()` on its scalars — one obvious path for "new rows
// landed" instead of two that could race. `SelectionState.row` is watched here because it can
// change from *outside* this component too (`selectBySha` re-resolving a selection after a
// refresh's re-walk, W11), not only from `handleClick`/keyboard nav, so it needs its own
// always-on two-row invalidation rather than being folded into those call sites.
watch(
  () => props.selection.row.value,
  (row) => {
    if (!grid) return;
    const rows = [previousSelectedRow, row].filter((value) => value >= 0);
    if (rows.length > 0) grid.invalidateRows(rows);
    grid.render();
    previousSelectedRow = row;
  },
);
watch(
  () => props.graphView.loadedRows.value,
  () => {
    grid?.updateRowCount();
    grid?.render();
  },
);
watch(
  () => props.graphView.generation.value,
  () => {
    grid?.invalidateAllRows();
    grid?.updateRowCount();
    grid?.render();
  },
);

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  if (resizeRaf !== 0) cancelAnimationFrame(resizeRaf);
  if (scrollRaf !== 0) cancelAnimationFrame(scrollRaf);
  unsubscribeLayout?.();
  unsubscribeTokens?.();
  tokenReader.dispose();
  host.value?.removeEventListener("keydown", handleKeyDown);
  host.value?.removeEventListener("contextmenu", handleContextMenu);
  grid?.destroy();
  grid = undefined;
});
</script>

<template>
  <div ref="host" class="kv-commit-grid" data-testid="commit-grid">
    <div
      class="kv-resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize author column"
      tabindex="0"
      :style="{ left: `${handleLeftAuthor}px` }"
      @mousedown="startDrag('author', $event)"
      @keydown="handleHandleKeydown('author', $event)"
    ></div>
    <div
      class="kv-resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize date column"
      tabindex="0"
      :style="{ left: `${handleLeftDate}px` }"
      @mousedown="startDrag('date', $event)"
      @keydown="handleHandleKeydown('date', $event)"
    ></div>
    <div
      class="kv-resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sha column"
      tabindex="0"
      :style="{ left: `${handleLeftSha}px` }"
      @mousedown="startDrag('sha', $event)"
      @keydown="handleHandleKeydown('sha', $event)"
    ></div>
  </div>
</template>

<style>
/*
 * The ~80 structural lines SlickGrid needs (§6.1): the library's own stylesheets are not
 * imported (they carry Bootstrap/Salesforce/Material palettes), so viewport, row and cell
 * positioning live here, mapped only to the --kv-* token layer. This file is the only place in
 * the repository where a .slick-* selector appears (W6's own "Done when").
 */
.kv-commit-grid {
  position: relative;
  height: 100%;
  width: 100%;
  overflow: hidden;
  font-family: var(--kv-font-family);
  font-size: var(--kv-font-size);
  color: var(--kv-row-fg);
}

.kv-commit-grid .slick-viewport,
.kv-commit-grid .grid-canvas {
  background-color: var(--kv-panel-bg);
}

.kv-commit-grid .slick-row {
  background-color: transparent;
}

.kv-commit-grid .slick-row:hover {
  background-color: var(--kv-row-hover-bg);
}

.kv-commit-grid .slick-row.kv-row-selected {
  background-color: var(--kv-row-selected-bg);
  color: var(--kv-row-selected-fg);
}

.kv-commit-grid .slick-row.kv-row-head {
  font-weight: 600;
}

.kv-commit-grid .slick-cell {
  border: none;
  padding: 0 var(--kv-space-2);
  display: flex;
  align-items: center;
  overflow: hidden;
}

/* The graph cell alone needs overflow: visible — W8's row overdraw (0.5px past the row's own
   band, so two rows' vertical runs meet without a hairline seam at a fractional DPR) draws
   slightly outside its own cell bounds by design. */
.kv-commit-grid .kv-cell-graph {
  padding: 0;
  overflow: visible;
}

.kv-graph-cell {
  width: 100%;
  height: 100%;
  display: block;
  overflow: visible;
}

.kv-graph-svg {
  display: block;
  overflow: visible;
}

.kv-cell-message,
.kv-cell-author {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kv-cell-date {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  cursor: pointer;
}

.kv-cell-sha {
  font-family: var(--kv-mono-font-family);
  font-size: var(--kv-mono-font-size);
  background: transparent;
  border: none;
  padding: 0;
  color: var(--kv-row-fg);
  opacity: 0.75;
  cursor: not-allowed;
}

/* §6.1's own resize handles (showColumnHeader: false costs SlickGrid's built-in header resize
   handles, which live in the header this grid doesn't render) — 5px wide, absolutely positioned
   over the grid, spanning its full height. */
.kv-resize-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 5px;
  margin-left: -2px;
  cursor: col-resize;
  z-index: 2;
  background: transparent;
}

.kv-resize-handle:hover,
.kv-resize-handle:focus-visible {
  background-color: var(--kv-focus-border);
  outline: none;
}
</style>
