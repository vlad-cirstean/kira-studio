/**
 * The graph column's pixel geometry — the mockup's numbers (`ROW_H 22`, `LANE_W 13`, `PAD_L 11`,
 * node radii, the 1.6 px stroke), per `docs/plans/P4.md` W8's own sketch. Lives in its own file,
 * one level below both consumers, rather than inside `rowSvg.ts` (where the plan first names
 * `GEOMETRY`) because `columns.ts`'s graph-column width formula (W6) needs these same numbers
 * before W8 exists — the plan's own dependency table has W8 depend on W6, not the reverse.
 * `rowSvg.ts` re-exports `GEOMETRY` from here once it lands (W8), so there is exactly one
 * definition of these numbers, never two that could drift apart.
 */
export const GEOMETRY = {
  laneWidth: 13,
  padLeft: 11,
  gutterPad: 6,
  nodeRadius: 3.4,
  mergeRadius: 4.2,
  strokeWidth: 1.6,
  maxLanes: 12,
  overdraw: 0.5,
} as const;

/**
 * The graph column's total pixel width for a given lane count (W6's column table:
 * `padLeft + min(laneCount, MAX_LANES) × laneWidth + gutterPad`). Shared here so
 * `CommitGrid.vue`'s `setColumns` recompute (on `laneCount` growth) and W8's row-drawing gutter
 * math read the same function and can never disagree about what a lane count of N spans.
 */
export function graphColumnWidth(laneCount: number): number {
  return (
    GEOMETRY.padLeft +
    Math.min(laneCount, GEOMETRY.maxLanes) * GEOMETRY.laneWidth +
    GEOMETRY.gutterPad
  );
}
