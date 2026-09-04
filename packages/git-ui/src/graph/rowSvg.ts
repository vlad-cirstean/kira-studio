/**
 * `docs/plans/P4.md` W8: "The graph column is a column, not an overlay. Its formatter returns one
 * small `<svg>` holding only the slice of the graph that passes through *that row's* height"
 * (§5.3). Pure, no Vue, no library, no DOM query beyond the element construction itself — no
 * component, no lifecycle, no `devicePixelRatio` handling, no resize path, no repaint coalescing
 * and no theme subscription, all of which existed only to keep a second drawing surface aligned
 * with rows it was not part of (§5.3's revision note). What remains is a pure function from a
 * row's data to an element.
 *
 * Split, like W7's `refBadges.ts`, into a pure planning half (`planEdgePaths`/`planNode`, unit-
 * tested directly in `tests/unit/ui/rowSvg.test.ts`) and a DOM-construction half
 * (`buildRowSvg`/its private helpers) exercised by W13's Playwright pass — this repo has no
 * jsdom/happy-dom wired into `bun:test` (confirmed by W6/W7, not assumed here).
 *
 * `GEOMETRY` itself lives in `./geometry.ts`, one level below both this file and W6's
 * `columns.ts` — see that file's own doc comment for why (the plan's dependency table has W8
 * depend on W6, not the reverse, so the shared constants had to exist before W8 could).
 */
import { type DecorationRef, UNRESOLVED_ROW } from '@kira/git-core';
import { GEOMETRY, graphColumnWidth } from './geometry';
import type { EdgeSegment } from './layoutStore';
import { laneClass, NODE_CLASS, type NodeKind } from './palette';

// Re-exported so a consumer of rowSvg.ts (the plan's own sketch defines GEOMETRY directly here)
// never needs to know it actually lives in geometry.ts — see that file's own doc comment for why
// (W6 needed it before W8 existed, per the plan's own dependency ordering).
export { GEOMETRY };

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The lane area alone (no `padLeft`/`gutterPad`) — `graphColumnWidth` in `geometry.ts` is
 *  `padLeft + gutterWidth(laneCount) + gutterPad`; this is the piece `hitTest.ts`'s `laneAt`
 *  needs to know where the gutter itself starts and ends within the column. */
export function gutterWidth(laneCount: number): number {
  return Math.min(laneCount, GEOMETRY.maxLanes) * GEOMETRY.laneWidth;
}

/**
 * One row's complete input to `buildRowSvg`: the reused `segments` buffer and how many of its
 * entries are valid (`segmentCount`) — mirroring `LayoutStore.segmentsInRow`'s own "write by
 * index, return a count, never reallocate" contract (W3) — plus this row's own lane/colour/shape.
 * `lane` is `undefined` for a row whose layout has not arrived yet (W5: text lands before lanes
 * do); `buildRowSvg` then draws an empty, correctly-sized cell rather than guessing a lane.
 */
export interface RowSlice {
  readonly row: number;
  readonly lane: number | undefined;
  readonly color: number;
  readonly laneCount: number;
  readonly nodeKind: NodeKind;
  readonly segments: readonly EdgeSegment[];
  readonly segmentCount: number;
}

/** `dataContext.decoration.some(...)` — the single source for "is this row a stash", shared with
 *  `columns.ts`'s `rowMetadata` and `refBadges.ts`'s badge, never a second heuristic. */
export function isStashRow(decorations: readonly DecorationRef[]): boolean {
  return decorations.some((ref) => ref.kind === 'stash');
}

/** Rounds to 2 decimal places and drops a trailing `.00` — keeps a row's `d` attribute short
 *  (thousands of these exist on screen at once, one per rendered cell) and keeps test-expected
 *  strings predictable without depending on floating-point's exact last-bit representation. */
function fmt(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** The centre-x of a lane's own column within the gutter, clamped to the twelfth lane
 *  (`GEOMETRY.maxLanes`) rather than growing the gutter without bound — a fifty-lane repository
 *  is real (P2's `fan(50, …)` fixture), and letting the graph eat a panel that is short and wide
 *  is the worse failure (§the plan's own W8 text: "the message column is what the user reads"). */
export function laneX(lane: number): number {
  const clamped = Math.min(lane, GEOMETRY.maxLanes - 1);
  return GEOMETRY.padLeft + clamped * GEOMETRY.laneWidth + GEOMETRY.laneWidth / 2;
}

/**
 * One segment's SVG path-data fragment for this row, in this row's own coordinates (y=0 is the
 * row's top, y=rowHeight is its bottom) — never the edge's full extent, per §5.3's "every segment
 * a row must draw is expressible in that row's own coordinates".
 *
 * Three cases, decided by comparing `row` against the segment's own `fromRow`/`toRow` (never a
 * second computation of "is this row special" — `LayoutStore.coversRow` already decided this
 * segment belongs to `row` at all):
 * - `row === fromRow`: the commit's own row. A bezier (or, when the lane does not change, an
 *   equivalent straight run) from the node's centre down to the bottom of this row in the
 *   *target* lane — "the transition happens entirely within the row" (§5.3). Overdrawn by
 *   `GEOMETRY.overdraw` past the row's bottom only; the top is the node itself, not a row
 *   boundary, so it gets none.
 * - `row === toRow` (and `toRow` is resolved): the parent's own row. A straight run from the top
 *   of this row down to the node's centre — overdrawn past the top only, for the same reason in
 *   reverse.
 * - Otherwise (a pass-through row, or an edge whose `toRow` is still `UNRESOLVED_ROW` — "runs to
 *   the bottom of its row and stops", which for a query bounded to `[0, rowCount)` it already
 *   does): a full-height run, overdrawn at both ends — two adjacent rows' runs must meet across a
 *   fractional `devicePixelRatio` without a hairline seam (§5.3's fifth decision).
 */
export function edgeCommand(segment: EdgeSegment, row: number, rowHeight: number): string {
  const overdraw = GEOMETRY.overdraw;

  if (row === segment.fromRow) {
    const xFrom = laneX(segment.fromLane);
    const xTo = laneX(segment.toLane);
    const yStart = rowHeight / 2;
    const yEnd = rowHeight + overdraw;
    if (xFrom === xTo) return `M${fmt(xFrom)},${fmt(yStart)} V${fmt(yEnd)}`;
    const midY = (yStart + yEnd) / 2;
    return (
      `M${fmt(xFrom)},${fmt(yStart)} ` +
      `C${fmt(xFrom)},${fmt(midY)} ${fmt(xTo)},${fmt(midY)} ${fmt(xTo)},${fmt(yEnd)}`
    );
  }

  const x = laneX(segment.toLane);
  const isEnd = segment.toRow !== UNRESOLVED_ROW && row === segment.toRow;
  const yTop = -overdraw;
  const yBottom = isEnd ? rowHeight / 2 : rowHeight + overdraw;
  return `M${fmt(x)},${fmt(yTop)} V${fmt(yBottom)}`;
}

export interface EdgePathPlan {
  readonly color: number;
  readonly d: string;
}

/** §5.3's first decision: "one `<path>` per lane colour present in the row, not one per segment"
 *  — every covering segment's own command (`edgeCommand`) is concatenated into the one path its
 *  colour owns, which is what holds a row to ~4 elements typical rather than one per segment.
 *  Two *different* lanes sharing a colour (legal once `laneCount` exceeds the palette size) are
 *  concatenated into the same path too — same visual result, one fewer element, and nothing reads
 *  lane identity back out of an already-drawn path. */
export function planEdgePaths(slice: RowSlice, rowHeight: number): readonly EdgePathPlan[] {
  const commandsByColor = new Map<number, string[]>();
  for (let i = 0; i < slice.segmentCount; i++) {
    const segment = slice.segments[i] as EdgeSegment;
    const command = edgeCommand(segment, slice.row, rowHeight);
    const existing = commandsByColor.get(segment.color);
    if (existing) existing.push(command);
    else commandsByColor.set(segment.color, [command]);
  }
  return Array.from(commandsByColor, ([color, commands]) => ({ color, d: commands.join(' ') }));
}

export interface NodeShapePlan {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly color: number;
  /** A filled dot (ordinary/merge's inner dot) vs. an unfilled ring (merge's outer ring, the
   *  whole of a stash's shape) — the DOM layer sets `fill: none` on an unfilled shape via inline
   *  style, never via a CSS class, because `.kv-lane-N` itself sets `fill` (to draw the ordinary
   *  dot at all) and only an inline style reliably wins that cascade. */
  readonly filled: boolean;
  readonly dashed: boolean;
}

/** §5.3's fifth decision, the three node shapes: filled circle (ordinary), filled circle plus an
 *  unfilled ring (merge — `store.parentsOf(row).length > 1`), unfilled dashed ring alone (stash —
 *  `decorationAt(row)` carries the `stash` kind). Empty for a row with no layout yet
 *  (`slice.lane === undefined`) — nothing to draw, not a guessed lane. */
export function planNode(slice: RowSlice, rowHeight: number): readonly NodeShapePlan[] {
  if (slice.lane === undefined) return [];
  const cx = laneX(slice.lane);
  const cy = rowHeight / 2;
  const color = slice.color;

  if (slice.nodeKind === 'stash') {
    return [{ cx, cy, r: GEOMETRY.nodeRadius, color, filled: false, dashed: true }];
  }

  const dot: NodeShapePlan = { cx, cy, r: GEOMETRY.nodeRadius, color, filled: true, dashed: false };
  if (slice.nodeKind === 'merge') {
    const ring: NodeShapePlan = {
      cx,
      cy,
      r: GEOMETRY.mergeRadius,
      color,
      filled: false,
      dashed: false,
    };
    return [dot, ring];
  }
  return [dot];
}

function buildPathElement(plan: EdgePathPlan): SVGPathElement {
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('class', laneClass(plan.color));
  path.setAttribute('d', plan.d);
  path.setAttribute('stroke-width', String(GEOMETRY.strokeWidth));
  // `.kv-lane-N` sets `fill` too (so a node's dot can use the same class) — any stylesheet rule
  // beats a presentation attribute, so only an inline style reliably makes this a line, not a
  // filled shape auto-closed at its own start/end point.
  path.style.fill = 'none';
  return path;
}

function buildNodeElement(plan: NodeShapePlan): SVGCircleElement {
  const circle = document.createElementNS(SVG_NS, 'circle');
  const classes = [laneClass(plan.color)];
  // Only the ordinary filled dot carries NODE_CLASS (the high-contrast outline rule) — see
  // palette.ts's own doc comment on why a ring must not: `.kv-node`'s stroke-width defaults to
  // `0` outside a high-contrast kind, which would erase a ring's only visible pixels everywhere
  // else.
  if (plan.filled) classes.push(NODE_CLASS);
  circle.setAttribute('class', classes.join(' '));
  circle.setAttribute('cx', fmt(plan.cx));
  circle.setAttribute('cy', fmt(plan.cy));
  circle.setAttribute('r', fmt(plan.r));
  if (!plan.filled) {
    circle.setAttribute('stroke-width', String(GEOMETRY.strokeWidth));
    circle.style.fill = 'none';
  }
  if (plan.dashed) {
    circle.setAttribute('stroke-dasharray', `${GEOMETRY.strokeWidth} ${GEOMETRY.strokeWidth}`);
  }
  return circle;
}

/** Builds one row's `<svg>` — sized to the *current* graph column width (`slice.laneCount`, the
 *  store's own high-water mark, not a per-row value, so every row's SVG stays the same width as
 *  the column SlickGrid itself sized via `columns.ts`) and `rowHeight` (`--kv-row-height`, the
 *  same value the grid takes as its own `rowHeight` option, so lanes and rows cannot drift).
 *  `overflow: visible` (`CommitGrid.vue`'s `<style>`) is what lets the `GEOMETRY.overdraw`
 *  fragments `edgeCommand` emits actually paint past this element's own bounds. */
export function buildRowSvg(slice: RowSlice, rowHeight: number): SVGSVGElement {
  const width = graphColumnWidth(slice.laneCount);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'kv-graph-svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(rowHeight));
  svg.setAttribute('viewBox', `0 0 ${width} ${rowHeight}`);

  for (const plan of planEdgePaths(slice, rowHeight)) svg.appendChild(buildPathElement(plan));
  for (const plan of planNode(slice, rowHeight)) svg.appendChild(buildNodeElement(plan));

  return svg;
}
