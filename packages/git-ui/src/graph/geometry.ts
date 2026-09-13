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
  /** G21 D1: the HEAD ring's own radius — `mergeRadius` used to double as this, which made a
   *  merge-at-HEAD's HEAD ring paint exactly over its merge ring (same centre, same radius,
   *  HEAD ring appended last) and erase the merge indicator entirely. `5.6` clears the merge
   *  ring by a full `strokeWidth` and clears the ordinary dot (`nodeRadius` 3.4) by
   *  `strokeWidth / 2`, while staying inside the lane's own envelope: the visible outer edge is
   *  `headRingRadius + strokeWidth / 2` = `5.6 + 0.8` = `6.4`, `<=` half the 13px lane width
   *  (6.5). */
  headRingRadius: 5.6,
  /** G-UX (item 1): the HEAD ring's own stroke width — thicker than the shared `strokeWidth`
   *  every edge/merge-ring/stash-ring uses, so the checked-out commit's ring reads as visibly
   *  heavier rather than blending in as just another thin line. Outer edge stays
   *  `headRingRadius + headRingStrokeWidth / 2` = `5.6 + 1.0` = `6.6`, ~0.1px past the lane's own
   *  half-width (6.5) — negligible bleed at this scale, accepted rather than shrinking the ring's
   *  own radius to compensate (the tight 13px lane envelope leaves no room to both thicken the
   *  stroke AND keep the ring's inner edge clear of the merge ring's outer edge at 5.0; a small,
   *  imperceptible edge-of-lane overflow is the better trade than a smaller, less visible ring). */
  headRingStrokeWidth: 2.0,
  /** G-UX (item 1): a soft, low-opacity disc behind the checked-out commit's node (painted under
   *  the row's own edges, `rowSvg.ts`'s `buildRowSvg`) — a halo, not a hard-edged shape, so it is
   *  allowed to reach closer to the lane's own edge than a stroke could without looking like
   *  bleed. */
  headHaloRadius: 6.2,
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
