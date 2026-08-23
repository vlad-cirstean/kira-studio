import { expect, test } from './fixtures';
import { uptimeMs } from './support/measure';

// P12's cold-start budgets (D8/D9/D10) — no Docker: session restore never opens a connection
// (§8.4, a restored tab renders "Reconnect & load" and nothing else until pressed), so the
// restored-session cold start is fully measurable against unreachable-host connections.
test.describe.configure({ timeout: 120_000 });

test('cold start — fresh home', async ({ relaunch, consoleErrors }) => {
  const wallStart = Date.now();
  const { app, window: page } = await relaunch();
  await page.waitForSelector('[data-testid="status-bar"]');
  await page.waitForSelector('[data-testid="project-panel"]');
  const wallMs = Date.now() - wallStart;
  const inAppMs = await uptimeMs(app);
  console.log(`startup.spec.ts fresh: wall=${wallMs}ms in-app uptime=${inAppMs.toFixed(0)}ms`);
  expect(inAppMs).toBeLessThanOrEqual(2500);
  expect(consoleErrors).toEqual([]);
});

test('cold start — restored session (5 connections, 10 tabs)', async ({
  relaunch,
  consoleErrors,
}) => {
  const { window: page } = await relaunch();

  const connectionIds: string[] = [];
  for (let i = 0; i < 5; i++) {
    const id = await page.evaluate(
      (i) =>
        window.kira
          .connectionsCreate({
            name: `Startup DB ${i}`,
            kind: 'postgres',
            color: 'grey',
            mode: 'fields',
            readOnly: false,
            // TEST-NET-3 (RFC 5737) — reserved, non-routable; session restore never dials out
            // (§8.4), so an unreachable host is deliberate, not a flake risk.
            host: '203.0.113.1',
            port: 5432,
            database: 'nope',
            username: 'nope',
            password: null,
            uri: null,
            options: {},
            preconnect: null,
          })
          .then((c) => c.id),
      i,
    );
    connectionIds.push(id);
  }

  const tabs = connectionIds.flatMap((connectionId, i) =>
    [0, 1].map((j) => ({
      id: `startup-tab-${i}-${j}`,
      connectionId,
      path: `database:db${i}/schema:app/table:t${j}`,
      order: i * 2 + j,
      active: i === 0 && j === 0,
      kind: 'data' as const,
      state: {
        pageSize: 100 as const,
        pageIndex: 0,
        filter: null,
        sort: null,
        projection: null,
        columnWidths: {},
        columnOrder: null,
        scrollTop: 0,
        scrollLeft: 0,
      },
    })),
  );
  await page.evaluate((tabs) => window.kira.tabsSave({ tabs }), tabs);
  // A direct tabsSave IPC call bypasses the renderer's own in-memory tabsState — and
  // before-quit's flush (src/main/index.ts) saves *that* state on close, which would silently
  // overwrite the rows just written above with the still-empty array the renderer booted with.
  // Reloading re-hydrates tabsState from the DB (main.ts's hydrateTabs()), so the flush on the
  // next close re-saves what's already there instead of clobbering it.
  await page.reload();
  await page.waitForSelector('[data-testid="status-bar"]');
  await expect(page.locator('[data-testid="tab"]')).toHaveCount(10, { timeout: 10_000 });

  const wallStart = Date.now();
  const { app: restoredApp, window: restored } = await relaunch();
  await restored.waitForSelector('[data-testid="status-bar"]');
  await restored.waitForSelector('[data-testid="project-panel"]');
  await expect(restored.locator('[data-testid="tab"]')).toHaveCount(10, { timeout: 10_000 });
  await expect(restored.locator('[data-testid="reconnect-panel"]')).toBeVisible();
  const wallMs = Date.now() - wallStart;
  const inAppMs = await uptimeMs(restoredApp);
  console.log(`startup.spec.ts restored: wall=${wallMs}ms in-app uptime=${inAppMs.toFixed(0)}ms`);
  expect(inAppMs).toBeLessThanOrEqual(3000);
  expect(consoleErrors).toEqual([]);
});
