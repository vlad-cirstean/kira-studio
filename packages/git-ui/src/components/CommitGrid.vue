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
import type { CommitRecord } from '@kira/git-core';
import type { Column, OnRenderedEventArgs } from 'slickgrid';
import { SlickGrid } from 'slickgrid';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { graphColumnWidth } from '../graph/geometry.ts';
import { createGraphFormatter } from '../graph/graphColumn.ts';
import type { GraphViewState, LayoutRange } from '../state/graphView.ts';
import type { PrState } from '../state/pr.ts';
import type { SearchState } from '../state/search.ts';
import type { SelectionState } from '../state/selection.ts';
import type { StackState } from '../state/stack.ts';
import { type ColumnWidths, type DateFormat, DEFAULT_COLUMN_WIDTHS } from '../state/viewState.ts';
import { compactRowHeightPx, rowHeightPx, TokenReader } from '../theme/readTokens.ts';
import { buildColumns, createCommitDataView } from './columns.ts';
import { formatAbsoluteDate, formatRelativeDate, measureAbsoluteDateWidth } from './dateFormat.ts';
import { composeRowLabel } from './rowAccessibility.ts';

const props = defineProps<{
  graphView: GraphViewState;
  selection: SelectionState;
  columnWidths: ColumnWidths;
  dateFormat: DateFormat;
  /** A previously persisted scroll target (`viewState.scrollRow`) — applied once, right after
   *  the first paint. Absent on a first-ever mount, where there is nothing to restore. */
  initialScrollRow?: number;
  /** P11 W13: the message column's own in-place highlight source — optional so a caller with
   *  nothing to search yet (none, currently; W14 is the first to instantiate a real one from
   *  `App.vue`) gets plain, unhighlighted subjects, mirroring `columns.ts`'s own
   *  `MessageSearchContext` default. */
  search?: SearchState;
  /** G24 D9: the graph indicator's own PR source — optional so a caller with nothing to show yet
   *  gets a plain, badge-free message column, mirroring `search`'s own default. */
  pr?: PrState;
  /** G26 D-4.13: the message column's own stack-decoration source — optional so a caller with no
   *  stack view mounted gets plain, undecorated branch badges, mirroring `pr`'s own default. */
  stack?: StackState;
  /** G-UX D1 (item 1a): the detail pane's own open/closed state, mirrored from `App.vue`'s
   *  `detailOpen` ref. `true` drops `author`/`date` to `compact: true` (`columns.ts`) and reflows
   *  their width into `message` — everything they show already renders in the pane the click just
   *  opened, so keeping them is pure duplication that starves the one column that is not. */
  detailOpen: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:columnWidths', widths: ColumnWidths): void;
  /** The top loaded row currently in view — what `viewState.scrollRow` should hold (a row
   *  index, not a pixel offset: it survives a re-walk, a pixel offset does not). */
  (e: 'scroll', row: number): void;
  /** A row already selected was clicked again, or `Enter` was pressed: open the detail pane if
   *  it is closed, close it if it is open. W10/App.vue own the pane's actual open/closed state. */
  (e: 'toggleDetail'): void;
  /** G-UX D2: an unselected row's first click — opens the detail pane unconditionally (never
   *  closes it), so clicking a different row while the pane is already open keeps it open. */
  (e: 'openDetail'): void;
  /** `Esc`: close the detail pane unconditionally. */
  (e: 'closeDetail'): void;
  /** `F5` or `Ctrl/Cmd+R` while this grid has focus. W10 owns the Refresh action itself. */
  (e: 'refresh'): void;
  /** `docs/plans/P6.md` W14: a right-click, `Shift+F10`, or the Menu key on a row — `App.vue`
   *  owns the actual `RowContextMenu.vue` instance (it is the one place with both `ops` and the
   *  commit store's decorations at hand), so this only ever reports which row and where to open
   *  it, exactly as `scroll`/`toggleDetail` report rather than acting on them. */
  (e: 'contextMenu', detail: { row: number; x: number; y: number }): void;
  /** `docs/plans/P7.md` W14: a right-click landed on a ref badge (`refBadges.ts`'s
   *  `data-ref-kind`/`data-ref-name`), not merely the row underneath it — `App.vue` opens the
   *  branch-scoped menu instead of the commit menu. The row is still selected either way
   *  (`handleContextMenu`'s own doc comment says why); this fires *instead of* `contextMenu`,
   *  never alongside it. */
  (
    e: 'refContextMenu',
    detail: { kind: 'branch' | 'remoteBranch'; name: string; x: number; y: number },
  ): void;
  /** `docs/plans/P9.md` W14: the stash counterpart of `refContextMenu` — a right-click landed on
   *  a stash badge (`refBadges.ts`'s `refKind: "stash"`). Reported as a plain row index rather
   *  than a parsed `stash@{N}`/sha pair: the row IS the stash commit (its own decoration already
   *  carries the exact index, and its `sha` field the exact sha), so `App.vue` reads both back
   *  from the store instead of this component re-deriving them from badge text. */
  (e: 'stashContextMenu', detail: { row: number; x: number; y: number }): void;
}>();

const MIN_COLUMN_WIDTH = 40;
const MAX_COLUMN_WIDTH = 600;
const MIN_MESSAGE_WIDTH = 120;
const HANDLE_KEY_STEP = 8;
// G21 D6b: mirrors `--kv-s-2` (density.css), `.slick-cell`'s own horizontal padding — one
// side; `measureAbsoluteDateWidth`'s own caller doubles it for both sides of the cell.
const CELL_PADDING_PX = 4;

const host = ref<HTMLDivElement | null>(null);
const dateWidthProbe = ref<HTMLSpanElement | null>(null);
let grid: SlickGrid<CommitRecord> | undefined;
const tokenReader = new TokenReader();

const widths = ref<ColumnWidths>({ ...props.columnWidths });

/** G21 D6b: the measured pixel width the absolute date format actually needs at the current
 *  font/zoom — `0` until the probe first resolves (always synchronous in practice; there is no
 *  SSR here) so a `Math.max(DEFAULT_COLUMN_WIDTHS.date, 0)` read before that never regresses the
 *  relative-format default. Used both as the first-ever-mount seed (`onMounted` below) and as
 *  the date column's own minimum drag width (`minWidthFor`), replacing the global
 *  `MIN_COLUMN_WIDTH` for that one column so it cannot be dragged back into the clipping state
 *  item 6 is about. */
const measuredDateWidth = ref(0);

function remeasureDateWidth(): void {
  const probe = dateWidthProbe.value;
  if (!probe) return;
  const font = getComputedStyle(probe).font;
  measuredDateWidth.value = Math.ceil(measureAbsoluteDateWidth(font) + 2 * CELL_PADDING_PX);
}

/** Every column but `date` keeps the global floor; `date`'s own measured minimum (once known)
 *  replaces it, never shrinks below it — `Math.max` covers a `measuredDateWidth` of `0` (not yet
 *  measured) falling back to the global floor exactly like every other column. */
function minWidthFor(column: keyof ColumnWidths): number {
  return column === 'date' ? Math.max(MIN_COLUMN_WIDTH, measuredDateWidth.value) : MIN_COLUMN_WIDTH;
}

// Built once per mounted grid (W8): closes over this instance's own LayoutStore/CommitStore
// (props.graphView is assumed stable for the life of one CommitGrid — a repo switch remounts
// this component rather than swapping graphView underneath it) and a rowHeight accessor so a
// `--kv-row-height` change is picked up on the next render without rebuilding this formatter.
// P7 (item 1): `rowHeight` is now per-row (`grid.getRowHeight(row)`, since rows vary), read
// through `grid` itself rather than a fixed token — `grid` is declared above and assigned in
// `onMounted`, before any row is ever actually rendered, so this closure never sees it undefined
// in practice; the `?? compactRowHeightPx` fallback only matters for a formatter call that could
// theoretically race construction. `compactRowHeight` feeds `nodeCenterY`'s own formula (§1.3 of
// the plan): the node's y always sits `compactRowHeight / 2` above the row's own bottom edge,
// regardless of how tall the row actually is.
const graphFormatter = createGraphFormatter(
  props.graphView.layout,
  props.graphView.store,
  (row) => grid?.getRowHeight(row) ?? compactRowHeightPx(tokenReader),
  () => compactRowHeightPx(tokenReader),
);

// Positions of the two drag handles (message|author, author|date), recomputed whenever the
// widths behind them change — see `updateHandlePositions`. (G21 D5: a third, date|sha, handle
// existed here until the sha column itself was deleted.)
const handleLeftAuthor = ref(0);
const handleLeftDate = ref(0);

let unsubscribeLayout: (() => void) | undefined;
let unsubscribeTokens: (() => void) | undefined;
let resizeObserver: ResizeObserver | undefined;
let resizeRaf = 0;
let scrollRaf = 0;
let previousSelectedRow = -1;

// W14: the row a click or a keyboard move just selected, so the accessibility pass below can
// move real DOM focus onto it the moment it next renders (`selection scrolls it into view first,
// focuses second` — the plan's own words). Never set for a selection that changes for a reason
// other than this component's own click/keyboard handling (e.g. App.vue re-resolving a selection
// by sha after a refresh) — those must not steal focus from wherever the user actually is.
let pendingFocusRow: number | null = null;

// W14: the row index that currently, genuinely holds real DOM focus, independent of
// `pendingFocusRow` above. A row's DOM node is destroyed and recreated by *any*
// `invalidateRows`/`render()` call that touches it, not only the selection-driven one
// `moveSelection`/`handleClick` trigger — `handleChunkLayout` (graph layout streaming in from
// the layout worker, W5) does the same for whatever range it touches, entirely independently and
// asynchronously of any selection change. When a `hugeRepo`-sized scenario's layout worker is
// still delivering chunks well after the grid is already interactable, one of those chunks can
// touch the very row the user just tabbed onto or selected — recreating its DOM node moments
// after `applyAccessibility` already focused it once, which the browser resolves by silently
// reverting focus to `<body>` (an element *removal*, not a user-driven `Tab`; a genuine, observed
// race, not a hypothetical one). `pendingFocusRow` alone only re-focuses a row on the *one*
// render immediately following a selection change, so it cannot catch this: by the time the
// second, unrelated render arrives, it has already been consumed. `focusedRowIndex` instead
// tracks "the row the user is actually on" persistently, refreshed by every genuine `focusin`
// (`handleFocusIn` below) and cleared only when focus genuinely lands somewhere that is not a
// row — never by the implicit, targetless bounce to `<body>` a DOM removal causes, which fires no
// `focusin` at all. `applyAccessibility` re-focuses this row on *every* render that recreates it,
// for as long as it remains the one the user is on, closing the race `pendingFocusRow` alone
// leaves open.
//
// G21 D5: this used to also track which of a row's *two* focusable elements — the row div or its
// `kv-cell-sha` copy button (P5 W10) — the user was actually on, since a background render (the
// layout worker's still-arriving chunks) could recreate the row's DOM node out from under
// whichever one currently held focus. The sha column and its button are gone; a row's own div is
// its only focusable element now, so that second piece of state goes with it.
let focusedRowIndex: number | null = null;

function handleFocusIn(event: FocusEvent): void {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const rowAttr = target.closest('.slick-row')?.getAttribute('data-row');
  focusedRowIndex = rowAttr != null ? Number(rowAttr) : null;
}

function computeMessageWidth(hostWidth: number, laneCount: number): number {
  // G-UX D1: with the detail pane open, `author`/`date` are not rendered at all (`currentColumns`
  // passes `compact: true`) — the width they would have reserved goes to the subject instead.
  const reserved = props.detailOpen ? 0 : widths.value.author + widths.value.date;
  const fixed = graphColumnWidth(laneCount) + reserved;
  return Math.max(MIN_MESSAGE_WIDTH, hostWidth - fixed);
}

/** `undefined` whenever there is nothing to highlight: no `search` prop at all, an empty/invalid
 *  query, or `scope: "refs"` (the message column has nothing to do with a ref-only search — §7.8's
 *  own field list for that scope never includes `subject`). Re-read on every render pass by
 *  `columns.ts`'s `messageFormatter`, never captured once, so this component only ever needs to
 *  trigger a re-render (the `search.searchGeneration` watcher below), not a column rebuild, when
 *  the pattern changes. */
function searchPattern(): RegExp | undefined {
  const search = props.search;
  if (search === undefined || search.scope.value === 'refs') return undefined;
  const compiled = search.compiled.value;
  return compiled.kind === 'ok' ? compiled.pattern : undefined;
}

/** G26 D-4.13: `columns.ts`'s own `StackContext.stackInfoFor` — a plain scan over the current
 *  `stack.list` result (never a memoized `Map`: the branch count a stack view realistically holds
 *  is small, and this only runs for a row that actually carries a branch decoration, F12's own
 *  "re-read on every render pass" contract, not once per grid render). `undefined` for a branch
 *  that is not a stack member at all — `refBadges.ts`'s own "render nothing" rule. */
function stackInfoFor(branchName: string): { stacked: boolean; stale: boolean } | undefined {
  const stackState = props.stack;
  if (stackState === undefined) return undefined;
  for (const summary of stackState.stacks.value) {
    const row = summary.branches.find((b) => b.name === branchName);
    if (row !== undefined) return { stacked: true, stale: row.state === 'needsRestack' };
  }
  if (stackState.orphans.value.some((o) => o.name === branchName)) {
    return { stacked: true, stale: true };
  }
  return undefined;
}

function currentColumns(): Column<CommitRecord>[] {
  const hostWidth = host.value?.clientWidth ?? 0;
  const laneCount = props.graphView.laneCount.value;
  return buildColumns(
    { ...widths.value, laneCount, messageWidth: computeMessageWidth(hostWidth, laneCount) },
    { dateFormat: () => props.dateFormat, now: () => Date.now() },
    graphFormatter,
    { pattern: searchPattern },
    {
      // G21 D4: the row-bold/HEAD-ring and merge-in edge colouring already read this same
      // LayoutStore for this same row — a row past its own `rowCount` (layout not arrived yet)
      // gets no lane class, matching `graphColumn.ts`'s own already-established "no layout, no
      // colour" case, never a guessed one.
      colorOf: (row) =>
        row < props.graphView.layout.rowCount ? props.graphView.layout.colorOf(row) : undefined,
    },
    {
      // G24 D9: `undefined` (not an empty array) is "nothing resolved yet" vs. "resolved, no PR"
      // — `columns.ts`'s own `messageFormatter` already treats both as "render nothing", so this
      // accessor only needs to pass `PrState.bySha`'s own map lookup straight through.
      prsFor: (sha) => props.pr?.bySha.value.get(sha),
    },
    { stackInfoFor },
    { compact: props.detailOpen },
  );
}

function updateHandlePositions(): void {
  // G-UX D1: no handles are rendered in compact mode (`v-if` below) — a handle for a column that
  // is not there would be a dead hit target, so this skips the computation entirely rather than
  // just leaving it unused.
  if (props.detailOpen) return;
  const hostWidth = host.value?.clientWidth ?? 0;
  const laneCount = props.graphView.laneCount.value;
  handleLeftAuthor.value = graphColumnWidth(laneCount) + computeMessageWidth(hostWidth, laneCount);
  handleLeftDate.value = handleLeftAuthor.value + widths.value.author;
}

/** G32 round-3 performance review, finding #7: `handleChunkLayout` (below) used to call
 *  `rebuildColumns()` unconditionally on EVERY streamed chunk, even though its own doc comment
 *  says the only reason it needs to is "`laneCount` grew" — a full `setColumns()` is a real
 *  SlickGrid structural rebuild (new header cells, a fresh column-position stylesheet, `left`
 *  offsets recomputed for every column), and a large history streams in dozens of 500-row chunks
 *  whose lane count is unchanged from the previous chunk far more often than not. Tracked here
 *  (rather than inside `rebuildColumns` itself) because every OTHER caller — the `detailOpen`
 *  watcher, `scheduleResize`'s own host-width changes, mount — has its own unconditional reason to
 *  rebuild regardless of lane count (compact mode changes the column set's shape; a resize changes
 *  `messageWidth`), so only `handleChunkLayout`'s call is gated. */
let lastRebuiltLaneCount = -1;

function rebuildColumns(): void {
  // G-UX (item 9): resizeCanvas() BEFORE setColumns() — SlickGrid's own cached canvas width has
  // to already reflect the host's current size before the new column set (and its `left` offsets)
  // is written, or the columns are laid out against a stale width. Without this, the detailOpen
  // watcher below used to call setColumns() alone (stale, pane-open width) and a ResizeObserver
  // rAF one frame later called resizeCanvas()+rebuildColumns() again (the true, final width) —
  // two different offsets painted a frame apart read as the columns sliding into place.
  grid?.resizeCanvas();
  grid?.setColumns(currentColumns());
  updateHandlePositions();
  lastRebuiltLaneCount = props.graphView.laneCount.value;
}

function setColumnWidth(column: keyof ColumnWidths, next: number): void {
  const clamped = Math.min(MAX_COLUMN_WIDTH, Math.max(minWidthFor(column), Math.round(next)));
  if (widths.value[column] === clamped) return;
  widths.value = { ...widths.value, [column]: clamped };
  rebuildColumns();
  emit('update:columnWidths', widths.value);
}

function startDrag(column: keyof ColumnWidths, event: MouseEvent): void {
  event.preventDefault();
  const startX = event.clientX;
  const startWidth = widths.value[column];
  const onMove = (moveEvent: MouseEvent): void => {
    setColumnWidth(column, startWidth + (moveEvent.clientX - startX));
  };
  const onUp = (): void => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

function handleHandleKeydown(column: keyof ColumnWidths, event: KeyboardEvent): void {
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    setColumnWidth(column, widths.value[column] - HANDLE_KEY_STEP);
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    setColumnWidth(column, widths.value[column] + HANDLE_KEY_STEP);
  }
}

/** G-UX D2 (item 1b): a click on an unselected row opens the detail pane on the FIRST click —
 *  clicking the already-selected row still toggles it closed (the only mouse-only way to close
 *  it, agreeing with `Esc` and the narrow-breakpoint drawer). G-UX D8 (item 8): the date cell no
 *  longer has any click behaviour of its own — the relative/absolute toggle lives in the Display
 *  settings section now, so a click anywhere on the row means exactly one thing. */
function handleClick(row: number): void {
  const wasSelected = props.selection.row.value === row;
  props.selection.select(row);
  pendingFocusRow = row;
  if (wasSelected) emit('toggleDetail');
  else emit('openDetail');
}

/** §6.4: "right-click selects the row [first]", then (P6 W14) opens `RowContextMenu.vue` at the
 *  click point — the browser's own native menu is suppressed now that there is a real one to
 *  show instead of P4's "nothing else". `docs/plans/P7.md` W14 adds one hit-test ahead of that:
 *  a click landing on a ref badge (`refBadges.ts`'s `data-ref-kind`) opens the branch-scoped menu
 *  instead — the row is still selected either way (this is about which menu opens, not whether
 *  the click also selects), and a click one pixel to the side of a badge (no `data-ref-kind`
 *  ancestor) falls straight through to the commit menu, unchanged. */
function handleContextMenu(event: MouseEvent): void {
  event.preventDefault();
  const cell = grid?.getCellFromEvent(event);
  if (!cell) return;
  props.selection.select(cell.row);

  const badgeEl =
    event.target instanceof Element ? event.target.closest<HTMLElement>('[data-ref-kind]') : null;
  const refKind = badgeEl?.dataset.refKind;
  const refName = badgeEl?.dataset.refName;
  if (refKind === 'branch' || refKind === 'remoteBranch') {
    if (refName !== undefined) {
      emit('refContextMenu', { kind: refKind, name: refName, x: event.clientX, y: event.clientY });
      return;
    }
  }
  if (refKind === 'stash') {
    emit('stashContextMenu', { row: cell.row, x: event.clientX, y: event.clientY });
    return;
  }

  emit('contextMenu', { row: cell.row, x: event.clientX, y: event.clientY });
}

/** `Shift+F10`/the Menu key (§6.6): opens the same menu `handleContextMenu` does, anchored to
 *  the selected row's own bounding rect rather than a click point that does not exist for a
 *  keyboard invocation. */
function openMenuFromKeyboard(row: number): void {
  if (!grid) return;
  const container = grid.getContainerNode();
  const rowNode = container.querySelector<HTMLElement>(`.slick-row[data-row="${row}"]`);
  const rect = rowNode?.getBoundingClientRect();
  emit('contextMenu', { row, x: rect?.left ?? 0, y: rect?.bottom ?? 0 });
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
  pendingFocusRow = clamped;
  grid?.scrollRowIntoView(clamped);
}

/**
 * §6.6's own keyboard model. Wired through `grid.onKeyDown` (not a plain `host` DOM listener —
 * see `onMounted`'s subscription for why): SlickGrid's own `handleKeyDown`, bound to its internal
 * focus sink *and* to the canvas every row lives in (so it also runs when a row itself — W14's own
 * roving-`tabindex` target — holds real DOM focus, not only the sink), intercepts `PageUp`/
 * `PageDown` unconditionally — `handled = true` regardless of `enableCellNavigation`
 * (`slick.grid.js`'s own `e.which === keyCode.PAGE_DOWN ? (this.navigatePageDown(), handled = !0)
 * : ...`) — and calls `stopPropagation()`, so those two keys never reach a listener on `host` at
 * all; `enableCellNavigation: false` spares every *other* key SlickGrid's own switch would
 * otherwise claim, `Tab`/`Shift+Tab` included (`navigateNext`/`navigatePrev` both bottom out in
 * `navigate()`'s own `!this._options.enableCellNavigation` guard, an unconditional `false`).
 *
 * Returns whether this function actually acted on the key — `onMounted`'s subscription calls
 * `event.stopImmediatePropagation()` only when it did (see that call site's own comment for why
 * this matters for `Tab` specifically: this function's caller is exactly where SlickGrid decides
 * whether to `preventDefault()` a keydown, so claiming a key we did nothing with would silently
 * block the browser's own default behaviour for it — `Tab` leaving the grid, most of all).
 */
function handleKeyDown(event: KeyboardEvent): boolean {
  const loaded = props.graphView.loadedRows.value;
  const current = props.selection.row.value;
  switch (event.key) {
    case 'ArrowUp':
      if (loaded === 0) return false;
      event.preventDefault();
      moveSelection(current < 0 ? 0 : current - 1);
      return true;
    case 'ArrowDown':
      if (loaded === 0) return false;
      event.preventDefault();
      moveSelection(current < 0 ? 0 : current + 1);
      return true;
    case 'Home':
      if (loaded === 0) return false;
      event.preventDefault();
      moveSelection(0);
      return true;
    case 'End':
      if (loaded === 0) return false;
      event.preventDefault();
      moveSelection(loaded - 1);
      return true;
    case 'PageUp':
      if (loaded === 0) return false;
      event.preventDefault();
      moveSelection((current < 0 ? 0 : current) - pageSize());
      return true;
    case 'PageDown':
      if (loaded === 0) return false;
      event.preventDefault();
      moveSelection((current < 0 ? 0 : current) + pageSize());
      return true;
    case 'Enter':
      event.preventDefault();
      emit('toggleDetail');
      return true;
    case 'Escape':
      event.preventDefault();
      emit('closeDetail');
      return true;
    case 'F5':
      event.preventDefault();
      emit('refresh');
      return true;
    case 'r':
    case 'R':
      if (!event.ctrlKey && !event.metaKey) return false;
      event.preventDefault();
      emit('refresh');
      return true;
    case 'F10':
      if (!event.shiftKey || current < 0) return false;
      event.preventDefault();
      openMenuFromKeyboard(current);
      return true;
    case 'ContextMenu':
      if (current < 0) return false;
      event.preventDefault();
      openMenuFromKeyboard(current);
      return true;
    default:
      return false;
  }
}

// W15: `kira:layout-complete` fires exactly once, the first time a `LayoutChunk` is applied and
// re-rendered — see App.vue's own doc comment on why it moved here rather than firing at mount.
let layoutCompleteMarked = false;

/** The row range that just gained lane layout (`GraphViewState.onChunkLayout`, W5) — rebuild the
 *  column set in case `laneCount` grew (the graph column's width formula depends on it), then
 *  invalidate exactly the rows that changed rather than the whole grid. */
function handleChunkLayout(range: LayoutRange): void {
  if (!grid) return;
  if (props.graphView.laneCount.value !== lastRebuiltLaneCount) rebuildColumns();
  const rows: number[] = [];
  for (let row = range.from; row < range.to; row++) rows.push(row);
  grid.invalidateRows(rows);
  grid.render();
  if (!layoutCompleteMarked) {
    layoutCompleteMarked = true;
    performance.mark('kira:layout-complete');
    performance.measure('kira:layout-complete', undefined, 'kira:layout-complete');
  }
}

function scheduleResize(): void {
  if (resizeRaf !== 0) return;
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = 0;
    grid?.resizeCanvas();
    rebuildColumns();
  });
}

/**
 * `docs/plans/P4.md` W14, "the whole of the above is one function called from
 * `onRendered({startRow, endRow})`, applied to the rows in that range": counts, selection,
 * roving focus and each row's composed accessible name, all from state this component already
 * holds. Cheap by construction — it only ever touches rows SlickGrid just built (a handful of
 * `setAttribute` calls per row, the same order as the row's own construction), never the whole
 * loaded history.
 *
 * `container`/rendered-row lookups go through `grid.getContainerNode()` rather than `host.value`
 * directly — they are the same element (SlickGrid's own `_container`, the constructor's first
 * argument), but reading it back off the grid instance keeps this function honest about only ever
 * touching DOM the library itself owns and rendered, not assuming anything about this component's
 * own template.
 */
function applyAccessibility(range: { startRow: number; endRow: number }): void {
  if (!grid) return;
  const container = grid.getContainerNode();
  const totalRows = props.graphView.loadedRows.value;
  const columns = grid.getColumns();
  container.setAttribute('aria-rowcount', String(totalRows));
  container.setAttribute('aria-colcount', String(columns.length));

  const selectedRow = props.selection.row.value;
  // No row selected yet (a fresh mount with nothing persisted): row 0, if it exists, is the one
  // tab stop into the grid — the ARIA grid pattern's own answer to "what receives focus before
  // anything has been chosen" (a plain `Tab` must land somewhere real, never nothing at all, once
  // `_focusSink`/`_focusSink2` below are taken out of the tab order).
  const tabbableRow = selectedRow >= 0 ? selectedRow : 0;

  const from = Math.max(0, range.startRow);
  const to = Math.min(range.endRow, totalRows - 1);
  for (let row = from; row <= to; row++) {
    const rowNode = container.querySelector<HTMLElement>(`.slick-row[data-row="${row}"]`);
    if (!rowNode) continue;

    rowNode.setAttribute('aria-rowindex', String(row + 1));
    const isSelected = row === selectedRow;
    rowNode.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    rowNode.tabIndex = row === tabbableRow ? 0 : -1;

    const commit = props.graphView.store.commitAt(row);
    const dateText =
      props.dateFormat === 'absolute'
        ? formatAbsoluteDate(commit.author.timestamp)
        : formatRelativeDate(commit.author.timestamp, Date.now());
    rowNode.setAttribute('aria-label', composeRowLabel(commit, dateText));

    const cells = rowNode.querySelectorAll<HTMLElement>('.slick-cell');
    for (const [index, cellNode] of cells.entries()) {
      cellNode.setAttribute('aria-colindex', String(index + 1));
    }
    // The graph column carries no information the row's own aria-label does not (§7.9) — lane
    // colour is decorative, and HEAD/stash/branch-vs-tag are all named in the label already.
    rowNode.querySelector('.kv-cell-graph')?.setAttribute('aria-hidden', 'true');

    // Either this row was just explicitly selected (`pendingFocusRow` — always the row div itself,
    // matching "selection scrolls it into view first, focuses second") or it is the row the user
    // was already on (`focusedRowIndex`) and this render just recreated its DOM node out from
    // under it — both cases need a *new* node focused; `focusedRowIndex`'s own doc comment above
    // explains why a one-shot `pendingFocusRow` check alone is not enough.
    //
    // `{ preventScroll: true }` is load-bearing, not a micro-optimisation: a freshly re-appended
    // row is added at the *end* of its DOM sibling list (its own doc comment on `handleClick`'s
    // sibling, `pendingFocusRow`, plus `commitList.spec.ts`'s own `rowByIndex` doc comment — "DOM
    // order no longer matches row order") and only *visually* placed back at the right spot via
    // its `transform: translateY(...)` inline style. A bare `.focus()` triggers the browser's own
    // implicit scroll-into-view, which was directly observed (via a `Node.prototype.removeChild`
    // trace) to use the row's untransformed *layout* position rather than its transformed visual
    // one — scrolling the real viewport to wherever the row landed in raw DOM order, not where it
    // is drawn. That scroll fires SlickGrid's own `handleScroll`, which runs its usual
    // `cleanupRows()` pass against the *new* (wrong) scroll position and evicts the very row this
    // function just focused — a real, reproduced keyboard-trap-adjacent bug on `hugeRepo`-sized
    // scenarios, where the eviction lands on no later `onRendered` pass to recover it, leaving
    // focus stranded on `<body>`. This grid already scrolls the target row into view correctly
    // itself (`moveSelection`'s own `grid.scrollRowIntoView` call, run *before* this ever fires) —
    // the browser's own heuristic has nothing left to usefully do here, only harm to avoid.
    const wasPendingFocus = pendingFocusRow === row;
    if (wasPendingFocus) pendingFocusRow = null;
    if (wasPendingFocus) {
      rowNode.focus({ preventScroll: true });
    } else if (row === focusedRowIndex) {
      rowNode.focus({ preventScroll: true });
    }
  }
}

onMounted(() => {
  if (!host.value) return;
  tokenReader.watch();

  // G21 D6b: measured before the grid's first column build, so a first-ever mount's seed is
  // right from the very first paint rather than only after a later rebuild.
  remeasureDateWidth();
  if (props.initialScrollRow === undefined) {
    // `initialScrollRow` is only ever passed when `App.vue` found real persisted state to
    // restore (its own prop doc comment) — absent means this is a genuine first-ever mount, the
    // one case D6a/D6b's seed is for. A persisted width (even one that happens to equal
    // `DEFAULT_COLUMN_WIDTHS.date`, e.g. a user who explicitly chose it) is never overridden.
    const seeded = Math.max(DEFAULT_COLUMN_WIDTHS.date, measuredDateWidth.value);
    if (seeded !== widths.value.date) widths.value = { ...widths.value, date: seeded };
  }

  const dataView = createCommitDataView({
    store: props.graphView.store,
    loadedRows: () => props.graphView.loadedRows.value,
    isSelected: (row) => props.selection.row.value === row,
    // P7 (item 1): a row with a ref/PR badge gets the taller, expanded height —
    // `rowMetadata`/`rowHasBadges` (columns.ts) are what actually decide "does this row have one".
    expandedRowHeight: () => rowHeightPx(tokenReader),
    prsFor: (sha) => props.pr?.bySha.value.get(sha),
  });

  const instance = new SlickGrid<CommitRecord>(host.value, dataView, currentColumns(), {
    // P7 (item 1): the grid-level default is now the COMPACT height — an undecorated row (no
    // ref/PR badge) is the common case, and `getItemMetadata` only ever asks for the taller,
    // expanded one explicitly (`enableVariableRowHeight` below).
    rowHeight: compactRowHeightPx(tokenReader), // §6.1 — never a literal in this file
    enableVariableRowHeight: true, // P7 (item 1): height varies with whether a row has a badge
    enableCellNavigation: false, // §6.6 navigates rows, not cells (see handleKeyDown's doc comment)
    enableColumnReorder: false, // §6.2: resizable, not reorderable — no SortableJS in the loop
    enableHtmlRendering: false, // formatters return elements; no innerHTML, nothing to sanitize
    showColumnHeader: false, // §6.1 — the workbench list this mirrors has no header row
    enableTextSelectionOnCells: true, // subjects/authors are meant to be selectable text
    explicitInitialization: false, // the constructor rendering immediately is what we want here
    minRowBuffer: 3, // render-ahead buffer above/below the viewport, not the whole history
    rowTopOffsetRenderType: 'transform', // matches how --kv-row-height drives row positioning
  });
  grid = instance;
  // Matches the laneCount currentColumns() just used to build the grid's initial column set above
  // — otherwise the very first streamed chunk would trigger one redundant rebuild even when its
  // laneCount already agrees with what mount just built.
  lastRebuiltLaneCount = props.graphView.laneCount.value;

  // W14/V2: SlickGrid's own internal structural elements — `_focusSink`/`_focusSink2` (two
  // invisible divs it binds its own keyboard handling to) and, less obviously, six `.slick-pane`,
  // four `.slick-viewport` and four `.grid-canvas` wrapper divs it always constructs regardless of
  // this grid's single-pane, unfrozen configuration — are *all* created with a literal
  // `tabindex="0"` (confirmed against the compiled source, not assumed from the `.d.ts`, which
  // types `_focusSink`/`_focusSink2` `protected` despite them being genuine public JS fields at
  // runtime). Most of those fourteen sit at 0×0 (no frozen columns/rows means their right/bottom
  // counterparts render empty) and a real browser already skips a zero-area stop, but
  // `.slick-pane-top-left`/`.slick-viewport-top-left` are not zero-sized — they are exactly as
  // large as the grid itself and sit in the DOM before any row, so without this sweep `Tab` lands
  // on one of *them*, never on a row. The row-level roving `tabindex` `applyAccessibility`
  // maintains below is the real tab stop this grid wants; this sweep is only the precondition —
  // none of these fourteen may still carry a `tabindex="0"` once it runs. Done once, right after
  // construction and before any row has been given a `tabindex` of its own, so it can safely
  // target every remaining `[tabindex="0"]` under the container without also catching a row.
  // Removing an element from the tab order does not stop a script-invoked `.focus()` from still
  // reaching it (`tabIndex` only governs `Tab`-key reachability) — moot here regardless, since
  // this grid no longer calls `grid.focus()` anywhere (`handleClick`/`moveSelection`'s own
  // `pendingFocusRow` focuses a row directly instead). Removing the `tabindex` attribute outright
  // (rather than setting the `.tabIndex` IDL property to `-1`, which leaves a literal
  // `tabindex="-1"` in the DOM) matters for more than tidiness: axe's `aria-required-children`
  // check for `role="grid"` containers treats *any* child bearing an explicit `tabindex` attribute
  // — any value — as a non-transparent element that must itself be a valid grid child, which these
  // plain structural wrapper divs are not. Removing the attribute keeps them transparent for that
  // computation.
  for (const el of instance.getContainerNode().querySelectorAll<HTMLElement>('[tabindex="0"]')) {
    el.removeAttribute('tabindex');
  }

  instance.onRendered.subscribe((_event, args: OnRenderedEventArgs) => applyAccessibility(args));
  // The constructor above already performed the grid's first render (`explicitInitialization:
  // false`) before this subscription existed to hear about it — `onRendered` is a plain
  // publish/subscribe event, not a replayed one, so that first pass gets the accessibility
  // attributes applied here explicitly rather than by waiting for whatever render happens next.
  const initialRange = instance.getRenderedRange();
  applyAccessibility({ startRow: initialRange.top, endRow: initialRange.bottom });

  instance.onClick.subscribe((_event, args) => handleClick(args.row));
  instance.onScroll.subscribe(() => {
    if (scrollRaf !== 0) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      if (grid) emit('scroll', grid.getViewport().top);
    });
  });
  // `stopImmediatePropagation()` only for a key `handleKeyDown` actually claimed — see that
  // function's own doc comment. Claiming *every* key unconditionally (this project's own earlier
  // approach, before W14) was safe for every key our own switch names, but not for `Tab`:
  // SlickGrid's `handleKeyDown` calls `e.preventDefault()` whenever `handled` ends up `true` by
  // the time it finishes, regardless of *which* code path set it there, so an unconditional
  // `stopImmediatePropagation()` here silently blocked the browser's own `Tab`-key focus
  // navigation the moment a row (rather than the inert `_focusSink`) could hold real DOM focus —
  // exactly the "no keyboard trap" failure W14's own keyboard-only pass exists to catch.
  instance.onKeyDown.subscribe((event) => {
    const handled = handleKeyDown(event.getNativeEvent<KeyboardEvent>());
    if (handled) event.stopImmediatePropagation();
  });

  host.value.addEventListener('contextmenu', handleContextMenu);
  // `document`, not `host.value`: `focusedRowIndex`'s own doc comment above needs to know when
  // focus lands anywhere that is *not* a row, including this grid's own resize handles (siblings
  // of `host`, not descendants — a plain SVG/DOM-tree ancestor listener would miss those) and
  // every other focusable element in the panel (the toolbar, the detail pane).
  document.addEventListener('focusin', handleFocusIn);

  resizeObserver = new ResizeObserver(scheduleResize);
  resizeObserver.observe(host.value);

  unsubscribeLayout = props.graphView.onChunkLayout(handleChunkLayout);

  unsubscribeTokens = tokenReader.onChange(() => {
    // G21 D6b: a font-size/family change (now tracked alongside row-height, readTokens.ts) can
    // widen or narrow the absolute date format's own rendered width — re-measure so the date
    // column's minimum drag width stays honest, even though nothing here forces the column's
    // *current* width to follow (a user-narrowed relative-format column stays exactly as narrow
    // as they left it; `.kv-cell-date`'s own ellipsis is the safety net for that case).
    remeasureDateWidth();
    if (!grid) return;
    grid.setOptions({ rowHeight: compactRowHeightPx(tokenReader) });
    // P7 (item 1): the token driving `rowHeightProvider` (via `getItemMetadata`'s `height`) just
    // changed for every row that has one, without a row-count change — exactly the case
    // `invalidateRowHeights`'s own doc comment calls out as needing an explicit call.
    grid.invalidateRowHeights();
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
// P11 W13: mirrors the `generation` watcher directly above — a new `searchGeneration` means the
// message column's own highlight source (`searchPattern` above) may have changed, so every row's
// formatter must re-run; `updateRowCount()` has no reason to run alongside it, since a search
// never changes how many rows are loaded.
watch(
  () => props.search?.searchGeneration.value,
  () => {
    grid?.invalidateAllRows();
    grid?.render();
  },
);
// G24 D9: mirrors the `search.searchGeneration` watcher directly above — a third instance of the
// same pattern. A new PR resolution never changes how many rows are loaded, same reasoning as
// `search.searchGeneration`'s own doc comment.
watch(
  () => props.pr?.generation.value,
  () => {
    grid?.invalidateAllRows();
    grid?.render();
  },
);
// G26 D-4.13: mirrors the `pr.generation` watcher directly above — the fourth instance of the
// same pattern (F12). A new stack resolution never changes how many rows are loaded either.
watch(
  () => props.stack?.generation.value,
  () => {
    grid?.invalidateAllRows();
    grid?.render();
  },
);
// G-UX D1: the detail pane opening/closing changes the column model itself (compact vs. full),
// unlike every watcher above — a full `rebuildColumns()`, not just an invalidate/render.
// G-UX (item 9): `flush: 'post'` — this must run AFTER Vue has applied the pane's own width
// change to the DOM (App.vue's `detailWidthPx`/the pane unmounting), so `host.clientWidth` (read
// inside `rebuildColumns()` -> `currentColumns()`/`resizeCanvas()`) already reflects the grid's
// true final width instead of the pane-open one.
watch(
  () => props.detailOpen,
  () => rebuildColumns(),
  { flush: 'post' },
);
// G-UX D8 (item 8): the date format is now a Display setting (`RepoSettingsDialog.vue`), not a
// per-cell toggle — mirrors the `generation`/`searchGeneration`/`pr`/`stack` watchers above.
watch(
  () => props.dateFormat,
  () => {
    grid?.invalidateAllRows();
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
  host.value?.removeEventListener('contextmenu', handleContextMenu);
  document.removeEventListener('focusin', handleFocusIn);
  grid?.destroy();
  grid = undefined;
});

/** `App.vue` (W11) calls this once a refresh's re-walk re-resolves a previously selected sha
 *  back to a (possibly different) row — `initialScrollRow` only ever applies once, at mount
 *  (see its own doc comment above), so a refresh that happens later needs an imperative path
 *  back to the same underlying `scrollRowIntoView` call. */
function scrollToRow(row: number): void {
  grid?.scrollRowIntoView(row);
}

/** G-UX item 2/D10: an auto-refresh's own viewport restore — `App.vue` captures
 *  `getViewport().top` before a background refresh and calls this with it afterward, so the
 *  user's scroll position wins over the selection's own `scrollRowIntoView` (the concern
 *  `RefreshButton.vue` originally raised for why auto-refresh did not exist). Distinct from
 *  `scrollToRow`, which centers a target row rather than pinning it to the viewport's top. */
function scrollToTopRow(row: number): void {
  grid?.scrollRowToTop(row);
}

/** The row currently pinned at the viewport's top — `App.vue`'s own capture half of the
 *  auto-refresh viewport restore, paired with `scrollToTopRow` above. */
function getViewportTop(): number | undefined {
  return grid?.getViewport().top;
}

/** `docs/plans/P11.md` W14: `SearchBox.vue`'s second-stage `Escape` (§6.6) asks to move real DOM
 *  focus back onto the grid — the same row `applyAccessibility`'s own roving tabindex already
 *  made the one native tab stop (the selected row, or row 0 with nothing selected yet). Scrolled
 *  into view first, exactly as a real click/keyboard selection already does elsewhere in this
 *  file (`moveSelection`'s own "scrolls it into view first, focuses second"). Unlike
 *  `moveSelection`, the row here is very likely *already* selected — this is "give focus back to
 *  what is already chosen", not "choose something new" — so `props.selection.select(row)` alone
 *  cannot be relied on to trigger the selection watcher's own invalidate/render (a same-value
 *  `select()` call is a no-op): `invalidateRows`/`render()` are called directly instead, which is
 *  what actually runs `onRendered` → `applyAccessibility` and lets `pendingFocusRow` take effect.
 *  A no-op with nothing loaded yet (`loadedRows === 0`) — there is no row to focus. */
function focusGrid(): void {
  if (!grid || props.graphView.loadedRows.value === 0) return;
  const row = Math.max(0, props.selection.row.value);
  grid.scrollRowIntoView(row);
  pendingFocusRow = row;
  grid.invalidateRows([row]);
  grid.render();
}

defineExpose({ scrollToRow, focusGrid, scrollToTopRow, getViewportTop });
</script>

<template>
  <div class="kv-commit-grid" data-testid="commit-grid">
    <!-- SlickGrid's own `init()` (`Utils.emptyElement(this._container)`) wipes out whatever was
         inside its container the moment it constructs — including these resize handles, if they
         were this element's own children. `host` is SlickGrid's *exclusive* DOM: the handles are
         its siblings, absolutely positioned over it via `.kv-commit-grid`'s own `position:
         relative` above, not descendants a `new SlickGrid(host.value, ...)` call would delete. -->
    <div ref="host" class="kv-grid-host"></div>
    <!-- G21 D6b: an off-screen probe carrying .kv-cell-date's own font-affecting rules, purely so
         `remeasureDateWidth` has a real element to read a computed `font` shorthand from — never
         shown, never a fifth grid column. -->
    <span ref="dateWidthProbe" class="kv-cell-date kv-date-width-probe" aria-hidden="true"></span>
    <div
      v-if="!detailOpen"
      class="kv-resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize author column"
      :aria-valuenow="widths.author"
      :aria-valuemin="MIN_COLUMN_WIDTH"
      :aria-valuemax="MAX_COLUMN_WIDTH"
      :aria-valuetext="`${widths.author} pixels`"
      tabindex="0"
      :style="{ left: `${handleLeftAuthor}px` }"
      @mousedown="startDrag('author', $event)"
      @keydown="handleHandleKeydown('author', $event)"
    ></div>
    <div
      v-if="!detailOpen"
      class="kv-resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize date column"
      :aria-valuenow="widths.date"
      :aria-valuemin="minWidthFor('date')"
      :aria-valuemax="MAX_COLUMN_WIDTH"
      :aria-valuetext="`${widths.date} pixels`"
      tabindex="0"
      :style="{ left: `${handleLeftDate}px` }"
      @mousedown="startDrag('date', $event)"
      @keydown="handleHandleKeydown('date', $event)"
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
  /* §6.3's own "Done when": a panel dragged to zero height is a real thing a user can do, and a
     grid asked to lay out a zero-height viewport is where a division-by-viewport-height bug
     would live. One row's worth of floor keeps that arithmetic away from zero. */
  min-height: var(--kv-row-height);
  overflow: hidden;
  font-family: var(--kv-font-family);
  font-size: var(--kv-font-size);
  color: var(--kv-row-fg);
}

/* SlickGrid's own container, sized to fill `.kv-commit-grid` exactly — see the template's own
   comment on why this cannot be `.kv-commit-grid` itself. */
.kv-grid-host {
  height: 100%;
  width: 100%;
}

/* G21 D6b: never painted, never laid out into the visible flow — `remeasureDateWidth`'s only use
   for this element is `getComputedStyle(…).font`, which needs a connected element to resolve the
   cascade but nothing about its own box. */
.kv-date-width-probe {
  position: absolute;
  visibility: hidden;
  pointer-events: none;
  white-space: nowrap;
}

/* SlickGrid's own dynamic stylesheet (`createCssRules`, `applyColumnWidths`) only ever writes
   `height`/`left`/`right` onto these elements — never `position`. Its own upstream CSS (not
   imported here, see this block's own opening comment) is what makes those declarations do
   anything at all: a `left` on a statically-positioned cell is a no-op, and a `transform:
   translateY()` on a statically-positioned row stacks *on top of* normal document flow instead
   of replacing it, doubling every row's effective offset. These four rules are that minimum,
   copied from `slick.grid.css`'s own `.slick-pane`/`.slick-viewport`/`.grid-canvas`/`.slick-row`/
   `.slick-cell` selectors (upstream also gates the row rule on `.ui-widget-content`, the class
   SlickGrid always adds to every row alongside `.slick-row`, so it's included here rather than
   widening the selector to something upstream doesn't actually rely on). */
.kv-commit-grid .slick-pane {
  position: absolute;
  outline: 0;
  overflow: hidden;
  width: 100%;
}

.kv-commit-grid .slick-viewport,
.kv-commit-grid .grid-canvas {
  position: relative;
  outline: 0;
  background-color: var(--kv-panel-bg);
}

.kv-commit-grid .slick-viewport {
  width: 100%;
}

.kv-commit-grid .slick-row.ui-widget-content {
  position: absolute;
  border: 0;
  width: 100%;
  background-color: transparent;
  /* G-UX D2 (item 1b): every row opens/toggles the detail pane on click — the whole row reads as
   *  clickable, not only `.kv-cell-date` (whose own `cursor: pointer` this cascades onto too,
   *  `cursor` being an inherited property; that per-cell rule is removed once item 8 relocates
   *  the date-format toggle off the cell entirely). `enableTextSelectionOnCells: true` still lets
   *  a pointer-cursor row be drag-selected for its text. */
  cursor: pointer;
}

/* G-UX (item 1): the checked-out row's own subtle background tint + left accent bar — placed
   BEFORE :hover/.kv-row-selected below (equal specificity throughout this file's own rows,
   (0,3,0) each; the LAST matching rule wins a tie), so hovering or selecting a HEAD row still
   shows the hover/selection background on top of this one, not the reverse. font-weight has no
   such ordering concern (hover/selected never set it), so it stays on this same rule rather than
   splitting into two. */
.kv-commit-grid .slick-row.kv-row-head {
  font-weight: 600;
  background-color: color-mix(in srgb, var(--kv-focus-border) 9%, transparent);
  box-shadow: inset 2px 0 0 0 var(--kv-focus-border);
}

.kv-commit-grid .slick-row:hover {
  background-color: var(--kv-row-hover-bg);
}

.kv-commit-grid .slick-row.kv-row-selected {
  background-color: var(--kv-row-selected-bg);
  color: var(--kv-row-selected-fg);
}

/* A border-only ref badge (tag/remote/stash/overflow — every `refBadges.ts` kind except
   `.kv-badge-local`, which used to always fill its own OPAQUE background and so never depend on
   the row's) carries its own decoration colour as both `color` and `border-color`, tuned against
   the row's *un*selected background. A selected row with, say, a green `v1.0.0` tag badge fails
   contrast for real (P5 W14's own axe scan on the commit-detail pane's populated state, the first
   scan to select a row carrying this particular badge kind) — fixed with the row's own selected-
   foreground, already verified high-contrast against `--kv-row-selected-bg`, for both properties
   so the badge's outline stays visible too. (G21 D5: the sha column's own copy of this same fix
   was deleted along with the column itself.)

   G-UX (item 2b): `.kv-badge-local.kv-badge-lane-tinted` joins this list — its own background is
   a *translucent* lane wash now (the per-lane rules below), not the opaque fill the comment above
   still describes for the untinted case, so it DOES depend on whatever sits underneath it once a
   lane is known; scoped to `.kv-badge-lane-tinted` only so a local badge with no lane data yet
   (rare — the layout worker has not attached a colour to this row) keeps its today-established
   look, unaffected. */
.kv-commit-grid .slick-row.kv-row-selected .kv-badge-remote,
.kv-commit-grid .slick-row.kv-row-selected .kv-badge-tag,
.kv-commit-grid .slick-row.kv-row-selected .kv-badge-stash,
.kv-commit-grid .slick-row.kv-row-selected .kv-badge-overflow,
.kv-commit-grid .slick-row.kv-row-selected .kv-badge-local.kv-badge-lane-tinted {
  color: var(--kv-row-selected-fg);
  border-color: var(--kv-row-selected-fg);
}

/* W14's roving tabindex focuses a real row node (not a hidden sink) — it needs a visible
   indicator of its own, the same token every other focusable edge in this grid already uses. */
.kv-commit-grid .slick-row:focus-visible {
  outline: 1px solid var(--kv-focus-border);
  outline-offset: -1px;
}

/* The stash tip (refs/stash — W7's DecorationRef "stash" kind): italic subject text is the row-
   level cue; the badge itself (dashed square, codicon-archive) is refBadges.ts's job, rendered
   inline in the message cell, not here. */
.kv-commit-grid .slick-row.kv-row-stash .kv-message-subject {
  font-style: italic;
}

.kv-commit-grid .slick-cell {
  position: absolute;
  border: none;
  padding: 0 var(--kv-s-2);
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

/* G19 D1: the graph column's own HEAD indicator — an unfilled ring in the same token the
   current-branch badge's own ring/glyph use (.kv-badge-current/.kv-badge-current-glyph, below),
   additive to whichever shapes the row's node already draws (stash/merge precedence untouched —
   rowSvg.ts's planNode). */
.kv-graph-head-ring {
  stroke: var(--kv-focus-border);
}

/* G-UX (item 1): the soft backdrop disc behind the HEAD ring — rowSvg.ts's buildRowSvg paints
   this one shape UNDER the row's own edges, everything else (including the ring above) on top. */
.kv-graph-head-halo {
  fill: var(--kv-focus-border);
  fill-opacity: 0.18;
}

/* G-UX (item 2b): the literal ask — badges above the message, on their own line, rather than
   fighting it for horizontal space (item 2a's `.kv-ref-badges` `max-width` cap was the quick,
   low-risk stopgap; this supersedes it). A 2-row CSS Grid, not a flex column. `18px` matches
   `--kv-row-height-compact`'s own `20px` (`density.css`) minus this cell's vertical padding; the
   subject stays `grid-row: 2` either way (`.kv-message-subject`, below) so it never has to move.
   `16px`/`18px` together match `--kv-row-height`'s own `36px` minus the same padding.
   P7 (item 1): the badges track is collapsed to `0` by default — a commit with no badges (most
   rows) is now genuinely single-line, not merely visually empty on a still-full-height row. Only
   `.kv-cell-message--has-badges` (`columns.ts`'s own `messageFormatter`, set in the same branch
   that decides whether `.kv-message-badges-row` is even built) reserves the 16px track; the row's
   own real height comes from `getItemMetadata`'s `height` (`columns.ts`'s `rowMetadata`), which
   uses the identical condition — the two can never disagree about whether a row is tall. */
.kv-cell-message {
  display: grid;
  grid-template-rows: 0 18px;
  align-items: center;
  min-width: 0;
  overflow: hidden;
}

.kv-cell-message.kv-cell-message--has-badges {
  grid-template-rows: 16px 18px;
}

/* The row-1 strip — ref badges then the PR badge, sharing one flex row and one `overflow: hidden`
   boundary so a commit with more decorations than fit truncates as a strip rather than spilling
   into the graph/author column. No `max-width` cap needed any more (item 2a's own reason for one):
   this row no longer shares its horizontal space with the subject at all. */
.kv-message-badges-row {
  grid-row: 1;
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
}

.kv-message-subject {
  grid-row: 2;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* P11 W13: `columns.ts`'s `messageFormatter`, active only while a search query is compiled. The
   same token the real editor's own Find widget highlights a match with (§3.4) — not an invented
   colour. */
.kv-search-hit {
  background-color: var(--kv-search-match-bg);
  border-radius: 2px;
}

.kv-cell-author {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* refBadges.ts's inline badge strip (P4 W7, §6.2): a row with no decorations never gets this
   wrapper at all (buildRefBadges returns null), so this only ever costs layout on rows that
   have something to show. Sits inside `.kv-message-badges-row` now (G-UX item 2b), alongside the
   PR badge — that shared wrapper owns the row's own `overflow: hidden`/width, so this strip
   itself needs no shrink/max-width logic of its own beyond not collapsing its own badges. */
.kv-ref-badges {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.kv-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 0 5px;
  height: 16px;
  line-height: 16px;
  font-size: 10px;
  white-space: nowrap;
  border: 1px solid transparent;
}

.kv-badge-pill {
  border-radius: 9px;
}

.kv-badge-square {
  border-radius: 3px;
}

.kv-badge-dashed {
  border-style: dashed;
}

/* G26 D-4.11: a stack member's own outline, and (only alongside it) the stale dashed variant —
   reuses .kv-badge-dashed's own affordance rather than inventing a second "needs attention"
   visual language. */
.kv-badge-branch--stacked {
  border-color: var(--kv-badge-branch-stacked-border);
}
.kv-badge-branch--stale {
  border-style: dashed;
}

.kv-badge-icon {
  font-size: 11px;
}

/* §6.2's "badge text truncates at ~190px, full name in title" — the icon stays fixed size, only
   the text label clips. */
.kv-badge-label {
  max-width: 190px;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* §7's "no colour-only meaning" — every distinct token below pairs with a distinct shape/glyph
   already chosen in refBadges.ts's badgeSpecFor, this file only supplies the colour. */
.kv-badge-local {
  background-color: var(--kv-badge-local-bg);
  border-color: var(--kv-badge-local-bg);
  color: var(--kv-badge-fg);
}

.kv-badge-remote {
  color: var(--kv-badge-remote-fg);
  border-color: var(--kv-badge-remote-fg);
}

.kv-badge-tag {
  color: var(--kv-badge-tag-fg);
  border-color: var(--kv-badge-tag-fg);
}

.kv-badge-stash {
  color: var(--kv-badge-stash-fg);
  border-color: var(--kv-badge-stash-border);
}

.kv-badge-overflow {
  color: var(--kv-row-fg);
  border-color: var(--kv-panel-border);
}

/* G24 D9: the per-commit/per-branch PR badge — a real <a href>, so it needs its own link reset
   (no underline, inherits the badge's own colour rather than the browser default blue/visited).
   State travels as one of these four classes, never as text (§7's "no colour-only meaning" is
   already satisfied by the "#123" number plus the tooltip naming the state in words). */
.kv-badge-pr {
  text-decoration: none;
  cursor: pointer;
}

.kv-badge-pr--open {
  color: var(--kv-badge-pr-open-fg);
  border-color: var(--kv-badge-pr-open-fg);
}

.kv-badge-pr--draft {
  color: var(--kv-badge-pr-draft-fg);
  border-color: var(--kv-badge-pr-draft-fg);
}

.kv-badge-pr--merged {
  color: var(--kv-badge-pr-merged-fg);
  border-color: var(--kv-badge-pr-merged-fg);
}

.kv-badge-pr--closed {
  color: var(--kv-badge-pr-closed-fg);
  border-color: var(--kv-badge-pr-closed-fg);
}

/* G-UX (item 1): replaces the old 5×5px `.kv-badge-dot` — a checkmark glyph reads as "current"
   at a glance, where a plain dot next to the badge's own icon was easy to miss. Fixed in
   `--kv-focus-border`, independent of the badge's own kind colour or any lane tint, so "this is
   the current branch" stays a single, consistent, always-recognisable signal. */
.kv-badge-current-glyph {
  font-size: 9px;
  color: var(--kv-focus-border);
}

/* The ring goes on the badge itself, not the glyph — a `box-shadow`, not `border`, so it never
   fights the lane-tinted `border-color` rules below (`.kv-badge-lane-tinted`). */
.kv-badge-current {
  box-shadow: 0 0 0 1px var(--kv-focus-border);
}

/* G21 D4: ties a badge back to the row's own lane, on the border and icon — for an outline badge
   (`.kv-badge-remote`/`-tag`/`-stash`, the overflow badge) this is the whole of it, same as
   always: never the label, which stays `--kv-badge-*` (`--kv-graph-lane-N` is tuned for 1.6px SVG
   strokes on a panel background, not for text contrast, and would fail legibility as a solid
   label colour on several lanes in several themes). Additive to, never a replacement for,
   `.kv-badge-remote`/`-tag`/`-stash` above — the kind colour and shape/glyph distinction (§6.1's
   "no colour-only meaning") still carry the badge's own meaning regardless of whether a lane
   colour is known. Eight rules, matching `vscode-tokens.css`'s own generated `.kv-lane-0`.
   `.kv-lane-7` range (`DEFAULT_PALETTE_SIZE`) — deliberately hand-written here rather than folded
   into that generated block, since these read `color`/`border-color` for an HTML badge, not the
   `fill`/`stroke` an SVG graph node needs. */
.kv-badge-lane-tinted.kv-lane-0 { border-color: var(--kv-graph-lane-0); }
.kv-badge-lane-tinted.kv-lane-0 .kv-badge-icon { color: var(--kv-graph-lane-0); }
.kv-badge-lane-tinted.kv-lane-1 { border-color: var(--kv-graph-lane-1); }
.kv-badge-lane-tinted.kv-lane-1 .kv-badge-icon { color: var(--kv-graph-lane-1); }
.kv-badge-lane-tinted.kv-lane-2 { border-color: var(--kv-graph-lane-2); }
.kv-badge-lane-tinted.kv-lane-2 .kv-badge-icon { color: var(--kv-graph-lane-2); }
.kv-badge-lane-tinted.kv-lane-3 { border-color: var(--kv-graph-lane-3); }
.kv-badge-lane-tinted.kv-lane-3 .kv-badge-icon { color: var(--kv-graph-lane-3); }
.kv-badge-lane-tinted.kv-lane-4 { border-color: var(--kv-graph-lane-4); }
.kv-badge-lane-tinted.kv-lane-4 .kv-badge-icon { color: var(--kv-graph-lane-4); }
.kv-badge-lane-tinted.kv-lane-5 { border-color: var(--kv-graph-lane-5); }
.kv-badge-lane-tinted.kv-lane-5 .kv-badge-icon { color: var(--kv-graph-lane-5); }
.kv-badge-lane-tinted.kv-lane-6 { border-color: var(--kv-graph-lane-6); }
.kv-badge-lane-tinted.kv-lane-6 .kv-badge-icon { color: var(--kv-graph-lane-6); }
.kv-badge-lane-tinted.kv-lane-7 { border-color: var(--kv-graph-lane-7); }
.kv-badge-lane-tinted.kv-lane-7 .kv-badge-icon { color: var(--kv-graph-lane-7); }

/* G-UX (item 2b): the literal ask's "easy to spot" half — a *filled* local badge (unlike the
   outline kinds above) takes its own background from the lane too, not just its border/icon, so
   the badge itself reads as "this lane's branch" at a glance. `color-mix(... 22%, transparent)`
   rather than a solid `--kv-graph-lane-N` fill: several lanes are near-white and would fail text
   contrast as a solid fill/label colour (the same reason the outline kinds above never tint their
   label) — a translucent wash lets the row's own background show through, so the badge's own text
   can stay at the row's ordinary foreground token instead of needing a lane-specific one. Three
   properties (background/color/border-color), one rule per lane, at `(0,3,0)` specificity —
   higher than `.kv-badge-local`'s own plain rule above, so this wins whenever a lane is known
   without needing `!important`. */
.kv-badge-local.kv-badge-lane-tinted.kv-lane-0 {
  background-color: color-mix(in srgb, var(--kv-graph-lane-0) 22%, transparent);
  color: var(--kv-row-fg);
}
.kv-badge-local.kv-badge-lane-tinted.kv-lane-1 {
  background-color: color-mix(in srgb, var(--kv-graph-lane-1) 22%, transparent);
  color: var(--kv-row-fg);
}
.kv-badge-local.kv-badge-lane-tinted.kv-lane-2 {
  background-color: color-mix(in srgb, var(--kv-graph-lane-2) 22%, transparent);
  color: var(--kv-row-fg);
}
.kv-badge-local.kv-badge-lane-tinted.kv-lane-3 {
  background-color: color-mix(in srgb, var(--kv-graph-lane-3) 22%, transparent);
  color: var(--kv-row-fg);
}
.kv-badge-local.kv-badge-lane-tinted.kv-lane-4 {
  background-color: color-mix(in srgb, var(--kv-graph-lane-4) 22%, transparent);
  color: var(--kv-row-fg);
}
.kv-badge-local.kv-badge-lane-tinted.kv-lane-5 {
  background-color: color-mix(in srgb, var(--kv-graph-lane-5) 22%, transparent);
  color: var(--kv-row-fg);
}
.kv-badge-local.kv-badge-lane-tinted.kv-lane-6 {
  background-color: color-mix(in srgb, var(--kv-graph-lane-6) 22%, transparent);
  color: var(--kv-row-fg);
}
.kv-badge-local.kv-badge-lane-tinted.kv-lane-7 {
  background-color: color-mix(in srgb, var(--kv-graph-lane-7) 22%, transparent);
  color: var(--kv-row-fg);
}

/* G19 D2: F2 found this cell had no overflow safety net at all — unlike
   .kv-message-subject/.kv-cell-author (both above), an absolute-format date overflowing the
   column's own width was silently clipped by the cell's own `overflow: hidden`, not truncated
   with an affordance. */
.kv-cell-date {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
