import type { ColumnDescriptor, TabularPage, TypeClass } from '@shared/protocol/page';
import { cellText, isNull } from '@shared/protocol/page';
import type { Range } from '@tanstack/vue-virtual';
import { typeClassColor } from '../../../theme/icons';
import { typeDescription } from '../typeGlossary';

const MIN_WIDTH = 64;
const MAX_WIDTH = 480;
const CELL_PADDING = 20; // px, both sides combined plus a little breathing room
const SAMPLE_ROWS = 50;

// P48 F9: DataGrid.vue's own gutter width and ConsoleResultGrid.vue's copy of it, spelled a
// third way as a bare `56` in the latter's own CSS — one constant behind all three.
export const GUTTER_WIDTH = 56;
// P48 F9: the 96px fallback both grids' own widths computeds used when neither a stored width
// nor a measured one is available yet.
export const DEFAULT_COLUMN_WIDTH = 96;
// P49 F9/D4: the pixel overscan budget and per-side column cap DataGrid.vue's own column
// virtualizer used, now shared with ConsoleResultGrid.vue's own column axis too.
export const OVERSCAN_PX = 560;
/** Per side. Bounds the DOM when columns are narrow enough that 560 px is a dozen of them. */
export const MAX_OVERSCAN_COLUMNS = 12;

let measureCtx: CanvasRenderingContext2D | null = null;

function getMeasureCtx(): CanvasRenderingContext2D {
  if (measureCtx) return measureCtx;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context is unavailable — cannot measure column widths');
  const root = getComputedStyle(document.documentElement);
  const family = root.getPropertyValue('--kira-font-family').trim() || 'monospace';
  const size = root.getPropertyValue('--kira-font-size').trim() || '12px';
  ctx.font = `${size} ${family}`;
  measureCtx = ctx;
  return ctx;
}

/** Drops the memoized measuring context so the next initialWidths() call re-reads the current
 *  appearance tokens (P31 D11) — without this, a font change leaves every unstored column sized
 *  for whatever font was active when this module first measured, for the rest of the session.
 *  Also drops initialWidths' own result cache below, for the same reason. */
export function resetMeasureCtx(): void {
  measureCtx = null;
  widthsCache = new WeakMap();
}

// P2 R1: DataGrid.vue's `widths` computed depends on the tab's stored columnWidths (so a resize
// drag's own patchDataTabState call invalidates it) *and* calls initialWidths(page) unconditionally
// inside — every pointermove during a drag re-ran this canvas-measurement pass over every column
// and up to 50 sample rows each, even though a resize never changes the page's own data. Pages are
// frozen and stable by reference (same premise as nameIndexCache below), so a WeakMap keyed by the
// page turns every measurement after the first, for a given page, into a reference check.
let widthsCache = new WeakMap<TabularPage, Record<string, number>>();

/** Measures the wider of the header and a sample of the first rows, clamped to [64, 480] px. */
export function initialWidths(page: TabularPage): Record<string, number> {
  const cached = widthsCache.get(page);
  if (cached) return cached;

  const ctx = getMeasureCtx();
  const decoder = new TextDecoder();
  const widths: Record<string, number> = {};
  const sampleCount = Math.min(SAMPLE_ROWS, page.rowCount);

  for (let c = 0; c < page.columns.length; c++) {
    const column = page.columns[c];
    const chunk = page.chunks[c];
    let max = ctx.measureText(column.name).width;
    for (let r = 0; r < sampleCount; r++) {
      if (isNull(chunk, r)) continue;
      const width = ctx.measureText(cellText(chunk, r, decoder)).width;
      if (width > max) max = width;
    }
    widths[column.name] = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(max + CELL_PADDING)));
  }
  widthsCache.set(page, widths);
  return widths;
}

/**
 * Prefix sums over `order`, recomputed only when widths or order change (a computed() in the
 * caller) — not per scroll frame, which columnRangeExtractor() below is cheap enough for.
 */
export function columnOffsets(order: string[], widths: Record<string, number>): number[] {
  const offsets: number[] = [0];
  let cursor = 0;
  for (const name of order) {
    cursor += widths[name] ?? DEFAULT_COLUMN_WIDTH;
    offsets.push(cursor);
  }
  return offsets;
}

// P47 D5: @tanstack/vue-virtual's own `rangeExtractor` seam, replacing visibleColumnRange (P29).
// TanStack already computes the exact visible range (range.startIndex/endIndex, the latter
// **inclusive**, unlike this function's old {startIndex, endIndex} contract where endIndex was
// exclusive) — only the pixel-budget expansion below is this app's own. The row axis has had
// overscan since P12; the column axis had none (F3 in P29's plan) — the asymmetry the "worse
// horizontally" report traces to. Buffer in pixels, not a column count: a column is 40-480 px
// wide, so "N columns of overscan" is a different distance on every table.
export function columnRangeExtractor(
  range: Pick<Range, 'startIndex' | 'endIndex'>,
  offsets: number[],
  /** Extra rendered width on each side. */
  overscanPx: number,
  /** Hard cap per side, so a table of narrow columns can't multiply the DOM without bound. */
  maxOverscanColumns: number,
): number[] {
  const n = offsets.length - 1;
  if (n <= 0) return [];

  // Expand each side by columns whose combined width covers overscanPx, capped independently.
  let startIndex = range.startIndex;
  let leftPx = 0;
  let leftCount = 0;
  while (startIndex > 0 && leftPx < overscanPx && leftCount < maxOverscanColumns) {
    startIndex--;
    leftPx += offsets[startIndex + 1] - offsets[startIndex];
    leftCount++;
  }
  let last = range.endIndex;
  let rightPx = 0;
  let rightCount = 0;
  while (last < n - 1 && rightPx < overscanPx && rightCount < maxOverscanColumns) {
    last++;
    rightPx += offsets[last + 1] - offsets[last];
    rightCount++;
  }

  const out: number[] = [];
  for (let i = startIndex; i <= last; i++) out.push(i);
  return out;
}

// P49 F3/D4: TanStack's default observeElementRect reports the scroll element's border-box size
// (ResizeObserver's borderBoxSize/getBoundingClientRect), which does NOT subtract a visible
// scrollbar's own thickness the way clientWidth/clientHeight do — on a wide table that discrepancy
// put a virtualizer's overscan boundary on a knife's edge (P47 F3). Measuring clientWidth/
// clientHeight instead is DataGrid.vue's own fix, hoisted here so ConsoleResultGrid.vue's column
// virtualizer shares it rather than growing its own copy.
export function observeScrollElementRect(
  instance: { scrollElement: Element | null },
  cb: (rect: { width: number; height: number }) => void,
): (() => void) | undefined {
  const el = instance.scrollElement as HTMLElement | null;
  if (!el) return undefined;
  const handler = () => cb({ width: el.clientWidth, height: el.clientHeight });
  handler();
  const observer = new ResizeObserver(handler);
  observer.observe(el);
  return () => observer.disconnect();
}

// P22 iter2 D1: reverted from pass 1's rAF-deferred notify (P22 D1, f28b25a/57d2f1a) — see
// docs/v1.1/plans/P22-webview-scroll-performance-iter2-rendering.md §2 for the full evidence.
// Pass 1's premise was that a fling can fire many native `scroll` events inside a single animation
// frame, so it deferred this observer's notify into one requestAnimationFrame per burst. That
// premise is false in every modern engine: HTML's *run the scroll steps* dispatches a scrolled
// element's `scroll` event at most once per rendering update, before *run the animation frame
// callbacks* runs in that same update — already documented at docs/PERF.md:98-102 for Chromium, and
// independently in f28b25a's own commit message for WebKit ("WebKit coalesces any number of
// synchronous writes into exactly one native `scroll` event"). So the deferral coalesced a burst
// that never happens, changed nothing a user could see, and cost two rAF schedules plus two timer
// resets per scroll event per grid (one of each per virtualizer) for no benefit — worse, it risked
// slipping a notify to the *next* frame whenever the browser delivers `scroll` to the main thread
// after that update's own rAF phase has already run, which is exactly the wrong direction for a
// "rows lag behind a fling" symptom. This restores @tanstack/virtual-core@3.17.8's own stock timing
// (observeElementOffset in its index.ts): `cb` runs synchronously on `scroll`, with only the stock
// observer's own isScrollingResetDelay debounce (default 150ms) kept for the trailing
// `isScrolling: false` notify — this app never sets useScrollendEvent, so that alternate stock path
// is not reproduced here. DataGrid.vue's own onScroll (not this function) is where a velocity
// estimate and the real-fling trace hook are now derived, off the same native `scroll` event this
// observer also listens for — see its own comment for why that seam is kept separate from this one.
export function observeScrollElementOffset(
  instance: {
    scrollElement: Element | null;
    options: { horizontal?: boolean; isRtl?: boolean; isScrollingResetDelay?: number };
  },
  cb: (offset: number, isScrolling: boolean) => void,
): (() => void) | undefined {
  const el = instance.scrollElement as HTMLElement | null;
  if (!el) return undefined;

  const readOffset = () => {
    const { horizontal, isRtl } = instance.options;
    return horizontal ? el.scrollLeft * ((isRtl && -1) || 1) : el.scrollTop;
  };

  let resetTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleEnd = () => {
    clearTimeout(resetTimer);
    resetTimer = setTimeout(
      () => cb(readOffset(), false),
      instance.options.isScrollingResetDelay ?? 150,
    );
  };

  const handler = () => {
    scheduleEnd();
    cb(readOffset(), true);
  };

  el.addEventListener('scroll', handler, { passive: true });
  return () => {
    el.removeEventListener('scroll', handler);
    clearTimeout(resetTimer);
  };
}

// P22 iter2 D3: velocity-adaptive, direction-biased row overscan ("runway") — see the plan's §5 D3.
// The row axis's overscan was symmetric and direction-blind (`overscan: Math.ceil(OVERSCAN_PX /
// rowHeight)`, virtual-core's own defaultRangeExtractor): it expands range.startIndex/endIndex by
// the same row count on both sides regardless of which way the user is scrolling, so a fast fling
// only ever has half the buffer's worth of runway ahead of it (F6). This extends the window further
// in the direction of travel, and only there, so the same total DOM buys more runway where it's
// actually needed.
//
// BASE_LEAD_PX/BASE_TRAIL_PX both equal OVERSCAN_PX so that at zero velocity this produces *exactly*
// the row window `overscan: Math.ceil(OVERSCAN_PX / rowHeight)` did — see rowRangeExtractor's own
// comment for the arithmetic that guarantees this. Every existing at-rest budget (the overscan-
// coverage invariants, the DOM-cell bounds) must see zero change from this file.
//
// LEAD_FRAMES/MAX_LEAD_PX are provisional: nobody in this repo has measured a real macOS momentum
// scroll's velocity (the plan's F5) — these are a defensible first guess, to be re-set once
// window.__kiraScrollTrace (D2) reports one from real hardware. Extra runway costs compositing
// memory while flinging only (WEBVIEW-SCROLL-MEMORY.md §6) — accepted (F7) as a trade, not free.
export const BASE_LEAD_PX = OVERSCAN_PX;
export const BASE_TRAIL_PX = OVERSCAN_PX;
/** Provisional (see above): extra lead px granted per px/frame of measured velocity. */
export const LEAD_FRAMES = 6;
/** Provisional (see above): hard ceiling on the lead side regardless of velocity. */
export const MAX_LEAD_PX = 2400;
// P22 iter2 D3(c): the cap is expressed in *cells*, not rows — a wide table (e.g. 61 columns) is
// already close to budgets.spec.ts's < 2 500 DOM-cell bound at rest (F6), so a flat row cap would
// let it blow that budget while a two-column table barely used its own share. Set below the
// existing bound so a wide table's extra lead self-limits well before the DOM-size gate would.
export const CELL_BUDGET = 2200;

// P22 iter2-scroll-gaps D2: provisional (same epistemic status as LEAD_FRAMES/MAX_LEAD_PX, above —
// nobody has a real renderMs-per-cell figure from the SlickGrid engine yet; D1 is what produces the
// first one). This is a PER-CALL cap on how many new (not-yet-cached) cells a single synchronous
// SlickGrid render() pass may build, independent of CELL_BUDGET (which caps the TOTAL mounted
// window across calls, not any one call's own new-row batch). Sized to keep one render() call's
// synchronous work well under a single frame's budget even on a 120 Hz display; re-set once the
// real-Mac protocol (docs/PERF.md §2.1c) reports actual renderMs figures for a cold batch of this
// size. Consumed by views/grid/slick/kiraSlickGrid.ts's own getRenderedRange override — the
// incumbent tanstack-virtual/DataGrid.vue grid has no equivalent single-call batch-size hazard
// (P22-slickgrid-migration-plan.md's own F2: SlickGrid's render() builds every newly-entering row
// synchronously in one unconditional DOM-construction pass, unlike Vue's own patch, which this app's
// incumbent grid goes through instead), so this constant is SlickGrid-only.
export const MAX_NEW_CELLS_PER_RENDER = 600;

// P22 iter2-pacing D2: a separate, SEPARATELY-CAPPED per-render budget for *runway* (beyond
// strictly-visible) growth only — MAX_NEW_CELLS_PER_RENDER above stays the absolute per-pass
// ceiling and the step-6 floor short-circuit unchanged. Lowering this makes the runway grow in
// small even steps instead of one large step followed by a cliff (a variance reduction, not a
// total-work reduction), and it trades directly against how fast the runway converges
// (uncoveredPx). Defaulted EQUAL to MAX_NEW_CELLS_PER_RENDER — i.e. behaviourally neutral, byte-
// identical to today's emitted range — because nobody has a real-hardware number for it yet;
// docs/PERF.md §2.1c step 4 is the A/B that sets it. Same precedent as forceSyncScrollingOverride
// (main.ts): a dial with a documented default, not a silent behaviour change. Consumed by
// views/grid/slick/kiraSlickGrid.ts's own getRenderedRange override, step 7.
export const MAX_NEW_LEAD_CELLS_PER_RENDER = MAX_NEW_CELLS_PER_RENDER;

// P22 iter2-pacing D1. Provisional, same epistemic status as LEAD_FRAMES/MAX_LEAD_PX/
// MAX_NEW_CELLS_PER_RENDER: how long the viewport must go without a native scroll event before a
// self-scheduled catch-up render is allowed to run. A catch-up that fires while a fling is still
// delivering scroll events lands in the same animation frame as that frame's scroll-driven
// render, doubling the frame's work (docs/v1.1/plans/P22-slickgrid-migration-plan-iter2-pacing.md
// §1.2: 131 of 140 frames in a WebKit repro). ~1.5 frames at 60 Hz, ~3 at 120 Hz. 0 restores the
// pre-fix "fire on the very next rAF, unconditionally" behaviour exactly — which is what makes the
// real-Mac A/B a console line (docs/PERF.md §2.1c). Re-set from that A/B, not from here.
export const CHASE_QUIET_MS = 24;

export interface RowRangeExtractorConfig {
  baseLeadPx: number;
  baseTrailPx: number;
  leadFrames: number;
  maxLeadPx: number;
  cellBudget: number;
}

/**
 * The row axis's own budget arithmetic — a pixel budget (velocity-adaptive, direction-biased,
 * cell-capped) reduced to a pair of inclusive row bounds. Split out from `rowRangeExtractor` below
 * (P22 spike C1) so `views/grid/slick/kiraSlickGrid.ts`'s `getRenderedRange` override can reuse the
 * exact same arithmetic instead of restating it — see that file's own comment. `direction`/
 * `velocityPxPerFrame` come from the caller's own scroll-velocity sampler (DataGrid.vue's onScroll,
 * or KiraSlickGrid's own); `mountedColumnCount` is the row axis's own budget divisor, read from the
 * column virtualizer so a wide table's cap tightens with however many columns are actually mounted
 * right now, not the table's total column count.
 */
export function rowRangeBounds(
  range: Pick<Range, 'startIndex' | 'endIndex' | 'count'>,
  rowHeight: number,
  /** |Δoffset| since the previous scroll event, in px. 0 at rest. */
  velocityPxPerFrame: number,
  /** Sign of the scroll delta: 1 forward (toward endIndex/down), -1 backward (up), 0 at rest. */
  direction: 1 | -1 | 0,
  mountedColumnCount: number,
  cfg: RowRangeExtractorConfig,
): { start: number; end: number } {
  if (range.count <= 0) return { start: 0, end: -1 };

  const trailRows = Math.ceil(cfg.baseTrailPx / rowHeight);
  const leadBaselineRows = Math.ceil(cfg.baseLeadPx / rowHeight);
  // Clamped below at cfg.baseLeadPx, so at velocityPxPerFrame === 0 this equals cfg.baseLeadPx
  // exactly, leadRowsWanted === leadBaselineRows, extraLeadRows === 0 — D3(a)'s own requirement,
  // true unconditionally regardless of the budget math below.
  const leadPxWanted = Math.min(
    cfg.maxLeadPx,
    Math.max(cfg.baseLeadPx, cfg.baseLeadPx + velocityPxPerFrame * cfg.leadFrames),
  );
  const leadRowsWanted = Math.ceil(leadPxWanted / rowHeight);
  const extraLeadRows = Math.max(0, leadRowsWanted - leadBaselineRows);

  // The baseline (both sides, leadBaselineRows === trailRows) is always granted in full, exactly
  // like today — only the *extra* velocity-driven lead is budget-capped, and only on the lead side.
  const visibleRows = range.endIndex - range.startIndex + 1;
  const budgetRows = Math.floor(cfg.cellBudget / Math.max(1, mountedColumnCount));
  const grantedExtraLeadRows = Math.max(
    0,
    Math.min(extraLeadRows, budgetRows - visibleRows - trailRows - leadBaselineRows),
  );
  const leadRows = leadBaselineRows + grantedExtraLeadRows;

  const [startRows, endRows] = direction < 0 ? [leadRows, trailRows] : [trailRows, leadRows];
  const start = Math.max(range.startIndex - startRows, 0);
  const end = Math.min(range.endIndex + endRows, range.count - 1);
  return { start, end };
}

/**
 * The row axis's own `rangeExtractor`, following columnRangeExtractor's own precedent (a pixel
 * budget expanded into item counts, capped) rather than virtual-core's item-count `overscan`. A
 * two-line wrapper over `rowRangeBounds` above, expanding its `{ start, end }` into the `number[]`
 * @tanstack/vue-virtual wants — behaviour-preserving by construction (P22 spike C1); see the plan's
 * §5 D3 and §5 D4 for why the arithmetic itself lives in `rowRangeBounds` now.
 */
export function rowRangeExtractor(
  range: Pick<Range, 'startIndex' | 'endIndex' | 'count'>,
  rowHeight: number,
  velocityPxPerFrame: number,
  direction: 1 | -1 | 0,
  mountedColumnCount: number,
  cfg: RowRangeExtractorConfig,
): number[] {
  const { start, end } = rowRangeBounds(
    range,
    rowHeight,
    velocityPxPerFrame,
    direction,
    mountedColumnCount,
    cfg,
  );
  const out: number[] = [];
  for (let i = start; i <= end; i++) out.push(i);
  return out;
}

// §8.5's type-aware right-alignment for numerics.
export function alignmentFor(descriptor: ColumnDescriptor): 'left' | 'right' {
  return descriptor.typeClass === 'number' ? 'right' : 'left';
}

/** The display order: stored order filtered to live columns, then any new columns appended. */
export function resolveColumnOrder(page: TabularPage, stored: string[] | null): string[] {
  const names = page.columns.map((c) => c.name);
  if (!stored) return names;
  const known = new Set(names);
  const kept = stored.filter((n) => known.has(n));
  const missing = names.filter((n) => !kept.includes(n));
  return [...kept, ...missing];
}

// Pages are frozen and stable by reference (page.ts's setPage), so a WeakMap keyed by the page
// itself memoises the name -> index lookup exactly once per page — the single mapping §0 note 4
// exists to guarantee, kept O(1) per call so it stays cheap on the render path.
const nameIndexCache = new WeakMap<TabularPage, Map<string, number>>();

function nameIndexFor(page: TabularPage): Map<string, number> {
  let map = nameIndexCache.get(page);
  if (!map) {
    map = new Map(page.columns.map((c, i) => [c.name, i]));
    nameIndexCache.set(page, map);
  }
  return map;
}

/** Display position -> index into page.columns/page.chunks. -1 when the name is gone. */
export function pageColumnIndexFor(page: TabularPage, order: string[], displayCol: number): number {
  const name = order[displayCol];
  if (name === undefined) return -1;
  return nameIndexFor(page).get(name) ?? -1;
}

// P48 F7: the column-header tooltip object DataGrid.vue and ConsoleResultGrid.vue each built —
// deliberately the same shape (P42 D19/D20's own comment), differing only in whether a DB
// comment line is available to fold into `body`. `dataType` is passed in rather than read off
// `col` directly: DataGrid.vue overlays a DESCRIBE-derived dataType where the console has none.
export function columnHeaderTooltip(
  col: { name: string; typeClass: TypeClass },
  dataType: string,
  comment?: string | null,
): { title: string; meta?: string; metaColor?: string; body?: string } {
  const description = dataType ? typeDescription(dataType) : null;
  return {
    title: col.name,
    meta: dataType || undefined,
    metaColor: typeClassColor(col.typeClass) || undefined,
    body: [description, comment].filter((line): line is string => !!line).join('\n') || undefined,
  };
}
