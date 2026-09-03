/**
 * `docs/plans/P4.md` W8: reduced to `laneAt(offsetX)`, pure arithmetic over the *cell-relative*
 * x. Which **row** was clicked is no longer ours to compute — SlickGrid's `onClick` carries `row`
 * and `cell` directly (`CommitGrid.vue`'s `handleClick`), and rederiving it from `scrollTop` would
 * be a second answer to a question the library already answers correctly through its own
 * page/offset compensation, the classic way two sources of truth drift. What the library cannot
 * know is which *lane* within the gutter the pointer landed on, and that stays here.
 *
 * P4's only consumer is a click on the graph cell selecting the row (`CommitGrid.vue`'s
 * `handleClick`, which does not yet use a lane at all — clicking anywhere in the graph cell just
 * selects the row, same as any other cell). This is written and tested now, ahead of a caller,
 * because P5's parent-navigation ("click a specific parent's lane to jump to it") and P6's
 * context menu both need it, and its arithmetic is exactly `rowSvg.ts`'s `laneX` inverted — the
 * two must never drift on where a lane's column actually is.
 */
import { GEOMETRY } from "./geometry.ts";

/**
 * The lane whose column contains `offsetX` (pixels from the graph cell's own left edge, i.e.
 * already excluding whatever the cell's own position within the row is — a caller reads this off
 * `event.offsetX` on the cell element, not the row or the grid). Clamped to `[0, maxLanes - 1]`:
 * an x inside `padLeft` (left of the first lane) reads as lane 0, and an x past the last drawn
 * lane (including past `maxLanes`, where every further lane clamps to the twelfth column per
 * `rowSvg.ts`'s `laneX`) reads as the last lane — never a lane number nothing was drawn at.
 */
export function laneAt(offsetX: number): number {
  const gutterX = offsetX - GEOMETRY.padLeft;
  const rawLane = Math.floor(gutterX / GEOMETRY.laneWidth);
  return Math.max(0, Math.min(GEOMETRY.maxLanes - 1, rawLane));
}
