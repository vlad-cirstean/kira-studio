// Pure geometry for the pinned ancestor band (P28): which rows are stuck, and where each one
// sits. DOM-free and Vue-free on purpose — its inputs are the flat row array the tree already
// builds, the scroll offset VirtualList now publishes, and the row height ProjectTree already
// computes.

/** All the band needs from a row. TreeRowVm satisfies it structurally. */
export interface StickyRowLike {
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
}

export interface StickySlot<T> {
  row: T;
  /** Index in the flat row array — the band's rows are real rows, not synthesized ones. */
  index: number;
  /** Offset from the top of the scrollport, in px. Negative while a header is being pushed out
   *  by the next section (D4). */
  top: number;
}

/** Connection + database + schema. Deeper ancestors (a group folder, P19) are not worth a third
 *  of a narrow panel; the outermost levels are the ones that answer "where am I" (D5). */
export const STICKY_MAX_ROWS = 3;

interface Candidate<T> {
  row: T;
  index: number;
  /** Viewport-relative px offset of the first row past this candidate's own subtree —
   *  `Number.POSITIVE_INFINITY` when the subtree runs to the end of the list. */
  boundaryY: number;
}

function subtreeBoundaryIndex<T extends StickyRowLike>(
  rows: readonly T[],
  fromIndex: number,
  depth: number,
): number {
  for (let i = fromIndex + 1; i < rows.length; i++) {
    if (rows[i].depth <= depth) return i;
  }
  return rows.length;
}

// Ancestors of `anchorIndex`, outermost first: walk backward looking for the nearest preceding
// row at each successively shallower depth. Ancestor depths run 0, 1, 2, ... up to the anchor's
// own depth minus one, and they appear in that order in the flat array before the anchor.
function ancestorsOf<T extends StickyRowLike>(
  rows: readonly T[],
  anchorIndex: number,
): { row: T; index: number }[] {
  const anchor = rows[anchorIndex];
  const out: { row: T; index: number }[] = [];
  let wantDepth = anchor.depth - 1;
  for (let i = anchorIndex - 1; i >= 0 && wantDepth >= 0; i--) {
    if (rows[i].depth === wantDepth) {
      out.push({ row: rows[i], index: i });
      wantDepth--;
    }
  }
  out.reverse();
  return out;
}

function slotTopFor(k: number, keptCount: number, boundaryY: number, rowHeight: number): number {
  return Math.min(k * rowHeight, boundaryY - (keptCount - k) * rowHeight);
}

export function stickyBand<T extends StickyRowLike>(
  rows: readonly T[],
  scrollTop: number,
  rowHeight: number,
  maxRows: number = STICKY_MAX_ROWS,
): StickySlot<T>[] {
  if (rows.length === 0 || rowHeight <= 0 || maxRows <= 0) return [];
  const anchorIndex = Math.min(Math.max(Math.floor(scrollTop / rowHeight), 0), rows.length - 1);
  const anchor = rows[anchorIndex];

  const chain = ancestorsOf(rows, anchorIndex);
  // The anchor itself joins the chain, innermost, only when it is a parent currently showing its
  // own children — otherwise there is nothing "under" it for a header to stand in for.
  if (anchor.hasChildren && anchor.expanded) chain.push({ row: anchor, index: anchorIndex });
  const capped = chain.slice(0, maxRows);
  if (capped.length === 0) return [];

  const candidates: Candidate<T>[] = capped.map(({ row, index }) => {
    const boundaryIndex = subtreeBoundaryIndex(rows, index, row.depth);
    const boundaryY =
      boundaryIndex >= rows.length
        ? Number.POSITIVE_INFINITY
        : boundaryIndex * rowHeight - scrollTop;
    return { row, index, boundaryY };
  });

  // The kept candidates are always a prefix: ancestor indices strictly increase, so a candidate's
  // own (unpinned) position rises by at least one row height per level while its pinned slot
  // rises by exactly one, so once one candidate has not yet passed its slot every deeper one has
  // not either. Trying the full capped count down to zero finds the largest prefix that has.
  for (let kept = candidates.length; kept >= 0; kept--) {
    let allPassed = true;
    for (let k = 0; k < kept; k++) {
      const naturalTop = candidates[k].index * rowHeight - scrollTop;
      const slotTop = slotTopFor(k, kept, candidates[k].boundaryY, rowHeight);
      if (!(naturalTop < slotTop)) {
        allPassed = false;
        break;
      }
    }
    if (allPassed) {
      return candidates.slice(0, kept).map((c, k) => ({
        row: c.row,
        index: c.index,
        top: slotTopFor(k, kept, c.boundaryY, rowHeight),
      }));
    }
  }
  return [];
}

/** How much room a reveal must leave above `index` so the row does not land behind the band —
 *  `min(depth, maxRows) * rowHeight`, since a row at depth d has exactly d ancestors in the flat
 *  list (D6). */
export function stickyInsetFor(
  rows: readonly StickyRowLike[],
  index: number,
  rowHeight: number,
  maxRows: number = STICKY_MAX_ROWS,
): number {
  const row = rows[index];
  if (!row) return 0;
  return Math.min(row.depth, maxRows) * rowHeight;
}
