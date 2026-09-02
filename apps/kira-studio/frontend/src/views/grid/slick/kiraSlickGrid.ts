import type { Column } from 'slickgrid';
import { SlickGrid } from 'slickgrid';
import {
  BASE_LEAD_PX,
  BASE_TRAIL_PX,
  CELL_BUDGET,
  LEAD_FRAMES,
  MAX_LEAD_PX,
  MAX_NEW_CELLS_PER_RENDER,
  OVERSCAN_PX,
  type RowRangeExtractorConfig,
  rowRangeBounds,
} from '../../shared/page/columns';
import * as scrollTrace from '../scrollTrace';
import type { RowHandle } from './dataSource';

// main.ts's own `declare global` (the real source of truth for this shape, D9) lives in a
// different TS program from tests/unit/tsconfig.json's — mirrors tests/ui/global.d.ts's own
// re-declaration of the same handful of `__kira*` hooks, for the identical cross-program reason.
declare global {
  interface Window {
    __kiraGridTuning?: {
      leadFramesOverride?: number;
      maxLeadPxOverride?: number;
      incrementalRows?: boolean;
      /** P22 iter2-scroll-gaps D2: overrides columns.ts's MAX_NEW_CELLS_PER_RENDER. */
      maxNewCellsPerRenderOverride?: number;
      /** P22 iter2-scroll-gaps D3: read by SlickGridHost.vue at grid construction, not by this file
       *  — declared here too only because this program's declaration merging requires an identical
       *  shape to main.ts's own. See main.ts's own doc comment for what it does. */
      forceSyncScrollingOverride?: boolean;
    };
  }
}

export interface KiraSlickVelocity {
  pxPerFrame: number;
  direction: 1 | -1 | 0;
}

/** `__kiraGridTuning`'s overrides, read fresh on every `getRenderedRange` call (never cached) —
 *  same contract as DataGrid.vue's own row-axis `rangeExtractor` closure, so the real-Mac A/B
 *  protocol (`docs/PERF.md` §2.1a) needs one build for both engines, not a rebuild per variant. */
function runwayConfig(): RowRangeExtractorConfig {
  const tuning = window.__kiraGridTuning;
  return {
    baseLeadPx: BASE_LEAD_PX,
    baseTrailPx: BASE_TRAIL_PX,
    leadFrames: tuning?.leadFramesOverride ?? LEAD_FRAMES,
    maxLeadPx: tuning?.maxLeadPxOverride ?? MAX_LEAD_PX,
    cellBudget: CELL_BUDGET,
  };
}

/** P22 iter2-scroll-gaps D2 step 4/7 — how many rows in `[start, end]` fall outside
 *  `[prevStart, prevEnd]`, i.e. how many of them are *not* already in SlickGrid's own `rowsCache`
 *  (`prev` is `lastRenderedRowBounds`, a reliable proxy for `rowsCache` membership — that plan's own
 *  D2 comment: `cleanupRows` keeps exactly the previously-returned range). A pure function, split out
 *  so the batch-cap arithmetic is testable without constructing a real `SlickGrid`. */
export function countNewRows(
  start: number,
  end: number,
  prevStart: number,
  prevEnd: number,
): number {
  if (end < start) return 0;
  const total = end - start + 1;
  const overlapStart = Math.max(start, prevStart);
  const overlapEnd = Math.min(end, prevEnd);
  const overlap = overlapEnd >= overlapStart ? overlapEnd - overlapStart + 1 : 0;
  return total - overlap;
}

/** The column axis's own overscan clamp (D4's third bullet: `OVERSCAN_PX` per side instead of a
 *  full viewport width, F4's third reading) — split out as a pure function so it's testable
 *  without constructing a real `SlickGrid` (which needs a live DOM container). */
export function clampColumnOverscan(
  leftPx: number,
  rightPx: number,
  overscanPx: number,
  canvasWidth: number,
): { leftPx: number; rightPx: number } {
  return {
    leftPx: Math.max(0, leftPx - overscanPx),
    rightPx: Math.min(canvasWidth, rightPx + overscanPx),
  };
}

/**
 * §6 D4 — a thin `SlickGrid` subclass overriding `getRenderedRange`, the plan's single point of
 * coupling to SlickGrid internals. SlickGrid's own runway (F4) is *smaller* than this app's at
 * rest — 3 rows/side (`minRowBuffer`) against this app's 560px (≈20 rows/side) — and not
 * velocity-scaled in motion; adopting it as-is would make the reported fast-scroll symptom worse,
 * not better. This reuses `rowRangeBounds` (the exact arithmetic `DataGrid.vue`'s own row axis
 * runs, C1's own refactor) rather than restating it, so both grids' at-rest window is provably the
 * same number — `tests/unit/row-range.spec.ts` covers that arithmetic; this file's own test covers
 * only the column-overscan clamp above.
 *
 * Every SlickGrid method called below is public and documented in the published `.d.ts`:
 * `getVisibleRange`, `getDataLength`, `getOptions`, `getCanvasNode`. `vScrollDir` (a protected
 * field) is deliberately never read — direction comes from the host's own velocity sampler
 * (`velocity`, below), which already discards a discrete jump as "at rest"
 * (`MAX_PLAUSIBLE_ROW_VELOCITY_PX_PER_FRAME`, mirrored from DataGrid.vue's own onScroll), a case a
 * raw sign test on `vScrollDir` would not. **On a `slickgrid` version bump, re-check that
 * `render()` still calls `this.getRenderedRange()` and that its return shape is still
 * `{ top, bottom, leftPx, rightPx }`** — F4's own citation, `dist/esm/index.mjs`'s `render()`.
 */
// Column<T>'s own `field` type is a recursive PathsToStringProps<T> derived from T's shape —
// RowHandle's own fields (row/pos/insertId) are not what `field` needs to hold (the app's
// arbitrary db column names), so the column generic is deliberately widened to `any` below,
// matching slickgrid's own escape hatch for exactly this case.
// biome-ignore lint/suspicious/noExplicitAny: see comment above.
export class KiraSlickGrid extends SlickGrid<RowHandle, Column<any>> {
  /** Supplied by the host on every scroll sample (DataGrid.vue's own `rowVelocity()` analogue) —
   *  read fresh on every call below, never memoised (this runs *during* SlickGrid's own render).
   *  Defaults to "at rest" so a grid that hasn't wired a sampler yet still renders the baseline
   *  runway — D3(a)'s own "byte-identical to today at rest" guarantee. */
  velocity: () => KiraSlickVelocity = () => ({ pxPerFrame: 0, direction: 0 });

  /** The row axis's own budget divisor (D4's third bullet) — a plain variable the host updates
   *  from `onRendered`, mirroring DataGrid.vue's own `mountedColumnCount` (columns.ts's own
   *  comment: calling into the column virtualizer from *inside* the row-range computation itself
   *  measurably regressed the scroll budget; the same hazard applies here). */
  mountedColumnCount = 1;

  /** The last `{start, end}` *rendered* row bounds this override computed — read by the host's
   *  `onRendered` handler to compute the page-row window it hands `setVisibleWindow` (P5 C1).
   *  SlickGrid's own `onRendered` event reports the strictly *visible* range (`visible.top/bottom`
   *  in `render()`), not the wider *rendered* range this override actually mounts — using the
   *  narrower one would prune the decode cache back to the visible slice on every render, defeating
   *  memoisation for the whole overscan band. */
  lastRenderedRowBounds: { start: number; end: number } = { start: 0, end: -1 };

  /** P22 iter2-scroll-gaps D2 step 8 — set while a self-scheduled `requestAnimationFrame` catch-up
   *  render is already in flight, so a call arriving before it fires does not schedule a second one.
   *  Re-entrancy note (this file's own existing comment, above, on `velocity`/`mountedColumnCount`):
   *  reads of this field must tolerate `undefined` on the very first, pre-field-init call exactly
   *  like those two already do — `!this.chasePending` is falsy (i.e. "not pending") for `undefined`
   *  without needing a separate default. */
  chasePending = false;

  override getRenderedRange(
    viewportTop?: number,
    viewportLeft?: number,
  ): { top: number; bottom: number; leftPx: number; rightPx: number } {
    // Defensive reads below, not stylistic ones: `SlickGrid`'s own constructor calls `init()`
    // (unless `explicitInitialization` is set), which renders synchronously — i.e. calls this
    // override — *before* a JS subclass's own field initialisers run (those run only after
    // `super()` returns). `this.velocity`/`this.mountedColumnCount` are genuinely `undefined` on
    // that first, base-constructor-triggered call; every read of a subclass field here has to
    // tolerate that, not just default it once at the field declaration (confirmed empirically —
    // `TypeError: this.velocity is not a function` from inside the `super(...)` call otherwise).
    // `this.chasePending`/`this.lastRenderedRowBounds` (P22 iter2-scroll-gaps D2) are read the same
    // defensive way below, for the identical reason.
    const range = super.getVisibleRange(viewportTop, viewportLeft);
    const { pxPerFrame, direction } = this.velocity
      ? this.velocity()
      : { pxPerFrame: 0, direction: 0 as const };
    const dataLength = this.getDataLength();
    const rowHeight = this.getOptions().rowHeight ?? 28;

    // P22 iter2-scroll-gaps D2 — the plan's own 9-step algorithm (§5 D2), restructured from the
    // single `rowRangeBounds` call this override used to make directly.
    //
    // Step 1: the strictly-visible range, always returned in full — nothing currently on screen is
    // ever deferred to a later frame.
    const mustStart = Math.max(0, range.top);
    const mustEnd = Math.min(range.bottom, dataLength - 1);

    // Step 2: today's full computation (visible + velocity-scaled runway), unchanged — the target
    // this call would return in full if there were no per-call budget at all.
    const target = rowRangeBounds(
      { startIndex: range.top, endIndex: range.bottom, count: dataLength },
      rowHeight,
      pxPerFrame,
      direction,
      this.mountedColumnCount || 1,
      runwayConfig(),
    );

    // Step 3: the previous call's returned range — a reliable proxy for "what's currently in
    // SlickGrid's own rowsCache" (cleanupRows keeps exactly the previously-returned range,
    // enableCellRowSpan is off — P22-slickgrid-migration-plan.md F2's own citation).
    const prev = this.lastRenderedRowBounds ?? { start: 0, end: -1 };

    // Step 4: how many rows the non-negotiable floor alone requires building fresh this call.
    const mustNewRows = countNewRows(mustStart, mustEnd, prev.start, prev.end);

    // Step 5: the per-call budget, in rows — MAX_NEW_CELLS_PER_RENDER (or its runtime override),
    // divided by however many columns are currently mounted (mirrors CELL_BUDGET's own divisor,
    // columns.ts's rowRangeBounds).
    const tuning = window.__kiraGridTuning;
    const maxNewCells = tuning?.maxNewCellsPerRenderOverride ?? MAX_NEW_CELLS_PER_RENDER;
    const budgetRows = Math.floor(maxNewCells / Math.max(1, this.mountedColumnCount || 1));

    let start: number;
    let end: number;
    if (mustEnd < mustStart) {
      // No data, or nothing visible — nothing to render.
      start = 0;
      end = -1;
    } else if (mustNewRows >= budgetRows) {
      // Step 6: even the non-negotiable floor is expensive on this table/window combination this
      // call — accept a viewport-bounded (not fling-distance-bounded) cost, and defer *all* extra
      // runway to the chase rather than spending what's left of the budget trying to also add lead.
      start = mustStart;
      end = mustEnd;
    } else {
      // Step 7: expand outward from `must` toward `target`, lead side first (today's existing
      // direction bias — rowRangeBounds' own [trailRows, leadRows]/[leadRows, trailRows] asymmetry),
      // until either `target` is reached or the remaining budget is exhausted. A row already inside
      // `prev` costs nothing to add (SlickGrid skips it — it's already in rowsCache); only a genuinely
      // new row spends budget, so growth only stalls when it actually reaches un-cached territory.
      let remaining = budgetRows - mustNewRows;
      start = mustStart;
      end = mustEnd;
      const growEnd = (limit: number) => {
        while (end < limit) {
          const next = end + 1;
          if (next < prev.start || next > prev.end) {
            if (remaining <= 0) break;
            remaining -= 1;
          }
          end = next;
        }
      };
      const growStart = (limit: number) => {
        while (start > limit) {
          const next = start - 1;
          if (next < prev.start || next > prev.end) {
            if (remaining <= 0) break;
            remaining -= 1;
          }
          start = next;
        }
      };
      // direction < 0 (scrolling up/backward) leads on the start side, matching rowRangeBounds' own
      // [leadRows, trailRows] assignment there; direction >= 0 (forward or at rest) leads on the end
      // side, matching its [trailRows, leadRows].
      if (direction < 0) {
        growStart(target.start);
        growEnd(target.end);
      } else {
        growEnd(target.end);
        growStart(target.start);
      }
    }

    // Step 8: if the returned range is narrower than `target` on either side, self-schedule a
    // catch-up render — every call (real-scroll- or catch-up-driven) recomputes `must`/`target` fresh
    // from the grid's *current* scroll position, so there is no queue of stale ranges to reconcile,
    // only "how far is `prev` from `target`, right now."
    if ((start > target.start || end < target.end) && end >= start && !this.chasePending) {
      this.chasePending = true;
      requestAnimationFrame(() => {
        this.chasePending = false;
        this.render();
      });
    }

    // Step 9: the range actually returned this call — read by step 3 on the *next* call.
    this.lastRenderedRowBounds = { start, end };
    // getCanvasNode() with no args resolves column 0 — this app's frozen gutter (D4/§5 item 5),
    // whose own pane is a fixed GUTTER_WIDTH wide, not the scrollable data pane whose width this
    // clamp needs. Column index 1 (the first data column) is always > frozenColumn (0), so it
    // resolves the right/scrollable canvas instead — see `_getContainerElement`'s own
    // `isRightSide = hasFrozenColumns() && idx > frozenColumn` test, read from source. It may not
    // exist yet on that same first, pre-subclass-field render (no data column mounted yet).
    const canvasWidth = this.getCanvasNode(1)?.clientWidth ?? 0;
    const { leftPx, rightPx } = clampColumnOverscan(
      range.leftPx,
      range.rightPx,
      OVERSCAN_PX,
      canvasWidth,
    );
    // The row axis's own budget divisor (D4's third bullet), self-maintained rather than supplied
    // by the host: DataGrid.vue's own mountedColumnCount is read from a *separate* column
    // virtualizer, and its own comment warns that calling into it from inside the row-range
    // computation regressed the scroll budget. SlickGrid has no separate column virtualizer to call
    // into — this approximates the mounted column count from this same render's own column window
    // and the grid's average column width, entirely locally, so the hazard that comment warns about
    // does not apply here at all. One frame stale by construction (like the app's own precedent):
    // it's set for the *next* call, from *this* call's own leftPx/rightPx.
    const columns = this.getColumns() ?? [];
    const totalWidth = columns.reduce((sum, c) => sum + (c.width ?? 0), 0) || 1;
    const avgWidth = totalWidth / Math.max(1, columns.length);
    this.mountedColumnCount = Math.max(1, Math.ceil((rightPx - leftPx) / avgWidth));
    return { top: start, bottom: end, leftPx, rightPx };
  }

  /** P22 iter2-scroll-gaps D1 — `render()` is fully synchronous (§1.1 of that plan: no `await`, no
   *  `setTimeout`, no `requestIdleCallback` anywhere between `_handleScroll` and `onRendered`
   *  firing), so the caller already has the duration in hand; report it straight to
   *  `scrollTrace.noteRenderMs` instead of Vue's `nextTick`-based `noteNotify` (meaningless here —
   *  there is no Vue patch on this render path at all). This is also D2's own seam: the batch-
   *  capping/chase logic lives in `getRenderedRange`, called from inside `super.render()` below, so
   *  timing wraps the whole call, chase-scheduled catch-ups included. */
  override render(): void {
    const start = performance.now();
    super.render();
    scrollTrace.noteRenderMs(performance.now() - start);
  }
}
