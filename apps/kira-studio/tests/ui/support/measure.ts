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

export interface ScrollCoverageResult {
  /** The requested velocity this ladder rung was run at, echoed back for the caller's own logging. */
  velocity: number;
  /**
   * Per frame: how much of the viewport band the mounted `[data-testid="grid-row"]` band failed to
   * cover, in px, floored at 0. The symptom's own metric (P22 §5 D3) — what the user sees as
   * unpainted sizer during a fast scroll.
   */
  uncoveredPx: number[];
  /**
   * Per frame: how many times the row virtualizer's onChange (markScrollWork) fired. P22 D1's
   * direct proof — must fall to <= 1 once the offset-driven notify is coalesced to one per frame.
   */
  notifiesPerFrame: number[];
}

/**
 * Measures rendered-band coverage and re-renders-per-frame *during* sustained scrolling, velocity-
 * parameterised in px/frame (P22 §0.4's own ground rule, mirroring WEBVIEW-SCROLL-MEMORY.md §5.4).
 * `measureScrollResponses` above cannot see this: it steps once from an idle DOM and waits for it to
 * settle, so it never has two scroll deltas in flight (P22 F6). This instrument keeps scrolling.
 *
 * A genuine fling delivers many native `scroll` notifications to the main thread before one repaint
 * — the very thing @tanstack/virtual-core@3.17.8's stock observeElementOffset notifies on
 * synchronously, per event (P22 F1). A single scripted `el.scrollTop = x` cannot reproduce that
 * burst: confirmed empirically that WebKit coalesces any number of synchronous writes in one task
 * into exactly one native `scroll` event, well before the offset observer distinguishes "coalesced
 * to one rAF" from "not". So each simulated frame below splits its advance into SUB_STEPS_PER_FRAME
 * synthetic `scroll` dispatches (one per sub-step, after actually moving scrollTop) — manufacturing
 * the same "N notifications before one paint" burst a real fling delivers by other means. This tests
 * the observer's own coalescing behaviour directly, which is exactly what P22 F7 says this sandbox
 * *can* settle (the app's own re-render count) as against what it cannot (whether WebKit's real
 * threaded/momentum scrolling produces such a burst on a packaged build — see P22 §7.3 item 1).
 */
export function measureScrollCoverage(
  page: Page,
  gridSelector: string,
  opts: { pxPerFrame: number; frames: number },
): Promise<ScrollCoverageResult> {
  const { pxPerFrame, frames } = opts;
  return page.evaluate(
    ({ gridSelector, pxPerFrame, frames }) => {
      const found = document.querySelector<HTMLElement>(gridSelector);
      if (!found) throw new Error(`measureScrollCoverage: ${gridSelector} not found`);
      const el = found;

      const w = window as unknown as { __kiraGridScrollWorkStart?: (t: number) => void };
      const prevHook = w.__kiraGridScrollWorkStart;
      let notifiesThisFrame = 0;
      w.__kiraGridScrollWorkStart = () => {
        notifiesThisFrame++;
      };

      const SUB_STEPS_PER_FRAME = 8;
      const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);

      function nextFrame(): Promise<void> {
        return new Promise((resolve) => requestAnimationFrame(() => resolve()));
      }

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

      return (async () => {
        const uncovered: number[] = [];
        const notifies: number[] = [];
        for (let f = 0; f < frames; f++) {
          notifiesThisFrame = 0;
          for (let s = 0; s < SUB_STEPS_PER_FRAME; s++) {
            const next = Math.min(maxScrollTop, el.scrollTop + pxPerFrame / SUB_STEPS_PER_FRAME);
            el.scrollTop = next;
            el.dispatchEvent(new Event('scroll'));
          }
          await nextFrame();
          uncovered.push(uncoveredPx());
          notifies.push(notifiesThisFrame);
        }
        w.__kiraGridScrollWorkStart = prevHook;
        return { velocity: pxPerFrame, uncoveredPx: uncovered, notifiesPerFrame: notifies };
      })();
    },
    { gridSelector, pxPerFrame, frames },
  );
}
