import type { Locator, Page } from '@playwright/test';
import type { ConnectionColor } from '@shared/domain/connection';
import { expect, test } from './fixtures';
import {
  DOCKER_UNAVAILABLE_MESSAGE,
  isDockerAvailable,
  type PgFixture,
  startPostgres,
} from './support/pg';

test.describe.configure({ timeout: 300_000 });

let pg: PgFixture | null = null;

test.beforeAll(async () => {
  test.setTimeout(300_000);
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
const INVOICE_SEQ_PATH = `${APP_PATH}/sequence:invoice_number_seq`;
const FULL_NAME_PATH = `${APP_PATH}/function:full_name`;
const ORDER_ITEMS_ID_COLUMN_PATH = `${ORDER_ITEMS_PATH}/column:id`;

function treeContainer(page: Page): Locator {
  return page.locator('[data-testid="tree-background"] .virtual-list');
}

// See ddl.spec.ts's identically named helper for why this waits on the container's own 'scroll'
// event rather than a fixed timeout.
async function scrollAndSettle(container: Locator, mode: 'reset' | 'advance'): Promise<void> {
  await container.evaluate(
    (el, m) =>
      new Promise<void>((resolve) => {
        const before = el.scrollTop;
        const target = m === 'reset' ? 0 : before + Math.max(200, el.clientHeight);
        if (target === before) {
          resolve();
          return;
        }
        const onScroll = () => {
          el.removeEventListener('scroll', onScroll);
          resolve();
        };
        el.addEventListener('scroll', onScroll);
        el.scrollTop = target;
        setTimeout(() => {
          el.removeEventListener('scroll', onScroll);
          resolve();
        }, 300);
      }),
    mode,
  );
}

async function findRow(page: Page, path: string): Promise<Locator> {
  const container = treeContainer(page);
  const target = page.locator(`[data-testid="tree-row"][data-path="${path}"]`);
  if ((await target.count()) > 0) return target;
  await scrollAndSettle(container, 'reset');
  for (let i = 0; i < 80; i++) {
    if ((await target.count()) > 0) break;
    const atBottom = await container.evaluate(
      (el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1,
    );
    if (atBottom) break;
    await scrollAndSettle(container, 'advance');
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
  await row.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await row.click({ button: 'right' });
  await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();
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
  opts: { name: string; color: ConnectionColor; readOnly: boolean },
): Promise<string> {
  await page.click('[data-testid="add-connection"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toBeVisible();
  await page.fill('[data-testid="connection-name"]', opts.name);
  await page.fill('[data-testid="connection-host"]', cfg.host ?? '');
  await page.fill('[data-testid="connection-port"]', String(cfg.port ?? ''));
  await page.fill('[data-testid="connection-database"]', cfg.database ?? '');
  await page.fill('[data-testid="connection-username"]', cfg.username ?? '');
  await page.fill('[data-testid="connection-password"]', cfg.password ?? '');
  await page.click(`[data-testid="color-${opts.color}"]`);
  if (opts.readOnly) await page.check('[data-testid="connection-readonly"]');
  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);

  const records = await page.evaluate(() => window.kira.connectionsList());
  const created = records.find((r) => r.name === opts.name);
  if (!created) throw new Error(`connection "${opts.name}" not found after save`);
  return created.id;
}

async function openConsoleFromMenu(page: Page, path: string): Promise<void> {
  await openRowMenu(page, path);
  await page.click('[data-testid="menu-item-open-console"]');
}

async function typeInto(view: Locator, page: Page, text: string): Promise<void> {
  await view.locator('.cm-content').click();
  await page.keyboard.type(text);
}

test('Query console — open, run statement/all, errors, saved queries, session restore', async ({
  kira,
  relaunch,
  consoleErrors,
}) => {
  test.setTimeout(300_000);
  if (!pg) throw new Error('postgres fixture did not start');
  const { window: page } = kira;

  const cfg = {
    host: pg.config.host,
    port: pg.config.port,
    database: pg.config.database,
    username: pg.config.username,
    password: pg.config.password,
  };
  await createConnection(page, cfg, { name: 'Console DB', color: 'green', readOnly: false });
  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-connect"]');
  await expect(
    page.locator('[data-testid="tree-row"][data-kind="connection"] .status-dot'),
  ).toHaveAttribute('data-status', 'connected', { timeout: 10_000 });
  await expandRow(page, '');
  await expandRow(page, DB_PATH);
  await expandRow(page, APP_PATH);

  // --- scenario 1: menu coverage, gated on caps.sql (D5) — offered on connection/container/
  // relation rows, absent on sequences, functions and columns (§8.10 lists no console entry
  // for those kinds). ------------------------------------------------------------------------
  await openRowMenu(page, '');
  await expect(page.locator('[data-testid="menu-item-open-console"]')).toBeVisible();
  await page.keyboard.press('Escape');

  await openRowMenu(page, DB_PATH);
  await expect(page.locator('[data-testid="menu-item-open-console"]')).toBeVisible();
  await page.keyboard.press('Escape');

  await openRowMenu(page, ORDER_ITEMS_PATH);
  await expect(page.locator('[data-testid="menu-item-open-console"]')).toBeVisible();
  await page.keyboard.press('Escape');

  await openRowMenu(page, INVOICE_SEQ_PATH);
  await expect(page.locator('[data-testid="menu-item-open-console"]')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await openRowMenu(page, FULL_NAME_PATH);
  await expect(page.locator('[data-testid="menu-item-open-console"]')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await expandRow(page, ORDER_ITEMS_PATH);
  await openRowMenu(page, ORDER_ITEMS_ID_COLUMN_PATH);
  await expect(page.locator('[data-testid="menu-item-open-console"]')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // --- scenario 2: opening always creates a fresh tab, never reuses one (unlike DDL/data) -----
  const tabsBeforeOpen = await page.locator('[data-testid="tab"]').count();
  await openConsoleFromMenu(page, ORDER_ITEMS_PATH);
  const consoleTab1 = page.locator('[data-testid="tab"][data-active="true"]');
  await expect(consoleTab1).toHaveAttribute('data-tab-kind', 'console');
  expect(await page.locator('[data-testid="tab"]').count()).toBe(tabsBeforeOpen + 1);

  const consoleView1 = page.locator('[data-testid="console-view"]');
  await expect(consoleView1).toBeVisible();
  await expect(consoleView1.locator('[data-testid="console-target"]')).toHaveText('order_items');

  await openConsoleFromMenu(page, ORDER_ITEMS_PATH);
  expect(await page.locator('[data-testid="tab"]').count()).toBe(tabsBeforeOpen + 2);
  const consoleTab1Id = (await consoleTab1.getAttribute('data-tab-id')) as string;
  await page.locator(`[data-testid="tab"][data-tab-id="${consoleTab1Id}"]`).click();
  await expect(consoleView1).toBeVisible();

  // --- scenario 3: run statement (the one under the cursor) vs. run all -----------------------
  await typeInto(consoleView1, page, 'SELECT 10 AS a;');
  await page.click('[data-testid="console-run-statement"]');
  const results1 = consoleView1.locator('[data-testid="console-result-grid"]');
  await expect(results1).toHaveCount(1);
  await expect(results1.first()).toContainText('10');

  // Appending leaves the cursor at the end of the new text, inside the second statement — "Run
  // statement" should now target only that one, not the first again and not both.
  await typeInto(consoleView1, page, '\nSELECT 20 AS b;');
  await page.click('[data-testid="console-run-statement"]');
  await expect(results1).toHaveCount(1);
  await expect(results1.first()).toContainText('20');
  await expect(results1.first()).not.toContainText('10');

  await page.click('[data-testid="console-run-all"]');
  await expect(results1).toHaveCount(2);
  await expect(consoleView1.locator('[data-testid="console-status"]')).toContainText(
    '2 result sets',
  );
  await expect(results1.nth(0)).toContainText('10');
  await expect(results1.nth(1)).toContainText('20');

  // --- scenario 4: an adapter error is surfaced verbatim, not swallowed -----------------------
  await openConsoleFromMenu(page, ORDER_ITEMS_PATH);
  const consoleView2 = page.locator('[data-testid="console-view"]');
  await typeInto(consoleView2, page, 'SELECT * FROM this_table_does_not_exist_zzz;');
  await page.click('[data-testid="console-run-all"]');
  const error2 = consoleView2.locator('[data-testid="console-error"]');
  await expect(error2).toBeVisible();
  await expect(error2).toContainText(/does not exist/i);

  // --- scenario 5: saved queries ----------------------------------------------------------------
  await openConsoleFromMenu(page, ORDER_ITEMS_PATH);
  const consoleView3 = page.locator('[data-testid="console-view"]');
  await typeInto(consoleView3, page, 'SELECT 42 AS answer;');
  await page.click('[data-testid="console-saved-toggle"]');
  await page.click('[data-testid="console-save-current"]');
  await expect(page.locator('[data-testid="text-prompt"]')).toBeVisible();
  await page.fill('[data-testid="text-prompt-input"]', 'My saved query');
  await page.click('[data-testid="text-prompt-ok"]');
  // Unlike applying an entry, saving does not close the menu (matches grid/FilterHistoryMenu.vue's
  // saveCurrent — only apply*/close actions dismiss it) — the freshly reload()ed list now shows it.
  await expect(
    page.locator('[data-testid="console-saved-entry"]', { hasText: 'My saved query' }),
  ).toBeVisible();
  await page.click('[data-testid="console-saved-backdrop"]');
  await expect(page.locator('[data-testid="console-saved-menu"]')).toHaveCount(0);

  await openConsoleFromMenu(page, ORDER_ITEMS_PATH);
  const consoleView4 = page.locator('[data-testid="console-view"]');
  await page.click('[data-testid="console-saved-toggle"]');
  const savedEntry = page.locator('[data-testid="console-saved-entry"]', {
    hasText: 'My saved query',
  });
  await expect(savedEntry).toBeVisible();
  await savedEntry.click();
  await expect(consoleView4.locator('.cm-content')).toContainText('SELECT 42 AS answer;');

  // --- scenario 6: session restore --------------------------------------------------------------
  await openConsoleFromMenu(page, ORDER_ITEMS_PATH);
  const restoreTab = page.locator('[data-testid="tab"][data-active="true"]');
  const restoreTabId = (await restoreTab.getAttribute('data-tab-id')) as string;
  const restoreView = page.locator('[data-testid="console-view"]');
  await typeInto(restoreView, page, "SELECT 'restore-check' AS marker;");
  await page.waitForTimeout(1200); // state/tabs.ts's 1s debounced save

  const relaunched = await relaunch();
  await relaunched.window.waitForSelector('[data-testid="status-bar"]');
  const restoredTab = relaunched.window.locator(
    `[data-testid="tab"][data-tab-id="${restoreTabId}"]`,
  );
  await expect(restoredTab).toBeVisible();
  await restoredTab.click();
  const restoredView = relaunched.window.locator('[data-testid="console-view"]');
  await expect(restoredView.locator('[data-testid="console-reconnect"]')).toBeVisible();
  await expect(restoredView.locator('.cm-content')).toHaveCount(0);

  await relaunched.window.click('[data-testid="console-reconnect-load"]');
  await expect(restoredView.locator('.cm-content')).toContainText('restore-check', {
    timeout: 15_000,
  });

  expect(consoleErrors).toEqual([]);
});
