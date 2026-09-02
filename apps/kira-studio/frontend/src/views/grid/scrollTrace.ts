import { nextTick } from 'vue';

// P22 iter2 D2: a real-fling scroll trace, driven by a human on real hardware — see
// docs/v1.1/plans/P22-webview-scroll-performance-iter2-rendering.md §5 D2/§7.3. Every scroll
// measurement anywhere else in this repo (tests/ui/support/measure.ts included) drives `scrollTop`
// from the main thread, so the DOM's scroll offset and the main thread's knowledge of it are
// necessarily the same value — the condition that produces the user's real symptom (the compositor
// showing a position the main thread hasn't rendered yet, since WebKit's scrolling thread moves the
// composited layer independently of the main thread during a momentum scroll) can never occur in
// that harness. This module has no such limitation: it reads the *live* DOM during a *real*
// trackpad fling, from inside the packaged app's own DevTools (View → Open DevTools, a dev build —
// internal/shell/menutemplate.go). It is not a tests/ui/ instrument and is not gated in CI; it exists
// so a human can capture a number nobody in this repo's history has ever measured. Reachable at
// `window.__kiraScrollTrace` (wired here from DataGrid.vue's registerGrid/noteScrollEvent/noteNotify
// calls, not from columns.ts's offset observer — see DataGrid.vue's own onScroll comment for why).
//
// Usage (Web Inspector console, one hard two-finger flick between the two calls):
//   __kiraScrollTrace.start()
//   copy(JSON.stringify(__kiraScrollTrace.stop()))

export interface ScrollTraceEvent {
  /** el.scrollTop at the moment this native `scroll` event was handled. */
  offset: number;
  /** performance.now() at the moment this native `scroll` event was handled. */
  t: number;
  /**
   * Whether this event's own timestamp falls after the rAF tick it got bucketed into. Per the
   * HTML spec, `scroll` dispatches before "run the animation frame callbacks" in the *same*
   * rendering update, so this should read false for essentially every event — a `t` value close
   * to (or moderately past) the frame boundary is expected `requestAnimationFrame`-callback-
   * timestamp jitter, not evidence of anything; only a *large*, *consistent* positive reading here
   * is meaningful (F3's open question — whether a notify can ever slip a whole frame).
   */
  afterRaf: boolean;
}

export interface ScrollTraceFrame {
  /** requestAnimationFrame's own timestamp for this tick. */
  t: number;
  /** Native `scroll` events observed since the previous rAF tick. F2's direct, real-hardware test
   *  — if this is ever > 1, a browser really did fire more than one scroll per frame here, and the
   *  premise pass 1 assumed (and this phase's D1 refuted from source/spec) needs revisiting. */
  scrollEvents: number;
  scrollTopAtEvent: ScrollTraceEvent[];
  /** |Δoffset| since the previous rAF tick, in px — the number nobody in this repo has measured
   *  from a real macOS momentum scroll (the plan's F5). */
  pxPerFrame: number;
  /** Whether either virtualizer's onChange fired since the previous rAF tick. */
  notified: boolean;
  mountedTop: number;
  mountedBottom: number;
  liveScrollTop: number;
  clientHeight: number;
  /** max(0, mountedTop − liveScrollTop) + max(0, liveScrollTop + clientHeight − mountedBottom) —
   *  the symptom's own metric: how much of the viewport the mounted row band fails to cover, read
   *  from the *live* DOM during a *real* scroll (unlike every sandbox measurement of this same
   *  quantity, which cannot see the compositor-ahead condition that makes it non-zero — see this
   *  module's own header comment). */
  uncoveredPx: number;
  /** Vue's own update duration for this frame — wall time from the row/column virtualizer's
   *  notify to the end of the resulting reactive flush (measured via nextTick, since Vue's own
   *  internal queuePostFlushCb is not part of its public/typed API in this version). 0 when
   *  nothing notified this frame. */
  renderMs: number;
  /** Mounted [data-testid="grid-row"] count. */
  rows: number;
}

export interface ScrollTraceStats {
  p50: number;
  p95: number;
  max: number;
}

export interface ScrollTraceSummary {
  pxPerFrame: ScrollTraceStats;
  uncoveredPx: ScrollTraceStats;
  renderMs: ScrollTraceStats;
  /** scrollEvents-per-frame → how many frames saw that count. F2's direct test, tallied. */
  scrollEventsHistogram: Record<number, number>;
}

export interface ScrollTraceResult {
  frames: ScrollTraceFrame[];
  summary: ScrollTraceSummary;
}

let recording = false;
let rafId = 0;
let gridEl: HTMLElement | null = null;
// P22 spike D9: the mounted-row selector `measureMountedBand` queries — defaults to the incumbent
// grid's own testid so every existing caller (DataGrid.vue) is unaffected; SlickGridHost.vue passes
// '.slick-row' so the same probe can A/B both engines on one build (§7.4(b)) without a rebuild.
let mountedRowSelector = '[data-testid="grid-row"]';

let pendingEvents: { offset: number; t: number }[] = [];
let pendingNotified = false;
let lastRenderMs = 0;
let prevLiveScrollTop = 0;
let frames: ScrollTraceFrame[] = [];

/** DataGrid.vue's/SlickGridHost.vue's own onMounted/onUnmounted — at most one grid is ever mounted
 *  at a time (MainView.vue keys its DataView by tab id), so a single module-level target is
 *  enough. `rowSelector` (P22 spike D9) is the mounted-row query `measureMountedBand` below uses —
 *  defaults to the incumbent grid's own testid. */
export function registerGrid(el: HTMLElement, rowSelector = '[data-testid="grid-row"]'): void {
  gridEl = el;
  mountedRowSelector = rowSelector;
}

export function unregisterGrid(el: HTMLElement): void {
  if (gridEl === el) gridEl = null;
}

/** DataGrid.vue's own onScroll, called on every native `scroll` event — a single array push behind
 *  a boolean when not recording, per D2's own "inert until start()" requirement. */
export function noteScrollEvent(offset: number, t: number): void {
  if (!recording) return;
  pendingEvents.push({ offset, t });
}

/** DataGrid.vue's own markScrollWork, called from each virtualizer's onChange. */
export function noteNotify(): void {
  if (!recording) return;
  pendingNotified = true;
  const start = performance.now();
  void nextTick(() => {
    lastRenderMs = performance.now() - start;
  });
}

function measureMountedBand(el: HTMLElement): { top: number; bottom: number; rows: number } {
  const rows = el.querySelectorAll<HTMLElement>(mountedRowSelector);
  if (rows.length === 0) return { top: 0, bottom: 0, rows: 0 };
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    if (row.offsetTop < top) top = row.offsetTop;
    const end = row.offsetTop + row.offsetHeight;
    if (end > bottom) bottom = end;
  }
  return { top, bottom, rows: rows.length };
}

function tick(rafT: number): void {
  if (!recording) return;

  const events = pendingEvents;
  pendingEvents = [];
  const notified = pendingNotified;
  pendingNotified = false;

  const el = gridEl;
  const liveScrollTop = el?.scrollTop ?? 0;
  const clientHeight = el?.clientHeight ?? 0;
  const band = el ? measureMountedBand(el) : { top: 0, bottom: 0, rows: 0 };
  const uncoveredPx = el
    ? Math.max(0, band.top - liveScrollTop) +
      Math.max(0, liveScrollTop + clientHeight - band.bottom)
    : 0;
  const pxPerFrame = Math.abs(liveScrollTop - prevLiveScrollTop);
  prevLiveScrollTop = liveScrollTop;

  frames.push({
    t: rafT,
    scrollEvents: events.length,
    scrollTopAtEvent: events.map((e) => ({ offset: e.offset, t: e.t, afterRaf: e.t > rafT })),
    pxPerFrame,
    notified,
    mountedTop: band.top,
    mountedBottom: band.bottom,
    liveScrollTop,
    clientHeight,
    uncoveredPx,
    renderMs: lastRenderMs,
    rows: band.rows,
  });

  rafId = requestAnimationFrame(tick);
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx] ?? 0;
}

function stats(values: number[]): ScrollTraceStats {
  return {
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    max: values.length ? Math.max(...values) : 0,
  };
}

function summarize(fr: ScrollTraceFrame[]): ScrollTraceSummary {
  const histogram: Record<number, number> = {};
  for (const f of fr) histogram[f.scrollEvents] = (histogram[f.scrollEvents] ?? 0) + 1;
  return {
    pxPerFrame: stats(fr.map((f) => f.pxPerFrame)),
    uncoveredPx: stats(fr.map((f) => f.uncoveredPx)),
    renderMs: stats(fr.map((f) => f.renderMs)),
    scrollEventsHistogram: histogram,
  };
}

export function start(): void {
  recording = true;
  frames = [];
  pendingEvents = [];
  pendingNotified = false;
  lastRenderMs = 0;
  prevLiveScrollTop = gridEl?.scrollTop ?? 0;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(tick);
}

export function stop(): ScrollTraceResult | null {
  if (!recording) {
    console.warn('__kiraScrollTrace.stop(): not recording — call start() first');
    return null;
  }
  recording = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;

  const result: ScrollTraceResult = { frames, summary: summarize(frames) };
  // Best-effort: readable from the console's own return value regardless, but a build where the
  // inspector isn't attachable still needs a way to get the JSON out.
  try {
    navigator.clipboard?.writeText(JSON.stringify(result))?.catch(() => {});
  } catch {
    // ignore — clipboard access can throw synchronously outside a secure/focused context.
  }
  return result;
}
