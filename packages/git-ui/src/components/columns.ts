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
import type { CommitRecord, CommitStore, DecorationRef, RowPlan } from '@kira/git-core';
import type { PrRecord } from '@kira/git-ipc';
import type { Column, CustomDataView, Formatter, ItemMetadata } from 'slickgrid';
import type { ColumnWidths, DateFormat } from '../state/viewState.ts';
import { formatAbsoluteDate, formatRelativeDate } from './dateFormat.ts';
import { buildPrBadge, buildRefBadges, type StackBadgeInfo } from './refBadges.ts';
import { splitHighlights } from './searchHighlight.ts';

/** Every field a column's `field:` must name is a valid dotted path into `CommitRecord`
 *  (SlickGrid's `Column<T>.field` is typed against `T`'s own leaf paths); formatters here read
 *  `dataContext` directly and ignore `value`, so which leaf each column claims is otherwise
 *  arbitrary — chosen for readability, not because the formatter uses it. */
export const GRAPH_COLUMN_ID = 'graph';
const MESSAGE_COLUMN_ID = 'message';
const AUTHOR_COLUMN_ID = 'author';
const DATE_COLUMN_ID = 'date';

function isStashDecoration(ref: DecorationRef): boolean {
  return ref.kind === 'stash';
}

// `kira-cell-date` stays as a runtime class: tests and the width probe read it.
const CELL_TEXT_CLASS = 'overflow-hidden text-ellipsis whitespace-nowrap';
const CELL_AUTHOR_CLASS = `text-muted-foreground ${CELL_TEXT_CLASS}`;
const CELL_DATE_CLASS = `kira-cell-date tabular-nums text-muted-foreground ${CELL_TEXT_CLASS}`;
// One flex row: badge strip (capped at half the cell), then the subject.
const CELL_MESSAGE_CLASS = 'kira-cell-message flex items-center gap-1 min-w-0 overflow-hidden';
const CELL_MESSAGE_COLLAPSED_CLASS = CELL_MESSAGE_CLASS;
const SUBJECT_CLASS = 'min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap';
const SUBJECT_STASH_CLASS = `${SUBJECT_CLASS} italic`;
const BADGES_ROW_CLASS = 'flex items-center gap-1 shrink min-w-0 max-w-1/2 overflow-hidden';
const SUBJECT_COLLAPSED_CLASS = `${SUBJECT_CLASS} italic text-muted-foreground`;

function textCell(text: string, className: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}

/** P11 W13: the subject's own in-place search highlight. `pattern()` is re-read on every render
 *  pass — mirroring `DateFormatterContext`'s own accessor convention — so
 *  `CommitGrid.vue` never rebuilds the column model just to reflect a new query; it only calls
 *  `invalidateAllRows()`/`render()` on `search.searchGeneration`, exactly as it already does for
 *  `graphView.generation`. `undefined` means "no query to highlight" (empty box, refs-only scope,
 *  or no `search` prop at all), not "clear the previous highlight" — there is nothing to clear
 *  since nothing here retains state across render passes. */
export interface MessageSearchContext {
  readonly pattern: () => RegExp | undefined;
}

const NO_SEARCH_CONTEXT: MessageSearchContext = { pattern: () => undefined };

/** G24 D9: the message column's own accessor onto a row's associated PR(s) — a third instance of
 *  `MessageSearchContext`'s own convention, re-read on every render pass rather
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
 *  instance of `MessageSearchContext`/`PrContext`'s own convention, re-read on
 *  every render pass. `CommitGrid.vue`'s own `stack.generation` watcher (F12's fourth instance)
 *  triggers a re-render on a new `stack.list`, never a column rebuild. `stackInfoFor` returns
 *  `undefined` for every branch that is not a stack member — `refBadges.ts`'s own "render
 *  nothing" rule, restated here. */
export interface StackContext {
  readonly stackInfoFor: (branchName: string) => StackBadgeInfo | undefined;
}

const NO_STACK_CONTEXT: StackContext = { stackInfoFor: () => undefined };

/** P93 §4.2/§7: the placeholder's own accessors — `plan` so `messageFormatter`/`authorFormatter`/
 *  `dateFormatter`/`rowMetadata` can each ask `entryAt(row).kind` without a fifth copy of
 *  `MessageSearchContext`'s "re-read on every render pass" convention per call site, and `labelFor`
 *  to turn a `RowPlanEntry.groupIndex` into the branch name the "N more commits on X" text needs
 *  (`RowPlan.groupKeyAt` only ever exposes the raw, unreadable key — `GraphOrderState.tips`'s own
 *  doc comment). `undefined` for the synthetic `other` group (index `tips.length`, no `TipRef` of
 *  its own) — `collapsedMessageText` below falls back to branch-less wording for it. */
export interface CollapsedRowContext {
  readonly plan: () => RowPlan;
  readonly labelFor: (groupIndex: number) => string | undefined;
}

/** A default's own permissive stand-in for a real `RowPlan` — unlike `identityRowPlan(0)`, it
 *  never asserts out of range, since a caller using the default (no real `GraphOrderState`
 *  attached) may still call a formatter with any row `getLength`/`SlickGrid` gave it; every entry
 *  reads as an ordinary `'commit'` row, the same behaviour every formatter here had before P93. */
const PERMISSIVE_PLAN: RowPlan = {
  length: Number.MAX_SAFE_INTEGER,
  revision: 0,
  storeLength: Number.MAX_SAFE_INTEGER,
  entryAt: (displayRow) => ({
    kind: 'commit',
    storeRow: displayRow,
    groupIndex: 0,
    hiddenCount: 0,
  }),
  storeRowAt: (displayRow) => displayRow,
  displayRowOf: (storeRow) => storeRow,
  containingDisplayRow: (storeRow) => storeRow,
  groupKeyAt: () => 'identity',
  forkParentOf: () => -1,
};

const NO_COLLAPSED_ROW_CONTEXT: CollapsedRowContext = {
  plan: () => PERMISSIVE_PLAN,
  labelFor: () => undefined,
};

/** P93 §4.2: "a chevron, then `47 more commits on feature/x`" — the label clause is dropped
 *  entirely for the `other` group (no branch name to name), rather than printing a placeholder
 *  word for it. */
export function collapsedMessageText(hiddenCount: number, label: string | undefined): string {
  const commits = hiddenCount === 1 ? 'commit' : 'commits';
  return label === undefined
    ? `${hiddenCount} more ${commits}`
    : `${hiddenCount} more ${commits} on ${label}`;
}

/** The message cell is one flex row: `refBadges.ts`'s badge strip and `buildPrBadge`'s badge, when
 *  present, share one wrapper (`BADGES_ROW_CLASS`) before the subject. A row with neither never gets
 *  that wrapper. The subject alone ellipsizes. With an active search pattern, the subject splits via
 *  `searchHighlight.ts`'s `splitHighlights` into plain text nodes and `bg-search-match` spans;
 *  `enableHtmlRendering: false` (§5.5) and `textContent` everywhere mean no escaping is needed. */
function messageFormatter(
  ctx: MessageSearchContext,
  prCtx: PrContext = NO_PR_CONTEXT,
  stackCtx: StackContext = NO_STACK_CONTEXT,
  collapsedCtx: CollapsedRowContext = NO_COLLAPSED_ROW_CONTEXT,
): Formatter<CommitRecord> {
  return (row, _cell, _value, _columnDef, dataContext) => {
    const cell = document.createElement('span');
    cell.className = CELL_MESSAGE_CLASS;

    // P93 §4.2: the placeholder's own message cell — chevron + "N more commits on X", never the
    // badge/subject rendering below (a contracted range has no single subject either).
    const entry = collapsedCtx.plan().entryAt(row);
    if (entry.kind === 'collapsed') {
      cell.className = CELL_MESSAGE_COLLAPSED_CLASS;
      cell.dataset.testid = 'graph-collapsed-row';
      cell.dataset.groupKey = collapsedCtx.plan().groupKeyAt(row);
      // `codicon-chevron-right`, not `FileTree.vue`/`ReviewCommitRow.vue`'s own expanded/collapsed
      // pair — a placeholder row only ever means "collapsed" (expanding it replaces the row
      // outright, §4.2), so there is no expanded state for this glyph to reflect.
      const chevron = document.createElement('span');
      chevron.className = 'codicon codicon-chevron-right shrink-0';
      chevron.setAttribute('aria-hidden', 'true');
      cell.appendChild(chevron);
      const text = document.createElement('span');
      text.className = SUBJECT_COLLAPSED_CLASS;
      text.textContent = collapsedMessageText(
        entry.hiddenCount,
        collapsedCtx.labelFor(entry.groupIndex),
      );
      cell.appendChild(text);
      return cell;
    }

    const badges = buildRefBadges(dataContext.decoration, stackCtx.stackInfoFor);
    // G24 D9: the PR badge shares the badge strip, placed after the ref badges.
    const prs = prCtx.prsFor(dataContext.sha);
    const prBadge = prs !== undefined ? buildPrBadge(prs) : null;
    if (badges !== null || prBadge !== null) {
      const badgesRow = document.createElement('span');
      badgesRow.className = BADGES_ROW_CLASS;
      if (badges !== null) badgesRow.appendChild(badges);
      if (prBadge !== null) badgesRow.appendChild(prBadge);
      cell.appendChild(badgesRow);
    }

    const subject = document.createElement('span');
    subject.dataset.testid = 'message-subject';
    subject.className = dataContext.decoration.some(isStashDecoration)
      ? SUBJECT_STASH_CLASS
      : SUBJECT_CLASS;
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
        hit.className = 'bg-search-match rounded-kira-xs';
        hit.textContent = run.text;
        subject.appendChild(hit);
      }
    }
    cell.appendChild(subject);

    return cell;
  };
}

/** P93 §4.2: "Author/date cells: empty" for a placeholder — a contracted range has no single
 *  author, and showing the newest hidden commit's would read as a fact about the row. Promoted
 *  from a bare constant (pre-P93) to a function for the same reason `dateFormatter` already is:
 *  it needs `collapsedCtx.plan()`, closed over per grid instance like every other formatter here. */
function authorFormatter(
  collapsedCtx: CollapsedRowContext = NO_COLLAPSED_ROW_CONTEXT,
): Formatter<CommitRecord> {
  return (row, _cell, _value, _columnDef, dataContext) => {
    if (collapsedCtx.plan().entryAt(row).kind === 'collapsed')
      return textCell('', CELL_AUTHOR_CLASS);
    return textCell(dataContext.author.name, CELL_AUTHOR_CLASS);
  };
}

/** `ctx.dateFormat`/`ctx.now` are accessors, not values, so a single `Column[]` array built once
 *  keeps rendering the *current* format on every SlickGrid-triggered re-render — `CommitGrid.vue`
 *  toggles the underlying ref and calls `invalidateAllRows()`/`render()`, it never rebuilds the
 *  column definitions just to flip a date format. */
export interface DateFormatterContext {
  readonly dateFormat: () => DateFormat;
  readonly now: () => number;
}

function dateFormatter(
  ctx: DateFormatterContext,
  collapsedCtx: CollapsedRowContext = NO_COLLAPSED_ROW_CONTEXT,
): Formatter<CommitRecord> {
  return (row, _cell, _value, _columnDef, dataContext) => {
    // P93 §4.2: same "empty for a placeholder" rule as `authorFormatter` — no single date either.
    if (collapsedCtx.plan().entryAt(row).kind === 'collapsed') return textCell('', CELL_DATE_CLASS);
    const timestamp = dataContext.author.timestamp;
    const text =
      ctx.dateFormat() === 'absolute'
        ? formatAbsoluteDate(timestamp)
        : formatRelativeDate(timestamp, ctx.now());
    return textCell(text, CELL_DATE_CLASS);
  };
}

/** The explicit widths `CommitGrid.vue` computes before building columns: `messageWidth` is
 *  whatever remains of the host's own width once every other column is accounted for; `graph`/
 *  `author`/`date` (from `ColumnWidths`) come from `viewState`'s persisted state (or
 *  `DEFAULT_COLUMN_WIDTHS` on first mount) — `laneCount` is still needed here, separately, by the
 *  graph column's own *formatter* (drawing lanes inside whatever width `graph` is set to). */
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
 *  affordance). Not user-resizable: `message` (it is "remaining width", recomputed by
 *  `CommitGrid.vue` on every resize rather than dragged). `graph`/`author`/`date` are resizable via
 *  `CommitGrid.vue`'s own drag handles (§6.1: `showColumnHeader: false` costs SlickGrid's built-in
 *  header resize handles, so this repo keeps its own — `resizable: false` below only governs the
 *  header-row handle this grid never shows), which write back through `grid.setColumns(...)` —
 *  this function, called again with the new widths, is the single source of the column model
 *  either way. `graph`'s own `graphFormatter` and geometry are W8's `graphColumn.ts`/`rowSvg.ts`,
 *  built once per grid instance and passed in here rather than built by this stateless module.
 *  `searchCtx` (W13) is optional and defaults to "no highlight"; only `CommitGrid.vue` passes
 *  a real one. `options.compact` (D1) returns only `graph`/`message` — `author`/`date` are omitted
 *  outright, not merely hidden, so there is no resize handle or hit target for a column that is
 *  not rendered. */
export function buildColumns(
  widths: ColumnWidthInputs,
  dateCtx: DateFormatterContext,
  graphFormatter: Formatter<CommitRecord>,
  searchCtx: MessageSearchContext = NO_SEARCH_CONTEXT,
  prCtx: PrContext = NO_PR_CONTEXT,
  stackCtx: StackContext = NO_STACK_CONTEXT,
  options: BuildColumnsOptions = {},
  collapsedCtx: CollapsedRowContext = NO_COLLAPSED_ROW_CONTEXT,
): Column<CommitRecord>[] {
  const columns: Column<CommitRecord>[] = [
    {
      id: GRAPH_COLUMN_ID,
      field: 'sha',
      name: '',
      width: widths.graph,
      // P92 item 2 follow-up: SlickGrid's own column default is `minWidth: 30`
      // (`_columnDefaults`, applied by `updateColumnProps()` on every `setColumns()`) — silently
      // applied to any column that does not declare its own, `graph` included. A one-lane (or
      // zero-lane, the transient pre-layout state) repo's own true width (`graphColumnWidth`,
      // `geometry.ts`) is 17-30px, so that hidden floor silently rendered the column wider than
      // `computeMessageWidth` (`CommitGrid.vue`) accounted for — the exact gap reappeared as a
      // permanent horizontal scrollbar §2's own `availableWidth()` fix does not touch, since the
      // desync is inside SlickGrid's own clamp, not in what width this file asks it to use. `0`
      // (not `undefined`) is required: `updateColumnProps()`'s clamp guards on `m.minWidth &&`, so
      // only a falsy `minWidth` (never merged back to the default) actually disables it.
      minWidth: 0,
      resizable: false,
      sortable: false,
      focusable: false,
      selectable: false,
      cssClass: 'kira-cell-graph',
      formatter: graphFormatter,
    },
    {
      id: MESSAGE_COLUMN_ID,
      field: 'subject',
      name: '',
      width: widths.messageWidth,
      minWidth: 0, // see `graph`'s own comment above — same hidden SlickGrid floor, same fix.
      resizable: false,
      sortable: false,
      focusable: false,
      selectable: false,
      formatter: messageFormatter(searchCtx, prCtx, stackCtx, collapsedCtx),
    },
  ];
  if (options.compact) return columns;
  columns.push(
    {
      id: AUTHOR_COLUMN_ID,
      field: 'author.name',
      name: '',
      width: widths.author,
      minWidth: 0, // see `graph`'s own comment above — same hidden SlickGrid floor, same fix.
      resizable: false,
      sortable: false,
      focusable: false,
      selectable: false,
      formatter: authorFormatter(collapsedCtx),
    },
    {
      id: DATE_COLUMN_ID,
      field: 'author.timestamp',
      name: '',
      width: widths.date,
      minWidth: 0, // see `graph`'s own comment above — same hidden SlickGrid floor, same fix.
      resizable: false,
      sortable: false,
      focusable: false,
      selectable: false,
      formatter: dateFormatter(dateCtx, collapsedCtx),
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
 *  P93 §7: `plan` translates the incoming row (SlickGrid's own display-row indexing) into the
 *  store row every other field here reads — `isSelected`/`prsFor` still take/answer for a STORE
 *  row (`SelectionState`'s own coordinate system, §1's "rows are one coordinate system" no longer
 *  true grid-wide but still true for selection), so `rowMetadata` translates once, at its own top,
 *  rather than pushing that onto every caller. */
interface RowMetadataContext {
  readonly store: CommitStore;
  readonly plan: () => RowPlan;
  readonly isSelected: (row: number) => boolean;
  readonly prsFor?: (sha: string) => readonly PrRecord[] | undefined;
}

function rowMetadata(ctx: RowMetadataContext, displayRow: number): ItemMetadata | null {
  const entry = ctx.plan().entryAt(displayRow);
  if (entry.kind === 'collapsed') {
    // P93 §4.2: "the compact height... A placeholder never carries badges" — nor is it ever
    // `kira-row-selected`/`-stash`: `entry.storeRow` is only the placeholder's first
    // contracted row (a shape `getItem` needs, §4.2's own note), not a fact about the placeholder
    // itself, so `store.decorationAt`/`isSelected` are never consulted for it.
    return { cssClasses: 'kira-row-collapsed' };
  }
  const row = entry.storeRow;
  const classes: string[] = [];
  if (ctx.isSelected(row)) classes.push('kira-row-selected');
  const decoration = ctx.store.decorationAt(row);
  if (decoration.some(isStashDecoration)) classes.push('kira-row-stash');
  return classes.length > 0 ? { cssClasses: classes.join(' ') } : null;
}

/** SlickGrid's row-height index rebuild calls `getItem` for every loaded row (to hand the item to
 *  `rowHeightProvider`, which the default provider ignores). Materializing each commit there cost
 *  hundreds of ms per rebuild on a large history, so the record is built on first field read —
 *  formatters only ever read the rows actually rendered. */
function lazyCommit(store: CommitStore, row: number): CommitRecord {
  let record: CommitRecord | undefined;
  const load = (): CommitRecord => {
    record ??= store.commitAt(row);
    return record;
  };
  return {
    get sha() {
      return load().sha;
    },
    get parents() {
      return load().parents;
    },
    get author() {
      return load().author;
    },
    get committer() {
      return load().committer;
    },
    get subject() {
      return load().subject;
    },
    get decoration() {
      return load().decoration;
    },
  };
}

/**
 * §5.5's whole contract with the library, three methods: `getItem` calls `store.commitAt(row)`
 * fresh on every invocation — no cache, no memoization — because the only way to guarantee "the
 * grid is never handed materialized rows" is for nothing here to *hold* a materialized row for
 * longer than one formatter pass needs it. `getLength`/`isSelected` are accessors rather than
 * captured values so this data view always answers with the store's/selection's *current* state.
 *
 * P93 §7: `row` throughout this data view is SlickGrid's own — the *display* row, `plan().length`
 * long and possibly reordered from arrival order (§5.4's identity plan is what every non-P93
 * caller still gets, unchanged). `getLength` no longer reads the store's loaded count directly;
 * `getItem`/`getItemMetadata` translate through `plan().storeRowAt` before touching the store.
 */
export type CommitDataViewDeps = RowMetadataContext;

export function createCommitDataView(deps: CommitDataViewDeps): CustomDataView<CommitRecord> {
  return {
    getLength: () => deps.plan().length,
    getItem: (row: number) => lazyCommit(deps.store, deps.plan().storeRowAt(row)),
    getItemMetadata: (row: number) => rowMetadata(deps, row),
  };
}
