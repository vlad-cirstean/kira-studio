/**
 * `docs/plans/P4.md` W6: the SlickGrid column definitions and the `CustomDataView` adapter that
 * is "the whole of §5.5's contract with the library" — three methods, called only for the rows
 * the grid actually renders, each `CommitRecord` materialized and immediately discarded rather
 * than retained (`getItem` is never memoized here; see `createCommitDataView`'s doc comment).
 *
 * The **graph** column's formatter is supplied by the caller (`CommitGrid.vue`, via W8's
 * `graphColumn.ts`'s `createGraphFormatter`) rather than built here: it needs a `LayoutStore` and
 * a `CommitStore` closed over per grid instance, which this module — shared column-definition
 * logic with no state of its own — does not hold. The **message** column (W7) renders the subject
 * plus, when the row has decorations, `refBadges.ts`'s inline badge strip ahead of it.
 *
 * `enableHtmlRendering: false` (set by `CommitGrid.vue`) means every formatter here must return
 * a real `HTMLElement`/`SVGElement`, never a string — enforced by the library, not by discipline,
 * so a commit subject containing `<script>` is text by construction.
 */
import type { CommitRecord, CommitStore, DecorationRef } from '@kira/git-core';
import type { PrRecord } from '@kira/git-ipc';
import type { Column, CustomDataView, Formatter, ItemMetadata } from 'slickgrid';
import { graphColumnWidth } from '../graph/geometry.ts';
// G19 D1: isHeadDecoration is promoted to rowSvg.ts (the graph column's own module), imported
// from there rather than defined here — mirroring isStashRow's already-established precedent for
// crossing this exact boundary.
import { isHeadDecoration } from '../graph/rowSvg.ts';
import type { ColumnWidths, DateFormat } from '../state/viewState.ts';
import { formatAbsoluteDate, formatRelativeDate } from './dateFormat.ts';
import { buildPrBadge, buildRefBadges, type StackBadgeInfo } from './refBadges.ts';
import { splitHighlights } from './searchHighlight.ts';

/** Every field a column's `field:` must name is a valid dotted path into `CommitRecord`
 *  (SlickGrid's `Column<T>.field` is typed against `T`'s own leaf paths); formatters here read
 *  `dataContext` directly and ignore `value`, so which leaf each column claims is otherwise
 *  arbitrary — chosen for readability, not because the formatter uses it. */
export const GRAPH_COLUMN_ID = 'graph';
export const MESSAGE_COLUMN_ID = 'message';
export const AUTHOR_COLUMN_ID = 'author';
export const DATE_COLUMN_ID = 'date';

function isStashDecoration(ref: DecorationRef): boolean {
  return ref.kind === 'stash';
}

function textCell(text: string, className: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}

/** P11 W13: the subject's own in-place search highlight. `pattern()` is re-read on every render
 *  pass — mirroring `DateFormatterContext`/`LaneColorContext`'s own accessor convention — so
 *  `CommitGrid.vue` never rebuilds the column model just to reflect a new query; it only calls
 *  `invalidateAllRows()`/`render()` on `search.searchGeneration`, exactly as it already does for
 *  `graphView.generation`. `undefined` means "no query to highlight" (empty box, refs-only scope,
 *  or no `search` prop at all), not "clear the previous highlight" — there is nothing to clear
 *  since nothing here retains state across render passes. */
export interface MessageSearchContext {
  readonly pattern: () => RegExp | undefined;
}

const NO_SEARCH_CONTEXT: MessageSearchContext = { pattern: () => undefined };

/** G21 D4: the message column's own accessor onto the row's lane colour — `columns.ts` itself
 *  has no `LayoutStore` (this module's own doc comment already explains why the graph column's
 *  formatter is supplied by the caller for the same reason); mirrors `MessageSearchContext`'s own
 *  shape exactly, re-read on every render pass rather than captured once. `undefined` for a row
 *  whose layout has not arrived yet (`graphColumn.ts`'s own already-established case) — the badge
 *  then renders with no lane tint, never a guessed colour. */
export interface LaneColorContext {
  readonly colorOf: (row: number) => number | undefined;
}

const NO_LANE_COLOR_CONTEXT: LaneColorContext = { colorOf: () => undefined };

/** G24 D9: the message column's own accessor onto a row's associated PR(s) — a third instance of
 *  `MessageSearchContext`/`LaneColorContext`'s own convention, re-read on every render pass rather
 *  than captured once, so `CommitGrid.vue` only ever needs to trigger a re-render (the
 *  `pr.generation` watcher) on a new resolution, never rebuild the column model. `prsFor` returns
 *  `undefined` for every "nothing to show" outcome (not-yet-resolved, in-flight, `disabled`,
 *  `unavailable`, or resolved-with-none) — `PrState.bySha`'s own doc comment on why the grid never
 *  has to distinguish those five itself. */
export interface PrContext {
  readonly prsFor: (sha: string) => readonly PrRecord[] | undefined;
}

const NO_PR_CONTEXT: PrContext = { prsFor: () => undefined };

/** G26 D-4.10/F12: the message column's own accessor onto a branch's stack decoration — a fourth
 *  instance of `MessageSearchContext`/`LaneColorContext`/`PrContext`'s own convention, re-read on
 *  every render pass. `CommitGrid.vue`'s own `stack.generation` watcher (F12's fourth instance)
 *  triggers a re-render on a new `stack.list`, never a column rebuild. `stackInfoFor` returns
 *  `undefined` for every branch that is not a stack member — `refBadges.ts`'s own "render
 *  nothing" rule, restated here. */
export interface StackContext {
  readonly stackInfoFor: (branchName: string) => StackBadgeInfo | undefined;
}

const NO_STACK_CONTEXT: StackContext = { stackInfoFor: () => undefined };

/** G-UX (item 2b): the message cell is a 2-row CSS grid now (`CommitGrid.vue`'s `<style>`), not a
 *  single flex row — `refBadges.ts`'s badge strip and `buildPrBadge`'s own badge, when either is
 *  present, share one `grid-row: 1` wrapper (`.kv-message-badges-row`) above the subject's own
 *  `grid-row: 2`, rather than sitting inline before it. A row with neither never gets that wrapper
 *  at all (mirroring `buildRefBadges`'s own "no empty wrapper" rule) — the subject's explicit
 *  `grid-row: 2` still lands it on the same baseline as every other row regardless, so an
 *  undecorated commit costs nothing beyond the row's own fixed height. The subject alone gets
 *  `text-overflow: ellipsis` — a CSS rule on `.kv-message-subject`, not something this formatter
 *  computes. When a search pattern is active, the subject's text is split by `searchHighlight.ts`'s
 *  `splitHighlights` into alternating plain text nodes and `<span class="kv-search-hit">` elements
 *  — `enableHtmlRendering: false` (§5.5) and this building every node with `textContent` mean no
 *  escaping code is introduced and none is needed. */
function messageFormatter(
  ctx: MessageSearchContext,
  laneCtx: LaneColorContext,
  prCtx: PrContext = NO_PR_CONTEXT,
  stackCtx: StackContext = NO_STACK_CONTEXT,
): Formatter<CommitRecord> {
  return (row, _cell, _value, _columnDef, dataContext) => {
    const cell = document.createElement('span');
    cell.className = 'kv-cell-message';

    const badges = buildRefBadges(
      dataContext.decoration,
      laneCtx.colorOf(row),
      stackCtx.stackInfoFor,
    );
    // G24 D9: the PR badge shares the same row-1 strip, placed after the ref badges.
    const prs = prCtx.prsFor(dataContext.sha);
    const prBadge = prs !== undefined ? buildPrBadge(prs) : null;
    if (badges !== null || prBadge !== null) {
      // P7 (item 1): the same condition that decides whether the badges-row element exists at
      // all also decides whether the row is tall enough to show it — `rowMetadata` below makes
      // the identical `decoration.length > 0 || hasPr` check, cheaply, without building this DOM.
      cell.classList.add('kv-cell-message--has-badges');
      const badgesRow = document.createElement('span');
      badgesRow.className = 'kv-message-badges-row';
      if (badges !== null) badgesRow.appendChild(badges);
      if (prBadge !== null) badgesRow.appendChild(prBadge);
      cell.appendChild(badgesRow);
    }

    const subject = document.createElement('span');
    subject.className = 'kv-message-subject';
    const pattern = ctx.pattern();
    if (pattern === undefined) {
      subject.textContent = dataContext.subject;
    } else {
      for (const run of splitHighlights(dataContext.subject, pattern)) {
        if (!run.matched) {
          subject.appendChild(document.createTextNode(run.text));
          continue;
        }
        const hit = document.createElement('span');
        hit.className = 'kv-search-hit';
        hit.textContent = run.text;
        subject.appendChild(hit);
      }
    }
    cell.appendChild(subject);

    return cell;
  };
}

const authorFormatter: Formatter<CommitRecord> = (_row, _cell, _value, _columnDef, dataContext) =>
  textCell(dataContext.author.name, 'kv-cell-author');

/** `ctx.dateFormat`/`ctx.now` are accessors, not values, so a single `Column[]` array built once
 *  keeps rendering the *current* format on every SlickGrid-triggered re-render — `CommitGrid.vue`
 *  toggles the underlying ref and calls `invalidateAllRows()`/`render()`, it never rebuilds the
 *  column definitions just to flip a date format. */
export interface DateFormatterContext {
  readonly dateFormat: () => DateFormat;
  readonly now: () => number;
}

function dateFormatter(ctx: DateFormatterContext): Formatter<CommitRecord> {
  return (_row, _cell, _value, _columnDef, dataContext) => {
    const timestamp = dataContext.author.timestamp;
    const text =
      ctx.dateFormat() === 'absolute'
        ? formatAbsoluteDate(timestamp)
        : formatRelativeDate(timestamp, ctx.now());
    return textCell(text, 'kv-cell-date');
  };
}

/** The explicit widths `CommitGrid.vue` computes before building columns: `messageWidth` is
 *  whatever remains of the host's own width once every other column is accounted for, the graph
 *  column's width is `graphColumnWidth(laneCount)`, and `author`/`date` come from `viewState`'s
 *  persisted `ColumnWidths` (or `DEFAULT_COLUMN_WIDTHS` on first mount). */
export interface ColumnWidthInputs extends ColumnWidths {
  readonly laneCount: number;
  readonly messageWidth: number;
}

/** G-UX D1 (item 1a): when the detail pane is open, `author`/`date` are dropped entirely — every
 *  fact they show also renders in the pane the click just opened (`CommitMeta.vue`'s Author/
 *  Committer), so keeping them is pure duplication that starves the one column that is not
 *  already duplicated: `message`. `CommitGrid.vue` stops subtracting `widths.author + widths.date`
 *  from `computeMessageWidth` in this mode, so the freed width goes to the subject. */
export interface BuildColumnsOptions {
  readonly compact?: boolean;
}

/** Builds the column definitions in display order (G21 D5: the fifth, `sha`, is gone — the
 *  details panel's own single click-to-copy SHA, `CommitMeta.vue`, is now the only sha-copy
 *  affordance). Not user-resizable: `graph` (its width is derived from `laneCount`, not a user
 *  choice — its `graphFormatter` and geometry are W8's `graphColumn.ts`/`rowSvg.ts`, built once
 *  per grid instance and passed in here rather than built by this stateless module) and `message`
 *  (it is "remaining width", recomputed by `CommitGrid.vue` on every resize rather than dragged).
 *  `author`/`date` are resizable via `CommitGrid.vue`'s own drag handles (§6.1:
 *  `showColumnHeader: false` costs SlickGrid's built-in header resize handles, so this repo keeps
 *  its own), which write back through `grid.setColumns(...)` — this function, called again with
 *  the new widths, is the single source of the column model either way. `searchCtx` (W13) and
 *  `laneCtx` (G21 D4) are both optional and default to "no highlight"/"no lane colour" so a
 *  caller that only needs the basic shape keeps working unchanged — only `CommitGrid.vue` passes
 *  real ones. `options.compact` (D1) returns only `graph`/`message` — `author`/`date` are omitted
 *  outright, not merely hidden, so there is no resize handle or hit target for a column that is
 *  not rendered. */
export function buildColumns(
  widths: ColumnWidthInputs,
  dateCtx: DateFormatterContext,
  graphFormatter: Formatter<CommitRecord>,
  searchCtx: MessageSearchContext = NO_SEARCH_CONTEXT,
  laneCtx: LaneColorContext = NO_LANE_COLOR_CONTEXT,
  prCtx: PrContext = NO_PR_CONTEXT,
  stackCtx: StackContext = NO_STACK_CONTEXT,
  options: BuildColumnsOptions = {},
): Column<CommitRecord>[] {
  const columns: Column<CommitRecord>[] = [
    {
      id: GRAPH_COLUMN_ID,
      field: 'sha',
      name: '',
      width: graphColumnWidth(widths.laneCount),
      resizable: false,
      sortable: false,
      focusable: false,
      selectable: false,
      cssClass: 'kv-cell-graph',
      formatter: graphFormatter,
    },
    {
      id: MESSAGE_COLUMN_ID,
      field: 'subject',
      name: '',
      width: widths.messageWidth,
      resizable: false,
      sortable: false,
      focusable: false,
      selectable: false,
      formatter: messageFormatter(searchCtx, laneCtx, prCtx, stackCtx),
    },
  ];
  if (options.compact) return columns;
  columns.push(
    {
      id: AUTHOR_COLUMN_ID,
      field: 'author.name',
      name: '',
      width: widths.author,
      resizable: false,
      sortable: false,
      focusable: false,
      selectable: false,
      formatter: authorFormatter,
    },
    {
      id: DATE_COLUMN_ID,
      field: 'author.timestamp',
      name: '',
      width: widths.date,
      resizable: false,
      sortable: false,
      focusable: false,
      selectable: false,
      formatter: dateFormatter(dateCtx),
    },
  );
  return columns;
}

/** `getItemMetadata`'s `cssClasses`: `selected` from `SelectionState` (not SlickGrid's own
 *  `RowSelectionModel` — see `CommitGrid.vue`'s doc comment), `head`/`stash` from `decorationAt` —
 *  the single source `docs/plans/P4.md` W8 promises ("the single source is `decorationAt`, not a
 *  second heuristic" — in particular, never a guess from the subject line, which an ordinary
 *  commit could coincidentally match).
 *
 *  P7 (item 1): also `getItemMetadata`'s `height`, now that `CommitGrid.vue` turns on
 *  `enableVariableRowHeight` — `expandedRowHeight`/`prsFor` are optional so every existing caller
 *  of `rowMetadata` that only needs the class behaviour keeps compiling; only `CommitGrid.vue`
 *  passes real ones. */
export interface RowMetadataContext {
  readonly store: CommitStore;
  readonly isSelected: (row: number) => boolean;
  readonly expandedRowHeight?: () => number;
  readonly prsFor?: (sha: string) => readonly PrRecord[] | undefined;
}

/** P7 (item 1): whether row `row` renders a ref/PR badge strip at all — the exact condition
 *  `messageFormatter` above uses to decide whether to build `.kv-message-badges-row` (and add
 *  `kv-cell-message--has-badges`), recomputed here cheaply (no DOM: `planBadges`'s own exhaustive
 *  `badgeSpecFor` switch means every decoration kind, `head` included, always produces a visible
 *  badge, so `decoration.length > 0` alone is a complete proxy) rather than calling
 *  `buildRefBadges`/`buildPrBadge` a second time just to check emptiness. */
function rowHasBadges(
  ctx: RowMetadataContext,
  row: number,
  decoration: readonly DecorationRef[],
): boolean {
  if (decoration.length > 0) return true;
  if (ctx.prsFor === undefined) return false;
  const sha = ctx.store.commitAt(row).sha;
  return (ctx.prsFor(sha)?.length ?? 0) > 0;
}

export function rowMetadata(ctx: RowMetadataContext, row: number): ItemMetadata | null {
  const classes: string[] = [];
  if (ctx.isSelected(row)) classes.push('kv-row-selected');
  const decoration = ctx.store.decorationAt(row);
  if (decoration.some(isHeadDecoration)) classes.push('kv-row-head');
  if (decoration.some(isStashDecoration)) classes.push('kv-row-stash');
  const hasBadges = ctx.expandedRowHeight !== undefined && rowHasBadges(ctx, row, decoration);
  if (classes.length === 0 && !hasBadges) return null;
  return {
    cssClasses: classes.length > 0 ? classes.join(' ') : undefined,
    height: hasBadges ? ctx.expandedRowHeight?.() : undefined,
  };
}

/**
 * §5.5's whole contract with the library, three methods: `getItem` calls `store.commitAt(row)`
 * fresh on every invocation — no cache, no memoization — because the only way to guarantee "the
 * grid is never handed materialized rows" is for nothing here to *hold* a materialized row for
 * longer than one formatter pass needs it. `getLength`/`isSelected` are accessors rather than
 * captured values so this data view always answers with the store's/selection's *current* state,
 * matching the plan's own sketch (`getLength: () => graphView.loadedRows.value`).
 */
export interface CommitDataViewDeps extends RowMetadataContext {
  readonly loadedRows: () => number;
}

export function createCommitDataView(deps: CommitDataViewDeps): CustomDataView<CommitRecord> {
  return {
    getLength: () => deps.loadedRows(),
    getItem: (row: number) => deps.store.commitAt(row),
    getItemMetadata: (row: number) => rowMetadata(deps, row),
  };
}
