import type { ColumnDescriptor, TabularPage, TypeClass } from '@shared/protocol/page';
import { cellText, isNull } from '@shared/protocol/page';
import { typeClassColor } from '../../../theme/icons';
import { typeDescription } from '../typeGlossary';

const MIN_WIDTH = 64;
const MAX_WIDTH = 480;
const CELL_PADDING = 20; // px, both sides combined plus a little breathing room
const SAMPLE_ROWS = 50;

// P48 F9: one constant behind what were three separate spellings of the same gutter width — the
// deleted DataGrid.vue's own, ConsoleResultGrid.vue's now-deleted tabular-branch copy (a bare `56`
// in its own CSS), and this one.
export const GUTTER_WIDTH = 56;
// P48 F9: the 96px fallback both grids' own widths computeds used when neither a stored width
// nor a measured one is available yet.
export const DEFAULT_COLUMN_WIDTH = 96;
// P49 F9/D4: the pixel overscan budget the deleted DataGrid.vue's own column virtualizer used — kept for
// KiraSlickGrid's own column-overscan clamp (kiraSlickGrid.ts's clampColumnOverscan); the per-side
// column *count* cap it was paired with (MAX_OVERSCAN_COLUMNS) died with the tanstack-virtual
// column axis it belonged to (P30 §3.6 C7) — SlickGrid clamps by canvas width instead.
export const OVERSCAN_PX = 560;

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
 *  Also drops initialWidths'/initialWidthsByIndex's own result caches below, for the same reason. */
export function resetMeasureCtx(): void {
  measureCtx = null;
  widthsCache = new WeakMap();
  namedWidthsCache = new WeakMap();
}

// P2 R1: the deleted DataGrid.vue's `widths` computed depended on the tab's stored columnWidths (so a resize
// drag's own patchDataTabState call invalidates it) *and* calls initialWidths(page) unconditionally
// inside — every pointermove during a drag re-ran this canvas-measurement pass over every column
// and up to 50 sample rows each, even though a resize never changes the page's own data. Pages are
// frozen and stable by reference (same premise as nameIndexCache below), so a WeakMap keyed by the
// page turns every measurement after the first, for a given page, into a reference check.
//
// Cached by column POSITION, not name (finding 6, round 2) — a console result comes from ad-hoc SQL
// (`SELECT 1 AS x, 2 AS x`), so `page.columns[i].name` is routinely not unique; a name-keyed cache
// silently let the last duplicate's own measured width win for every column sharing that name. The
// main grid's own pages (real DB tables) never have duplicate column names, so `initialWidths`
// below — the name-keyed view every existing caller (SlickGridHost.vue) still wants — stays exactly
// as correct as it always was for that caller; `initialWidthsByIndex` is the new, duplicate-safe
// view `ConsoleSlickGrid.vue` addresses columns by everywhere else in that file (`colField(i)`,
// P30 §3 follow-up fix). `namedWidthsCache` below is `initialWidths`' own second-level cache, kept
// reference-stable across repeat calls exactly like the single cache this replaced (P2 R1's own
// "no further measuring" guarantee, plus reference identity a caller could reasonably rely on).
let widthsCache = new WeakMap<TabularPage, number[]>();
let namedWidthsCache = new WeakMap<TabularPage, Record<string, number>>();

/** Measures the wider of the header and a sample of the first rows, clamped to [64, 480] px —
 *  positional, parallel to `page.columns`/`page.chunks`. */
function measuredWidths(page: TabularPage): number[] {
  const cached = widthsCache.get(page);
  if (cached) return cached;

  const ctx = getMeasureCtx();
  const decoder = new TextDecoder();
  const widths: number[] = [];
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
    widths.push(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(max + CELL_PADDING))));
  }
  widthsCache.set(page, widths);
  return widths;
}

/** Name-keyed view of `measuredWidths` — correct as long as `page.columns` has no duplicate
 *  names (every real DB table): on a duplicate, the last one measured wins, same as it always has.
 *  `initialWidthsByIndex` below is the duplicate-safe view. Its own cache, so repeat calls for the
 *  same page return the exact same object (not just an equal one) without rebuilding it. */
export function initialWidths(page: TabularPage): Record<string, number> {
  const cached = namedWidthsCache.get(page);
  if (cached) return cached;
  const arr = measuredWidths(page);
  const out: Record<string, number> = {};
  page.columns.forEach((column, i) => {
    out[column.name] = arr[i] as number;
  });
  namedWidthsCache.set(page, out);
  return out;
}

/** Position-keyed view of `measuredWidths` — the one duplicate column names can't collide in
 *  (finding 6, round 2). */
export function initialWidthsByIndex(page: TabularPage): number[] {
  return measuredWidths(page);
}

// P30 §3.6 C7: columnOffsets/columnRangeExtractor/observeScrollElementRect/
// observeScrollElementOffset/MAX_OVERSCAN_COLUMNS — the tanstack-vue-virtual column axis these
// four served — retired with @tanstack/vue-virtual itself once ConsoleResultGrid.vue's tabular
// branch (their only remaining caller after P22 Pass B's own cutover) moved onto SlickGrid's own
// native column virtualization (P30 §3). See git history for the deleted implementations.

// P22 iter2 D3: velocity-adaptive, direction-biased row overscan ("runway") — see the plan's §5 D3.
// The row axis's overscan was symmetric and direction-blind (`overscan: Math.ceil(OVERSCAN_PX /
// rowHeight)`, virtual-core's own defaultRangeExtractor): it expands range.startIndex/endIndex by
// the same row count on both sides regardless of which way the user is scrolling, so a fast fling
// only ever has half the buffer's worth of runway ahead of it (F6). This extends the window further
// in the direction of travel, and only there, so the same total DOM buys more runway where it's
// actually needed.
//
// BASE_LEAD_PX/BASE_TRAIL_PX both equal OVERSCAN_PX so that at zero velocity this produces *exactly*
// the row window `overscan: Math.ceil(OVERSCAN_PX / rowHeight)` did — see rowRangeBounds' own
// comment, below, for the arithmetic that guarantees this. Every existing at-rest budget (the
// overscan-coverage invariants, the DOM-cell bounds) must see zero change from this file.
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
// size. Consumed by views/shared/slick/kiraSlickGrid.ts's own getRenderedRange override — the
// deleted tanstack-virtual/DataGrid.vue grid had no equivalent single-call batch-size hazard
// (P22-slickgrid-migration-plan.md's own F2: SlickGrid's render() builds every newly-entering row
// synchronously in one unconditional DOM-construction pass, unlike Vue's own patch, which that grid
// went through instead), so this constant is SlickGrid-only.
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
// views/shared/slick/kiraSlickGrid.ts's own getRenderedRange override, step 7.
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
 * cell-capped) reduced to a pair of inclusive row bounds. Originally split out from a
 * `rowRangeExtractor` wrapper shaped for `@tanstack/vue-virtual`'s own `rangeExtractor` API
 * (DataGrid.vue's own consumer, deleted with it at P22 Pass B's cutover — this function's own
 * general arithmetic had no dependency on that API and so needed no counterpart), so
 * `views/shared/slick/kiraSlickGrid.ts`'s `getRenderedRange` override could reuse the exact same
 * arithmetic instead of restating it — see that file's own comment. `range` keeps that API's own
 * three-field shape structurally (P30 §3.6 C7 dropped the `@tanstack/vue-virtual` import itself,
 * the library being long gone from this arithmetic's only remaining caller). `direction`/
 * `velocityPxPerFrame` come from the caller's own scroll-velocity sampler (KiraSlickGrid's own,
 * today the only caller); `mountedColumnCount` is the row axis's own budget divisor, read from the
 * column virtualizer so a wide table's cap tightens with however many columns are actually mounted
 * right now, not the table's total column count.
 */
export function rowRangeBounds(
  range: { startIndex: number; endIndex: number; count: number },
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

// P48 F7: the column-header tooltip object the deleted DataGrid.vue and ConsoleResultGrid.vue's
// own (now also deleted) tabular branch each built — deliberately the same shape (P42 D19/D20's
// own comment), differing only in whether a DB comment line is available to fold into `body`.
// `dataType` is passed in rather than read off `col` directly: DataGrid.vue overlaid a
// DESCRIBE-derived dataType where the console has none.
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
