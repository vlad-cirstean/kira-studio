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
import type { CommitRecord, RowPlan } from '@kira/git-core';
import { KuiColumnResizeHandle } from '@kira/kira-ui';
import AttributeTooltip from '@theme/components/AttributeTooltip.vue';
import { useEventListener, useResizeObserver } from '@vueuse/core';
import type { Column, OnRenderedEventArgs } from 'slickgrid';
import { SlickGrid } from 'slickgrid';
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { graphColumnWidth } from '../graph/geometry.ts';
import { createGraphFormatter } from '../graph/graphColumn.ts';
import { laneAt } from '../graph/hitTest.ts';
import { useGraphVisible } from '../graphVisibility.ts';
import type { GraphOrderState } from '../state/graphOrder.ts';
import type { GraphViewState, LayoutRange } from '../state/graphView.ts';
import type { PrState } from '../state/pr.ts';
import type { SearchState } from '../state/search.ts';
import type { SelectionState } from '../state/selection.ts';
import type { StackState } from '../state/stack.ts';
import { type ColumnWidths, type DateFormat, DEFAULT_COLUMN_WIDTHS } from '../state/viewState.ts';
import { compactRowHeightPx, rowHeightPx, TokenReader } from '../theme/readTokens.ts';
import {
  type ColumnFit,
  type ColumnFitInput,
  effectiveGraphWidth,
  fitColumns,
  MAX_COLUMN_WIDTH,
  maxDragWidth,
} from './columnFit.ts';
import {
  buildColumns,
  collapsedMessageText,
  createCommitDataView,
  GRAPH_COLUMN_ID,
} from './columns.ts';
import { formatAbsoluteDate, formatRelativeDate, measureAbsoluteDateWidth } from './dateFormat.ts';
import { type GridKeyboardDeps, handleGridKeyDown } from './gridKeyboard.ts';
import { composeRowLabel } from './rowAccessibility.ts';

const props = defineProps<{
  graphView: GraphViewState;
  /** P93 §4.2/§7: the collapse/expand half of the branch-ordered layout — `handleClick`'s own
   *  branch for a placeholder row, and `scrollToRow`'s auto-expand, both call `toggleGroup` on
   *  this then `graphView.rebuildOrder()`. Required, not optional (unlike `search`/`pr`/`stack`):
   *  every mount of this component threads the same `GraphOrderState` `App.vue` gives `graphView`
   *  itself (`graphView.plan` already reflects it either way; this is only where the toggle and
   *  the group label lookup live). */
  order: GraphOrderState;
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
  /** P74 §3.3: same capability `AppToolbar.vue` threads into `BranchPicker.vue`/`StackList.vue` —
   *  gates whether the inline PR badge (`refBadges.ts`'s `buildPrBadge`) is a clickable button or
   *  a plain, inert span. Required, not optional: a caller with no PR source at all still passes
   *  `false` explicitly, the same posture `detailOpen` already takes. */
  openExternalCapability: boolean;
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
  /** Drawn graph column width, for the uncommitted strip's matching cell. Not persisted. */
  (e: 'graphWidth', px: number): void;
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
  /** P74 §3.3: a click landed on the inline PR badge (`refBadges.ts`'s `data-pr-number`) —
   *  reported as a plain PR number rather than this component calling `DetailActions.openPullRequest`
   *  itself, mirroring `refContextMenu`/`stashContextMenu`'s own "report, don't act" convention;
   *  `App.vue` is the one place with `actions` at hand. Never fires alongside `openDetail`/
   *  `toggleDetail` — `handleClick`'s own hit-test returns before either would run. */
  (e: 'openPullRequest', number: number): void;
}>();

const MIN_COLUMN_WIDTH = 40;
const MIN_MESSAGE_WIDTH = 120;
// G21 D6b: mirrors `.slick-cell`'s own horizontal padding (`kv:px-1` in the style block below, 4px) — one
// side; `measureAbsoluteDateWidth`'s own caller doubles it for both sides of the cell.
const CELL_PADDING_PX = 4;

const host = ref<HTMLDivElement | null>(null);
const dateWidthProbe = ref<HTMLSpanElement | null>(null);
let grid: SlickGrid<CommitRecord> | undefined;
const tokenReader = new TokenReader();

// P220: the graph column never sits below its drag minimum; the row SVG clips lanes past the
// column's right edge, so a narrower persisted width hides every lane.
const widths = ref<ColumnWidths>({
  ...props.columnWidths,
  graph: Math.max(MIN_COLUMN_WIDTH, props.columnWidths.graph),
});
// P228: grow-only high-water of the lanes' width for this mount (0 until the first lane-aware
// layout); a repo switch remounts, which resets it. The column never renders below it, in any
// mode, so no drawn node clips. `graphAuto`: a first-ever mount tracks the floor, even below the
// stored width, until the user drags the graph handle.
const laneFloor = ref(0);
let graphAuto = false;

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
  if (column === 'graph') return Math.max(MIN_COLUMN_WIDTH, laneFloor.value);
  return column === 'date' ? Math.max(MIN_COLUMN_WIDTH, measuredDateWidth.value) : MIN_COLUMN_WIDTH;
}

function graphWidth(): number {
  return effectiveGraphWidth(widths.value.graph, minWidthFor('graph'), laneFloor.value > 0 && graphAuto);
}

/** P93 §7: every translation site in this file's own coordinate conversion — SlickGrid's rows
 *  (`instance.onClick`, `getViewport()`, `data-row`, …) are *display* rows, while
 *  `props.selection.row`/`viewState.scrollRow`/this component's own `scrollToRow`/`scrollToTopRow`
 *  contract stay *store* rows (§5.4's identity plan makes the two the same array position for
 *  every caller that has not attached a `GraphOrderState`, so nothing changes for them). An
 *  accessor, not a captured value, so a plan rebuild never needs this component rebuilt — only
 *  the grid invalidated (the `plan` watcher below). */
function plan(): RowPlan {
  return props.graphView.plan.value;
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
  plan,
  () => props.graphView.layoutCurrent,
  (row) => grid?.getRowHeight(row) ?? compactRowHeightPx(tokenReader),
  () => compactRowHeightPx(tokenReader),
  graphWidth,
);

// Positions of the two drag handles (message|author, author|date), recomputed whenever the
// widths behind them change — see `updateHandlePositions`. (G21 D5: a third, date|sha, handle
// existed here until the sha column itself was deleted.)
const handleLeftAuthor = ref(0);
const handleLeftDate = ref(0);
// P92 item 1: graph|message, unlike the other two, renders in compact mode too — compact drops
// author/date (G-UX D1) but keeps the graph column, so this one has no `!detailOpen` gate.
const handleLeftGraph = ref(0);
const maxGraph = ref(MAX_COLUMN_WIDTH);
const maxAuthor = ref(MAX_COLUMN_WIDTH);
const maxDate = ref(MAX_COLUMN_WIDTH);
const effectiveWidths = ref<ColumnFit>({ graph: 0, author: 0, date: 0, message: 0 });

let unsubscribeLayout: (() => void) | undefined;
let unsubscribeTokens: (() => void) | undefined;
let resizeRaf = 0;
let scrollRaf = 0;
let previousSelectedRow = -1;
// P108 F1: `initialScrollRow` applies once — set the moment a plan actually covers it (or, once
// loading settles with the row still uncovered, clamped to the nearest valid row) — never left to
// keep retrying forever. See `applyInitialScrollRow` below.
let initialScrollApplied = false;

// P79 review fix (Performance, LOW): `false` while a KeepAlive host has backgrounded this mount
// (RepoGraphView.vue's own onDeactivated, via main.ts's `setVisible`) — the four generation
// watchers below skip their own rebuild while hidden, marking one owed instead of doing it once
// per missed bump against a grid nobody can see; the catch-up watch further down replays it once,
// combined, the moment this flips back to visible.
const graphVisible = useGraphVisible();
let pendingRebuildOnVisible = false;

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

function fitInput(): ColumnFitInput {
  return {
    stored: widths.value,
    available: availableWidth(),
    graphFloor: minWidthFor('graph'),
    graphAuto: laneFloor.value > 0 && graphAuto,
    minAuthor: MIN_COLUMN_WIDTH,
    minDate: minWidthFor('date'),
    minMessage: MIN_MESSAGE_WIDTH,
    compact: props.detailOpen,
  };
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

/** P93 §4.2: turns a `RowPlanEntry.groupIndex` into the branch name a placeholder's own "N more
 *  commits on X" text and `aria-label` both need — `RowPlan.groupKeyAt` only ever exposes the raw,
 *  unreadable key (`GraphOrderState.tips`'s own doc comment); `undefined` for the synthetic
 *  `other` group (index `order.tips.length`, no `TipRef` of its own), `collapsedMessageText`'s own
 *  fallback for that case. */
function groupLabelFor(groupIndex: number): string | undefined {
  return props.order.tips[groupIndex]?.label;
}

/** P92 item 2: the width the column model must sum to — SlickGrid's own viewport content box, not
 *  the host's. `clientWidth` already excludes the vertical scrollbar's gutter; `host.clientWidth`
 *  does not, and the difference is a permanent horizontal scrollbar (SlickGrid's own
 *  `getCanvasWidth()` sums the column widths and writes that onto `.grid-canvas`, wider than the
 *  viewport it scrolls in by exactly that gutter, plus up to 1px from `clientWidth`'s rounding
 *  against the viewport's fractional `getBoundingClientRect()` measurement). Floored to match the
 *  canvas's own whole-pixel sizing. `host` is the fallback for the one call before the grid exists
 *  (`onMounted`'s own first `currentColumns()`). */
function availableWidth(): number {
  const viewport = grid?.getViewportNode();
  return Math.floor(viewport?.clientWidth ?? host.value?.clientWidth ?? 0);
}

function currentColumns(): Column<CommitRecord>[] {
  const laneCount = props.graphView.laneCount.value;
  const fit = fitColumns(fitInput());
  return buildColumns(
    { graph: fit.graph, author: fit.author, date: fit.date, laneCount, messageWidth: fit.message },
    { dateFormat: () => props.dateFormat, now: () => Date.now() },
    graphFormatter,
    { pattern: searchPattern },
    {
      // G21 D4: the row-bold/HEAD-ring and merge-in edge colouring already read this same
      // LayoutStore for this same row — a row past its own `rowCount` (layout not arrived yet)
      // gets no lane class, matching `graphColumn.ts`'s own already-established "no layout, no
      // colour" case, never a guessed one.
      colorOf: (row) =>
        props.graphView.layoutCurrent && row < props.graphView.layout.rowCount
          ? props.graphView.layout.colorOf(row)
          : undefined,
    },
    {
      // G24 D9: `undefined` (not an empty array) is "nothing resolved yet" vs. "resolved, no PR"
      // — `columns.ts`'s own `messageFormatter` already treats both as "render nothing".
      // Badge only the commit a PR's head points at; the detail pane keeps the ancestry answer.
      prsFor: (sha) => props.pr?.prsHeadedAt(sha),
      openExternalCapability: props.openExternalCapability,
    },
    { stackInfoFor },
    { compact: props.detailOpen },
    { plan, labelFor: groupLabelFor },
  );
}

function updateHandlePositions(): void {
  // P92 item 1: the graph|message handle renders in compact mode too (see `handleLeftGraph`'s own
  // comment); the author/date handles stay gated, compact mode drops those two columns.
  const input = fitInput();
  const fit = fitColumns(input);
  effectiveWidths.value = fit;
  handleLeftGraph.value = fit.graph;
  maxGraph.value = maxDragWidth('graph', fit, input);
  if (props.detailOpen) return;
  handleLeftAuthor.value = fit.graph + fit.message;
  handleLeftDate.value = handleLeftAuthor.value + fit.author;
  maxAuthor.value = maxDragWidth('author', fit, input);
  maxDate.value = maxDragWidth('date', fit, input);
}

// Regression fix (post-P79-merge): the width `rebuildColumns()` last actually ran against —
// `-1` (never equals a real width) until the first call. `scheduleResize` below reads this
// to skip a rebuild that would only repeat one some other caller (almost always the `detailOpen`
// watcher, per this function's own "G-UX (item 9)" comment) already did against the same width a
// moment earlier. Without it, closing the detail pane triggered TWO full `setColumns()` passes for
// the one width change — the watcher's own synchronous one (`flush: 'post'`, already the true,
// final width) and a second, purely redundant one a frame later when the same resize also reached
// the ResizeObserver — each of which tears down and recreates every row's DOM (`setColumns()` ->
// `invalidateAllRows()`) before rebuilding it. Two teardown/rebuild cycles a frame apart, for
// identical output, is wasted work on its own; under real load (contended CPU, several webview
// tests' own Chromium instances running at once) it also widens the window in which anything
// reading the grid's DOM — a test, `applyAccessibility`'s own focus restore — can catch a row
// mid-teardown between the two passes and see a stale, zero-width cell. Deduplicating by width
// closes that window by making the second pass a no-op instead of a second real rebuild.
// P92 item 2: reads `availableWidth()` now, not `host.clientWidth` — same dedupe, correct box.
let lastRebuiltWidth = -1;

let lastEmittedGraphWidth = -1;

function emitGraphWidth(): void {
  const px = graphWidth();
  if (px === lastEmittedGraphWidth) return;
  lastEmittedGraphWidth = px;
  emit('graphWidth', px);
}

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
  lastRebuiltWidth = availableWidth();
  emitGraphWidth();
}

function setColumnWidth(column: keyof ColumnWidths, next: number): void {
  if (column === 'graph') graphAuto = false;
  const input = fitInput();
  const limit = maxDragWidth(column, fitColumns(input), input);
  const clamped = Math.min(limit, Math.max(minWidthFor(column), Math.round(next)));
  if (widths.value[column] === clamped) return;
  widths.value = { ...widths.value, [column]: clamped };
  rebuildColumns();
  emit('update:columnWidths', widths.value);
}

/** P93 §4.2: a placeholder's own click/Enter/Space activation — expands its group, session-only
 *  (`GraphOrderState.toggleGroup`), and rebuilds the plan the identical way `App.vue`'s own tips
 *  watcher does (fire-and-forget: the grid's own `plan` watcher, already wired, picks up the
 *  result). `scrollToRow`'s auto-expand calls this too. */
function toggleGroup(displayRow: number): void {
  props.order.toggleGroup(plan().groupKeyAt(displayRow));
  void props.graphView.rebuildOrder();
}

/** G-UX D2 (item 1b): a click on an unselected row opens the detail pane on the FIRST click —
 *  clicking the already-selected row still toggles it closed (the only mouse-only way to close
 *  it, agreeing with `Esc` and the narrow-breakpoint drawer). G-UX D8 (item 8): the date cell no
 *  longer has any click behaviour of its own — the relative/absolute toggle lives in the Display
 *  settings section now, so a click anywhere on the row means exactly one thing.
 *
 *  P93 §4.2: a collapsed placeholder is "never 'selected' in `SelectionState`'s sense — there is
 *  no sha to select" — a click on one expands its group instead, never reaching `selection.select`
 *  or either detail-pane emit. */
function handleClick(displayRow: number): void {
  if (plan().entryAt(displayRow).kind === 'collapsed') {
    toggleGroup(displayRow);
    return;
  }
  const row = plan().storeRowAt(displayRow);
  const wasSelected = props.selection.row.value === row;
  props.selection.select(row);
  pendingFocusRow = displayRow;
  if (wasSelected) emit('toggleDetail');
  else emit('openDetail');
}

/** P74 §3.3: a click landing on the inline PR badge (`refBadges.ts`'s `data-pr-number`, present
 *  only when `openExternalCapability` gated it to a real `<button>`) opens that PR instead of
 *  selecting the row — the same "hit-test ahead of the ordinary click" shape
 *  `handleContextMenu`'s own `data-ref-kind` check already uses for a right-click. Returns the PR
 *  number when it claimed the click, `undefined` when the click should fall through to
 *  `handleClick` unchanged. */
function prNumberFromClick(event: MouseEvent | undefined): number | undefined {
  const badgeEl =
    event?.target instanceof Element ? event.target.closest<HTMLElement>('[data-pr-number]') : null;
  const raw = badgeEl?.dataset.prNumber;
  return raw !== undefined ? Number(raw) : undefined;
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
  // P93 §4.2: "a collapsed row is never 'selected'" applies to a right-click too — its own
  // storeRowAt is a hidden (contracted) row, not one on screen, so selecting it and opening a
  // commit-scoped menu for it would be wrong in the same way handleClick's own guard avoids.
  if (plan().entryAt(cell.row).kind === 'collapsed') {
    toggleGroup(cell.row);
    return;
  }
  const row = plan().storeRowAt(cell.row);
  props.selection.select(row);

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
    emit('stashContextMenu', { row, x: event.clientX, y: event.clientY });
    return;
  }

  emit('contextMenu', { row, x: event.clientX, y: event.clientY });
}

/** `Shift+F10`/the Menu key (§6.6): opens the same menu `handleContextMenu` does, anchored to
 *  the selected row's own bounding rect rather than a click point that does not exist for a
 *  keyboard invocation. `row` (the parameter, and what this emits) is a *store* row, matching
 *  `contextMenu`'s own contract (§7: "the context menus ... speak store rows") — only the DOM
 *  lookup below needs the display row `data-row` is actually keyed by. */
function openMenuFromKeyboard(row: number): void {
  if (!grid) return;
  const container = grid.getContainerNode();
  const displayRow = plan().displayRowOf(row);
  const rowNode = container.querySelector<HTMLElement>(`.slick-row[data-row="${displayRow}"]`);
  const rect = rowNode?.getBoundingClientRect();
  emit('contextMenu', { row, x: rect?.left ?? 0, y: rect?.bottom ?? 0 });
}

/** P93 §6.2: "clicking a stub scrolls to its parent row" — `hitTest.ts`'s `laneAt` already answers
 *  which lane a click landed in; the stub is drawn in this row's own lane (`readSlice`'s own doc
 *  comment), so the test is "this row has an upward link, and the click landed in its lane".
 *  Reuses `moveSelection`'s own select-and-scroll shape (the same "jump to a row" semantics
 *  `App.vue`'s search-reveal path already uses) rather than duplicating it — a stub click does not
 *  toggle the detail pane, matching keyboard navigation rather than an ordinary row click. Returns
 *  whether it claimed the click, so `onClick`'s own handler knows not to fall through to
 *  `handleClick`.
 *
 *  P93 §4.2: "click anywhere on the row" expands a collapsed placeholder — including its own
 *  graph cell, even one whose own contracted internal merges left it a fork stub of its own
 *  (§4.3) — so this bails out for one and lets `handleClick`'s toggle win instead of navigating. */
function handleForkStubClick(
  displayRow: number,
  cell: number,
  event: MouseEvent | undefined,
): boolean {
  if (!grid || !event) return false;
  if (plan().entryAt(displayRow).kind === 'collapsed') return false;
  const columns = grid.getColumns();
  if (columns[cell]?.id !== GRAPH_COLUMN_ID) return false;
  const parentDisplayRow = plan().forkParentOf(displayRow);
  if (parentDisplayRow < 0) return false;
  const cellNode = grid.getCellNode(displayRow, cell);
  if (!cellNode) return false;
  const offsetX = event.clientX - cellNode.getBoundingClientRect().left;
  if (!props.graphView.layoutCurrent) return false;
  if (laneAt(offsetX) !== props.graphView.layout.laneOf(displayRow)) return false;
  moveSelection(parentDisplayRow);
  return true;
}

function pageSize(): number {
  if (!grid) return 1;
  const { top, bottom } = grid.getViewport();
  return Math.max(1, bottom - top);
}

/** P93 §7: `displayRow` walks display rows (branch-ordered, §3) — arrow-key/Home/End/Page nav
 *  moves by one row on screen, not by one store row, which after branch grouping are no longer
 *  the same thing.
 *
 *  P93 §4.2: a collapsed placeholder is never "selected" (there is no sha to select) — arrow/Home/
 *  End/Page navigation still lands *focus* on it (a real, tabbable row a keyboard user must be
 *  able to reach to `Enter`/`Space`-activate it, §4.2's own "with it focused"), so `pendingFocusRow`
 *  and the scroll still happen; only `selection.select` is skipped, leaving whatever commit row
 *  was selected before still selected underneath it. */
function moveSelection(displayRow: number): void {
  const length = plan().length;
  if (length === 0) return;
  const clampedDisplay = Math.max(0, Math.min(displayRow, length - 1));
  const entry = plan().entryAt(clampedDisplay);
  pendingFocusRow = clampedDisplay;
  grid?.scrollRowIntoView(clampedDisplay);
  if (entry.kind === 'collapsed') {
    // No `selection.select` call means the `selection.row` watch (which normally does this) never
    // fires — same reasoning as `focusGrid`'s own doc comment on a same-value `select()` being a
    // no-op: force the render pass `applyAccessibility`'s `pendingFocusRow` consumption needs.
    grid?.invalidateRows([clampedDisplay]);
    grid?.render();
    return;
  }
  props.selection.select(entry.storeRow);
}

// P94 pass 3 §4.3: everything handleKeyDown's own branches need, built once — plan/toggleGroup/
// openMenuFromKeyboard/pageSize/moveSelection are stable function declarations (hoisted, so this
// object can reference them regardless of where in the script they're each defined);
// focusedRowIndex is a getter since it's a plain, non-reactive `let` that must be read fresh on
// every call, never snapshotted once here.
const keyboardDeps: GridKeyboardDeps = {
  plan,
  focusedRowIndex: () => focusedRowIndex,
  selectionRow: props.selection.row,
  moveSelection,
  pageSize,
  toggleGroup,
  openMenuFromKeyboard,
  emit,
};

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
 *
 * The branches themselves live in gridKeyboard.ts's own handleGridKeyDown (P94 pass 3 §4.3).
 */
function handleKeyDown(event: KeyboardEvent): boolean {
  return handleGridKeyDown(event, keyboardDeps);
}

// W15: `kira:layout-complete` fires exactly once, the first time a `LayoutChunk` is applied and
// re-rendered — see App.vue's own doc comment on why it moved here rather than firing at mount.
let layoutCompleteMarked = false;

// P79 fix (Performance MEDIUM + Functional MEDIUM): every ancestry-affecting signal —
// `pr.generation` (a resolved branch) and the graph window growing/resetting
// (`graphView.loadedRows`/`graphView.generation`) — used to either skip `rebuildAncestry`
// entirely (the window-growth case, the desync bug) or run it once per signal with no
// coalescing (the N-branches-in-one-burst case, the performance finding). Both watchers below
// now only set this flag; `nextTick` (this file's own established pattern — see the `detailOpen`
// watcher's `flush: 'post'`) drains it into exactly one `rebuildAncestry` + one grid
// invalidate/render per tick, however many signals fired within it.
let ancestryRebuildPending = false;

function scheduleAncestryRebuild(): void {
  if (ancestryRebuildPending) return;
  ancestryRebuildPending = true;
  void nextTick(() => {
    ancestryRebuildPending = false;
    // P74 §4.2/§4.3: rebuilds the ancestry derivation the detail pane's `prForCommit` reads.
    if (props.pr) props.pr.rebuildAncestry(props.graphView.store);
    // P72 §5.1: `rowMetadata` (columns.ts) derives a row's `height` from `rowHasBadges`, which
    // reads `prsFor` — a PR resolution can flip a row between the compact and expanded height
    // without a row-count change, exactly the case `invalidateRowHeights`'s own doc comment (and
    // the token-change listener above) calls out as needing this explicit call, or SlickGrid's
    // row-position index goes stale against the new heights (the scroll-flicker symptom).
    grid?.invalidateRowHeights();
    grid?.invalidateAllRows();
    grid?.render();
  });
}

/** Raises the lane floor as later chunks and pages raise `laneCount`. Never emitted or persisted:
 *  only a user drag writes a width. */
function raiseLaneFloor(): void {
  const lanes = props.graphView.laneCount.value;
  if (lanes === 0) return;
  const before = graphWidth();
  laneFloor.value = Math.max(laneFloor.value, graphColumnWidth(lanes));
  if (graphWidth() !== before) rebuildColumns();
}

/** A row range just gained lane layout (`GraphViewState.onChunkLayout`, W5) — invalidate its
 *  heights; `raiseLaneFloor` widens the graph column when the new lanes need it.
 *
 *  P92 item 4: `invalidateRowHeights()`, not `invalidateRows(rows)` + `render()` — the latter
 *  marks heights dirty but never rebuilds SlickGrid's row-position index (only `updateRowCount()`
 *  does that), so an already-rendered row below one whose height just changed (a badge/PR
 *  decoration) keeps its stale `translateY()` while the index moves on: two rows land in the same
 *  band and their glyphs double up. `invalidateRowHeights()` is the library's own "index and rows
 *  are both stale" entry point, so `_range` is unused now — kept for the callback signature. */
function handleChunkLayout(_range: LayoutRange): void {
  if (!grid) return;
  raiseLaneFloor();
  grid.invalidateRowHeights();
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
    // P79 review fix (Performance, LOW), corrected post-merge regression: a KeepAlive'd host
    // (RepoGraphView.vue) shrinks this grid's container to 0×0 on deactivate — the ResizeObserver
    // above fires for that transition too, and without a guard `resizeCanvas()`/`rebuildColumns()`
    // would do a full layout pass against a grid nobody can see. The original fix inferred "nobody
    // can see this" from a 0×0 read, which also matched a real host's transient 0×0 during initial
    // mount (layout not yet settled when this callback's rAF ran) — the observer never fires again
    // once the host settles at its true size unchanged from that reading, so the grid's columns
    // never got laid out at all. `graphVisible` (already threaded through for the four generation
    // watchers above) is the actual signal for "backgrounded", not a proxy for it: `RepoGraphView
    // .vue`'s `onDeactivated` sets it `false` synchronously, before the resulting 0×0 resize ever
    // reaches this async callback (`graphVisibility.ts`), and it stays `true` through every plain
    // mount/resize — including one that happens to observe 0×0 before its real layout settles — so
    // gating on it here skips exactly the intended case and no other.
    if (!graphVisible.value) return;
    // `lastRebuiltWidth`'s own doc comment (above `rebuildColumns`): skip a rebuild that would
    // only repeat one already done, synchronously, against this exact width — closing the detail
    // pane is the common case, but this covers any caller of `rebuildColumns()` racing this same
    // async callback for the same resize.
    const width = availableWidth();
    if (width === lastRebuiltWidth) return;
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
  const totalRows = plan().length;
  const columns = grid.getColumns();
  container.setAttribute('aria-rowcount', String(totalRows));
  container.setAttribute('aria-colcount', String(columns.length));

  // P93 §7: `props.selection.row` is a store row; every `row` this loop touches is a display row
  // (`data-row`'s own indexing, and `range`'s) — translated once, here, rather than per row.
  const selectedStoreRow = props.selection.row.value;
  const selectedRow = selectedStoreRow >= 0 ? plan().displayRowOf(selectedStoreRow) : -1;
  // No row selected yet (a fresh mount with nothing persisted): row 0, if it exists, is the one
  // tab stop into the grid — the ARIA grid pattern's own answer to "what receives focus before
  // anything has been chosen" (a plain `Tab` must land somewhere real, never nothing at all, once
  // `_focusSink`/`_focusSink2` below are taken out of the tab order).
  const from = Math.max(0, range.startRow);
  const to = Math.min(range.endRow, totalRows - 1);
  const rowNodeAt = (row: number): HTMLElement | null =>
    container.querySelector<HTMLElement>(`.slick-row[data-row="${row}"]`);
  // When that row is scrolled out of the rendered range (or hidden in a collapsed group), the
  // first rendered row takes the tab stop instead, so a keyboard user can always reach the grid.
  let tabbableRow = selectedRow >= 0 ? selectedRow : 0;
  if (tabbableRow < from || tabbableRow > to || rowNodeAt(tabbableRow) === null) {
    tabbableRow = -1;
    for (let row = from; row <= to; row++) {
      if (rowNodeAt(row) !== null) {
        tabbableRow = row;
        break;
      }
    }
  }

  for (let row = from; row <= to; row++) {
    const rowNode = rowNodeAt(row);
    if (!rowNode) continue;

    rowNode.setAttribute('aria-rowindex', String(row + 1));
    const isSelected = row === selectedRow;
    rowNode.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    rowNode.tabIndex = row === tabbableRow ? 0 : -1;

    // P93 §4.2: "`aria-expanded="false"` on the row, `aria-label` = the message text" — a
    // placeholder has no single commit to read `composeRowLabel` from (`store.commitAt` below
    // reads only its first contracted row, a shape for `getItem`, never a fact about the row,
    // `columns.ts`'s own note on why formatters never read it either).
    const entry = plan().entryAt(row);
    if (entry.kind === 'collapsed') {
      rowNode.setAttribute('aria-expanded', 'false');
      rowNode.setAttribute(
        'aria-label',
        collapsedMessageText(entry.hiddenCount, groupLabelFor(entry.groupIndex)),
      );
    } else {
      rowNode.removeAttribute('aria-expanded');
      const commit = props.graphView.store.commitAt(entry.storeRow);
      const dateText =
        props.dateFormat === 'absolute'
          ? formatAbsoluteDate(commit.author.timestamp)
          : formatRelativeDate(commit.author.timestamp, Date.now());
      rowNode.setAttribute('aria-label', composeRowLabel(commit, dateText));
    }

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

/** P108 F1: `initialScrollRow` is a persisted *store* row (`viewState.scrollRow`), applied once,
 *  right after mount — but the plan this component reads from can lag behind it two ways: a cold
 *  boot mounts before the first chunk lands at all (`plan()` still `identityRowPlan(0)`), and a
 *  restart-at-zero refresh can leave a stale plan covering the *old*, larger history for a moment.
 *  Either way, converting the persisted row against a plan that does not yet cover it used to
 *  assert; now `displayRowOf` returns `-1` for "not covered" instead (`rowPlan.ts`), and this
 *  function is what turns that into "wait for a plan that does cover it, or, once loading has
 *  genuinely settled with the row still uncovered (this repo just has fewer rows now), clamp to
 *  the last one that exists" — never a permanent no-op and never a crash. Called once at mount,
 *  then again from the `plan`/`loading` watchers below until it succeeds. */
function applyInitialScrollRow(row: number): void {
  if (initialScrollApplied || !grid) return;
  const currentPlan = plan();
  if (row >= 0 && row < currentPlan.storeLength) {
    grid.scrollRowIntoView(currentPlan.displayRowOf(row));
    initialScrollApplied = true;
    return;
  }
  // Still streaming in: more rows may yet cover `row` exactly — keep waiting rather than clamping
  // early against a plan that is only partially loaded. Two separate "not done yet" signals, both
  // required: `loading` covers the network fetch, but `#applyChunk` (`graphView.ts`) folds a
  // chunk into the store and returns WITHOUT awaiting its own relayout (F11's own coalescing
  // drain loop) — so `loading` can already read `'idle'` while the plan is still one or more
  // relayouts behind the store's real row count. Only `storeLength` catching up all the way to
  // `store.rowCount` means there is no relayout left in flight to still change the answer.
  if (props.graphView.loading.value !== 'idle') return;
  if (currentPlan.storeLength < props.graphView.store.rowCount) return;
  const storeLength = currentPlan.storeLength;
  if (storeLength <= 0) return; // nothing loaded at all yet (or an empty repo) — nothing to clamp to.
  const clamped = Math.min(Math.max(row, 0), storeLength - 1);
  grid.scrollRowIntoView(currentPlan.containingDisplayRow(clamped));
  initialScrollApplied = true;
}

useEventListener(host, 'contextmenu', handleContextMenu);
useEventListener(document, 'focusin', handleFocusIn);
useResizeObserver(host, scheduleResize);

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
    graphAuto = true;
  }
  raiseLaneFloor();

  const dataView = createCommitDataView({
    store: props.graphView.store,
    plan,
    // `row` here is already a store row — `rowMetadata` (columns.ts) translates the incoming
    // display row before calling this.
    isSelected: (row) => props.selection.row.value === row,
    // P7 (item 1): a row with a ref/PR badge gets the taller, expanded height —
    // `rowMetadata`/`rowHasBadges` (columns.ts) are what actually decide "does this row have one".
    expandedRowHeight: () => rowHeightPx(tokenReader),
    prsFor: (sha) => props.pr?.prsHeadedAt(sha),
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

  instance.onClick.subscribe((event, args) => {
    const nativeEvent = event.getNativeEvent<MouseEvent>();
    const prNumber = prNumberFromClick(nativeEvent);
    if (prNumber !== undefined) {
      emit('openPullRequest', prNumber);
      return;
    }
    if (handleForkStubClick(args.row, args.cell, nativeEvent)) return;
    handleClick(args.row);
  });
  instance.onScroll.subscribe(() => {
    if (scrollRaf !== 0) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      // `scroll`'s own contract (`viewState.scrollRow`) is a store row — `getViewport().top` is
      // SlickGrid's own display row.
      if (grid) emit('scroll', plan().storeRowAt(grid.getViewport().top));
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

  // `document`, not `host.value`: `focusedRowIndex`'s own doc comment above needs to know when
  // focus lands anywhere that is *not* a row, including this grid's own resize handles (siblings
  // of `host`, not descendants — a plain SVG/DOM-tree ancestor listener would miss those) and
  // every other focusable element in the panel (the toolbar, the detail pane).

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
  emitGraphWidth();
  // `initialScrollRow` (`viewState.scrollRow`) is a persisted store row — translate to the
  // display row this mount's plan currently resolves it to. `applyInitialScrollRow` (P108 F1)
  // handles a plan that does not cover it yet (cold boot, before the first chunk lands) by
  // deferring to the `plan`/`loading` watchers below rather than converting it here unguarded.
  if (props.initialScrollRow !== undefined) {
    applyInitialScrollRow(props.initialScrollRow);
  }
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
    // `invalidateRows` takes SlickGrid's own display rows — `previousSelectedRow`/`row` are both
    // store rows (matching `SelectionState`'s own coordinate system), translated here.
    const rows = [previousSelectedRow, row]
      .filter((value) => value >= 0)
      .map((value) => plan().displayRowOf(value))
      .filter((value) => value >= 0);
    if (rows.length > 0) grid.invalidateRows(rows);
    grid.render();
    previousSelectedRow = row;
  },
);
watch(
  () => props.graphView.loadedRows.value,
  () => {
    // P92 item 2 follow-up: the row count crossing the "needs a vertical scrollbar" threshold is
    // the ONE thing that can shrink `availableWidth()` with no host resize and no detailOpen
    // toggle — the two triggers `scheduleResize`'s own ResizeObserver and the `detailOpen` watcher
    // already cover. Without this, a history that streams past that threshold keeps the column
    // widths computed at the pre-scrollbar width, permanently reproducing the bug §2 exists to
    // fix. `scheduleResize` already dedupes against `lastRebuiltWidth`, so this is a no-op for
    // every row load that does not actually cross the threshold.
    scheduleResize();
    // P79 fix (Functional MEDIUM): newly-loaded rows (`graph.loadMore`) can be ancestors of an
    // already-resolved PR tip — without this, they showed no badge until some unrelated PR
    // resolution happened to bump `pr.generation` again (`prByAncestry` desyncing from the
    // store's own, larger row set). A no-op via `scheduleAncestryRebuild`'s own guard when there
    // is no `pr` source at all.
    if (props.pr) scheduleAncestryRebuild();
  },
);
// P93 §7: the plan changes on every relayout — a page landing (already covered by `loadedRows`
// above, but `plan` always changes right alongside it, §5.3, so `invalidate()` belongs here
// instead of being called from both) and, later, a collapse toggle or `App.vue`'s own tips
// watcher recomputing the order with the row count unchanged, which `loadedRows` alone would
// never catch. `invalidate()`, not `render()` alone: a plan rebuild can move which store row a
// given display row shows, and `updateRowCount()`'s own index rebuild (`invalidate()`'s contract,
// P92 item 4's own comment) must run whether or not the row *count* moved.
watch(
  () => props.graphView.plan.value,
  () => {
    grid?.invalidate();
    // P108 F1: a plan rebuild landing is exactly "a plan that might now cover `initialScrollRow`"
    // — retry here rather than only once at mount.
    if (props.initialScrollRow !== undefined) applyInitialScrollRow(props.initialScrollRow);
  },
);
// P108 F1: a plan rebuild does not necessarily accompany the LAST chunk of a load (`loading`
// flips back to `'idle'` after it, with no further plan change) — this is what lets
// `applyInitialScrollRow` clamp a genuinely-uncovered row once loading has actually settled,
// instead of waiting on a plan change that may never come again.
watch(
  () => props.graphView.loading.value,
  () => {
    if (props.initialScrollRow !== undefined) applyInitialScrollRow(props.initialScrollRow);
  },
);
watch(
  () => props.graphView.generation.value,
  () => {
    // P79 review fix: a generation bump while backgrounded marks the rebuild owed instead of
    // doing it now — the catch-up watch below replays it, once, on the next reactivate.
    if (!graphVisible.value) {
      pendingRebuildOnVisible = true;
      return;
    }
    grid?.invalidateAllRows();
    grid?.updateRowCount();
    grid?.render();
    // P79 fix (Functional MEDIUM): a restart-at-row-0 re-walk is the other shape of "the loaded
    // window changed" `rebuildAncestry` must track — see the `loadedRows` watcher directly above.
    if (props.pr) scheduleAncestryRebuild();
  },
);
// P11 W13: mirrors the `generation` watcher directly above — a new `searchGeneration` means the
// message column's own highlight source (`searchPattern` above) may have changed, so every row's
// formatter must re-run; `updateRowCount()` has no reason to run alongside it, since a search
// never changes how many rows are loaded.
watch(
  () => props.search?.searchGeneration.value,
  () => {
    if (!graphVisible.value) {
      pendingRebuildOnVisible = true;
      return;
    }
    grid?.invalidateAllRows();
    grid?.render();
  },
);
// G24 D9: mirrors the `search.searchGeneration` watcher directly above — a third instance of the
// same pattern. A new PR resolution never changes how many rows are loaded, same reasoning as
// `search.searchGeneration`'s own doc comment.
// P79 fix (Performance MEDIUM): used to call `rebuildAncestry` + a full grid invalidate/render
// directly, once per fired watcher — `PrState.resolveBranch` bumps `generation` once per
// individual `branch.resolvePr` response, so warming N branches in one burst (e.g. entering
// Refs search scope, `search.ts`'s own "warms in full" comment) ran N full rebuilds/re-renders
// for the same final state. Now only marks the shared dirty flag — see `scheduleAncestryRebuild`.
watch(
  () => props.pr?.generation.value,
  () => {
    if (!graphVisible.value) {
      pendingRebuildOnVisible = true;
      return;
    }
    scheduleAncestryRebuild();
  },
);
// G26 D-4.13: mirrors the `pr.generation` watcher directly above — the fourth instance of the
// same pattern (F12). A new stack resolution never changes how many rows are loaded either.
watch(
  () => props.stack?.generation.value,
  () => {
    if (!graphVisible.value) {
      pendingRebuildOnVisible = true;
      return;
    }
    grid?.invalidateAllRows();
    grid?.render();
  },
);
// P79 review fix (Performance, LOW): replays whatever the four watchers above deferred while
// backgrounded, once, combined, rather than once per missed generation bump. Runs the union of
// their own effects — safe as a superset since `invalidateAllRows`/`render` are idempotent, and
// `rebuildAncestry`/`invalidateRowHeights` are the same "make everything current" calls each of
// them already does independently. P92 item 1: no `rebuildColumns()` here any more — the generation
// watcher above stopped calling it too, now that the graph column's width no longer depends on
// `laneCount`.
watch(graphVisible, (visible) => {
  if (!visible || !pendingRebuildOnVisible) return;
  pendingRebuildOnVisible = false;
  if (props.pr) props.pr.rebuildAncestry(props.graphView.store);
  grid?.invalidateRowHeights();
  grid?.invalidateAllRows();
  grid?.updateRowCount();
  grid?.render();
});
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
  if (resizeRaf !== 0) cancelAnimationFrame(resizeRaf);
  if (scrollRaf !== 0) cancelAnimationFrame(scrollRaf);
  unsubscribeLayout?.();
  unsubscribeTokens?.();
  tokenReader.dispose();
  grid?.destroy();
  grid = undefined;
});

/** `App.vue` (W11) calls this once a refresh's re-walk re-resolves a previously selected sha
 *  back to a (possibly different) row — `initialScrollRow` only ever applies once, at mount
 *  (see its own doc comment above), so a refresh that happens later needs an imperative path
 *  back to the same underlying `scrollRowIntoView` call.
 *
 *  P93 §8.4: "a search reveal that lands inside a collapsed group expands it and scrolls to the
 *  commit" — when `row` is currently hidden (`displayRowOf` returns `-1`, `RowPlan`'s own
 *  contract for a contracted member), this expands its containing group first
 *  (`containingDisplayRow` finds the placeholder row, `groupKeyAt` its key) and awaits the rebuild
 *  before scrolling against the NEW plan's own `displayRowOf` — `async` now, unlike before P93;
 *  both existing callers (`App.vue`) already discard the return value, so this is source-
 *  compatible for them either way.
 *
 *  P108 F1: `row` can also be one this plan does not cover at all yet (`row >= storeLength`, not
 *  merely hidden) — e.g. a stale plan mid-rebuild after a restart-at-zero refresh. Guarded before
 *  ever calling `containingDisplayRow` (whose own contract, unlike `displayRowOf`, still asserts
 *  in range — it is never handed an uncovered row here), and re-checked after `rebuildOrder()`'s
 *  own await: another rebuild (or repo switch) can land while it runs, and the row this call
 *  started for may no longer be covered by the time it resolves. Either way, this bails rather
 *  than scrolling to the wrong place. */
async function scrollToRow(row: number): Promise<void> {
  if (row < 0 || row >= plan().storeLength) return;
  if (plan().displayRowOf(row) < 0) {
    const key = plan().groupKeyAt(plan().containingDisplayRow(row));
    props.order.toggleGroup(key);
    await props.graphView.rebuildOrder();
    if (row >= plan().storeLength) return;
  }
  const displayRow = plan().displayRowOf(row);
  if (displayRow < 0) return;
  grid?.scrollRowIntoView(displayRow);
}

/** G-UX item 2/D10: an auto-refresh's own viewport restore — `App.vue` captures
 *  `getViewport().top` before a background refresh and calls this with it afterward, so the
 *  user's scroll position wins over the selection's own `scrollRowIntoView` (the concern
 *  `RefreshButton.vue` originally raised for why auto-refresh did not exist). Distinct from
 *  `scrollToRow`, which centers a target row rather than pinning it to the viewport's top.
 *
 *  P108 F1: `row` is the viewport-top row captured *before* the refresh that just reset/rebuilt
 *  the plan — a smaller post-refresh history can leave it uncovered. Falls back to the nearest
 *  covered group's own display row (`containingDisplayRow`, safe once `row` is checked in range)
 *  rather than pinning to nothing at all; entirely uncovered bails, same as `scrollToRow`. */
function scrollToTopRow(row: number): void {
  if (!grid || row < 0 || row >= plan().storeLength) return;
  const displayRow = plan().displayRowOf(row);
  grid.scrollRowToTop(displayRow >= 0 ? displayRow : plan().containingDisplayRow(row));
}

/** The row currently pinned at the viewport's top — `App.vue`'s own capture half of the
 *  auto-refresh viewport restore, paired with `scrollToTopRow` above. A store row, matching that
 *  function's own contract. */
function getViewportTop(): number | undefined {
  const top = grid?.getViewport().top;
  return top === undefined ? undefined : plan().storeRowAt(top);
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
 *  A no-op with nothing loaded yet (`plan().length === 0`) — there is no row to focus.
 *
 *  P108 F1: `selection.row` can momentarily hold a row a just-reset plan no longer covers (a
 *  restart-at-zero refresh's own pre-flush watcher order) — `displayRowOf` returning `-1` for
 *  that now falls back to row 0, same as no selection at all, rather than focusing row `-1`. */
function focusGrid(): void {
  if (!grid || plan().length === 0) return;
  const selectedStoreRow = props.selection.row.value;
  const selectedDisplayRow = selectedStoreRow >= 0 ? plan().displayRowOf(selectedStoreRow) : -1;
  const row = selectedDisplayRow >= 0 ? selectedDisplayRow : 0;
  grid.scrollRowIntoView(row);
  pendingFocusRow = row;
  grid.invalidateRows([row]);
  grid.render();
}

defineExpose({ scrollToRow, focusGrid, scrollToTopRow, getViewportTop });
</script>

<template>
  <div
    class="kv-commit-grid kv:relative kv:h-full kv:w-full kv:min-h-row kv:overflow-hidden kv:text-base kv:text-row-fg kv:[font-family:var(--kv-font-family)]"
    data-testid="commit-grid"
  >
    <!-- SlickGrid's own `init()` (`Utils.emptyElement(this._container)`) wipes out whatever was
         inside its container the moment it constructs — including these resize handles, if they
         were this element's own children. `host` is SlickGrid's *exclusive* DOM: the handles are
         its siblings, absolutely positioned over it via `.kv-commit-grid`'s own `position:
         relative` above, not descendants a `new SlickGrid(host.value, ...)` call would delete. -->
    <div ref="host" class="kv-grid-host kv:h-full kv:w-full"></div>
    <!-- P131 Part 2 §5.1: ref and PR badges (refBadges.ts) write `data-kira-tip` on plain DOM they
         build outside Vue -- this one hoisted trigger, a sibling of `host` (never inside it:
         SlickGrid's own `init()` empties `host`), covers every badge in every cell. -->
    <AttributeTooltip :container="host" />
    <!-- G21 D6b: an off-screen probe carrying .kv-cell-date's own font-affecting rules, purely so
         `remeasureDateWidth` has a real element to read a computed `font` shorthand from — never
         shown, never a fifth grid column. -->
    <span
      ref="dateWidthProbe"
      class="kv-cell-date kv:tabular-nums kv:absolute kv:invisible kv:pointer-events-none kv:whitespace-nowrap"
      aria-hidden="true"
    ></span>
    <KuiColumnResizeHandle
      class="kv:absolute kv:top-0 kv:bottom-0 kv:w-1.25 kv:-ml-0.5 kv:cursor-col-resize kv:z-2 kv:bg-transparent kv:hover:bg-focus kv:focus-visible:bg-focus kv:focus-visible:outline-none"
      :style="{ left: `${handleLeftGraph}px` }"
      label="Resize graph column"
      :value="effectiveWidths.graph"
      :min="minWidthFor('graph')"
      :max="maxGraph"
      @update:value="(w) => setColumnWidth('graph', w)"
    />
    <KuiColumnResizeHandle
      v-if="!detailOpen"
      class="kv:absolute kv:top-0 kv:bottom-0 kv:w-1.25 kv:-ml-0.5 kv:cursor-col-resize kv:z-2 kv:bg-transparent kv:hover:bg-focus kv:focus-visible:bg-focus kv:focus-visible:outline-none"
      :style="{ left: `${handleLeftAuthor}px` }"
      label="Resize author column"
      :value="effectiveWidths.author"
      :min="MIN_COLUMN_WIDTH"
      :max="maxAuthor"
      @update:value="(w) => setColumnWidth('author', w)"
    />
    <KuiColumnResizeHandle
      v-if="!detailOpen"
      class="kv:absolute kv:top-0 kv:bottom-0 kv:w-1.25 kv:-ml-0.5 kv:cursor-col-resize kv:z-2 kv:bg-transparent kv:hover:bg-focus kv:focus-visible:bg-focus kv:focus-visible:outline-none"
      :style="{ left: `${handleLeftDate}px` }"
      label="Resize date column"
      :value="effectiveWidths.date"
      :min="minWidthFor('date')"
      :max="maxDate"
      @update:value="(w) => setColumnWidth('date', w)"
    />
  </div>
</template>

<style>
@reference "../theme/tailwind.css";

/*
 * P213: single-declaration properties below are `@apply`'d kv: utilities. `outline: 0` and
 * `border: 0` stay raw (their utilities are composite and lean on `--tw-*` @property rules a
 * @reference file never emits), as do `contain`, the `color-mix` head tint, the inset accent
 * shadow and the focus outline recipe.
 *
 * The ~80 structural lines SlickGrid needs (§6.1): the library's own stylesheets are not
 * imported (they carry Bootstrap/Salesforce/Material palettes), so viewport, row and cell
 * positioning live here, mapped only to the --kv-* token layer. This file is the only place in
 * the repository where a .slick-* selector appears (W6's own "Done when").
 */
/* P110 A13: `.kv-commit-grid`'s own base box (position/height/width/min-height/overflow/font/
   color) moved onto the template's own `kv:` utilities — the classname itself stays, here and on
   the root `<div>`, since every `.kv-commit-grid .xxx` descendant rule below still needs it as a
   scoping ancestor for SlickGrid's JS-built DOM. `.kv-date-width-probe` had no descendant rule of
   its own and no other consumer, so it converts and drops its classname entirely.
   P110 A-fix: `.kv-grid-host` looked like the same case (no CSS rule of its own either) but
   graph-columns.spec.ts queries it directly (`document.querySelector('[data-testid="commit-grid"]
   .kv-grid-host')`) — kept as a bare literal on the `host` div for that reason alone. */

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
  @apply kv:absolute kv:overflow-hidden kv:w-full;
  outline: 0;
}

.kv-commit-grid .slick-viewport,
.kv-commit-grid .grid-canvas {
  @apply kv:relative kv:bg-panel;
  outline: 0;
}

.kv-commit-grid .slick-viewport {
  @apply kv:w-full;
}

/* SlickGrid rewrites inline `overflow-x: auto` on every resizeCanvas. Columns always fit
   (columnFit.ts); important hidden is the last guard so a sideways wheel never scrolls the graph
   off screen. */
.kv-commit-grid .slick-viewport {
  @apply kv:overflow-x-hidden!;
}

/* P162: one stacking context and paint boundary for every row (each row is a stacking context
   via its translateY transform), so no row can be promoted to its own compositing layer. */
.kv-commit-grid .grid-canvas {
  contain: layout paint;
}

.kv-commit-grid .slick-row.ui-widget-content {
  @apply kv:absolute kv:w-full kv:bg-panel kv:cursor-pointer;
  border: 0;
  /* P92 item 4: opaque, not transparent — the canvas already paints this exact token underneath
     (`.grid-canvas`, above), so nothing changes visually, but a repainted row now erases the band
     it owns instead of compositing over whatever was there. */
  /* G-UX D2 (item 1b): every row opens/toggles the detail pane on click — the whole row reads as
   *  clickable, not only `.kv-cell-date` (whose own `cursor: pointer` this cascades onto too,
   *  `cursor` being an inherited property; that per-cell rule is removed once item 8 relocates
   *  the date-format toggle off the cell entirely). `enableTextSelectionOnCells: true` still lets
   *  a pointer-cursor row be drag-selected for its text. */
}

/* G-UX (item 1): the checked-out row's own subtle background tint + left accent bar — placed
   BEFORE :hover/.kv-row-selected below (equal specificity throughout this file's own rows,
   (0,3,0) each; the LAST matching rule wins a tie), so hovering or selecting a HEAD row still
   shows the hover/selection background on top of this one, not the reverse. font-weight has no
   such ordering concern (hover/selected never set it), so it stays on this same rule rather than
   splitting into two. */
.kv-commit-grid .slick-row.kv-row-head {
  @apply kv:font-semibold;
  background-color: color-mix(in srgb, var(--kv-focus-border) 9%, transparent);
  box-shadow: inset 2px 0 0 0 var(--kv-focus-border);
}

.kv-commit-grid .slick-row:hover {
  @apply kv:bg-hover;
}

.kv-commit-grid .slick-row.kv-row-selected {
  @apply kv:bg-selected kv:text-selected-fg;
}

/* History: a border-only ref badge originally carried its own decoration colour as both `color`
   and `border-color`, tuned against the row's *un*selected background — a selected row with, say,
   a green `v1.0.0` tag badge failed contrast for real (P5 W14's own axe scan), fixed at the time
   with the row's own selected-foreground for both properties. P7 replaced every kind with an
   opaque fill instead, which made that override unnecessary (a chip's own contrast against its
   own fill no longer depended on the row underneath).
   P92 item 10: back to an outline (no fill) — the label/icon are `--kv-badge-fg`, a fixed,
   theme-supplied token, not the kind colour P5 W14's fix was tuned against, so that specific
   selected-row failure cannot recur; legibility now depends on `--kv-badge-fg` against whatever
   row background sits behind it (unselected, hover, selected), verified by eye in both themes
   rather than re-adding a selected-row override for a token this file does not otherwise treat as
   theme-conditional. */

/* W14's roving tabindex focuses a real row node (not a hidden sink) — it needs a visible
   indicator of its own, the same token every other focusable edge in this grid already uses. */
.kv-commit-grid .slick-row:focus-visible {
  outline: 1px solid var(--kv-focus-border);
  outline-offset: -1px;
}

/* P93 §4.2: the placeholder row — `columns.ts`'s `rowMetadata` sets `kv-row-collapsed`
   (`getItemMetadata`'s own `cssClasses`), never `kv-row-selected`/`-head`/`-stash` (its own doc
   comment on why). The muted tone doubles as the "this is not a real commit" cue the row itself
   otherwise gives no other visual signal for. */
.kv-commit-grid .slick-row.kv-row-collapsed {
  @apply kv:text-muted-foreground;
}

.kv-commit-grid .slick-cell {
  @apply kv:absolute kv:flex kv:items-center kv:overflow-hidden kv:py-0 kv:px-1;
  border: none;
}

/* The graph cell alone needs overflow: visible — W8's row overdraw (0.5px past the row's own
   band, so two rows' vertical runs meet without a hairline seam at a fractional DPR) draws
   slightly outside its own cell bounds by design. */
.kv-commit-grid .kv-cell-graph {
  @apply kv:p-0 kv:overflow-visible;
}

/* Font sizes stay here: `check_font_scale` exempts this file, and the same size as a class on
   unprefixed badge markup would trip it. The rest of the badge look is utilities from
   `badgeClass.ts` (P131 Part 2 §5.1) and the cell builders in `columns.ts`/`refBadges.ts`. */
.kv-badge {
  font-size: var(--kv-t-md);
}

/* P72 §6.3: a step below `.kv-badge`'s own label size — an icon reads as decoration, not text. */
.kv-badge-icon {
  font-size: var(--kv-t-sm);
}

/* P72 §6.3: `--kv-t-xs`, one step further down since a checkmark is even more purely decorative. */
.kv-badge-current-glyph {
  font-size: var(--kv-t-xs);
}

.kv-collapsed-chevron {
  font-size: var(--kv-t-md);
}

</style>
