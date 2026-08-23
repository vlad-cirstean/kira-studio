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
const WIDE_TABLE_PATH = `${APP_PATH}/table:wide_table`;
const ORDER_SUMMARY_PATH = `${APP_PATH}/view:order_summary`;
const CUSTOMER_TOTALS_PATH = `${APP_PATH}/matview:customer_totals`;
const INVOICE_SEQ_PATH = `${APP_PATH}/sequence:invoice_number_seq`;
const FULL_NAME_PATH = `${APP_PATH}/function:full_name`;
const ORDER_ITEMS_ID_COLUMN_PATH = `${ORDER_ITEMS_PATH}/column:id`;

interface OpRecordLike {
  id: string;
  connectionId: string | null;
  kind: string;
}

function treeContainer(page: Page): Locator {
  return page.locator('[data-testid="tree-background"] .virtual-list');
}

// Scrolling the tree closes any open context menu (a window-level capture-phase 'scroll'
// listener backs that, correctly, so a menu never floats over content that's moved out from
// under it) — and a programmatic scrollTop write dispatches its 'scroll' event asynchronously,
// on a timer the browser controls. A blind `waitForTimeout` after the write is a guess at that
// timing; under load it guesses wrong and the event fires later, right after a click that opened
// a fresh menu, closing it before the next assertion sees it. So this waits for the 'scroll'
// event itself (falling back to a short timeout for a write that doesn't actually move
// scrollTop, which fires no event at all) before ever proceeding — the row is only found or
// clicked once no scroll event from this helper's own writes can still be in flight.
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
        // Fallback in case the browser coalesces/suppresses the event unexpectedly.
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

// A right-click on a row that Playwright still considers not-quite-in-view triggers its own
// internal scroll-into-view as part of the click's actionability check — a scroll whose 'scroll'
// event (caught, correctly, by a window-level listener that closes any open context menu so one
// never floats over content that's scrolled out from under it) can otherwise land asynchronously
// right after the click opens a fresh menu, closing it before the next assertion sees it.
// Scrolling the row fully into view ourselves first, and waiting out any resulting event, means
// the click that follows has nothing left to scroll.
async function openRowMenu(page: Page, path: string): Promise<void> {
  const row = await findRow(page, path);
  await row.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await row.click({ button: 'right' });
  await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();
}

async function getOps(page: Page, connectionId: string): Promise<OpRecordLike[]> {
  const all = await page.evaluate(() => window.kira.opsRecent({ limit: 5000 }));
  return all.filter((o) => o.connectionId === connectionId);
}

async function ddlOpCount(page: Page, connectionId: string): Promise<number> {
  return (await getOps(page, connectionId)).filter((o) => o.kind === 'ddl').length;
}

// Driven through the actual dialog (connections.spec.ts's own convention), not a bare
// `window.kira.connectionsCreate()` call: the tree's connection row list is hydrated once at
// boot (state/connections.ts's `hydrateConnections()`) and never re-fetched on its own, so a
// connection created by calling the bridge directly never appears in the tree — only the
// dialog's `saveDialog()` also pushes the new record into that reactive store.
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
  await page.click('[data-testid="connection-kind-postgres"]');
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

async function openDdlFromMenu(page: Page, path: string): Promise<void> {
  await openRowMenu(page, path);
  await page.click('[data-testid="menu-item-open-ddl"]');
}

test('DDL tab — open, notes, read-only, cache and ops, session restore', async ({
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
  const connectionId = await createConnection(page, cfg, {
    name: 'DDL DB',
    color: 'blue',
    readOnly: false,
  });
  const connRow = page.locator('[data-testid="tree-row"][data-kind="connection"]');
  await expect(connRow).toBeVisible();
  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-connect"]');
  await expect(
    page.locator('[data-testid="tree-row"][data-kind="connection"] .status-dot'),
  ).toHaveAttribute('data-status', 'connected', { timeout: 10_000 });
  await expandRow(page, '');
  await expandRow(page, DB_PATH);
  await expandRow(page, APP_PATH);

  // --- scenario 1: open from the menu -----------------------------------------------------
  await openDdlFromMenu(page, ORDER_ITEMS_PATH);
  const orderItemsTab = page.locator('[data-testid="tab"][data-active="true"]');
  await expect(orderItemsTab).toHaveAttribute('data-tab-kind', 'ddl');
  const orderItemsTabId = (await orderItemsTab.getAttribute('data-tab-id')) as string;

  const ddlView = page.locator('[data-testid="ddl-view"]');
  await expect(ddlView).toBeVisible();
  await expect(ddlView).toHaveAttribute('data-path', ORDER_ITEMS_PATH);
  await expect(ddlView).toHaveAttribute('data-origin', 'composed', { timeout: 15_000 });
  await expect(ddlView).toHaveAttribute('data-source', 'server');
  await expect(ddlView.locator('.cm-content')).toContainText('CREATE TABLE app.order_items');

  // --- scenario 2: menu coverage -----------------------------------------------------------
  await openRowMenu(page, ORDER_ITEMS_PATH);
  await expect(page.locator('[data-testid="menu-item-open-ddl"]')).toBeVisible();
  await page.keyboard.press('Escape');

  await openRowMenu(page, ORDER_SUMMARY_PATH);
  await expect(page.locator('[data-testid="menu-item-open-ddl"]')).toBeVisible();
  await page.keyboard.press('Escape');

  await openRowMenu(page, CUSTOMER_TOTALS_PATH);
  await expect(page.locator('[data-testid="menu-item-open-ddl"]')).toBeVisible();
  await page.keyboard.press('Escape');

  await openRowMenu(page, INVOICE_SEQ_PATH);
  await expect(page.locator('[data-testid="menu-item-open-ddl"]')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await openRowMenu(page, FULL_NAME_PATH);
  await expect(page.locator('[data-testid="menu-item-open-ddl"]')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await expandRow(page, ORDER_ITEMS_PATH);
  await openRowMenu(page, ORDER_ITEMS_ID_COLUMN_PATH);
  await expect(page.locator('[data-testid="menu-item-open-ddl"]')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Back to the DDL tab for the remaining scenarios.
  await page.locator(`[data-testid="tab"][data-tab-id="${orderItemsTabId}"]`).click();
  await expect(ddlView).toBeVisible();

  // --- scenario 3: highlighting is live ----------------------------------------------------
  const tokenCount = await ddlView.locator('.cm-content span').count();
  expect(tokenCount).toBeGreaterThan(0);

  // --- scenario 4: read-only ----------------------------------------------------------------
  const beforeType = await ddlView.locator('.cm-content').innerText();
  await ddlView.locator('.cm-content').click();
  await page.keyboard.type('DROP TABLE x;');
  expect(await ddlView.locator('.cm-content').innerText()).toBe(beforeType);
  await expect(ddlView).toHaveAttribute('data-read-only-reason', 'ddl-not-editable');

  // --- scenario 5: notes --------------------------------------------------------------------
  const notes = page.locator('[data-testid="ddl-notes"]');
  await expect(notes).toBeVisible();
  await expect(notes).toContainText(/trigger/i);

  // --- scenario 6: cache and ops ------------------------------------------------------------
  const opsBeforeSecondOpen = await ddlOpCount(page, connectionId);
  await openDdlFromMenu(page, WIDE_TABLE_PATH);
  await expect(page.locator('[data-testid="ddl-view"]')).toHaveAttribute(
    'data-path',
    WIDE_TABLE_PATH,
  );
  const opsAfterSecondOpen = await ddlOpCount(page, connectionId);
  expect(opsAfterSecondOpen).toBe(opsBeforeSecondOpen + 1);

  await page.locator(`[data-testid="tab"][data-tab-id="${orderItemsTabId}"]`).click();
  await expect(ddlView).toHaveAttribute('data-path', ORDER_ITEMS_PATH);
  expect(await ddlOpCount(page, connectionId)).toBe(opsAfterSecondOpen);

  await page.locator(`[data-testid="tab"][data-tab-id="${orderItemsTabId}"] .tab-close`).click();
  const opsBeforeReopen = await ddlOpCount(page, connectionId);
  await openDdlFromMenu(page, ORDER_ITEMS_PATH);
  await expect(ddlView).toHaveAttribute('data-path', ORDER_ITEMS_PATH);
  await expect(ddlView).toHaveAttribute('data-source', 'cache');
  expect(await ddlOpCount(page, connectionId)).toBe(opsBeforeReopen);

  const opsBeforeRefresh = await ddlOpCount(page, connectionId);
  await page.click('[data-testid="ddl-refresh"]');
  await expect(ddlView).toHaveAttribute('data-source', 'server');
  expect(await ddlOpCount(page, connectionId)).toBe(opsBeforeRefresh + 1);

  // --- scenario 7: two tabs, one target -----------------------------------------------------
  const tabsBefore = await page.locator('[data-testid="tab"]').count();
  await openDdlFromMenu(page, ORDER_ITEMS_PATH);
  expect(await page.locator('[data-testid="tab"]').count()).toBe(tabsBefore);
  await expect(page.locator('[data-testid="tab"][data-active="true"]')).toHaveAttribute(
    'data-tab-kind',
    'ddl',
  );

  // --- scenario 8: data and DDL side by side ------------------------------------------------
  await openRowMenu(page, ORDER_ITEMS_PATH);
  await page.click('[data-testid="menu-item-open-data-new-tab"]');
  const dataTab = page.locator('[data-testid="tab"][data-active="true"]');
  await expect(dataTab).toHaveAttribute('data-tab-kind', 'data');
  const dataTabId = (await dataTab.getAttribute('data-tab-id')) as string;
  await expect(page.locator('[data-testid="data-grid"]')).toBeVisible();
  // No cell is selected in this freshly-opened grid, so the cell editor panel — now driven
  // entirely by selection, not a persistent manual-toggle flag — hasn't mounted at all.
  await expect(page.locator('[data-testid="cell-editor"]')).toHaveCount(0);

  const currentDdlTab = page.locator('[data-testid="tab"][data-tab-kind="ddl"]').first();
  const currentDdlTabId = (await currentDdlTab.getAttribute('data-tab-id')) as string;
  expect(currentDdlTabId).not.toBe(dataTabId);
  await currentDdlTab.click();
  await expect(page.locator('[data-testid="ddl-view"]')).toBeVisible();
  await expect(page.locator('[data-testid="data-grid"]')).toHaveCount(0);

  await page.locator(`[data-testid="tab"][data-tab-id="${dataTabId}"]`).click();
  await expect(page.locator('[data-testid="data-grid"]')).toBeVisible();
  await expect(page.locator('[data-testid="ddl-view"]')).toHaveCount(0);
  // No cell is selected in this freshly-opened grid, so the cell editor panel — now driven
  // entirely by selection, not a persistent manual-toggle flag — hasn't mounted at all.
  await expect(page.locator('[data-testid="cell-editor"]')).toHaveCount(0);

  await currentDdlTab.click();
  await expect(page.locator('[data-testid="ddl-view"]')).toBeVisible();

  await page.screenshot({ path: 'test-results/screenshots/ddl-tab.png' });

  // --- scenario 9: session restore ----------------------------------------------------------
  await page.waitForTimeout(300); // layout.ts's 150ms write-debounce, so relaunch sees it
  const relaunched = await relaunch();
  await relaunched.window.waitForSelector('[data-testid="status-bar"]');
  const restoredDdlTab = relaunched.window.locator('[data-testid="tab"][data-tab-kind="ddl"]');
  await expect(restoredDdlTab.first()).toBeVisible();
  await restoredDdlTab.first().click();
  const restoredView = relaunched.window.locator('[data-testid="ddl-view"]');
  await expect(restoredView.locator('[data-testid="ddl-reconnect"]')).toBeVisible();
  await expect(restoredView.locator('.cm-content')).toHaveCount(0);

  await relaunched.window.click('[data-testid="ddl-reconnect-load"]');
  await expect(restoredView.locator('.cm-content')).toContainText('CREATE', { timeout: 15_000 });

  // --- scenario 10: MariaDB ------------------------------------------------------------------
  // Skipped here — §8b of the plan covers the second engine's ddl() directly, and the renderer
  // path above is engine-agnostic by construction (DdlView.vue never branches on connection kind
  // except to pick the CodeMirror SQL dialect).

  expect(consoleErrors).toEqual([]);
});
