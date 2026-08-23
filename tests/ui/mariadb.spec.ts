import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  DOCKER_UNAVAILABLE_MESSAGE,
  isDockerAvailable,
  type MariaFixture,
  startMariadb,
} from './support/mariadb';

// The second engine through the real UI, deliberately small (D27): if this passes and no
// renderer file has a MariaDB branch in it, the adapter-abstraction claim is proven.
test.describe.configure({ timeout: 240_000 });

let mariadb: MariaFixture | null = null;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  if (!(await isDockerAvailable())) {
    test.skip(true, DOCKER_UNAVAILABLE_MESSAGE);
    return;
  }
  mariadb = await startMariadb();
});

test.afterAll(async () => {
  await mariadb?.stop();
});

const DB_PATH = 'database:kira_test';
const ORDER_ITEMS_PATH = `${DB_PATH}/table:order_items`;
const ORDER_ITEMS_ID_COLUMN_PATH = `${ORDER_ITEMS_PATH}/column:id`;
const BIG_ROWS_PATH = `${DB_PATH}/table:big_rows`;

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

async function firstGutterNumber(page: Page): Promise<string> {
  const grid = page.locator('[data-testid="data-grid"]');
  await grid.evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.waitForTimeout(50);
  return (await page.locator('[data-testid="grid-gutter-cell"]').first().innerText()).trim();
}

test('mariadb — connect, tree, data tab, count, filter, cancel', async ({
  kira,
  consoleErrors,
}) => {
  test.setTimeout(240_000);
  if (!mariadb) throw new Error('mariadb fixture did not start');
  const { window: page } = kira;

  const cfg = mariadb.config;
  await page.evaluate(
    (cfg) =>
      window.kira.connectionsCreate({
        name: 'MariaDB',
        kind: 'mariadb',
        color: 'orange',
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
      }),
    {
      host: cfg.host,
      port: cfg.port,
      database: cfg.database,
      username: cfg.username,
      password: cfg.password,
    },
  );

  const connRow = page.locator('[data-testid="tree-row"][data-kind="connection"]');
  await expect(connRow).toBeVisible();
  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-connect"]');
  await expect(connRow.locator('.status-dot')).toHaveAttribute('data-status', 'connected', {
    timeout: 10_000,
  });

  // --- tree: database -> table -> columns, no schema level in between --------------------
  await expandRow(page, '');
  const dbRow = await expandRow(page, DB_PATH);
  await expect(dbRow).toHaveAttribute('data-kind', 'database');
  const orderItemsRow = await expandRow(page, ORDER_ITEMS_PATH);
  await expect(orderItemsRow).toHaveAttribute('data-kind', 'table');
  await expect(await findRow(page, ORDER_ITEMS_ID_COLUMN_PATH)).toBeVisible();

  await page.screenshot({ path: 'test-results/screenshots/mariadb.png' });

  // --- open a data tab, read a page, count, filter ----------------------------------------
  await (await findRow(page, ORDER_ITEMS_PATH)).dblclick();
  await expect(page.locator('[data-testid="data-grid"]')).toBeVisible();
  await expect(page.locator('[data-testid="grid-header-cell"][data-column="id"]')).toBeVisible();
  await expect.poll(() => firstGutterNumber(page), { timeout: 15_000 }).toBe('1');

  await page.click('[data-testid="toolbar-count"]');
  await expect(page.locator('[data-testid="toolbar-count"]')).toHaveAttribute('title', /3/, {
    timeout: 15_000,
  });

  await page.fill('[data-testid="filter-where-input"]', 'quantity > 1');
  await page.press('[data-testid="filter-where-input"]', 'Enter');
  await expect(page.locator('[data-testid="grid-row"]')).toHaveCount(2, { timeout: 10_000 });
  await page.fill('[data-testid="filter-where-input"]', '');
  await page.press('[data-testid="filter-where-input"]', 'Enter');

  // --- cancel a long read ------------------------------------------------------------------
  await (await findRow(page, BIG_ROWS_PATH)).dblclick();
  await expect(page.locator('[data-testid="data-grid"]')).toBeVisible();
  await page.click('[data-testid="page-size-10000"]');
  await expect.poll(() => firstGutterNumber(page), { timeout: 15_000 }).not.toBe('');
  // MariaDB's optimizer short-circuits `OR` per row — an `(SELECT SLEEP(2)) IS NULL OR id > 0`
  // filter (the Postgres approach, where an uncorrelated subquery is always hoisted into a
  // one-shot InitPlan) never even calls SLEEP() here, since `id > 0` alone already decides every
  // row. Gating the slow branch on a single, rare row (`id != 1`, false for exactly one row)
  // means SLEEP() is only reached — and only needs to run — once, giving this filtered read a
  // flat, deterministic ~2s cost overall.
  await page.fill('[data-testid="filter-where-input"]', 'id != 1 OR (SELECT SLEEP(2)) IS NOT NULL');
  await page.press('[data-testid="filter-where-input"]', 'Enter');
  await page.click('[data-testid="toolbar-stop"]');
  await expect
    .poll(
      async () => {
        const ops = await page.evaluate(() => window.kira.opsRecent({ limit: 200 }));
        return ops.find((o) => o.kind === 'read')?.status;
      },
      { timeout: 10_000 },
    )
    .toBe('cancelled');

  expect(consoleErrors).toEqual([]);
});
