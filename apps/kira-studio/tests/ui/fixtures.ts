import { test as base, type Page } from '@playwright/test';
import type { ControlSnapshot, PortSnapshot } from '../ipc/support/types';
import { mergeBootSnapshots } from './support/bootSnapshots';
import {
  type GitStreamEventSnapshot,
  type GitStreamRequestSnapshot,
  type GitStreamStreamSnapshot,
  installMockGitStream,
  type MockGitStreamHandle,
} from './support/mockGitStream';
import { type ControlMockHandle, installControlMocks } from './support/mockRuntime';
import { installMockStream, type MockStreamHandle } from './support/mockStream';
import { startServer, type UiServer } from './support/server';

export interface KiraApp {
  window: Page;
  control: ControlMockHandle;
  stream: MockStreamHandle;
  // v1.3 P1: the "git" stream's own mock handle — installed for every relaunch (composed with
  // 'engine', mockGitStreamBrowser.js's own doc comment on why), but only ever actually opened by
  // a spec that navigates into Git mode. tests/ui/git/*.spec.ts is where `gitStream` options are
  // ever passed; every other spec gets the harmless empty default.
  gitStream: MockGitStreamHandle;
}

export interface RelaunchOptions {
  control?: readonly ControlSnapshot[];
  stream?: readonly PortSnapshot[];
  gitStream?: {
    requests?: readonly GitStreamRequestSnapshot[];
    streams?: readonly GitStreamStreamSnapshot[];
    events?: readonly GitStreamEventSnapshot[];
  };
  /** Playwright's own `BrowserContextOptions.timezoneId` (e.g. `'America/New_York'`) — this
   *  sandbox's own system timezone is UTC (P57 M5 finding, porting cell-editor.spec.ts), which
   *  silently makes any "local time differs from UTC" assertion vacuously true-or-false depending
   *  on the host machine rather than the app's own behaviour, since `browser.newPage()` otherwise
   *  inherits the host's real zone. A spec that genuinely needs Local and UTC to differ should
   *  pass this rather than assume the host isn't UTC. */
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
      const page = await browser.newPage({ timezoneId: options?.timezoneId });
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
      // Installed after 'engine' (composition order, mockGitStreamBrowser.js's own doc comment) —
      // still before the one navigation below, same "before it" rule as the other two.
      const gitStream = await installMockGitStream(page, options?.gitStream ?? {});

      // P22 Pass B, C17 — SlickGrid is the ONLY grid engine now (DataGrid.vue/GridRow.vue and the
      // `__kiraGridEngine` flag this file used to set before boot are deleted — the user's own
      // call: "any issue will be fixed on slickgrid, no turning back"). DataView.vue mounts
      // SlickGridHost.vue unconditionally, so there is nothing left to select here.
      await page.goto(uiServer.url);
      await page.waitForSelector('[data-testid="status-bar"]');

      current = page;
      return { window: page, control, stream, gitStream };
    };

    await use(launch);

    if (current) await current.close();
  },

  kira: async ({ relaunch }, use) => {
    await use(await relaunch());
  },
});

export { expect } from '@playwright/test';
