import type { Locator, Page } from '@playwright/test';
import type { ConnectionColor } from '@shared/domain/connection';
import { expect, test } from './fixtures';
import {
  DOCKER_UNAVAILABLE_MESSAGE,
  isDockerAvailable,
  type PgFixture,
  startPostgres,
} from './support/pg';
import { expandRow, findRow, openRowMenu } from './support/tree';

test.describe.configure({ timeout: 240_000 });

let pg: PgFixture | null = null;

test.beforeAll(async () => {
  test.setTimeout(240_000);
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

async function menuItemIds(page: Page): Promise<string[]> {
  const menu = page.locator('[data-testid="context-menu"]');
  return menu
    .locator(':scope > div')
    .evaluateAll((els) =>
      els.map((el) =>
        el.classList.contains('p-sep')
          ? '--separator--'
          : (el.getAttribute('data-testid') ?? '').replace('menu-item-', ''),
      ),
    );
}

function tabLocator(page: Page, tabId: string): Locator {
  return page.locator(`[data-testid="tab"][data-tab-id="${tabId}"]`);
}

async function createConnection(page: Page, name: string, color: ConnectionColor): Promise<string> {
  if (!pg) throw new Error('postgres fixture did not start');
  return page.evaluate(
    ({ cfg, name, color }) =>
      window.kira
        .connectionsCreate({
          name,
          kind: 'postgres',
          color,
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
    {
      cfg: {
        host: pg.config.host,
        port: pg.config.port,
        database: pg.config.database,
        username: pg.config.username,
        password: pg.config.password,
      },
      name,
      color,
    },
  );
}

async function connectAndOpenOrderItems(page: Page): Promise<void> {
  const connRow = page.locator('[data-testid="tree-row"][data-kind="connection"]');
  await expect(connRow).toBeVisible();
  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-connect"]');
  await expect(connRow.locator('.status-dot')).toHaveAttribute('data-status', 'connected', {
    timeout: 10_000,
  });
  await expandRow(page, '');
  await expandRow(page, DB_PATH);
  await expandRow(page, APP_PATH);
}

test('tabs — independent state, context menu, colours, session restore', async ({
  kira,
  relaunch,
  consoleErrors,
}) => {
  test.setTimeout(240_000);
  if (!pg) throw new Error('postgres fixture did not start');
  const { window: page } = kira;

  await createConnection(page, 'Tabs DB', 'blue');
  await connectAndOpenOrderItems(page);

  // --- open the same table twice: independent state (§8.4, §9.2's own example) -----------
  const orderItemsRow = await findRow(page, ORDER_ITEMS_PATH);
  await orderItemsRow.dblclick(); // tab 1

  await openRowMenu(page, ORDER_ITEMS_PATH);
  await page.click('[data-testid="menu-item-open-data-new-tab"]'); // tab 2, now active

  const tabs = page.locator('[data-testid="tab"]');
  await expect(tabs).toHaveCount(2);
  const tab1Id = await tabs.nth(0).getAttribute('data-tab-id');
  const tab2Id = await tabs.nth(1).getAttribute('data-tab-id');
  if (!tab1Id || !tab2Id) throw new Error('expected two tab ids');

  // tab 2 is active: page it to 5 and change its page size.
  await expect(page.locator('[data-testid="data-grid"]')).toBeVisible();
  await page.fill('[data-testid="pager-page-input"]', '5');
  await page.press('[data-testid="pager-page-input"]', 'Tab');
  await page.click('[data-testid="page-size-1000"]');
  await expect(page.locator('[data-testid="page-size-1000"]')).toHaveClass(/on/);

  // Switch to tab 1: untouched (page 1, page size 100).
  await tabLocator(page, tab1Id).click();
  await expect(page.locator('[data-testid="page-size-100"]')).toHaveClass(/on/);
  await expect(page.locator('[data-testid="pager-page-input"]')).toHaveValue('1');

  await page.screenshot({ path: 'test-results/screenshots/tabs.png' });

  // --- tab context menu: exact item id list, then exercise each action --------------------
  await tabLocator(page, tab1Id).click({ button: 'right' });
  await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();
  expect(await menuItemIds(page)).toEqual([
    'close',
    'close-others',
    'close-to-the-right',
    'close-all',
    '--separator--',
    'duplicate-tab',
    'copy-name',
    'reveal-in-project-panel',
  ]);
  await page.keyboard.press('Escape');

  // Duplicate tab 1: a third tab appears, sharing tab 1's target but fresh state.
  await tabLocator(page, tab1Id).click({ button: 'right' });
  await page.click('[data-testid="menu-item-duplicate-tab"]');
  await expect(tabs).toHaveCount(3);
  const tab3Id = await tabs.nth(2).getAttribute('data-tab-id');
  if (!tab3Id) throw new Error('expected a third tab id');
  await expect(page.locator('[data-testid="pager-page-input"]')).toHaveValue('1');

  // Reveal in project panel: collapse the tree, then assert the action re-expands and selects
  // the originating row.
  await (await findRow(page, '')).locator('.twisty').click();
  await tabLocator(page, tab3Id).click({ button: 'right' });
  await page.click('[data-testid="menu-item-reveal-in-project-panel"]');
  await expect(await findRow(page, ORDER_ITEMS_PATH)).toHaveClass(/selected/, { timeout: 10_000 });

  // Close others: only tab 3 (the one right-clicked) survives.
  await tabLocator(page, tab3Id).click({ button: 'right' });
  await page.click('[data-testid="menu-item-close-others"]');
  await expect(tabs).toHaveCount(1);
  await expect(tabLocator(page, tab3Id)).toBeVisible();

  // Rebuild two tabs to exercise close-to-the-right and close-all.
  const orderItemsRowAgain = await findRow(page, ORDER_ITEMS_PATH);
  await orderItemsRowAgain.dblclick(); // reuses/activates the same-target tab (tab 3)
  await openRowMenu(page, ORDER_ITEMS_PATH);
  await page.click('[data-testid="menu-item-open-data-new-tab"]');
  await expect(tabs).toHaveCount(2);
  await tabs.first().click({ button: 'right' });
  await page.click('[data-testid="menu-item-close-to-the-right"]');
  await expect(tabs).toHaveCount(1);

  await tabs.first().click({ button: 'right' });
  await page.click('[data-testid="menu-item-close-all"]');
  await expect(tabs).toHaveCount(0);
  await expect(page.locator('[data-testid="tab-strip-empty"]')).toBeVisible();
  await expect(page.locator('[data-testid="main-view"]')).toContainText('Kira Studio');

  // --- colours: the tab and toolbar band both carry the connection colour token -----------
  await (await findRow(page, ORDER_ITEMS_PATH)).dblclick();
  const tab = page.locator('[data-testid="tab"]');
  await expect(tab).toHaveAttribute('data-color', 'blue');
  await expect(tab).toHaveAttribute('style', /--kira-conn-blue/);
  await expect(page.locator('.toolbar-band')).toHaveAttribute('style', /--kira-conn-blue/);

  await openRowMenu(page, '');
  await page.hover('[data-testid="menu-item-color"]');
  await expect(page.locator('[data-testid="context-submenu"]')).toBeVisible();
  await page.click('[data-testid="menu-item-color-magenta"]');
  await expect(tab).toHaveAttribute('data-color', 'magenta');
  await expect(tab).toHaveAttribute('style', /--kira-conn-magenta/);
  await expect(page.locator('.toolbar-band')).toHaveAttribute('style', /--kira-conn-magenta/);

  // --- session restore: three tabs across two connections ---------------------------------
  // tab A already open on connection 1 (order_items, from the colours step above). Add a
  // second tab on connection 1 while its subtree is still the only one expanded...
  await openRowMenu(page, ORDER_ITEMS_PATH);
  await page.click('[data-testid="menu-item-open-data-new-tab"]'); // tab B
  await expect(page.locator('[data-testid="tab"]')).toHaveCount(2);

  // ...then collapse connection 1's own root entirely, before connection 2 exists — every one
  // of its descendant rows (database, schema, table — all sharing the exact same `data-path`
  // values connection 2 will render) disappears from the DOM with it. findRow()/expandRow()
  // below match on `data-path` alone, with no per-connection scoping, so this single collapse
  // is what keeps every subsequent lookup unambiguous.
  // Connection 2 does not exist yet at this point, so this is still unambiguous without any
  // name filter — the plain connection-row locator matches exactly one row.
  const firstConnRow = page.locator('[data-testid="tree-row"][data-kind="connection"]');
  await expect(firstConnRow).toHaveCount(1);
  await firstConnRow.locator('.twisty').click();

  await createConnection(page, 'Tabs DB 2', 'teal');
  const secondConnRow = page
    .locator('[data-testid="tree-row"][data-kind="connection"]')
    .filter({ hasText: 'Tabs DB 2' });
  await expect(secondConnRow).toBeVisible();
  await secondConnRow.click({ button: 'right' });
  await page.click('[data-testid="menu-item-connect"]');
  await expect(secondConnRow.locator('.status-dot')).toHaveAttribute('data-status', 'connected', {
    timeout: 10_000,
  });
  await secondConnRow.locator('.twisty').click();
  await expandRow(page, DB_PATH);
  await expandRow(page, APP_PATH);
  await (await findRow(page, ORDER_ITEMS_PATH)).dblclick(); // tab C, on connection 2

  await page.click('[data-testid="page-size-1000"]');
  await page.fill('[data-testid="pager-page-input"]', '3');
  await page.press('[data-testid="pager-page-input"]', 'Tab');

  const allTabs = page.locator('[data-testid="tab"]');
  await expect(allTabs).toHaveCount(3);
  const titles = await allTabs.evaluateAll((els) => els.map((el) => el.textContent?.trim()));

  const { window: restored } = await relaunch();

  const restoredTabs = restored.locator('[data-testid="tab"]');
  await expect(restoredTabs).toHaveCount(3, { timeout: 10_000 });
  const restoredTitles = await restoredTabs.evaluateAll((els) =>
    els.map((el) => el.textContent?.trim()),
  );
  expect(restoredTitles).toEqual(titles);

  // Restored tabs are never connected — each shows "Reconnect & load".
  for (let i = 0; i < 3; i++) {
    await restoredTabs.nth(i).click();
    await expect(restored.locator('[data-testid="reconnect-panel"]')).toBeVisible();
  }

  // Pressing it on tab C (connection 2) connects only that connection, and loads its page
  // with the persisted page index and page size.
  await restoredTabs.last().click();
  await restored.click('[data-testid="reconnect-load"]');
  await expect(restored.locator('[data-testid="data-grid"]')).toBeVisible({ timeout: 15_000 });
  await expect(restored.locator('[data-testid="page-size-1000"]')).toHaveClass(/on/);
  await expect(restored.locator('[data-testid="pager-page-input"]')).toHaveValue('3');
  await restored.screenshot({ path: 'test-results/screenshots/restored-tab.png' });

  // --- close a tab and relaunch: it stays gone -------------------------------------------
  await restoredTabs.first().click({ button: 'right' });
  await restored.click('[data-testid="menu-item-close"]');
  await expect(restoredTabs).toHaveCount(2);

  const { window: relaunchedAgain } = await relaunch();
  await expect(relaunchedAgain.locator('[data-testid="tab"]')).toHaveCount(2, {
    timeout: 10_000,
  });

  expect(consoleErrors).toEqual([]);
});
