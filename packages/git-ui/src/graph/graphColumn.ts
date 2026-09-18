/**
 * `docs/plans/P4.md` W8: binds `rowSvg.ts` to the SlickGrid graph column, replacing W6's
 * `columns.ts` placeholder (an empty `<svg>`, correctly sized so the row's height/width never
 * jumps once this formatter starts drawing into it — see that file's own doc comment).
 */
import type { CommitRecord, CommitStore, RowPlan } from '@kira/git-core';
import type { Formatter } from 'slickgrid';
import type { EdgeSegment, LayoutStore } from './layoutStore.ts';
import { nodeKindFor } from './palette.ts';
import { buildRowSvg, isHeadDecoration, isStashRow, type RowSlice } from './rowSvg.ts';

/**
 * W15's `rowBuildMs` (median + p99, recorded not gated) is defined as "sampled inside the graph
 * column's formatter" — this is that sample point. Opt-in: `tests/perf/graphUi.ts` sets
 * `window.__kiraRowBuildSamplesMs` to an empty array before scrolling and reads it back
 * afterwards; every other caller (production, every other test) never sets it, so the formatter's
 * only added cost outside a perf run is the one property read below.
 */
declare global {
  interface Window {
    __kiraRowBuildSamplesMs?: number[];
  }
}

/** A row past `layout.rowCount` has text but no lanes yet (W5: text lands before lanes do) — a
 *  `lane: undefined` slice, which `rowSvg.ts`'s `planNode`/`buildRowSvg` already know draws
 *  nothing rather than guessing. `layout.laneCount` (the store's current high-water mark, not a
 *  per-row value) still sizes the cell correctly so nothing jumps once layout does arrive.
 *
 *  P93 §7: `row` is the *display* row (SlickGrid's own indexing, and what `layout` is now keyed
 *  by — `projectLayoutInput`'s output is already in display-row coordinates). `store`, whose rows
 *  are arrival-order, is read through `plan.storeRowAt(row)` instead. */
function readSlice(
  layout: LayoutStore,
  store: CommitStore,
  plan: RowPlan,
  row: number,
  reusable: EdgeSegment[],
): RowSlice {
  if (row >= layout.rowCount) {
    return {
      row,
      lane: undefined,
      color: 0,
      laneCount: layout.laneCount,
      nodeKind: 'commit',
      segments: reusable,
      segmentCount: 0,
      isHead: false,
      forkStub: undefined,
    };
  }
  const entry = plan.entryAt(row);
  const segmentCount = layout.segmentsInRow(row, reusable);
  // P93 §6.2: the parent is always above (a smaller display row, already laid out in the same
  // pass) whenever `forkParentOf` returns one, so `layout.colorOf` needs no extra bounds check.
  const forkParentRow = plan.forkParentOf(row);
  const forkStub = forkParentRow >= 0 ? { color: layout.colorOf(forkParentRow) } : undefined;

  if (entry.kind === 'collapsed') {
    // P93 §6.1: a placeholder has no single commit's parent count or decorations to derive a
    // shape/HEAD state from — `nodeKind` comes straight from the plan entry, never `nodeKindFor`,
    // and `isHead` is always false (a placeholder is never the checked-out commit).
    return {
      row,
      lane: layout.laneOf(row),
      color: layout.colorOf(row),
      laneCount: layout.laneCount,
      nodeKind: 'collapsed',
      segments: reusable,
      segmentCount,
      isHead: false,
      forkStub,
    };
  }

  const storeRow = entry.storeRow;
  const decoration = store.decorationAt(storeRow);
  return {
    row,
    lane: layout.laneOf(row),
    color: layout.colorOf(row),
    laneCount: layout.laneCount,
    nodeKind: nodeKindFor(store.parentsOf(storeRow).length, isStashRow(decoration)),
    segments: reusable,
    segmentCount,
    // G19 D1: the identical shape F1 found `columns.ts`'s own row-bold indicator already computes
    // — the single source of truth (`isHeadDecoration`), not a second heuristic.
    isHead: decoration.some(isHeadDecoration),
    forkStub,
  };
}

/**
 * Builds the graph column's formatter. `reusable` is allocated once, here, and refilled by
 * `LayoutStore.segmentsInRow` on every call — W3 made that query allocation-free precisely so
 * this line could be written; a fresh array per row, at up to tens of thousands of rendered rows
 * across a scroll session, is exactly the allocation churn `segmentsInRow`'s own contract exists
 * to avoid.
 *
 * P7 (item 1): `rowHeight` is now `(row) => number` rather than a fixed accessor — since row
 * height varies with badge presence (`CommitGrid.vue`'s `enableVariableRowHeight`), the caller
 * passes `grid.getRowHeight(row)` so this formatter always draws into the row's own real height,
 * not a stale grid-wide default. `compactRowHeight` feeds `rowSvg.ts`'s `nodeCenterY` (the node's
 * y, anchored to the subject line rather than the row's own midpoint — a `--kv-row-height-compact`
 * theme change is reflected on the next render without rebuilding this formatter, same as before).
 *
 * P92 item 1: `columnWidth` is likewise an accessor, not a value — `CommitGrid.vue` passes
 * `() => widths.value.graph`, so a column drag never rebuilds this formatter (matching
 * `DateFormatterContext`/`MessageSearchContext`'s own convention), and every row still draws into
 * the column's *current* width even though this closure is only built once per grid instance.
 *
 * P93 §7: `plan` is likewise an accessor (`() => graphView.plan.value`), re-read on every row
 * rather than captured once — a plan rebuild (a page landing, tips changing) never needs this
 * formatter rebuilt, only the grid invalidated (`CommitGrid.vue`'s own `plan` watcher).
 */
export function createGraphFormatter(
  layout: LayoutStore,
  store: CommitStore,
  plan: () => RowPlan,
  rowHeight: (row: number) => number,
  compactRowHeight: () => number,
  columnWidth: () => number,
): Formatter<CommitRecord> {
  const reusable: EdgeSegment[] = [];
  return (row) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'kv-graph-cell';
    const total = rowHeight(row);
    const nodeCenterY = total - compactRowHeight() / 2;
    const width = columnWidth();
    const samples = window.__kiraRowBuildSamplesMs;
    if (samples) {
      const start = performance.now();
      wrapper.appendChild(
        buildRowSvg(readSlice(layout, store, plan(), row, reusable), total, nodeCenterY, width),
      );
      samples.push(performance.now() - start);
    } else {
      wrapper.appendChild(
        buildRowSvg(readSlice(layout, store, plan(), row, reusable), total, nodeCenterY, width),
      );
    }
    return wrapper;
  };
}
