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
// P19 D2: a group folder's path is its parent's path plus `#<kind>` (renderer-only, never sent
// to an adapter — project/state/tree.ts's groupPath()).
const VIEWS_FOLDER_PATH = `${APP_PATH}#view`;
const MATVIEWS_FOLDER_PATH = `${APP_PATH}#matview`;
const SEQUENCES_FOLDER_PATH = `${APP_PATH}#sequence`;
const FUNCTIONS_FOLDER_PATH = `${APP_PATH}#function`;

interface OpRecordLike {
  id: string;
  connectionId: string | null;
  kind: string;
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
// A right-click on a row that Playwright still considers not-quite-in-view triggers its own
// internal scroll-into-view as part of the click's actionability check — a scroll whose 'scroll'
// event (caught, correctly, by a window-level listener that closes any open context menu so one
// never floats over content that's scrolled out from under it) can otherwise land asynchronously
// right after the click opens a fresh menu, closing it before the next assertion sees it.
// Scrolling the row fully into view ourselves first, and waiting out any resulting event, means
// the click that follows has nothing left to scroll.
async function getOps(page: Page, connectionId: string): Promise<OpRecordLike[]> {
  const all = await page.evaluate(() => window.kira.opsRecent({ limit: 5000 }));
  return all.filter((o) => o.connectionId === connectionId);
}

async function definitionOpCount(page: Page, connectionId: string): Promise<number> {
  return (await getOps(page, connectionId)).filter((o) => o.kind === 'definition').length;
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

async function openDefinitionFromMenu(page: Page, path: string): Promise<void> {
  await openRowMenu(page, path);
  await page.click('[data-testid="menu-item-open-definition"]');
}

// D7: Structure is the default pane — scenarios that need the raw text (highlighting, read-only
// typing, notes, cache/refresh source badge) switch to Source explicitly first.
async function switchToSource(view: Locator): Promise<void> {
  await view.locator('[data-testid="definition-pane-source"]').click();
  await expect(view.locator('.cm-content')).toBeVisible();
}

test('Definition tab — Structure/Source, columns menu, notes, read-only, cache and ops, session restore', async ({
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
    name: 'Definition DB',
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

  // --- scenario 1: open from the menu, Structure is the default pane ----------------------
  await openDefinitionFromMenu(page, ORDER_ITEMS_PATH);
  const orderItemsTab = page.locator('[data-testid="tab"][data-active="true"]');
  await expect(orderItemsTab).toHaveAttribute('data-tab-kind', 'definition');
  const orderItemsTabId = (await orderItemsTab.getAttribute('data-tab-id')) as string;

  const definitionView = page.locator('[data-testid="definition-view"]');
  await expect(definitionView).toBeVisible();
  await expect(definitionView).toHaveAttribute('data-path', ORDER_ITEMS_PATH);
  await expect(definitionView).toHaveAttribute('data-origin', 'composed', { timeout: 15_000 });
  await expect(definitionView).toHaveAttribute('data-source', 'server');
  await expect(definitionView.locator('[data-testid="definition-pane-structure"]')).toHaveClass(
    /on/,
  );
  await expect(definitionView.locator('.cm-content')).toHaveCount(0);

  // --- scenario 2: Structure sections, count badges, and the relocated Columns menu -------
  const columnsSection = definitionView.locator('[data-testid="definition-columns"]');
  await expect(columnsSection).toBeVisible();
  await expect(columnsSection).toContainText('id');
  const indexesSection = definitionView.locator('[data-testid="definition-indexes"]');
  await expect(indexesSection).toBeVisible();
  const constraintsSection = definitionView.locator('[data-testid="definition-constraints"]');
  await expect(constraintsSection).toBeVisible();
  // order_items has a PK, two FKs (order_id, product_id) and a CHECK on quantity (D11).
  // P19's badge redesign (1e6b6b0) gave primaryKey/foreignKey rows a PK/FK letter badge instead
  // of the plain text label — only check/unique/exclusion still render a lowercase text badge.
  await expect(constraintsSection).toContainText('PK');
  await expect(constraintsSection).toContainText('FK');
  await expect(constraintsSection).toContainText('check');

  // D9: the tree's former column-row context menu, relocated — Copy name / Add to projection /
  // Sort by, addressed by the table's own tab path directly.
  const idColumnRow = columnsSection.locator('tr', { has: page.getByText('id', { exact: true }) });
  // Same race openRowMenu() guards against, but here against the Structure body's own scroll
  // container: settle any pending scrollIntoView first, so the right-click's own actionability
  // scroll can't deliver its 'scroll' event late, right after the menu opens.
  await idColumnRow.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await idColumnRow.click({ button: 'right' });
  const contextMenu = page.locator('[data-testid="context-menu"]');
  await expect(contextMenu).toBeVisible();
  const menuIds = await contextMenu
    .locator(':scope > div')
    .evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-testid') ?? '').replace('menu-item-', '')),
    );
  expect(menuIds).toEqual(['copy-name', 'add-to-projection', 'sort-by']);
  await page.click('[data-testid="menu-item-add-to-projection"]');
  const dataTabAfterProjection = page.locator('[data-testid="tab"][data-active="true"]');
  await expect(dataTabAfterProjection).toHaveAttribute('data-tab-kind', 'data');
  await expect(page.locator('[data-testid="data-grid"]')).toBeVisible();

  // Back to the definition tab for the remaining scenarios.
  await page.locator(`[data-testid="tab"][data-tab-id="${orderItemsTabId}"]`).click();
  await expect(definitionView).toBeVisible();

  // --- scenario 3: menu coverage ------------------------------------------------------------
  // P19 groups views/matviews/sequences/functions into folders, collapsed by default — expand
  // each so the rows below are actually in the tree.
  await expandRow(page, VIEWS_FOLDER_PATH);
  await expandRow(page, MATVIEWS_FOLDER_PATH);
  await expandRow(page, SEQUENCES_FOLDER_PATH);
  await expandRow(page, FUNCTIONS_FOLDER_PATH);

  await openRowMenu(page, ORDER_ITEMS_PATH);
  await expect(page.locator('[data-testid="menu-item-open-definition"]')).toBeVisible();
  await page.keyboard.press('Escape');

  await openRowMenu(page, ORDER_SUMMARY_PATH);
  await expect(page.locator('[data-testid="menu-item-open-definition"]')).toBeVisible();
  await page.keyboard.press('Escape');

  await openRowMenu(page, CUSTOMER_TOTALS_PATH);
  await expect(page.locator('[data-testid="menu-item-open-definition"]')).toBeVisible();
  await page.keyboard.press('Escape');

  await openRowMenu(page, INVOICE_SEQ_PATH);
  await expect(page.locator('[data-testid="menu-item-open-definition"]')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await openRowMenu(page, FULL_NAME_PATH);
  await expect(page.locator('[data-testid="menu-item-open-definition"]')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // --- scenario 4: highlighting is live (Source pane) ---------------------------------------
  await switchToSource(definitionView);
  await expect(definitionView.locator('[data-testid="definition-pane-source"]')).toHaveClass(/on/);
  await expect(definitionView.locator('.cm-content')).toContainText('CREATE TABLE app.order_items');
  const tokenCount = await definitionView.locator('.cm-content span').count();
  expect(tokenCount).toBeGreaterThan(0);

  // --- scenario 5: read-only (Source pane) --------------------------------------------------
  const beforeType = await definitionView.locator('.cm-content').innerText();
  await definitionView.locator('.cm-content').click();
  await page.keyboard.type('DROP TABLE x;');
  expect(await definitionView.locator('.cm-content').innerText()).toBe(beforeType);
  await expect(definitionView).toHaveAttribute('data-read-only-reason', 'definition-not-editable');

  // --- scenario 6: notes (Source pane) -------------------------------------------------------
  const notes = page.locator('[data-testid="definition-notes"]');
  await expect(notes).toBeVisible();
  await expect(notes).toContainText(/trigger/i);

  // --- scenario 7: cache and ops --------------------------------------------------------------
  const opsBeforeSecondOpen = await definitionOpCount(page, connectionId);
  await openDefinitionFromMenu(page, WIDE_TABLE_PATH);
  await expect(page.locator('[data-testid="definition-view"]')).toHaveAttribute(
    'data-path',
    WIDE_TABLE_PATH,
  );
  const opsAfterSecondOpen = await definitionOpCount(page, connectionId);
  expect(opsAfterSecondOpen).toBe(opsBeforeSecondOpen + 1);

  await page.locator(`[data-testid="tab"][data-tab-id="${orderItemsTabId}"]`).click();
  await expect(definitionView).toHaveAttribute('data-path', ORDER_ITEMS_PATH);
  expect(await definitionOpCount(page, connectionId)).toBe(opsAfterSecondOpen);

  await page.locator(`[data-testid="tab"][data-tab-id="${orderItemsTabId}"] .tab-close`).click();
  const opsBeforeReopen = await definitionOpCount(page, connectionId);
  await openDefinitionFromMenu(page, ORDER_ITEMS_PATH);
  await expect(definitionView).toHaveAttribute('data-path', ORDER_ITEMS_PATH);
  await expect(definitionView).toHaveAttribute('data-source', 'cache');
  expect(await definitionOpCount(page, connectionId)).toBe(opsBeforeReopen);

  const opsBeforeRefresh = await definitionOpCount(page, connectionId);
  await page.click('[data-testid="definition-refresh"]');
  await expect(definitionView).toHaveAttribute('data-source', 'server');
  expect(await definitionOpCount(page, connectionId)).toBe(opsBeforeRefresh + 1);

  // --- scenario 8: two tabs, one target -------------------------------------------------------
  const tabsBefore = await page.locator('[data-testid="tab"]').count();
  await openDefinitionFromMenu(page, ORDER_ITEMS_PATH);
  expect(await page.locator('[data-testid="tab"]').count()).toBe(tabsBefore);
  await expect(page.locator('[data-testid="tab"][data-active="true"]')).toHaveAttribute(
    'data-tab-kind',
    'definition',
  );

  // --- scenario 9: data and definition side by side -------------------------------------------
  await openRowMenu(page, ORDER_ITEMS_PATH);
  await page.click('[data-testid="menu-item-open-data-new-tab"]');
  const dataTab = page.locator('[data-testid="tab"][data-active="true"]');
  await expect(dataTab).toHaveAttribute('data-tab-kind', 'data');
  const dataTabId = (await dataTab.getAttribute('data-tab-id')) as string;
  await expect(page.locator('[data-testid="data-grid"]')).toBeVisible();
  // No cell is selected in this freshly-opened grid, so the cell editor panel — now driven
  // entirely by selection, not a persistent manual-toggle flag — hasn't mounted at all.
  await expect(page.locator('[data-testid="cell-editor"]')).toHaveCount(0);

  const currentDefinitionTab = page
    .locator('[data-testid="tab"][data-tab-kind="definition"]')
    .first();
  const currentDefinitionTabId = (await currentDefinitionTab.getAttribute('data-tab-id')) as string;
  expect(currentDefinitionTabId).not.toBe(dataTabId);
  await currentDefinitionTab.click();
  await expect(page.locator('[data-testid="definition-view"]')).toBeVisible();
  await expect(page.locator('[data-testid="data-grid"]')).toHaveCount(0);

  await page.locator(`[data-testid="tab"][data-tab-id="${dataTabId}"]`).click();
  await expect(page.locator('[data-testid="data-grid"]')).toBeVisible();
  await expect(page.locator('[data-testid="definition-view"]')).toHaveCount(0);
  // No cell is selected in this freshly-opened grid, so the cell editor panel — now driven
  // entirely by selection, not a persistent manual-toggle flag — hasn't mounted at all.
  await expect(page.locator('[data-testid="cell-editor"]')).toHaveCount(0);

  await currentDefinitionTab.click();
  await expect(page.locator('[data-testid="definition-view"]')).toBeVisible();

  await page.screenshot({ path: 'test-results/screenshots/definition-tab.png' });

  // --- scenario 10: session restore -------------------------------------------------------------
  await page.waitForTimeout(300); // layout.ts's 150ms write-debounce, so relaunch sees it
  const relaunched = await relaunch();
  await relaunched.window.waitForSelector('[data-testid="status-bar"]');
  // wide_table's tab specifically — its `pane` was never switched away from Structure's
  // persisted default, unlike order_items's tab (still on Source since scenario 4).
  const restoredDefinitionTab = relaunched.window
    .locator('[data-testid="tab"][data-tab-kind="definition"]')
    .filter({ hasText: 'wide_table' });
  await expect(restoredDefinitionTab).toBeVisible();
  await restoredDefinitionTab.click();
  const restoredView = relaunched.window.locator('[data-testid="definition-view"]');
  await expect(restoredView.locator('[data-testid="definition-reconnect"]')).toBeVisible();
  await expect(restoredView.locator('[data-testid="definition-columns"]')).toHaveCount(0);

  await relaunched.window.click('[data-testid="definition-reconnect-load"]');
  // Restored on Structure (D7's persisted default) — Columns renders once the load resolves.
  await expect(restoredView.locator('[data-testid="definition-columns"]')).toBeVisible({
    timeout: 15_000,
  });

  // --- scenario 11: MariaDB ------------------------------------------------------------------
  // Skipped here — mariadb.spec.ts covers the second engine's definition() directly, and the
  // renderer path above is engine-agnostic by construction (DefinitionView.vue never branches
  // on connection kind except to pick the CodeMirror SQL dialect).

  expect(consoleErrors).toEqual([]);
});

test('Definition tab — tree grouping: folders collapsed by default, zero-IPC expand, Mongo collections', async ({
  kira,
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
  await createConnection(page, cfg, { name: 'Grouping DB', color: 'green', readOnly: false });
  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-connect"]');
  await expect(
    page.locator('[data-testid="tree-row"][data-kind="connection"] .status-dot'),
  ).toHaveAttribute('data-status', 'connected', { timeout: 10_000 });
  await expandRow(page, '');
  await expandRow(page, DB_PATH);
  await expandRow(page, APP_PATH);

  // Tables render first, ungrouped, ahead of any folder.
  const wideTableRow = await findRow(page, WIDE_TABLE_PATH);
  await expect(wideTableRow).toBeVisible();
  await expect(wideTableRow.locator('.twisty')).not.toBeVisible();

  for (const path of [
    VIEWS_FOLDER_PATH,
    MATVIEWS_FOLDER_PATH,
    SEQUENCES_FOLDER_PATH,
    FUNCTIONS_FOLDER_PATH,
  ]) {
    const folder = await findRow(page, path);
    await expect(folder).toBeVisible();
    await expect(folder).toHaveAttribute('data-kind', 'group');
  }

  // Collapsed by default (D4) — the Sequences folder's own member isn't rendered until toggled,
  // and toggling costs zero IPC calls / op-log rows (a pure render over the schema's
  // already-fetched children).
  expect(await page.locator(`[data-path="${INVOICE_SEQ_PATH}"]`).count()).toBe(0);
  const opsBefore = await page.evaluate(() => window.kira.opsRecent({ limit: 5000 }));
  await (await findRow(page, SEQUENCES_FOLDER_PATH)).locator('.twisty').click();
  await expect(await findRow(page, INVOICE_SEQ_PATH)).toBeVisible();
  const opsAfter = await page.evaluate(() => window.kira.opsRecent({ limit: 5000 }));
  expect(opsAfter).toHaveLength(opsBefore.length);
});
