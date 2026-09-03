/**
 * `docs/plans/P4.md` W8: binds `rowSvg.ts` to the SlickGrid graph column, replacing W6's
 * `columns.ts` placeholder (an empty `<svg>`, correctly sized so the row's height/width never
 * jumps once this formatter starts drawing into it — see that file's own doc comment).
 */
import type { CommitRecord, CommitStore } from "@kira-version/core";
import type { Formatter } from "slickgrid";
import type { EdgeSegment, LayoutStore } from "./layoutStore.ts";
import { nodeKindFor } from "./palette.ts";
import { buildRowSvg, isStashRow, type RowSlice } from "./rowSvg.ts";

/** A row past `layout.rowCount` has text but no lanes yet (W5: text lands before lanes do) — a
 *  `lane: undefined` slice, which `rowSvg.ts`'s `planNode`/`buildRowSvg` already know draws
 *  nothing rather than guessing. `layout.laneCount` (the store's current high-water mark, not a
 *  per-row value) still sizes the cell correctly so nothing jumps once layout does arrive. */
function readSlice(
  layout: LayoutStore,
  store: CommitStore,
  row: number,
  reusable: EdgeSegment[],
): RowSlice {
  if (row >= layout.rowCount) {
    return {
      row,
      lane: undefined,
      color: 0,
      laneCount: layout.laneCount,
      nodeKind: "commit",
      segments: reusable,
      segmentCount: 0,
    };
  }
  const segmentCount = layout.segmentsInRow(row, reusable);
  return {
    row,
    lane: layout.laneOf(row),
    color: layout.colorOf(row),
    laneCount: layout.laneCount,
    nodeKind: nodeKindFor(store.parentsOf(row).length, isStashRow(store.decorationAt(row))),
    segments: reusable,
    segmentCount,
  };
}

/**
 * Builds the graph column's formatter. `reusable` is allocated once, here, and refilled by
 * `LayoutStore.segmentsInRow` on every call — W3 made that query allocation-free precisely so
 * this line could be written; a fresh array per row, at up to tens of thousands of rendered rows
 * across a scroll session, is exactly the allocation churn `segmentsInRow`'s own contract exists
 * to avoid. `rowHeight` is an accessor (`() => rowHeightPx(tokenReader)`, `CommitGrid.vue`), not a
 * captured value, so a `--kv-row-height` theme change is reflected on the next render without
 * rebuilding this formatter.
 */
export function createGraphFormatter(
  layout: LayoutStore,
  store: CommitStore,
  rowHeight: () => number,
): Formatter<CommitRecord> {
  const reusable: EdgeSegment[] = [];
  return (row) => {
    const wrapper = document.createElement("div");
    wrapper.className = "kv-graph-cell";
    wrapper.appendChild(buildRowSvg(readSlice(layout, store, row, reusable), rowHeight()));
    return wrapper;
  };
}
