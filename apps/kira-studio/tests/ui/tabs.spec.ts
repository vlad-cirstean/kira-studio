import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';
import {
  ORDER_ITEMS_PATH,
  orderItemsFixture,
  postgresConnectionSummary,
} from './support/postgresFixture';
import { connectionRow, expandRow, findRow, openRowMenu } from './support/tree';

// Ported from tests/e2e/tabs.spec.ts (P57 D16). Its "session restore" section (roughly the back
// half of the first scenario) asserts three tabs across two connections surviving a real
// relaunch(), including which ones reconnect and which persisted page/page-size values come back
// — none of that has an equivalent here (tests/ui/fixtures.ts's own header comment: no backing
// store, nothing to persist to), so it's dropped, same category as workbench.spec.ts's five.
// Everything before it — independent per-tab state, the tab context menu (exact item list, then
// each action), and tab colour — needs no relaunch and ports against real captured Postgres data
// (tests/ui/support/postgresFixture.ts). The second scenario (tab-strip overflow scrolling) is
// pure layout and ports unchanged.

const CONNECTION_ID = 'conn-tabs';
const FIXTURE = orderItemsFixture(CONNECTION_ID);
const CONNECTION_SUMMARY = postgresConnectionSummary(CONNECTION_ID, 'Tabs DB', 'blue');

const CONTROL: ControlSnapshot[] = [
  { channel: IPC.connectionsList, response: [] },
  {
    channel: IPC.connectionsCreate,
    args: {
      name: 'Tabs DB',
      kind: 'postgres',
      color: 'blue',
      mode: 'fields',
      readOnly: false,
      host: '127.0.0.1',
      port: 5432,
      database: 'kira_test',
      username: 'postgres',
      password: null,
      uri: null,
      options: {},
      preconnect: null,
      preconnectSidecar: false,
      autoExplain: false,
    },
    response: CONNECTION_SUMMARY,
  },
  ...FIXTURE.control,
  {
    channel: IPC.connectionsUpdate,
    args: {
      id: CONNECTION_ID,
      input: {
        name: 'Tabs DB',
        kind: 'postgres',
        color: 'magenta',
        mode: 'fields',
        readOnly: false,
        host: '127.0.0.1',
        port: 5432,
        database: 'kira_test',
        username: 'postgres',
        uri: null,
        options: {},
        preconnect: null,
        preconnectSidecar: false,
        autoExplain: false,
        password: null,
      },
    },
    response: { ...CONNECTION_SUMMARY, color: 'magenta' },
  },
];

async function menuItemIds(page: import('@playwright/test').Page): Promise<string[]> {
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

function tabLocator(page: import('@playwright/test').Page, tabId: string) {
  return page.locator(`[data-testid="tab"][data-tab-id="${tabId}"]`);
}

async function createAndConnect(page: import('@playwright/test').Page): Promise<void> {
  await page.click('[data-testid="add-connection"]');
  await page.click('[data-testid="connection-kind-postgres"]');
  await page.fill('[data-testid="connection-name"]', 'Tabs DB');
  await page.fill('[data-testid="connection-host"]', '127.0.0.1');
  await page.fill('[data-testid="connection-port"]', '5432');
  await page.fill('[data-testid="connection-database"]', 'kira_test');
  await page.fill('[data-testid="connection-username"]', 'postgres');
  await page.click('[data-testid="color-blue"]');
  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);

  const connRow = connectionRow(page);
  await expect(connRow).toBeVisible();
  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-connect"]');
  await expect(connRow.locator('.status-dot')).toHaveAttribute('data-status', 'connected', {
    timeout: 10_000,
  });
  await expandRow(page, '');
  await expandRow(page, 'database:kira_test');
  await expandRow(page, 'database:kira_test/schema:app');
}

test('tabs — independent state, context menu, colours', async ({ relaunch }) => {
  const { window: page } = await relaunch({ control: CONTROL });
  await createAndConnect(page);

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

  // tab 2 is active: change its page size to 1000.
  await expect(page.locator('[data-testid="data-grid"]')).toBeVisible();
  await page.click('[data-testid="page-size-1000"]');
  await expect(page.locator('[data-testid="page-size-1000"]')).toHaveClass(/on/);

  // Switch to tab 1: untouched (page size 100).
  await tabLocator(page, tab1Id).click();
  await expect(page.locator('[data-testid="page-size-100"]')).toHaveClass(/on/);

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
  await expect(page.locator('[data-testid="page-size-100"]')).toHaveClass(/on/);

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

  // --- colours: the tab and toolbar rail both carry the connection colour token -----------
  await (await findRow(page, ORDER_ITEMS_PATH)).dblclick();
  const tab = page.locator('[data-testid="tab"]');
  await expect(tab).toHaveAttribute('data-color', 'blue');
  await expect(tab).toHaveAttribute('style', /--kira-conn-blue/);
  await expect(page.locator('.p-toolbar-rail')).toHaveAttribute('style', /--kira-conn-blue/);

  await openRowMenu(page, '');
  await page.hover('[data-testid="menu-item-color"]');
  await expect(page.locator('[data-testid="context-submenu"]')).toBeVisible();
  await page.click('[data-testid="menu-item-color-magenta"]');
  await expect(tab).toHaveAttribute('data-color', 'magenta');
  await expect(tab).toHaveAttribute('style', /--kira-conn-magenta/);
  await expect(page.locator('.p-toolbar-rail')).toHaveAttribute('style', /--kira-conn-magenta/);
});

// P31 item 2/D6/D7: WorkbenchShell's own class name used to collide with TabStrip's identically
// named root under scoped CSS's "child inherits the parent's scope id too" rule, so the outer
// overflow: hidden always won regardless of what TabStrip.vue itself declared (F7). D6 renames the
// outer wrapper; D7 adds a wheel handler and a visible thin scrollbar.
test('the tab strip scrolls once tabs overflow it (P31 D6/D7)', async ({ relaunch }) => {
  const { window: page } = await relaunch({ control: CONTROL });
  await createAndConnect(page);
  const orderItemsRow = await findRow(page, ORDER_ITEMS_PATH);
  // Twelve independent tabs of the same table (§8.4: "the same table opens any number of
  // times") — enough at any reasonable window width to overflow a 900px-wide strip.
  for (let i = 0; i < 12; i++) {
    await orderItemsRow.click({ button: 'right' });
    await page.click('[data-testid="menu-item-open-data-new-tab"]');
  }
  await expect(page.locator('[data-testid="tab"]')).toHaveCount(12);

  const strip = page.locator('[data-testid="tab-strip-row"]');
  const overflowX = await strip.evaluate((el) => getComputedStyle(el).overflowX);
  expect(overflowX).not.toBe('hidden');
  const { scrollWidth, clientWidth } = await strip.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(scrollWidth).toBeGreaterThan(clientWidth);

  const scrollLeftBefore = await strip.evaluate((el) => el.scrollLeft);
  await strip.hover();
  await page.mouse.wheel(0, 300);
  await expect.poll(() => strip.evaluate((el) => el.scrollLeft)).toBeGreaterThan(scrollLeftBefore);

  // Activating the first tab again scrolls it back into view (TabStrip.vue's own watch, unchanged).
  await page.locator('[data-testid="tab"]').first().click();
  await expect
    .poll(async () => {
      const box = await page.locator('[data-testid="tab"]').first().boundingBox();
      const stripBox = await strip.boundingBox();
      if (!box || !stripBox) return false;
      return box.x >= stripBox.x;
    })
    .toBe(true);
});
