import type { Locator, Page } from '@playwright/test';
import type { ConnectionColor } from '@shared/domain/connection';
import { expect, test } from './fixtures';
import {
  DOCKER_UNAVAILABLE_MESSAGE,
  isDockerAvailable,
  type PgFixture,
  startPostgres,
} from './support/pg';

// P13's own regression spec for its leak sweep (F4-F7, F19, F20). One Postgres container, per
// the per-spec convention every other tests/ui/*.spec.ts follows.
test.describe.configure({ timeout: 600_000 });

let pg: PgFixture | null = null;

test.beforeAll(async () => {
  test.setTimeout(600_000);
  if (!(await isDockerAvailable())) {
    test.skip(true, DOCKER_UNAVAILABLE_MESSAGE);
    return;
  }
  pg = await startPostgres();
});

test.afterAll(async () => {
  await pg?.stop();
});

const DB_PATH = 'database:kira_test';
const APP_PATH = `${DB_PATH}/schema:app`;
const ORDER_ITEMS_PATH = `${APP_PATH}/table:order_items`;

function treeContainer(page: Page): Locator {
  return page.locator('[data-testid="tree-background"] .virtual-list');
}

async function findRow(page: Page, path: string): Promise<Locator> {
  const container = treeContainer(page);
  const target = page.locator(`[data-testid="tree-row"][data-path="${path}"]`);
  await container.evaluate((el) => {
    el.scrollTop = 0;
  });
  for (let i = 0; i < 80; i++) {
    if ((await target.count()) > 0) return target;
    const atBottom = await container.evaluate(
      (el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1,
    );
    if (atBottom) break;
    await container.evaluate((el) => {
      el.scrollTop += Math.max(200, el.clientHeight);
    });
    await page.waitForTimeout(30);
  }
  return target;
}

async function expandRow(page: Page, path: string): Promise<Locator> {
  const row = await findRow(page, path);
  await expect(row).toBeVisible();
  await row.locator('.twisty').click();
  await expect(row.locator('.twisty .spin')).toHaveCount(0, { timeout: 15_000 });
  return row;
}

async function openRowMenu(page: Page, path: string): Promise<void> {
  const row = await findRow(page, path);
  await row.click({ button: 'right' });
  await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();
}

function connectionRootRow(page: Page, name: string): Locator {
  return page.locator('[data-testid="tree-row"][data-kind="connection"]').filter({ hasText: name });
}

async function createConnection(
  page: Page,
  cfg: {
    host: string | null;
    port: number | null;
    database: string | null;
    username: string | null;
    password: string | null;
  },
  opts: { name: string; color: ConnectionColor },
): Promise<string> {
  return page.evaluate(
    ({ cfg, opts }) =>
      window.kira
        .connectionsCreate({
          name: opts.name,
          kind: 'postgres',
          color: opts.color,
          mode: 'fields',
          readOnly: false,
          host: cfg.host,
          port: cfg.port,
          database: cfg.database,
          username: cfg.username,
          password: cfg.password,
          uri: null,
          options: {},
          preconnect: null,
          preconnectSidecar: false,
        })
        .then((c) => c.id),
    { cfg, opts },
  );
}

async function connectAndExpand(page: Page, name: string): Promise<void> {
  const root = connectionRootRow(page, name);
  await expect(root).toBeVisible();
  await root.click({ button: 'right' });
  await page.click('[data-testid="menu-item-connect"]');
  await expect(root.locator('.status-dot')).toHaveAttribute('data-status', 'connected', {
    timeout: 10_000,
  });
  await root.locator('.twisty').click();
  await expandRow(page, DB_PATH);
  await expandRow(page, APP_PATH);
}

async function openConsoleFromMenu(page: Page, path: string): Promise<void> {
  await openRowMenu(page, path);
  await page.click('[data-testid="menu-item-open-console"]');
}

async function openDefinitionFromMenu(page: Page, path: string): Promise<void> {
  await openRowMenu(page, path);
  await page.click('[data-testid="menu-item-open-definition"]');
}

async function typeInto(view: Locator, page: Page, text: string): Promise<void> {
  await view.locator('.cm-content').click();
  await page.keyboard.type(text);
}

async function retainedBytes(page: Page): Promise<number> {
  return page.evaluate(() => window.__kiraRetainedBytes?.() ?? -1);
}

async function waitForGrid(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="data-grid"]')).toBeVisible();
  await expect
    .poll(async () => page.locator('[data-testid="grid-gutter-cell"]').count(), { timeout: 15_000 })
    .toBeGreaterThan(0);
}

async function closeAllTabs(page: Page): Promise<void> {
  // Same race openRowMenu() guards against, but against the tab strip's own scroll: the active
  // tab auto-scrolls into view (TabStrip.vue), which can leave the first (leftmost) tab off-
  // screen — settle any pending scroll before the right-click's own actionability scroll can
  // deliver its 'scroll' event late, right after the menu opens.
  const firstTab = page.locator('[data-testid="tab"]').first();
  await firstTab.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await firstTab.click({ button: 'right' });
  await page.click('[data-testid="menu-item-close-all"]');
  await expect(page.locator('[data-testid="tab"]')).toHaveCount(0);
}

test('leak sweep — tab/store symmetry, connection delete, L3 bound, cache-clear hit rate reset', async ({
  relaunch,
}) => {
  test.setTimeout(600_000);
  if (!pg) throw new Error('postgres fixture did not start');
  let { window: page } = await relaunch();

  const cfg = {
    host: pg.config.host,
    port: pg.config.port,
    database: pg.config.database,
    username: pg.config.username,
    password: pg.config.password,
  };

  const connAId = await createConnection(page, cfg, { name: 'Leaks A', color: 'blue' });
  await connectAndExpand(page, 'Leaks A');

  // --- scenario 1: tab open/close symmetry across all five page stores (F4, F5, D4, D5) -------
  // A data tab and a console tab (with a large result set) both retain bytes in one of the five
  // stores this file's own `__kiraRetainedBytes` sums; a definition tab retains none of them but must
  // still close cleanly alongside the other two.
  const baseline1 = await retainedBytes(page);

  await (await findRow(page, ORDER_ITEMS_PATH)).dblclick();
  await waitForGrid(page);

  await openConsoleFromMenu(page, ORDER_ITEMS_PATH);
  const consoleView = page.locator('[data-testid="console-view"]');
  await expect(consoleView).toBeVisible();
  await typeInto(consoleView, page, 'SELECT * FROM generate_series(1, 5000) AS n;');
  await page.click('[data-testid="console-run-all"]');
  await expect(consoleView.locator('[data-testid="console-result-grid"]')).toHaveCount(1);

  await openDefinitionFromMenu(page, ORDER_ITEMS_PATH);
  await expect(page.locator('[data-testid="definition-view"]')).toBeVisible();

  expect(await retainedBytes(page)).toBeGreaterThan(baseline1);

  await closeAllTabs(page);
  expect(await retainedBytes(page)).toBe(baseline1);

  // --- scenario 2: runtime records are released (F4) -------------------------------------------
  const baseline2 = await retainedBytes(page);
  for (let i = 0; i < 20; i++) {
    await openRowMenu(page, ORDER_ITEMS_PATH);
    await page.click('[data-testid="menu-item-open-data-new-tab"]');
    await waitForGrid(page);
  }
  await expect(page.locator('[data-testid="tab"]')).toHaveCount(20);
  await closeAllTabs(page);
  expect(await retainedBytes(page)).toBe(baseline2);

  // A freshly re-opened tab starts from a default runtime: no stale count, nothing counted yet.
  await (await findRow(page, ORDER_ITEMS_PATH)).dblclick();
  await waitForGrid(page);
  const freshCountButton = page.locator('[data-testid="toolbar-count"]');
  await expect(freshCountButton).not.toHaveClass(/stale/);
  // Icon-only button — the number lives in its title tooltip, not visible text.
  expect(await freshCountButton.getAttribute('data-kira-tip')).toBe('Count all rows');
  await closeAllTabs(page);

  // --- scenario 3: deleting a connection closes its tabs, purges the tree, and leaves
  // persistence working for the connection that survives (F6/D6, F7/D7) -----------------------
  await (await findRow(page, ORDER_ITEMS_PATH)).dblclick();
  await waitForGrid(page);
  await openRowMenu(page, ORDER_ITEMS_PATH);
  await page.click('[data-testid="menu-item-open-data-new-tab"]');
  await expect(page.locator('[data-testid="tab"]')).toHaveCount(2);

  // Collapse A's own root before B exists — A's descendant rows share the exact same `data-path`
  // values B will render, and findRow/expandRow match on `data-path` alone (tabs.spec.ts's own
  // convention, for the identical reason).
  await connectionRootRow(page, 'Leaks A').locator('.twisty').click();

  const connBId = await createConnection(page, cfg, { name: 'Leaks B', color: 'teal' });
  await connectAndExpand(page, 'Leaks B');
  await (await findRow(page, ORDER_ITEMS_PATH)).dblclick();
  await expect(page.locator('[data-testid="tab"]')).toHaveCount(3);
  const bTab = page.locator('[data-testid="tab"][data-active="true"]');
  const bTabId = (await bTab.getAttribute('data-tab-id')) as string;

  expect(await page.evaluate(() => window.__kiraTreeConnectionIds?.())).toContain(connAId);

  page.once('dialog', (dialog) => dialog.accept());
  await connectionRootRow(page, 'Leaks A').click({ button: 'right' });
  await page.click('[data-testid="menu-item-delete"]');
  await expect(connectionRootRow(page, 'Leaks A')).toHaveCount(0, { timeout: 10_000 });

  // A's two tabs are gone; B's tab is the only one left.
  await expect(page.locator('[data-testid="tab"]')).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator(`[data-testid="tab"][data-tab-id="${bTabId}"]`)).toBeVisible();

  // The tree store no longer holds any state keyed by A's now-deleted connection id (F6/D6).
  expect(await page.evaluate(() => window.__kiraTreeConnectionIds?.())).not.toContain(connAId);

  // Persistence keeps working for B: change its tab state, relaunch, and it survives. Before
  // D7, `replaceTabs`'s INSERT re-inserted a row bearing A's now-nonexistent connection_id and
  // every subsequent save threw — silently killing persistence for the rest of the session.
  await page.click('[data-testid="page-size-1000"]');
  await expect(page.locator('[data-testid="page-size-1000"]')).toHaveClass(/on/);
  await page.waitForTimeout(300); // state/tabs.ts's debounced save

  ({ window: page } = await relaunch());
  const restoredTab = page.locator(`[data-testid="tab"][data-tab-id="${bTabId}"]`);
  await expect(restoredTab).toBeVisible({ timeout: 10_000 });
  await restoredTab.click();
  await expect(page.locator('[data-testid="reconnect-panel"]')).toBeVisible();
  await page.click('[data-testid="reconnect-load"]');
  await waitForGrid(page);
  await expect(page.locator('[data-testid="page-size-1000"]')).toHaveClass(/on/);

  // --- scenario 4: L3 is bounded (F19, D19) -----------------------------------------------------
  // Drive many more distinct {path, filter} combinations than D19's ~2 000-entry budget could
  // ever hold, and assert the map stops growing at the budget instead of tracking the request
  // count — the failure this replaces was an unbounded `Map` (docs/v1/PERF.md §4 item 1).
  const COMBOS = 2500;
  const CONCURRENCY = 25;
  for (let start = 0; start < COMBOS; start += CONCURRENCY) {
    const batch = Array.from(
      { length: Math.min(CONCURRENCY, COMBOS - start) },
      (_, j) => start + j,
    );
    await Promise.all(
      batch.map((i) =>
        page.evaluate(
          ({ connectionId, path, i }) =>
            window.__kiraCount?.({
              opId: crypto.randomUUID(),
              tabId: null,
              connectionId,
              path,
              filter: `(1=1) OR (0=${i})`,
            }),
          { connectionId: connBId, path: ORDER_ITEMS_PATH, i },
        ),
      ),
    );
  }
  const statsAfterDrive = await page.evaluate(() => window.__kiraCacheStats?.());
  expect(statsAfterDrive?.l3Entries ?? 0).toBeGreaterThan(0);
  // Strictly below the number of distinct requests issued — proves eviction happened.
  expect(statsAfterDrive?.l3Entries ?? Number.POSITIVE_INFINITY).toBeLessThan(COMBOS);
  // Within D19's ~2 048-entry budget (256 KiB / 128 B), with a little slack.
  expect(statsAfterDrive?.l3Entries ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(2100);

  // --- scenario 5: clearing the cache resets the hit rate (F20, D20) ---------------------------
  // Revisit an already-fetched page: guarantees at least one L2 hit to report a real rate.
  await page.click('[data-testid="page-size-100"]');
  await waitForGrid(page);
  await page.click('[data-testid="page-size-1000"]');
  await waitForGrid(page);
  await page.click('[data-testid="page-size-100"]');
  await waitForGrid(page);

  await page.click('[data-testid="open-settings"]');
  await page.click('[data-testid="settings-section-Cache"]');
  const hitRateField = page
    .locator('.section-pane .field', { hasText: 'Hit rate' })
    .locator('input');
  const hitRateBefore = (await hitRateField.inputValue()).trim();
  expect(hitRateBefore).not.toBe('—');

  await page.click('[data-testid="settings-clear-caches"]');
  await expect(hitRateField).toHaveValue('—', { timeout: 10_000 });
  await page.click('[data-testid="settings-close"]');
});
