import type { Page } from '@playwright/test';

// Wraps `Worker.prototype.onmessage` so each layout worker reply bumps a counter and, when armed,
// runs a fixed user action `depth` microtasks after the app's own handler. Depth 1 lands between
// the plan publish and the Vue flush, a gap input events cannot reach but a same-task caller can.
// Test support only; the app has no hook for it.

export interface RaceAction {
  /** Viewport scroll applied before the click, in px (negative scrolls up). */
  readonly scrollBy: number;
}

interface ProbeWindow {
  __kiraLayoutReplies: number;
  __kiraLayoutArmed?: { depth: number; action: RaceAction };
  __kiraRaceSubject?: string | null;
}

/** Call after the page has booted and before the repo graph opens (the worker is made then). */
export async function installLayoutWorkerProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as ProbeWindow;
    w.__kiraLayoutReplies = 0;
    const descriptor = Object.getOwnPropertyDescriptor(Worker.prototype, 'onmessage');
    const { get, set } = descriptor ?? {};
    if (!get || !set) throw new Error('Worker.prototype.onmessage is not an accessor');

    const act = (action: RaceAction): void => {
      const viewport = document.querySelector(
        '[data-testid="commit-grid"] .slick-viewport-top.slick-viewport-left',
      );
      if (!viewport) return;
      viewport.scrollTop += action.scrollBy;
      viewport.dispatchEvent(new Event('scroll'));
      const commits = [
        ...document.querySelectorAll<HTMLElement>(
          '[data-testid="commit-grid"] .slick-row[data-row]',
        ),
      ]
        .filter((row) => row.querySelector('[data-testid="message-subject"]'))
        .sort((a, b) => Number(a.dataset.row) - Number(b.dataset.row));
      const target = commits[Math.max(0, commits.length - 2)];
      w.__kiraRaceSubject =
        target?.querySelector('[data-testid="message-subject"]')?.textContent ?? null;
      target?.querySelector<HTMLElement>('.kira-cell-message')?.click();
    };

    Object.defineProperty(Worker.prototype, 'onmessage', {
      configurable: true,
      get() {
        return get.call(this);
      },
      set(handler: unknown) {
        if (typeof handler !== 'function') {
          set.call(this, handler);
          return;
        }
        set.call(this, function wrapped(this: Worker, event: MessageEvent) {
          handler.call(this, event);
          w.__kiraLayoutReplies += 1;
          const armed = w.__kiraLayoutArmed;
          if (!armed) return;
          w.__kiraLayoutArmed = undefined;
          let remaining = armed.depth;
          const step = (): void => {
            if (remaining-- > 0) queueMicrotask(step);
            else act(armed.action);
          };
          step();
        });
      },
    });
  });
}

/** Layout worker replies handled so far. */
export async function layoutReplies(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as ProbeWindow).__kiraLayoutReplies ?? 0);
}

/** Runs `action` `depth` microtasks after the next layout reply is handled. */
export async function armAfterLayout(page: Page, depth: number, action: RaceAction): Promise<void> {
  await page.evaluate(
    (arg) => {
      const w = window as unknown as ProbeWindow;
      w.__kiraRaceSubject = undefined;
      w.__kiraLayoutArmed = arg;
    },
    { depth, action },
  );
}

/** The subject of the row the armed action clicked; `null` when it found no commit row. */
export async function raceSubject(page: Page): Promise<string | null | undefined> {
  return page.evaluate(() => (window as unknown as ProbeWindow).__kiraRaceSubject);
}
