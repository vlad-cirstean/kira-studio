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

/**
 * Per scroll step: returns (mutation-callback time − the synchronous `scrollTop` assignment) —
 * the app's whole main-thread response to a scroll, same "synchronous trigger → first
 * MutationObserver callback" shape D5 uses for every other budget in this file (D5/D6).
 *
 * An earlier version started the clock at the native `scroll` event's own `timeStamp` instead,
 * on the theory that a `scroll` event (unlike requestAnimationFrame) isn't vsync-locked. That's
 * false for a script-driven `scrollTop` change: Chromium defers the `scroll` event's dispatch to
 * the next "update the rendering" step, the same per-frame cadence rAF uses — confirmed by
 * forcing a step to start right after a frame boundary (via a double-rAF wait) and observing
 * every sample jump to a full frame period. Gating the measurement on that event timestamp was
 * reintroducing exactly the vsync floor D6 says a rAF-based measurement "can never" escape.
 * Starting the clock at the trigger itself avoids the same floor `measureClickToDom` avoids.
 */
export function measureScrollResponses(
  page: Page,
  gridSelector: string,
  steps: number,
): Promise<number[]> {
  return page.evaluate(
    ({ gridSelector, steps }) => {
      const el = document.querySelector<HTMLElement>(gridSelector);
      if (!el) throw new Error(`measureScrollResponses: ${gridSelector} not found`);
      const total = Math.max(0, el.scrollHeight - el.clientHeight);

      function step(target: number): Promise<number> {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            observer.disconnect();
            reject(new Error('measureScrollResponses: step timed out'));
          }, 5000);

          const observer = new MutationObserver(() => {
            clearTimeout(timer);
            observer.disconnect();
            resolve(performance.now() - start);
          });
          observer.observe(el as HTMLElement, { childList: true, subtree: true, attributes: true });

          const start = performance.now();
          (el as HTMLElement).scrollTop = target;
        });
      }

      return (async () => {
        const results: number[] = [];
        for (let i = 1; i <= steps; i++) {
          results.push(await step(Math.round((total * i) / steps)));
        }
        return results;
      })();
    },
    { gridSelector, steps },
  );
}

/** `process.uptime() * 1000` read in main — startup cost with Playwright's spawn overhead out (D8). */
export function uptimeMs(app: ElectronApplication): Promise<number> {
  return app.evaluate(() => process.uptime() * 1000);
}
