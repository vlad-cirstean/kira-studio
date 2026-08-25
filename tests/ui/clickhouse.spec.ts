import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  type ClickHouseFixture,
  DOCKER_UNAVAILABLE_MESSAGE,
  isDockerAvailable,
  startClickHouse,
} from './support/clickhouse';
import { expandRow, findRow, openRowMenu } from './support/tree';

// P36 D37: a small, deliberate subset of tests/ui/mysql.spec.ts — Docker-gated like every
// engine's UI spec except SQLite's own unconditional one (P35 D35). Its two load-bearing
// assertions are the backtick-quoted Filter by this value (D29) and the disabled − row button
// with an engine-specific tooltip (D31/D26) — both are seams where a missing branch fails
// silently rather than loudly.
test.describe.configure({ timeout: 240_000 });

let clickhouse: ClickHouseFixture | null = null;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  if (!(await isDockerAvailable())) {
    test.skip(true, DOCKER_UNAVAILABLE_MESSAGE);
    return;
  }
  clickhouse = await startClickHouse();
});

test.afterAll(async () => {
  await clickhouse?.stop();
});

async function typeInto(
  view: ReturnType<Page['locator']>,
  page: Page,
  text: string,
): Promise<void> {
  await view.locator('.cm-content').click();
  await page.keyboard.type(text);
}

test('clickhouse — engine picker, connect, tree, filter-by-value quoting, delete gating, definition, console', async ({
  kira,
  consoleErrors,
}) => {
  test.setTimeout(240_000);
  if (!clickhouse) throw new Error('clickhouse fixture did not start');
  const { window: page } = kira;
  const cfg = clickhouse.config;
  const dbPath = `database:${clickhouse.database}`;
  const orderItemsPath = `${dbPath}/table:order_items`;
  const viewsFolderPath = `${dbPath}#view`;
  const matviewsFolderPath = `${dbPath}#matview`;

  // --- 1. the engine picker shows a real ClickHouse tile, port prefilled to 8123 (D10) --------
  await page.click('[data-testid="add-connection"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toBeVisible();
  const clickhouseTile = page.locator('[data-testid="connection-kind-clickhouse"]');
  await expect(clickhouseTile).toBeVisible();
  const markHtml = await clickhouseTile.locator('svg').innerHTML();
  expect(markHtml.trim().length).toBeGreaterThan(0);
  await clickhouseTile.click();
  await expect(page.locator('[data-testid="connection-port"]')).toHaveValue('8123');

  await page.fill('[data-testid="connection-name"]', 'Test ClickHouse');
  await page.fill('[data-testid="connection-host"]', cfg.host ?? '');
  await page.fill('[data-testid="connection-port"]', String(cfg.port ?? ''));
  await page.fill('[data-testid="connection-database"]', cfg.database ?? '');
  await page.fill('[data-testid="connection-username"]', cfg.username ?? '');
  await page.fill('[data-testid="connection-password"]', cfg.password ?? '');
  await page.click('[data-testid="color-orange"]');
  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);

  // --- 2. connecting shows the green dot and a ClickHouse 26.x server version ------------------
  const connRow = page.locator('[data-testid="tree-row"][data-kind="connection"]').filter({
    hasText: 'Test ClickHouse',
  });
  await expect(connRow).toBeVisible();
  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-connect"]');
  const statusDot = connRow.locator('.status-dot');
  await expect(statusDot).toHaveAttribute('data-status', 'connected', { timeout: 10_000 });
  await expect(statusDot).toHaveAttribute('data-kira-tip', /^ClickHouse 2\d\./);

  // --- 3. the seeded database, tables ungrouped, Views/Materialized views folders, no ----------
  //        INFORMATION_SCHEMA node (D15) ---------------------------------------------------------
  await expandRow(page, '');
  const dbRow = await expandRow(page, dbPath);
  await expect(dbRow).toHaveAttribute('data-kind', 'database');
  const orderItemsRow = await findRow(page, orderItemsPath);
  await expect(orderItemsRow).toHaveAttribute('data-kind', 'table');
  const viewsFolder = await findRow(page, viewsFolderPath);
  await expect(viewsFolder).toBeVisible();
  await expect(viewsFolder).toContainText('Views');
  const matviewsFolder = await findRow(page, matviewsFolderPath);
  await expect(matviewsFolder).toBeVisible();
  await expect(matviewsFolder).toContainText('Materialized views');
  await expect(
    page.locator('[data-testid="tree-row"]').filter({ hasText: 'INFORMATION_SCHEMA' }),
  ).toHaveCount(0);

  // --- 4. Filter by this value: backtick-quoted, and it really narrows the grid (D29) -----------
  await (await findRow(page, orderItemsPath)).dblclick();
  await expect(page.locator('[data-testid="data-grid"]')).toBeVisible();
  await expect(page.locator('[data-testid="grid-header-cell"][data-column="id"]')).toBeVisible();

  const idCell = page.locator('[data-testid="grid-cell"][data-row="0"][data-column="id"]');
  await expect(idCell).toBeVisible();
  const idValue = (await idCell.innerText()).trim();
  await idCell.click({ button: 'right' });
  await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();
  await page.click('[data-testid="menu-item-filter-by-value"]');
  await expect(page.locator('[data-testid="grid-row"]')).toHaveCount(1, { timeout: 10_000 });
  const whereInput = page.locator('[data-testid="filter-where-input"]');
  await expect(whereInput).toHaveValue(`\`id\` = '${idValue}'`);
  await whereInput.fill('');
  await whereInput.press('Enter');

  // --- 5. + row is enabled; − row is disabled with an engine-specific tooltip; double-clicking --
  //        a cell does not start an inline edit (D31/D26) ---------------------------------------
  const addRowButton = page.locator('[data-testid="toolbar-add-row"]');
  await expect(addRowButton).toBeEnabled();
  const deleteRowButton = page.locator('[data-testid="toolbar-delete-row"]');
  await expect(deleteRowButton).toBeDisabled();
  await expect(deleteRowButton).toHaveAttribute('data-kira-tip', /does not support deleting rows/);

  await idCell.dblclick();
  await expect(page.locator('[data-testid="grid-cell-input"]')).toHaveCount(0);

  // --- 6. the definition tab's Table properties section, and no PK badge anywhere (D18/D22) -----
  await openRowMenu(page, orderItemsPath);
  await page.click('[data-testid="menu-item-open-definition"]');
  const definitionView = page.locator('[data-testid="definition-view"]');
  await expect(definitionView).toBeVisible();
  const tableSection = page.locator(
    '[data-testid="definition-properties"][data-title="Table properties"]',
  );
  await expect(tableSection).toBeVisible();
  await expect(tableSection).toContainText('MergeTree');
  await expect(tableSection).toContainText('Sorting key');
  await expect(page.locator('.header-key', { hasText: 'PK' })).toHaveCount(0);

  // --- 7. the console tab is really in SQL mode, and runs a statement (D30) ---------------------
  await openRowMenu(page, dbPath);
  await page.click('[data-testid="menu-item-open-console"]');
  const consoleView = page.locator('[data-testid="console-view"]');
  await expect(consoleView).toBeVisible();
  await typeInto(consoleView, page, 'SELECT 1;');
  await page.click('[data-testid="console-run-statement"]');
  const results = consoleView.locator('[data-testid="console-result-grid"]');
  await expect(results).toHaveCount(1);
  await expect(results.first()).toContainText('1');

  expect(consoleErrors).toEqual([]);
});
