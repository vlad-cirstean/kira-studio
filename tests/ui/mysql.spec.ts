import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  DOCKER_UNAVAILABLE_MESSAGE,
  isDockerAvailable,
  type MysqlFixture,
  startMysql,
} from './support/mysql';
import { expandRow, findRow, openRowMenu } from './support/tree';

// The third SQL engine through the real UI, deliberately small (D31): its whole reason to exist
// is D17's dialect seam — a *Filter by this value* predicate must come back backtick-quoted, not
// double-quoted, which is exactly the failure mode invisible to `bun run test:db` (F22).
test.describe.configure({ timeout: 240_000 });

let mysql: MysqlFixture | null = null;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  if (!(await isDockerAvailable())) {
    test.skip(true, DOCKER_UNAVAILABLE_MESSAGE);
    return;
  }
  mysql = await startMysql();
});

test.afterAll(async () => {
  await mysql?.stop();
});

const DB_PATH = 'database:kira_test';
const ORDER_ITEMS_PATH = `${DB_PATH}/table:order_items`;
const FUNCTIONS_FOLDER_PATH = `${DB_PATH}#function`;

async function typeInto(
  view: ReturnType<Page['locator']>,
  page: Page,
  text: string,
): Promise<void> {
  await view.locator('.cm-content').click();
  await page.keyboard.type(text);
}

test('mysql — engine picker, connect, tree, filter-by-value quoting, console', async ({
  kira,
  consoleErrors,
}) => {
  test.setTimeout(240_000);
  if (!mysql) throw new Error('mysql fixture did not start');
  const { window: page } = kira;
  const cfg = mysql.config;

  // --- D18/D19: the engine picker shows a real MySQL tile, and picking it prefills the port ---
  await page.click('[data-testid="add-connection"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toBeVisible();
  const mysqlTile = page.locator('[data-testid="connection-kind-mysql"]');
  await expect(mysqlTile).toBeVisible();
  const markHtml = await mysqlTile.locator('svg').innerHTML();
  expect(markHtml.trim().length).toBeGreaterThan(0);
  await mysqlTile.click();
  await expect(page.locator('[data-testid="connection-port"]')).toHaveValue('3306');

  await page.fill('[data-testid="connection-name"]', 'Test MySQL');
  await page.fill('[data-testid="connection-host"]', cfg.host ?? '');
  await page.fill('[data-testid="connection-port"]', String(cfg.port ?? ''));
  await page.fill('[data-testid="connection-database"]', cfg.database ?? '');
  await page.fill('[data-testid="connection-username"]', cfg.username ?? '');
  await page.fill('[data-testid="connection-password"]', cfg.password ?? '');

  // fields mode has no sslmode control of its own (options only ever round-trips through a
  // URI's query string, ConnectionDialog.vue's setUri/setMode) — a stock MySQL 8.4 server's
  // caching_sha2_password requires a TLS (or public-key) exchange for this user's very first
  // authentication (mysql/support fixture's own D5/D26 comment), so switching to URI mode and
  // adding ?sslmode=require here is the only way this connection can actually succeed, mirroring
  // the fixture's own `options: { sslmode: 'require' }` config the db suite connects with.
  await page.click('[data-testid="mode-uri"]');
  const generatedUri = await page.inputValue('[data-testid="connection-uri"]');
  await page.fill('[data-testid="connection-uri"]', `${generatedUri}?sslmode=require`);

  await page.click('[data-testid="color-cyan"]');
  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);

  // --- D6: connecting shows the green dot and a MySQL 8.4 server version -------------------
  const connRow = page.locator('[data-testid="tree-row"][data-kind="connection"]').filter({
    hasText: 'Test MySQL',
  });
  await expect(connRow).toBeVisible();
  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-connect"]');
  const statusDot = connRow.locator('.status-dot');
  await expect(statusDot).toHaveAttribute('data-status', 'connected', { timeout: 10_000 });
  await expect(statusDot).toHaveAttribute('data-kira-tip', /^MySQL 8\.4\./);

  // --- D20: kira_test, its tables and a "Routines" folder — not "Functions" ------------------
  await expandRow(page, '');
  const dbRow = await expandRow(page, DB_PATH);
  await expect(dbRow).toHaveAttribute('data-kind', 'database');
  const orderItemsRow = await findRow(page, ORDER_ITEMS_PATH);
  await expect(orderItemsRow).toHaveAttribute('data-kind', 'table');
  const routinesFolder = await findRow(page, FUNCTIONS_FOLDER_PATH);
  await expect(routinesFolder).toBeVisible();
  await expect(routinesFolder).toContainText('Routines');

  // --- D17: the load-bearing assertion — Filter by this value must quote with backticks ------
  await (await findRow(page, ORDER_ITEMS_PATH)).dblclick();
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

  // --- D17's other half: the console tab is really in SQL mode, not plain text ----------------
  await openRowMenu(page, DB_PATH);
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
