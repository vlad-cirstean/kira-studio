import { type CellClassFlags, classesFrom } from '../../../theme/cellClass';
import type { EdgeHash } from './cssLayers';
import type { Selection } from './selection';

// P22 D10 — moved verbatim out of views/grid/SlickGridHost.vue's own computeSelEdgeHashes
// (F17/F18), so views/console/ConsoleSlickGrid.vue can share it instead of lacking it outright
// (P19's port dropped it, leaving the console with a fill but no perimeter — F17). Pure, like
// cssLayers.ts's searchCellLayers right above this file: no reference to `grid` or `dataSource`
// themselves, every caller hands in its own rendered-bounds/page-row/field-name mapping as a
// callback (biome.json's own views/<kind>/* boundary rule is why this has to live here rather
// than be imported cross-kind).

export const SEL_EDGE_LAYER_KEYS = [
  'kira-sel-t',
  'kira-sel-r',
  'kira-sel-b',
  'kira-sel-l',
] as const;

/** A selection's own perimeter, O(perimeter ∩ rendered) by construction: only the two edge
 *  columns (c0/c1, or every selected row's own two edge columns for a row selection, or every
 *  selected column's own two edge rows for a column selection) are ever walked per rendered row —
 *  never the interior. A committed selection is at most one rectangle (or, in row/column mode, a
 *  set of full-width/full-height strips), which is what keeps this bounded regardless of how
 *  large the selection itself is.
 *
 *  @param sel the current selection, in PAGE-row space (SlickGridHost.vue's own `rt().selection`,
 *    ConsoleSlickGrid.vue's own `currentSelection` after its existing `toPageRowSelection`).
 *  @param renderedBounds the display-position range actually in the DOM right now
 *    (`grid.lastRenderedRowBounds`) — bounds the walk to what SlickGrid can actually paint.
 *  @param pageRowAt a display position -> page row (`dataSource.getItem(pos).row`).
 *  @param fieldAtDisplayCol a DISPLAY column index (gutter already excluded — `Selection`'s own
 *    convention, `selection.ts`'s own header comment) -> the SlickGrid column id `setCellCssStyles`
 *    wants. Each caller adds its own +1 gutter offset the way it already does for its other column
 *    lookups.
 *  @param displayRowCount the display row count — only consulted for a `'column'` selection's own
 *    top/bottom test (`pos === 0` / `pos === displayRowCount - 1`).
 *  @param displayColCount the display column count (gutter excluded) — only consulted for a
 *    `'row'` selection's own left/right edge-column test.
 */
export function computeSelEdgeHashes(
  sel: Selection | null,
  renderedBounds: { start: number; end: number },
  pageRowAt: (pos: number) => number,
  fieldAtDisplayCol: (displayCol: number) => string | undefined,
  displayRowCount: number,
  displayColCount: number,
): [EdgeHash, EdgeHash, EdgeHash, EdgeHash] {
  const hashes: [EdgeHash, EdgeHash, EdgeHash, EdgeHash] = [{}, {}, {}, {}];
  if (!sel) return hashes;
  const { start, end } = renderedBounds;
  if (end < start) return hashes;

  const mark = (pos: number, displayCol: number, flags: CellClassFlags): void => {
    const field = fieldAtDisplayCol(displayCol);
    if (!field) return;
    for (const cls of classesFrom(flags)) {
      const i = SEL_EDGE_LAYER_KEYS.indexOf(`kira-${cls}` as (typeof SEL_EDGE_LAYER_KEYS)[number]);
      if (i < 0) continue;
      const hash = hashes[i] as EdgeHash;
      hash[pos] ??= {};
      (hash[pos] as Record<string, string>)[field] = cls;
    }
  };

  if (sel.kind === 'cell' || sel.kind === 'range') {
    const anchorRow = sel.kind === 'range' ? sel.anchorRow : sel.row;
    const anchorCol = sel.kind === 'range' ? sel.anchorCol : sel.col;
    const r0 = Math.min(anchorRow, sel.row);
    const r1 = Math.max(anchorRow, sel.row);
    const c0 = Math.min(anchorCol, sel.col);
    const c1 = Math.max(anchorCol, sel.col);
    for (let pos = start; pos <= end; pos++) {
      const pageRow = pageRowAt(pos);
      if (pageRow < r0 || pageRow > r1) continue;
      const isTop = pageRow === r0;
      const isBottom = pageRow === r1;
      mark(pos, c0, {
        selEdgeLeft: true,
        selEdgeRight: c0 === c1,
        selEdgeTop: isTop,
        selEdgeBottom: isBottom,
      });
      if (c1 !== c0)
        mark(pos, c1, { selEdgeRight: true, selEdgeTop: isTop, selEdgeBottom: isBottom });
      // Interior columns of the top/bottom row only — c0/c1 already got their own edge above.
      if (isTop) for (let c = c0 + 1; c <= c1 - 1; c++) mark(pos, c, { selEdgeTop: true });
      if (isBottom) for (let c = c0 + 1; c <= c1 - 1; c++) mark(pos, c, { selEdgeBottom: true });
    }
  } else if (sel.kind === 'row') {
    const rows = new Set(sel.rows);
    const lastCol = displayColCount - 1;
    for (let pos = start; pos <= end; pos++) {
      const pageRow = pageRowAt(pos);
      if (!rows.has(pageRow)) continue;
      const isTop = !rows.has(pageRow - 1);
      const isBottom = !rows.has(pageRow + 1);
      // Every column across the full row width sits on the row's own top/bottom boundary, not
      // just the two ends (a cell/range rectangle's top/bottom edge is only the two boundary
      // columns' cells — a row selection's is every column, see the fix this was ported with).
      for (let c = 0; c <= lastCol; c++) {
        mark(pos, c, {
          selEdgeLeft: c === 0,
          selEdgeRight: c === lastCol,
          selEdgeTop: isTop,
          selEdgeBottom: isBottom,
        });
      }
    }
  } else if (sel.kind === 'column') {
    const cols = new Set(sel.cols);
    for (let pos = start; pos <= end; pos++) {
      const isTop = pos === 0;
      const isBottom = pos === displayRowCount - 1;
      for (const c of cols) {
        mark(pos, c, {
          selEdgeTop: isTop,
          selEdgeBottom: isBottom,
          selEdgeLeft: !cols.has(c - 1),
          selEdgeRight: !cols.has(c + 1),
        });
      }
    }
  }
  return hashes;
}
