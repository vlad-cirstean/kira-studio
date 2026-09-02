import type { Page } from '@playwright/test';

// Ported from tests/e2e/support/measure.ts (P57 D16) — `percentile`/`measureClickToDom`/
// `measureScrollResponses` are pure `page.evaluate()` DOM/MutationObserver timers with zero
// Electron dependency (confirmed by reading the original: its only Electron-coupled export is
// `uptimeMs`, which reads `ElectronApplication.evaluate(() => process.uptime())` for
// `startup.spec.ts` — a spec with no analogue in this tier, per P57-cutover.md §7 ("startup.spec.ts
// has no subject and no analogue"). `uptimeMs` is dropped here rather than ported; everything else
// is byte-identical.

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

/**
 * Clicks `click`, then resolves at the first MutationObserver callback under `observe` for which
 * `until` holds, returning ms since the synchronous click dispatch. MutationObserver callbacks are
 * microtasks, so resolution is sub-millisecond; a requestAnimationFrame poll would quantise every
 * result to a ~16.7 ms multiple and could never demonstrate a 50 ms budget, let alone 8 ms (D5).
 * Paint is deliberately outside the measurement (D5).
 */
export function measureClickToDom(
  page: Page,
  opts: {
    click: string;
    observe: string;
    until: { selector: string; text?: string; minCount?: number };
    timeoutMs?: number;
  },
): Promise<number> {
  const { click, observe, until, timeoutMs = 5000 } = opts;
  return page.evaluate(
    ({ click, observe, until, timeoutMs }) => {
      return new Promise<number>((resolve, reject) => {
        const clickEl = document.querySelector<HTMLElement>(click);
        const observeEl = document.querySelector<HTMLElement>(observe);
        if (!clickEl || !observeEl) {
          reject(
            new Error(`measureClickToDom: target not found (click=${click}, observe=${observe})`),
          );
          return;
        }

        function isDone(): boolean {
          if (until.minCount !== undefined) {
            return document.querySelectorAll(until.selector).length >= until.minCount;
          }
          const target = document.querySelector(until.selector);
          if (!target) return false;
          if (until.text !== undefined) return (target.textContent ?? '').includes(until.text);
          return true;
        }

        const timer = setTimeout(() => {
          observer.disconnect();
          reject(new Error(`measureClickToDom: timed out waiting for ${until.selector}`));
        }, timeoutMs);

        const observer = new MutationObserver(() => {
          if (!isDone()) return;
          clearTimeout(timer);
          observer.disconnect();
          resolve(performance.now() - start);
        });
        observer.observe(observeEl, { childList: true, subtree: true, characterData: true });

        const start = performance.now();
        clickEl.click();
      });
    },
    { click, observe, until, timeoutMs },
  );
}

export interface ScrollResponseDeltas {
  /** DataGrid.vue's own __kiraGridScrollWorkStart mark → MutationObserver callback (see below). */
  workDeltas: number[];
  /** The original end-to-end number: synchronous trigger → MutationObserver callback (D5/D6). */
  e2eDeltas: number[];
}

/**
 * Per scroll step: returns both an end-to-end delta (synchronous `scrollTop` assignment → first
 * MutationObserver callback, same "trigger → DOM commit" shape D5 uses for every other budget in
 * this file) and a work-only delta that isolates the app's own main-thread work from browser
 * frame-scheduling delay.
 *
 * An earlier version gated the 8ms budget on the end-to-end number alone. That number conflates
 * two frame-scheduling waits that are not app work: a script-driven `scrollTop` change's own
 * `scroll` event is deferred to Chromium's next "update the rendering" step (the same per-frame
 * cadence requestAnimationFrame uses), and DataGrid.vue's onScroll deliberately coalesces bursty
 * scroll events by doing its actual state sync inside its own requestAnimationFrame callback — a
 * second hop stacked on the first. Confirmed by forcing a step to start right after a frame
 * boundary (via a double-rAF wait) and observing every sample jump to a full frame period.
 * SPEC.md's 8ms figure is explicitly "(120 Hz displays)" — a per-frame work budget, not a
 * display-independent latency — so gating on the end-to-end number was reintroducing exactly the
 * vsync floor D6 says a rAF-based measurement "can never" escape, on an environment with no real
 * 120Hz cadence to synthesize.
 *
 * The work-only delta starts its clock at DataGrid.vue's own __kiraGridScrollWorkStart mark
 * (apps/kira-studio/frontend/src/main.ts's Window augmentation; called from the top of onScroll's rAF callback,
 * after both scheduling hops have already resolved and neither app code path takes) instead of at
 * the synchronous property write, while keeping the same MutationObserver-based end signal. If no
 * mark ever arrives for a step (mark is only set once a test defines the hook, so this shouldn't
 * happen when called from budgets.spec.ts, but would if this were reused without wiring it up),
 * workDeltas falls back to the e2e start so the promise still resolves with a sane, if inflated,
 * number rather than a negative or NaN one.
 */
// P29 D13: one axis parameter, not a second function — this file's own header rule is that
// budgets.spec.ts/startup.spec.ts must both produce numbers with identical instrumentation so
// they stay comparable. Default 'vertical' keeps the existing call site (scrollTop) byte-for-byte
// unchanged.
export function measureScrollResponses(
  page: Page,
  gridSelector: string,
  steps: number,
  axis: 'vertical' | 'horizontal' = 'vertical',
): Promise<ScrollResponseDeltas> {
  return page.evaluate(
    ({ gridSelector, steps, axis }) => {
      const el = document.querySelector<HTMLElement>(gridSelector);
      if (!el) throw new Error(`measureScrollResponses: ${gridSelector} not found`);
      const prop = axis === 'horizontal' ? 'scrollLeft' : 'scrollTop';
      const total =
        axis === 'horizontal'
          ? Math.max(0, el.scrollWidth - el.clientWidth)
          : Math.max(0, el.scrollHeight - el.clientHeight);

      const w = window as unknown as { __kiraGridScrollWorkStart?: (t: number) => void };

      function step(target: number): Promise<{ work: number; e2e: number }> {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            w.__kiraGridScrollWorkStart = undefined;
            observer.disconnect();
            reject(new Error('measureScrollResponses: step timed out'));
          }, 5000);

          let workStart = 0;
          w.__kiraGridScrollWorkStart = (t: number) => {
            workStart = t;
          };

          const observer = new MutationObserver(() => {
            clearTimeout(timer);
            w.__kiraGridScrollWorkStart = undefined;
            observer.disconnect();
            const end = performance.now();
            resolve({ work: end - (workStart || start), e2e: end - start });
          });
          observer.observe(el as HTMLElement, { childList: true, subtree: true, attributes: true });

          const start = performance.now();
          (el as HTMLElement)[prop] = target;
        });
      }

      return (async () => {
        const workDeltas: number[] = [];
        const e2eDeltas: number[] = [];
        for (let i = 1; i <= steps; i++) {
          const { work, e2e } = await step(Math.round((total * i) / steps));
          workDeltas.push(work);
          e2eDeltas.push(e2e);
        }
        return { workDeltas, e2eDeltas };
      })();
    },
    { gridSelector, steps, axis },
  );
}

export interface SustainedScrollResult {
  /** The requested velocity this ladder rung was run at, echoed back for the caller's own logging. */
  velocity: number;
  /**
   * Per frame: how much of the viewport band the mounted `[data-testid="grid-row"]` band failed to
   * cover, in px, floored at 0 — read *at the moment of the write*, before any settle wait. The
   * symptom's own metric (P22 iter2 §5 D3).
   */
  uncoveredPx: number[];
}

/**
 * Measures rendered-band coverage *during* sustained scrolling, velocity-parameterised in px/frame
 * — replaces P22 pass 1's `measureScrollCoverage` (P22 iter2 D7:
 * docs/v1.1/plans/P22-webview-scroll-performance-iter2-rendering.md §5 D7/F1/F4). That instrument
 * manufactured its own "many scroll events per frame" burst via `SUB_STEPS_PER_FRAME = 8` synthetic
 * `dispatchEvent(new Event('scroll'))` calls — a burst real browsers never produce (`scroll`
 * dispatches at most once per rendering update; docs/PERF.md:98-102, f28b25a's own commit message)
 * — so its "before: up to 8/frame" numbers measured the harness's own constant, not the app.
 *
 * This drives one *real* `scroll` event per rAF (`el.scrollTop = next`, no synthetic dispatch) and
 * reads `uncoveredPx` synchronously in the same callback, before Vue's scheduler has had a chance to
 * react to it — no `await nextFrame()` settle wait, which is what let pass 1's `uncoveredPx === 0`
 * read as reassuring when it was structurally guaranteed to.
 *
 * This is still not proof the real symptom is gone: this harness drives `scrollTop` from the main
 * thread, so the DOM's scroll offset and the main thread's own knowledge of it are the same value by
 * construction — the condition that produces the symptom on real hardware (the compositor showing a
 * position the main thread hasn't rendered yet, since WebKit's scrolling thread moves the composited
 * layer independently of the main thread during a momentum scroll) cannot occur here, at any
 * velocity (P22 iter2 F4). Logged, not gated, for exactly that reason — a real measurement needs
 * `window.__kiraScrollTrace` on real hardware (views/grid/scrollTrace.ts, the plan's §7.3).
 */
export function measureSustainedScroll(
  page: Page,
  gridSelector: string,
  opts: { pxPerFrame: number; frames: number },
): Promise<SustainedScrollResult> {
  const { pxPerFrame, frames } = opts;
  return page.evaluate(
    ({ gridSelector, pxPerFrame, frames }) => {
      const found = document.querySelector<HTMLElement>(gridSelector);
      if (!found) throw new Error(`measureSustainedScroll: ${gridSelector} not found`);
      const el = found;
      const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);

      function uncoveredPx(): number {
        const rows = document.querySelectorAll<HTMLElement>('[data-testid="grid-row"]');
        const viewStart = el.scrollTop;
        const viewEnd = viewStart + el.clientHeight;
        if (rows.length === 0) return Math.max(0, viewEnd - viewStart);
        let mountedStart = Number.POSITIVE_INFINITY;
        let mountedEnd = Number.NEGATIVE_INFINITY;
        for (const row of rows) {
          if (row.offsetTop < mountedStart) mountedStart = row.offsetTop;
          const end = row.offsetTop + row.offsetHeight;
          if (end > mountedEnd) mountedEnd = end;
        }
        const above = Math.max(0, mountedStart - viewStart);
        const below = Math.max(0, viewEnd - mountedEnd);
        return above + below;
      }

      return new Promise<{ velocity: number; uncoveredPx: number[] }>((resolve) => {
        const uncovered: number[] = [];
        let f = 0;
        function tick(): void {
          el.scrollTop = Math.min(maxScrollTop, el.scrollTop + pxPerFrame);
          uncovered.push(uncoveredPx());
          f++;
          if (f < frames) requestAnimationFrame(tick);
          else resolve({ velocity: pxPerFrame, uncoveredPx: uncovered });
        }
        requestAnimationFrame(tick);
      });
    },
    { gridSelector, pxPerFrame, frames },
  );
}

export interface RowUpdateStep {
  /** Distinct `[data-testid="grid-row"][data-row]` values mounted after this step that weren't
   *  mounted before it. */
  rowsEntered: number;
  /** The reverse — mounted before, gone after. */
  rowsLeft: number;
  /** GridRow.vue's own onUpdated count during this step (window.__kiraGridRowUpdates). */
  updates: number;
}

/**
 * P22 iter2 D4's own sandbox-provable proof (the plan's §5 D4, last paragraph): a genuinely
 * reference-stable RowVM makes Vue skip re-rendering a GridRow whose props didn't change — a row
 * that merely slides to a new window position without any of its own content changing should not
 * update at all, and a row entering or leaving the window mounts or unmounts rather than updating
 * (Vue's keyed diff, not this mechanism). This is a property of the app's own JS/DOM reconciliation,
 * fully settleable in this sandbox — it says nothing about whether skipping those re-renders is
 * *enough* to fix the perceived lag on real hardware, which is a different question (§7.3).
 */
export function measureRowUpdatesDuringScroll(
  page: Page,
  gridSelector: string,
  opts: { pxPerFrame: number; steps: number },
): Promise<RowUpdateStep[]> {
  const { pxPerFrame, steps } = opts;
  return page.evaluate(
    ({ gridSelector, pxPerFrame, steps }) => {
      const found = document.querySelector<HTMLElement>(gridSelector);
      if (!found) throw new Error(`measureRowUpdatesDuringScroll: ${gridSelector} not found`);
      const el = found;
      const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);

      function mountedRows(): Set<number> {
        const out = new Set<number>();
        for (const rowEl of document.querySelectorAll<HTMLElement>('[data-testid="grid-row"]')) {
          const row = Number(rowEl.dataset.row);
          if (!Number.isNaN(row)) out.add(row);
        }
        return out;
      }

      const w = window as unknown as { __kiraGridRowUpdates?: () => void };
      const prevHook = w.__kiraGridRowUpdates;

      return new Promise<RowUpdateStep[]>((resolve) => {
        const results: RowUpdateStep[] = [];
        let prev = mountedRows();
        let updatesThisStep = 0;
        w.__kiraGridRowUpdates = () => {
          updatesThisStep++;
        };

        function afterSettle(): void {
          const now = mountedRows();
          let rowsEntered = 0;
          for (const row of now) if (!prev.has(row)) rowsEntered++;
          let rowsLeft = 0;
          for (const row of prev) if (!now.has(row)) rowsLeft++;
          results.push({ rowsEntered, rowsLeft, updates: updatesThisStep });
          prev = now;
          if (results.length < steps) step();
          else {
            w.__kiraGridRowUpdates = prevHook;
            resolve(results);
          }
        }

        function step(): void {
          updatesThisStep = 0;
          el.scrollTop = Math.min(maxScrollTop, el.scrollTop + pxPerFrame);
          // Two rAFs: Vue's own reactive flush runs on the microtask checkpoint well before even
          // one elapses, so this is a conservative margin, not a tuned minimum.
          requestAnimationFrame(() => requestAnimationFrame(afterSettle));
        }
        step();
      });
    },
    { gridSelector, pxPerFrame, steps },
  );
}
