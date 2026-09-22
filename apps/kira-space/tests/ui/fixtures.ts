import { resolve } from 'node:path';
import { test as base, type Page } from '@playwright/test';
import { startServer, type UiServer } from '@workbench/testing/ui/server';
import { mergeBootSnapshots } from './support/bootSnapshots';
import { type ControlMockHandle, installControlMocks } from './support/mockRuntime';
import type { ControlSnapshot } from './support/types';

// P103 Part 4 (closing audit, §10): tests/ui/support/server.ts hoisted to
// @workbench/testing/ui/server — see that file's own doc comment for why it now takes `distDir`.
const DIST_DIR = resolve(__dirname, '../../frontend/dist');

export interface KiraApp {
  window: Page;
  control: ControlMockHandle;
}

export interface RelaunchOptions {
  control?: readonly ControlSnapshot[];
  /** Playwright's own `BrowserContextOptions.timezoneId`. */
  timezoneId?: string;
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
 * Kira Studio's own `tests/ui/fixtures.ts`, ported — `relaunch()` means "open a fresh page against
 * the static build and mock the control-call wire protocol from scratch". No `stream`/`MockStreamHandle`
 * fixture here: that whole mechanism (mockStream.ts) is Studio's own bulk-data grid-page protocol
 * (`window._wails.streamFactory('data')`), which this app has no counterpart for — the one stream
 * this app's own repo-graph mount opens (`window._wails.streamFactory('git')`) is a different wire
 * entirely, mocked per-spec by `installGitStreamMock` (support/gitStreamMock.ts), not by this
 * fixture's own boot-time `relaunch()`.
 */
export const test = base.extend<KiraFixtures, KiraWorkerFixtures>({
  uiServer: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright requires a literal destructuring pattern here, even with no fixture deps.
    async ({}, use) => {
      const server = await startServer(DIST_DIR);
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
      const page = await browser.newPage({ timezoneId: options?.timezoneId });
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });
      await page.setViewportSize({ width: 1440, height: 960 });

      // Must land before the first navigation — the same ordering rule Kira Studio's own
      // fixtures.ts follows.
      const control = await installControlMocks(page, mergeBootSnapshots(options?.control ?? []));

      await page.goto(uiServer.url);
      await page.waitForSelector('[data-testid="status-bar"]');

      current = page;
      return { window: page, control };
    };

    await use(launch);

    if (current) await current.close();
  },

  kira: async ({ relaunch }, use) => {
    await use(await relaunch());
  },
});

export { expect } from '@playwright/test';
