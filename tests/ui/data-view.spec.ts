import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { api } from './support/api';
import { isDockerAvailable, type PgFixture, startPostgres } from './support/pg';

// P2 data-view acceptance (Steps 8–13). Drives the real UI against real Postgres. Op-counting
// assertions require prefetch to be off, so connectAndOpenData disables it first (D21); the
// prefetch test re-enables it and is explicit about that.

const PERSIST_MS = 350;

let pg: PgFixture | null = null;
let unavailable = false;

test.beforeAll(async () => {
  unavailable = !(await isDockerAvailable());
  if (!unavailable) pg = await startPostgres();
});

test.afterAll(async () => {
  await pg?.stop();
});

function fixture(): PgFixture {
  if (!pg) throw new Error('postgres fixture unavailable');
  return pg;
}

async function connectAndOpenData(
  window: Page,
  relaunch: () => Promise<{ window: Page }>,
): Promise<{ window: Page; connectionId: string }> {
  const cfg = fixture().config;
  const created = await window.evaluate(
    (input) =>
      (window as unknown as { kira: { connectionsCreate: (i: unknown) => Promise<unknown> } }).kira
        .connectionsCreate(input),
    {
      name: 'pg',
      kind: 'postgres',
      color: 'blue',
      mode: 'fields',
      readOnly: false,
      host: cfg.host,
      port: cfg.port,
      database: 'kira_test',
      username: 'postgres',
      password: 'kira',
      uri: null,
      options: {},
    },
  );
  const connectionId = (created as { id: string }).id;
  // Relaunch so the renderer's connectionsState rehydrates from storage (the tree is driven by
  // that state; a bridge-created connection does not appear until relaunch, per the P1 pattern).
  ({ window } = await relaunch());
  await window.evaluate(
    (x) =>
      (window as unknown as { kira: { connectionsConnect: (i: unknown) => Promise<unknown> } }).kira
        .connectionsConnect({ id: x }),
    connectionId,
  );
  // Disable prefetch so op-counting assertions are deterministic.
  await window.evaluate(
    () =>
      (window as unknown as { kira: { settingsSet: (p: unknown) => Promise<unknown> } }).kira
        .settingsSet({ data: { prefetchNextPage: false } }),
  );
  await window.waitForTimeout(200);
  return { window, connectionId };
}

function row(window: Page, kind: string, name: string) {
  return window.locator(`[data-testid="tree-row"][data-kind="${kind}"]`, { hasText: name });
}

async function openTableByName(window: Page, name: string): Promise<void> {
  await row(window, 'connection', 'pg').dblclick();
  await window.waitForSelector('[data-testid="tree-row"][data-kind="database"]');
  await row(window, 'database', 'kira_test').dblclick();
  await row(window, 'schema', 'app').dblclick();
  await window.waitForSelector('[data-testid="tree-row"][data-kind="table"]');
  await row(window, 'table', name).click({ button: 'right' });
  await window.click('[data-testid="menu-item-open-data"]');
  await expect(window.locator('[data-testid="data-grid"]')).toBeVisible();
  await window.waitForSelector('[data-testid="grid-cell"]');
}

test('open data creates a tab; new-tab opens independently; tabs restore as Reconnect & load', async ({ kira, relaunch }) => {
  test.skip(unavailable, 'Docker daemon unreachable — run `colima start`');
  let { window } = kira;
  ({ window } = await connectAndOpenData(window, relaunch));
  await openTableByName(window, 'big_rows');

  const firstTab = await window.locator('[data-testid="tab-strip"] [data-testid^="tab-"]').count();
  expect(firstTab).toBe(1);

  await row(window, 'table', 'big_rows').click({ button: 'right' });
  await window.click('[data-testid="menu-item-open-data-new-tab"]');
  await expect(window.locator('[data-testid="tab-strip"] [data-testid^="tab-"]')).toHaveCount(2);

  // Relaunch → both tabs restore; the active tab's body is a Reconnect & load placeholder, and zero
  // new ops fire until it is pressed (§8.4 / D15).
  await window.waitForTimeout(PERSIST_MS * 3);
  const persisted = await window.evaluate(() => (window as unknown as { kira: { tabsGetAll: () => Promise<unknown[]> } }).kira.tabsGetAll());
  expect(persisted.length).toBe(2);
  const readOpsBefore = (await api.opsRecent(window, 100)).filter((o) => o.kind === 'read').length;
  ({ window } = await relaunch());

  await expect(window.locator('[data-testid="tab-strip"] [data-testid^="tab-"]')).toHaveCount(2);
  await expect(window.locator('[data-testid="reconnect-prompt"]')).toHaveCount(1);
  const readOpsAfter = (await api.opsRecent(window, 100)).filter((o) => o.kind === 'read').length;
  expect(readOpsAfter).toBe(readOpsBefore);

  await window.locator('[data-testid="reconnect-load"]').first().click();
  await expect(window.locator('[data-testid="data-grid"]')).toBeVisible();
});

test('grid windows the DOM and shows real row values', async ({ kira, relaunch }) => {
  test.skip(unavailable, 'Docker daemon unreachable — run `colima start`');
  let { window } = kira;
  ({ window } = await connectAndOpenData(window, relaunch));
  await openTableByName(window, 'big_rows');

  const cellCount = await window.locator('[data-testid="grid-cell"]').count();
  expect(cellCount).toBeLessThan(1200);

  const firstCell = await window.locator('[data-testid="grid-cell"]').first().innerText();
  expect(firstCell.trim()).toBe('1');

  // Scroll to the bottom: the last visible row's id cell (first column) must be a real number.
  await window.evaluate(() => {
    const grid = document.querySelector('[data-testid="data-grid"]');
    if (grid) grid.scrollTop = grid.scrollHeight;
  });
  await window.waitForTimeout(300);
  const lastRowCells = await window
    .locator('[data-testid="grid-row"]')
    .last()
    .locator('[data-testid="grid-cell"]')
    .allInnerTexts();
  const lastId = Number.parseInt(lastRowCells[0]?.trim() ?? '', 10);
  expect(lastId).toBeGreaterThan(400);
});

test('paging forward 3 then back 3 lands on the identical first row', async ({ kira, relaunch }) => {
  test.skip(unavailable, 'Docker daemon unreachable — run `colima start`');
  let { window } = kira;
  ({ window } = await connectAndOpenData(window, relaunch));
  await openTableByName(window, 'big_rows');

  expect((await window.locator('[data-testid="grid-cell"]').first().innerText()).trim()).toBe('1');
  for (let i = 0; i < 3; i++) {
    await window.click('[data-testid="page-next"]');
    await window.waitForTimeout(250);
  }
  for (let i = 0; i < 3; i++) {
    await window.click('[data-testid="page-prev"]');
    await window.waitForTimeout(250);
  }
  expect((await window.locator('[data-testid="grid-cell"]').first().innerText()).trim()).toBe('1');
});

test('count-all fills the pager total', async ({ kira, relaunch }) => {
  test.skip(unavailable, 'Docker daemon unreachable — run `colima start`');
  let { window } = kira;
  ({ window } = await connectAndOpenData(window, relaunch));
  await openTableByName(window, 'customers'); // 2 rows

  await window.click('[data-testid="count-all"]');
  await expect(window.locator('[data-testid="page-total"]')).toHaveText('of 1');
});

test('header sort rewrites the ORDER BY box and reorders rows', async ({ kira, relaunch }) => {
  test.skip(unavailable, 'Docker daemon unreachable — run `colima start`');
  let { window } = kira;
  ({ window } = await connectAndOpenData(window, relaunch));
  await openTableByName(window, 'regions'); // west(1), east(2)

  await window.locator('[data-testid="grid-header"][data-column="name"]').click();
  await window.waitForTimeout(300);
  await window.click('[data-testid="filter-toggle"]');
  const orderBy = await window.locator('[data-testid="filter-orderby"]').inputValue();
  expect(orderBy).toContain('"name" ASC');

  // Cells are in column order: [id, name]. After sorting by name ASC the first row is east(id=2),
  // so the id cell is "2" and the name cell is "east".
  const cells = await window.locator('[data-testid="grid-cell"]').allInnerTexts();
  expect(cells[0].trim()).toBe('2');
  expect(cells[1].trim()).toBe('east');
});

test('filter toolbar: WHERE applies, server errors verbatim, saved filter reopens', async ({ kira, relaunch }) => {
  test.skip(unavailable, 'Docker daemon unreachable — run `colima start`');
  let { window } = kira;
  ({ window } = await connectAndOpenData(window, relaunch));
  await openTableByName(window, 'regions');

  await window.click('[data-testid="filter-toggle"]');
  await window.fill('[data-testid="filter-where"]', 'id > 1');
  await window.press('[data-testid="filter-where"]', 'Enter');
  await window.waitForTimeout(300);
  expect(await window.locator('[data-testid="grid-row"]').count()).toBe(1);

  const ops = await api.opsRecent(window, 20);
  const readOp = ops.find((o) => o.kind === 'read');
  expect(readOp?.command).toContain('WHERE (id > 1)');

  // Invalid SQL → server error verbatim under the input, grid keeps the last good page.
  await window.fill('[data-testid="filter-where"]', 'id >');
  await window.press('[data-testid="filter-where"]', 'Enter');
  await window.waitForTimeout(300);
  await expect(window.locator('[data-testid="filter-where-error"]')).toBeVisible();
  const errText = await window.locator('[data-testid="filter-where-error"]').innerText();
  expect(errText.toLowerCase()).toContain('syntax');
  expect(await window.locator('[data-testid="grid-row"]').count()).toBe(1);

  // Save as "big ids", reopen in a new tab, pick it from history.
  await window.fill('[data-testid="filter-where"]', 'id > 1');
  await window.press('[data-testid="filter-where"]', 'Enter');
  window.once('dialog', (dialog) => void dialog.accept('big ids'));
  await window.click('[data-testid="filter-save"]');
  await window.waitForTimeout(300);

  await row(window, 'table', 'regions').click({ button: 'right' });
  await window.click('[data-testid="menu-item-open-data-new-tab"]');
  await expect(window.locator('[data-testid="data-grid"]')).toBeVisible();
  await window.click('[data-testid="filter-toggle"]');
  await window.click('[data-testid="filter-history"]');
  await expect(window.locator('[data-testid="filter-history-menu"]')).toBeVisible();
  await window.locator('[data-testid="filter-history-entry"]').filter({ hasText: 'big ids' }).click();
  await window.waitForTimeout(300);
  expect(await window.locator('[data-testid="grid-row"]').count()).toBe(1);
});

test('search toolbar is page-local and reports match counts', async ({ kira, relaunch }) => {
  test.skip(unavailable, 'Docker daemon unreachable — run `colima start`');
  let { window } = kira;
  ({ window } = await connectAndOpenData(window, relaunch));
  await openTableByName(window, 'customers'); // acme, globex

  await window.keyboard.press('Meta+f');
  await expect(window.locator('[data-testid="search-toolbar"]')).toBeVisible();
  await window.fill('[data-testid="search-query"]', 'acme');
  await window.waitForTimeout(400);
  await expect(window.locator('[data-testid="search-count"]')).toHaveText('1 of 1');

  // Invalid regex shows an inline error and does not throw.
  await window.click('[data-testid="search-regex"]');
  await window.fill('[data-testid="search-query"]', '(');
  await expect(window.locator('[data-testid="search-regex-error"]')).toHaveText('invalid regex');
});

test('stop button cancels a real server-side query and flips the op to cancelled', async ({ kira, relaunch }) => {
  test.skip(unavailable, 'Docker daemon unreachable — run `colima start`');
  let { window } = kira;
  ({ window } = await connectAndOpenData(window, relaunch));
  await openTableByName(window, 'big_rows');

  await window.click('[data-testid="filter-toggle"]');
  await window.fill('[data-testid="filter-where"]', 'id > 0 AND pg_sleep(30) IS NULL');
  await window.press('[data-testid="filter-where"]', 'Enter');

  await expect(window.locator('[data-testid="stop"]')).toBeEnabled();
  await window.click('[data-testid="stop"]');

  await expect
    .poll(async () => {
      const ops = await api.opsRecent(window, 20);
      return ops.find((o) => o.kind === 'read')?.status;
    })
    .toBe('cancelled');
});

test('prefetch fills L2 on idle so the next page is served from cache', async ({ kira, relaunch }) => {
  test.skip(unavailable, 'Docker daemon unreachable — run `colima start`');
  let { window } = kira;
  ({ window } = await connectAndOpenData(window, relaunch));
  await openTableByName(window, 'big_rows');

  // Re-enable prefetch for this test (D21).
  await window.evaluate(
    () =>
      (window as unknown as { kira: { settingsSet: (p: unknown) => Promise<unknown> } }).kira
        .settingsSet({ data: { prefetchNextPage: true } }),
  );
  await window.waitForTimeout(800);

  const readOpsBefore = (await api.opsRecent(window, 30)).filter((o) => o.kind === 'read').length;
  await window.click('[data-testid="page-next"]');
  await window.waitForTimeout(400);

  const readOpsAfter = (await api.opsRecent(window, 30)).filter((o) => o.kind === 'read').length;
  expect(readOpsAfter).toBe(readOpsBefore);
  const status = await window.locator('[data-testid="toolbar-status"]').innerText();
  expect(status).toContain('cached');
});
