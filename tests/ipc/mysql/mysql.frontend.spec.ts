import { expect, test } from '../../ui/fixtures';
import { connectionRow, expandRow, findRow, openRowMenu } from '../../ui/support/tree';
import { installControlMocks } from '../support/mockControl';
import { installMockPort } from '../support/mockPort';
import type { ControlSnapshot } from '../support/types';
import { controlSnapshots, portSnapshots } from './mysql.fixture';

// P50 §4.4 — mysql's frontend half, same shape as mariadb's (§4.2). The engine-picker/Add
// Connection dialog flow is left to tests/ui/connections.spec.ts (kept, unchanged, generic
// connection-dialog UI) — this spec starts from an already-listed connection.

interface TreeNodeLike {
  name: string;
  path: string;
  kind: string;
}

function nodePathByName(name: string): string {
  for (const snap of controlSnapshots as ControlSnapshot[]) {
    if (snap.channel !== 'kira:tree:children') continue;
    const nodes = (snap.response as { nodes?: TreeNodeLike[] } | undefined)?.nodes ?? [];
    const node = nodes.find((n) => n.name === name);
    if (node) return node.path;
  }
  throw new Error(`no captured tree node named ${name} in mysql.fixture.ts`);
}

const DB_PATH = nodePathByName('kira_test');
const ORDER_ITEMS_PATH = nodePathByName('order_items');

test('mysql (frontend, mocked IPC) — connect, tree, filter-by-value quoting, console', async ({
  kira,
  consoleErrors,
}) => {
  const { app, window: page } = kira;

  await installControlMocks(app, controlSnapshots);
  await page.reload();
  await page.waitForSelector('[data-testid="status-bar"]');
  const port = await installMockPort(page, portSnapshots);

  const connRow = connectionRow(page);
  await expect(connRow).toBeVisible();
  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-connect"]');
  const statusDot = connRow.locator('.status-dot');
  await expect(statusDot).toHaveAttribute('data-status', 'connected', { timeout: 10_000 });
  await expect(statusDot).toHaveAttribute('data-kira-tip', /^MySQL 8\.4\./);

  await expandRow(page, '');
  const dbRow = await expandRow(page, DB_PATH);
  await expect(dbRow).toHaveAttribute('data-kind', 'database');
  const orderItemsRow = await findRow(page, ORDER_ITEMS_PATH);
  await expect(orderItemsRow).toHaveAttribute('data-kind', 'table');
  // D20: the "Routines" folder heading is a frontend rendering decision over the real
  // function-kind nodes the fixture carries — the one part of this scenario the backend half
  // cannot assert (there is no backend "folder" node kind at all).
  const routinesFolder = page.locator('[data-testid="tree-row"]', { hasText: 'Routines' });
  await expect(routinesFolder).toBeVisible();

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
  // D17: the load-bearing assertion this whole adapter split exists for — backtick, not
  // double-quote.
  await expect(whereInput).toHaveValue(`\`id\` = '${idValue}'`);

  // D7: the read request the filter actually produced, not only what it rendered.
  const ops = await port.ops();
  const filteredRead = ops.find(
    (o) =>
      o.op === 'data:read' && (o.payload as { filter?: string }).filter === `\`id\` = '${idValue}'`,
  );
  expect(filteredRead).toBeTruthy();

  await whereInput.fill('');
  await whereInput.press('Enter');

  await openRowMenu(page, DB_PATH);
  await page.click('[data-testid="menu-item-open-console"]');
  const consoleView = page.locator('[data-testid="console-view"]');
  await expect(consoleView).toBeVisible();
  await consoleView.locator('.cm-content').click();
  await page.keyboard.type('SELECT 1;');
  await page.click('[data-testid="console-run-statement"]');
  const results = consoleView.locator('[data-testid="console-result-grid"]');
  await expect(results).toHaveCount(1);
  await expect(results.first()).toContainText('1');

  expect(consoleErrors).toEqual([]);
});
