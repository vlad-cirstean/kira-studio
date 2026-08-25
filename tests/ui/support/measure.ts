import type { ElectronApplication, Page } from '@playwright/test';

// P12's shared measurement primitives (D24) — the only non-re-export module in tests/ui/support/.
// budgets.spec.ts, memory.spec.ts, and startup.spec.ts all import from here so their numbers are
// produced by identical instrumentation and are therefore comparable across specs and across runs.

export interface ProcessSample {
  type: string; // 'Browser' | 'Tab' | 'Utility' | 'GPU' | ...
  serviceName: string; // 'kira-engine' for the engine; '' when Electron reports none
  pid: number;
  rssBytes: number;
}

export interface RssSample {
  totalBytes: number;
  processes: ProcessSample[];
}

/** One `app.getAppMetrics()` reading, summed. No IPC, no production hook (D1). */
export function sampleRss(app: ElectronApplication): Promise<RssSample> {
  return app.evaluate(({ app }) => {
    const metrics = app.getAppMetrics();
    const processes = metrics.map((m) => ({
      type: m.type,
      serviceName: m.serviceName ?? '',
      pid: m.pid,
      rssBytes: m.memory.workingSetSize * 1024,
    }));
    const totalBytes = processes.reduce((sum, p) => sum + p.rssBytes, 0);
    return { totalBytes, processes };
  });
}

/** Idle `settleMs`, then `samples` readings `intervalMs` apart (D3). No forced GC. */
export async function sampleRssSeries(
  app: ElectronApplication,
  opts?: { settleMs?: number; samples?: number; intervalMs?: number },
): Promise<RssSample[]> {
  const { settleMs = 5000, samples = 10, intervalMs = 1000 } = opts ?? {};
  await new Promise((resolve) => setTimeout(resolve, settleMs));
  const series: RssSample[] = [];
  for (let i = 0; i < samples; i++) {
    series.push(await sampleRss(app));
    if (i < samples - 1) await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return series;
}

/** Multi-line per-process min/max breakdown for console.log — printed always, not only on failure. */
export function formatRssSeries(series: RssSample[]): string {
  if (series.length === 0) return '(no samples)';
  const mb = (bytes: number): string => (bytes / (1024 * 1024)).toFixed(1);
  const totals = series.map((s) => s.totalBytes);

  const byKey = new Map<string, number[]>();
  for (const sample of series) {
    for (const p of sample.processes) {
      const key = `${p.type}${p.serviceName ? `:${p.serviceName}` : ''} (pid ${p.pid})`;
      const values = byKey.get(key) ?? [];
      values.push(p.rssBytes);
      byKey.set(key, values);
    }
  }

  const lines = [
    `total: min=${mb(Math.min(...totals))}MB max=${mb(Math.max(...totals))}MB (${series.length} samples)`,
  ];
  for (const [key, values] of byKey) {
    lines.push(`  ${key}: min=${mb(Math.min(...values))}MB max=${mb(Math.max(...values))}MB`);
  }
  return lines.join('\n');
}

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
 * (src/renderer/main.ts's Window augmentation; called from the top of onScroll's rAF callback,
 * after both scheduling hops have already resolved and neither app code path takes) instead of at
 * the synchronous property write, while keeping the same MutationObserver-based end signal. If no
 * mark ever arrives for a step (mark is only set once a test defines the hook, so this shouldn't
 * happen when called from budgets.spec.ts, but would if this were reused without wiring it up),
 * workDeltas falls back to the e2e start so the promise still resolves with a sane, if inflated,
 * number rather than a negative or NaN one.
 */
// P29 D13: one axis parameter, not a second function — this file's own header rule is that
// budgets.spec.ts/memory.spec.ts/startup.spec.ts must all produce numbers with identical
// instrumentation so they stay comparable. Default 'vertical' keeps the existing call site
// (scrollTop) byte-for-byte unchanged.
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

/** `process.uptime() * 1000` read in main — startup cost with Playwright's spawn overhead out (D8). */
export function uptimeMs(app: ElectronApplication): Promise<number> {
  return app.evaluate(() => process.uptime() * 1000);
}
