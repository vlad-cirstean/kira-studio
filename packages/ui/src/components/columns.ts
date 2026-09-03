/**
 * `docs/plans/P4.md` W6: the SlickGrid column definitions and the `CustomDataView` adapter that
 * is "the whole of §5.5's contract with the library" — three methods, called only for the rows
 * the grid actually renders, each `CommitRecord` materialized and immediately discarded rather
 * than retained (`getItem` is never memoized here; see `createCommitDataView`'s doc comment).
 *
 * Two of the five columns below are deliberately minimal. The **graph** column returns an empty
 * `<svg>` — W8's `graphColumn.ts` replaces this formatter with the real one once `rowSvg.ts`
 * exists; until then (and forever, for a row whose layout hasn't arrived yet — W5: text lands
 * before lanes do) an empty graph cell is correct, not a placeholder that throws. The **message**
 * column renders the subject as plain text — W7's `refBadges.ts` extends this same formatter
 * with inline ref badges once the badge renderer exists. Splitting graph/message this way now
 * (rather than leaving both unwritten) is what lets W6's own "Done when" bullets — bounded row
 * count, `getItem` call counting, keyboard/scroll behaviour — be verified without waiting on W7
 * or W8, exactly as the plan's dependency table has it (W7 and W8 both depend on W6).
 *
 * `enableHtmlRendering: false` (set by `CommitGrid.vue`) means every formatter here must return
 * a real `HTMLElement`/`SVGElement`, never a string — enforced by the library, not by discipline,
 * so a commit subject containing `<script>` is text by construction.
 */
import type { CommitRecord, CommitStore, DecorationRef } from "@kira-version/core";
import type { Column, CustomDataView, Formatter, ItemMetadata } from "slickgrid";
import { formatAbsoluteDate, formatRelativeDate } from "./dateFormat.ts";
import { graphColumnWidth } from "../graph/geometry.ts";
import type { ColumnWidths, DateFormat } from "../state/viewState.ts";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Every field a column's `field:` must name is a valid dotted path into `CommitRecord`
 *  (SlickGrid's `Column<T>.field` is typed against `T`'s own leaf paths); formatters here read
 *  `dataContext` directly and ignore `value`, so which leaf each column claims is otherwise
 *  arbitrary — chosen for readability, not because the formatter uses it. */
export const GRAPH_COLUMN_ID = "graph";
export const MESSAGE_COLUMN_ID = "message";
export const AUTHOR_COLUMN_ID = "author";
export const DATE_COLUMN_ID = "date";
export const SHA_COLUMN_ID = "sha";

function isHeadDecoration(ref: DecorationRef): boolean {
  return ref.kind === "head" || (ref.kind === "branch" && ref.isHead);
}

function textCell(text: string, className: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  return span;
}

/** W8's placeholder: an empty graph cell, sized to the column so the row's height/width never
 *  jumps once `graphColumn.ts` starts drawing into it. No lanes, no edges — see this file's own
 *  doc comment for why that is correct now rather than temporary. Wrapped in a plain `<div>`
 *  because `Formatter`'s return type is `HTMLElement`, which an `SVGSVGElement` is not (SVG
 *  elements implement a separate DOM interface) — W8's real formatter keeps the same wrapper. */
const graphFormatter: Formatter<CommitRecord> = () => {
  const wrapper = document.createElement("div");
  wrapper.className = "kv-graph-cell";
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "kv-graph-svg");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  wrapper.appendChild(svg);
  return wrapper;
};

/** W7's placeholder: the subject alone, no ref badges yet. `text-overflow: ellipsis` is a CSS
 *  rule on the cell (`CommitGrid.vue`'s `<style>`), not something this formatter computes. */
const messageFormatter: Formatter<CommitRecord> = (_row, _cell, _value, _columnDef, dataContext) =>
  textCell(dataContext.subject, "kv-cell-message");

const authorFormatter: Formatter<CommitRecord> = (_row, _cell, _value, _columnDef, dataContext) =>
  textCell(dataContext.author.name, "kv-cell-author");

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
      ctx.dateFormat() === "absolute"
        ? formatAbsoluteDate(timestamp)
        : formatRelativeDate(timestamp, ctx.now());
    return textCell(text, "kv-cell-date");
  };
}

/** A `<button disabled>`, per the plan's own scope boundary: "the sha column renders as a button
 *  because that is what §6.4 says it is, but the copy action and the `Clipboard` port land with
 *  P5's copy actions, and a button that looks live and does nothing is worse than a button that
 *  is explicitly not there yet — so it is rendered `disabled` with a title saying so." */
const shaFormatter: Formatter<CommitRecord> = (_row, _cell, _value, _columnDef, dataContext) => {
  const button = document.createElement("button");
  button.type = "button";
  button.disabled = true;
  button.className = "kv-cell-sha";
  button.title = "Copy SHA — not available until P5";
  button.textContent = dataContext.sha.slice(0, 7);
  return button;
};

/** The explicit widths `CommitGrid.vue` computes before building columns: `messageWidth` is
 *  whatever remains of the host's own width once every other column is accounted for, the graph
 *  column's width is `graphColumnWidth(laneCount)`, and `author`/`date`/`sha` come from
 *  `viewState`'s persisted `ColumnWidths` (or `DEFAULT_COLUMN_WIDTHS` on first mount). */
export interface ColumnWidthInputs extends ColumnWidths {
  readonly laneCount: number;
  readonly messageWidth: number;
}

/** Builds the five column definitions in display order. Not user-resizable: `graph` (its width
 *  is derived from `laneCount`, not a user choice — W8 owns its formatter and its geometry) and
 *  `message` (it is "remaining width", recomputed by `CommitGrid.vue` on every resize rather than
 *  dragged). `author`/`date`/`sha` are resizable via `CommitGrid.vue`'s own drag handles (§6.1:
 *  `showColumnHeader: false` costs SlickGrid's built-in header resize handles, so this repo keeps
 *  its own), which write back through `grid.setColumns(...)` — this function, called again with
 *  the new widths, is the single source of the column model either way. */
export function buildColumns(
  widths: ColumnWidthInputs,
  dateCtx: DateFormatterContext,
): Column<CommitRecord>[] {
  return [
    {
      id: GRAPH_COLUMN_ID,
      field: "sha",
      name: "",
      width: graphColumnWidth(widths.laneCount),
      resizable: false,
      sortable: false,
      focusable: false,
      selectable: false,
      cssClass: "kv-cell-graph",
      formatter: graphFormatter,
    },
    {
      id: MESSAGE_COLUMN_ID,
      field: "subject",
      name: "",
      width: widths.messageWidth,
      resizable: false,
      sortable: false,
      focusable: false,
      selectable: false,
      formatter: messageFormatter,
    },
    {
      id: AUTHOR_COLUMN_ID,
      field: "author.name",
      name: "",
      width: widths.author,
      resizable: false,
      sortable: false,
      focusable: false,
      selectable: false,
      formatter: authorFormatter,
    },
    {
      id: DATE_COLUMN_ID,
      field: "author.timestamp",
      name: "",
      width: widths.date,
      resizable: false,
      sortable: false,
      focusable: false,
      selectable: false,
      formatter: dateFormatter(dateCtx),
    },
    {
      id: SHA_COLUMN_ID,
      field: "sha",
      name: "",
      width: widths.sha,
      resizable: false,
      sortable: false,
      focusable: false,
      selectable: false,
      formatter: shaFormatter,
    },
  ];
}

/** `getItemMetadata`'s `cssClasses`: `selected` from `SelectionState` (not SlickGrid's own
 *  `RowSelectionModel` — see `CommitGrid.vue`'s doc comment), `head` from `decorationAt`. Stash
 *  row styling is not here: `DecorationRef` has no `stash` kind yet (`packages/core`'s model
 *  covers branch/remoteBranch/tag/head only) — W7 extends the model and this function together,
 *  the single source `docs/plans/P4.md` W8 already promises ("the single source is
 *  `decorationAt`, not a second heuristic"). */
export interface RowMetadataContext {
  readonly store: CommitStore;
  readonly isSelected: (row: number) => boolean;
}

export function rowMetadata(ctx: RowMetadataContext, row: number): ItemMetadata | null {
  const classes: string[] = [];
  if (ctx.isSelected(row)) classes.push("kv-row-selected");
  if (ctx.store.decorationAt(row).some(isHeadDecoration)) classes.push("kv-row-head");
  return classes.length > 0 ? { cssClasses: classes.join(" ") } : null;
}

/**
 * §5.5's whole contract with the library, three methods: `getItem` calls `store.commitAt(row)`
 * fresh on every invocation — no cache, no memoization — because the only way to guarantee "the
 * grid is never handed materialized rows" is for nothing here to *hold* a materialized row for
 * longer than one formatter pass needs it. `getLength`/`isSelected` are accessors rather than
 * captured values so this data view always answers with the store's/selection's *current* state,
 * matching the plan's own sketch (`getLength: () => graphView.loadedRows.value`).
 */
export interface CommitDataViewDeps {
  readonly store: CommitStore;
  readonly loadedRows: () => number;
  readonly isSelected: (row: number) => boolean;
}

export function createCommitDataView(deps: CommitDataViewDeps): CustomDataView<CommitRecord> {
  return {
    getLength: () => deps.loadedRows(),
    getItem: (row: number) => deps.store.commitAt(row),
    getItemMetadata: (row: number) => rowMetadata(deps, row),
  };
}
