import { test as base } from '@playwright/test';

// 2026-09-22: the day the committed ADE fixtures are anchored to.
const FIXED_NOW = 1_790_070_000_000;

import { type MobileServer, startMobileServer } from './support/mockServer';

// `server` is the scripted phone backend (one per worker, reset per test); `app` opens the phone
// app against it. A test sets `server.state.auth = 'ok'` before `app()` to start paired.
interface Fixtures {
  app: () => Promise<void>;
}
interface WorkerFixtures {
  server: MobileServer;
}

export const test = base.extend<Fixtures, WorkerFixtures>({
  server: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright requires a literal destructuring pattern here, even with no fixture deps.
    async ({}, use) => {
      const server = await startMobileServer();
      await use(server);
      await server.close();
    },
    { scope: 'worker' },
  ],
  app: async ({ page, server }, use) => {
    server.reset();
    await use(async () => {
      // Pins the wall clock so the plan's day groups match the fixtures; time keeps running.
      await page.clock.install({ time: FIXED_NOW });
      await page.clock.resume();
      await page.goto(server.url);
    });
  },
});

export { expect } from '@playwright/test';
