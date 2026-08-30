import { test as base, type Page } from '@playwright/test';
import type { ControlSnapshot, PortSnapshot } from '../ipc/support/types';
import { mergeBootSnapshots } from './support/bootSnapshots';
import { type ControlMockHandle, installControlMocks } from './support/mockRuntime';
import { installMockStream, type MockStreamHandle } from './support/mockStream';
import { startServer, type UiServer } from './support/server';

export interface KiraApp {
  window: Page;
  control: ControlMockHandle;
  stream: MockStreamHandle;
}

export interface RelaunchOptions {
  control?: readonly ControlSnapshot[];
  stream?: readonly PortSnapshot[];
}

export type Relaunch = (options?: RelaunchOptions) => Promise<KiraApp>;

interface KiraFixtures {
  consoleErrors: string[];
  relaunch: Relaunch;
  kira: KiraApp;
}

interface KiraWorkerFixtures {
  uiServer: UiServer;
}

/**
 * The `tests/ui/` counterpart to `tests/e2e/fixtures.ts` (P57 D16). There is no more Electron
 * process, no `KIRA_HOME`, and no real backend of any kind — `relaunch()` here means "open a fresh
 * page against the static build and mock both wire protocols from scratch", not "restart a real
 * app process". A spec that genuinely needs a second `relaunch()` to assert something survives a
 * restart is asserting something this tier cannot prove any more (there is nothing to persist to)
 * — see the per-spec porting notes for where that changed the scenario itself, not just its
 * mechanics.
 */
export const test = base.extend<KiraFixtures, KiraWorkerFixtures>({
  uiServer: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright requires a literal destructuring pattern here, even with no fixture deps.
    async ({}, use) => {
      const server = await startServer();
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

    const launch = async (options?: RelaunchOptions): Promise<KiraApp> => {
      if (current) await current.close();
      const page = await browser.newPage();
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });
      await page.setViewportSize({ width: 1440, height: 960 });

      // Both installs are page.route/addInitScript registrations — they must land before the
      // first navigation, exactly like tests/ipc frontend specs' own `installControlMocks` +
      // `installMockPort` ordering (mockPort.ts's own comment: "must be called after the last
      // reload" — here there is exactly one navigation, so "before it" is the only rule).
      const control = await installControlMocks(page, mergeBootSnapshots(options?.control ?? []));
      const stream = await installMockStream(page, options?.stream ?? []);

      await page.goto(uiServer.url);
      await page.waitForSelector('[data-testid="status-bar"]');

      current = page;
      return { window: page, control, stream };
    };

    await use(launch);

    if (current) await current.close();
  },

  kira: async ({ relaunch }, use) => {
    await use(await relaunch());
  },
});

export { expect } from '@playwright/test';
