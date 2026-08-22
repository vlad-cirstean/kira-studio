import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron, test as base, type ElectronApplication, type Page } from '@playwright/test';

const mainEntry = resolve(__dirname, '../../out/main/index.js');

export interface KiraApp {
  app: ElectronApplication;
  window: Page;
}

interface KiraFixtures {
  kiraHome: string;
  consoleErrors: string[];
  relaunch: () => Promise<KiraApp>;
  kira: KiraApp;
}

export const test = base.extend<KiraFixtures>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires a literal destructuring pattern here, even with no fixture deps.
  kiraHome: async ({}, use) => {
    const dir = await mkdtemp(join(tmpdir(), 'kira-ui-'));
    await use(dir);
    await rm(dir, { recursive: true, force: true });
  },

  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires a literal destructuring pattern here, even with no fixture deps.
  consoleErrors: async ({}, use) => {
    await use([]);
  },

  relaunch: async ({ kiraHome, consoleErrors }, use) => {
    // Non-negotiable per D10: a real ~/.kira-studio must never be touched by a test run.
    if (!kiraHome.startsWith(tmpdir())) {
      throw new Error(`KIRA_HOME fixture "${kiraHome}" is not under the OS tmpdir`);
    }

    let current: KiraApp | undefined;

    const launch = async (): Promise<KiraApp> => {
      if (current) await current.app.close();

      const app = await _electron.launch({
        args: [mainEntry],
        env: { ...process.env, KIRA_HOME: kiraHome, NODE_ENV: 'test' },
      });
      const window = await app.firstWindow();
      window.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });
      await window.waitForSelector('[data-testid="status-bar"]');

      current = { app, window };
      return current;
    };

    await use(launch);

    if (current) await current.app.close();
  },

  kira: async ({ relaunch }, use) => {
    await use(await relaunch());
  },
});

export { expect } from '@playwright/test';
