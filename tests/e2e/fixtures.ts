import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron, test as base, type ElectronApplication, type Page } from '@playwright/test';

const mainEntry = resolve(__dirname, '../../out/main/index.js');

export interface KiraApp {
  app: ElectronApplication;
  window: Page;
}

interface RelaunchOptions {
  /** Overlaid onto the default launch env; a value of `undefined` deletes that key from the
   *  merged env instead of setting it (P25 D16 — this is how a scenario turns the Linux
   *  development secrets fallback off to exercise the Keychain-unavailable path). */
  env?: Record<string, string | undefined>;
}

interface KiraFixtures {
  kiraHome: string;
  consoleErrors: string[];
  relaunch: (options?: RelaunchOptions) => Promise<KiraApp>;
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

    const launch = async (options?: RelaunchOptions): Promise<KiraApp> => {
      if (current) await current.app.close();

      // KIRA_INSECURE_SECRETS is the Linux-only development fallback (P25 D13) that lets this
      // suite assert one observable secret-storage contract on both platforms instead of a
      // Linux-only degraded one; it's a no-op on darwin. `undefined` entries in the overlay
      // delete the key rather than set it, so a scenario can turn the fallback off entirely.
      const merged: Record<string, string | undefined> = {
        ...process.env,
        KIRA_HOME: kiraHome,
        NODE_ENV: 'test',
        KIRA_INSECURE_SECRETS: '1',
        ...options?.env,
      };
      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(merged)) {
        if (value !== undefined) env[key] = value;
      }

      const app = await _electron.launch({ args: [mainEntry], env });
      const window = await app.firstWindow();
      window.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });
      await window.waitForSelector('[data-testid="status-bar"]');
      // A fresh profile has no persisted window bounds, so Electron falls back to its own
      // built-in default (800x600) — which happens to equal this app's declared minimum
      // (window.ts's minWidth/minHeight). At that size, opening the cell editor panel (default
      // height 180px) can squeeze the grid's own viewport down to a few px, well under one row +
      // header — not a realistic size for these interaction tests to run at. Resize to something
      // closer to a typical user's window before any test touches the UI.
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setSize(1440, 960);
      });

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
