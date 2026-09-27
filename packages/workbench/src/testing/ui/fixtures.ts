import { test as base, type Page } from '@playwright/test';
import { startServer, type UiServer } from './server.ts';

/**
 * P107 I2-42: Studio's and Space's `tests/ui/fixtures.ts` shared this whole frame — a worker-
 * scoped static server, console-error collection, a `relaunch()` that opens a fresh page, installs
 * mocks before the first navigation, and waits for the shell to boot. The one real per-app
 * difference was what gets installed and what `KiraApp` carries beyond `window` (Space: `control`
 * only; Studio: `control` + `stream`) — now `installMocks`. Each app's own `fixtures.ts` becomes
 * its mock installer plus this call.
 */
export interface UiFixturesOptions {
  /** Playwright's own `BrowserContextOptions.timezoneId`. */
  readonly timezoneId?: string;
  /** P129 Part 5 §3.4: pins the boot-time wall clock (Playwright's own `page.clock`) to a known
   *  instant — for a spec that needs a deterministic weekday (weekend hatching, Monday separators)
   *  rather than whatever day the suite happens to run on. Installed before the first navigation, so
   *  the app's own `new Date()`/`Date.now()` reads read this pinned instant from its very first
   *  render, then `resume()`s immediately: real timers (TanStack retries, `useTimeoutFn` resets,
   *  `useIntervalFn` ticks) keep advancing at 1x from that pinned start, rather than freezing —
   *  only "which real day is `today`" is pinned, not "does time pass". */
  readonly clockTime?: number | string | Date;
}

export interface UiFixturesConfig<TExtra extends object, TOptions extends UiFixturesOptions> {
  readonly distDir: string;
  /** Registers this launch's mocks (`page.route`/`addInitScript`) and returns `KiraApp`'s own
   *  extra fields beyond `window` — called, and must resolve, before `relaunch()`'s one
   *  navigation, same ordering every original per-app `relaunch()` already required. */
  readonly installMocks: (page: Page, options: TOptions | undefined) => Promise<TExtra>;
  /** The selector `relaunch()` waits for once the page has navigated. Both apps currently share
   *  `'[data-testid="status-bar"]'` (the default) — overridable for a future app whose shell
   *  renders a different landmark. */
  readonly readySelector?: string;
}

export type KiraApp<TExtra extends object> = { window: Page } & TExtra;

export type Relaunch<TExtra extends object, TOptions extends UiFixturesOptions> = (
  options?: TOptions,
) => Promise<KiraApp<TExtra>>;

interface KiraFixtures<TExtra extends object, TOptions extends UiFixturesOptions> {
  consoleErrors: string[];
  relaunch: Relaunch<TExtra, TOptions>;
  kira: KiraApp<TExtra>;
}

interface KiraWorkerFixtures {
  uiServer: UiServer;
}

export function createUiFixtures<
  TExtra extends object,
  TOptions extends UiFixturesOptions = UiFixturesOptions,
>(config: UiFixturesConfig<TExtra, TOptions>) {
  const readySelector = config.readySelector ?? '[data-testid="status-bar"]';

  return base.extend<KiraFixtures<TExtra, TOptions>, KiraWorkerFixtures>({
    uiServer: [
      // biome-ignore lint/correctness/noEmptyPattern: Playwright requires a literal destructuring pattern here, even with no fixture deps.
      async ({}, use) => {
        const server = await startServer(config.distDir);
        await use(server);
        await server.close();
      },
      { scope: 'worker' },
    ],

    // biome-ignore lint/correctness/noEmptyPattern: Playwright requires a literal destructuring pattern here, even with no fixture deps.
    consoleErrors: async ({}, use) => {
      await use([]);
    },

    relaunch: async ({ browser, uiServer, consoleErrors }, use) => {
      let current: Page | undefined;

      const launch = async (options?: TOptions): Promise<KiraApp<TExtra>> => {
        if (current) await current.close();
        const page = await browser.newPage({ timezoneId: options?.timezoneId });
        page.on('console', (msg) => {
          if (msg.type() === 'error') consoleErrors.push(msg.text());
        });
        await page.setViewportSize({ width: 1440, height: 960 });

        // Must land before the first navigation — same rule as installMocks below, and in the same
        // order every original per-app relaunch() already required for it.
        if (options?.clockTime !== undefined) {
          await page.clock.install({ time: options.clockTime });
          await page.clock.resume();
        }

        // Must land before the first navigation — every original per-app relaunch()'s own rule.
        const extra = await config.installMocks(page, options);

        await page.goto(uiServer.url);
        await page.waitForSelector(readySelector);

        current = page;
        return { window: page, ...extra } as KiraApp<TExtra>;
      };

      await use(launch);

      if (current) await current.close();
    },

    kira: async ({ relaunch }, use) => {
      await use(await relaunch());
    },
  });
}

export { expect } from '@playwright/test';
