import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  DOCKER_UNAVAILABLE_MESSAGE,
  isDockerAvailable,
  type PgFixture,
  startPostgres,
} from './support/pg';

// Container-backed (D22): skips with a Colima-naming reason when the Docker daemon is
// unreachable, rather than failing every UI spec in the project.
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
const BIG_ROWS_PATH = `${APP_PATH}/table:big_rows`;
const NULLS_PATH = `${APP_PATH}/table:nulls_and_unicode`;

interface OpRecordLike {
  id: string;
  connectionId: string | null;
  kind: string;
  status: string;
  command: string | null;
}

function treeContainer(page: Page): Locator {
  return page.locator('[data-testid="tree-background"] .virtual-list');
}

// The project tree is virtualized — a row not currently scrolled into view simply is not in
// the DOM. Same scroll-until-found shape as tree.spec.ts's findRow.
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

async function getOps(page: Page, connectionId: string): Promise<OpRecordLike[]> {
  const all = await page.evaluate(() => window.kira.opsRecent({ limit: 5000 }));
  return all.filter((o) => o.connectionId === connectionId);
}

function ofKind(ops: OpRecordLike[], kind: string): OpRecordLike[] {
  return ops.filter((o) => o.kind === kind);
}

// The grid is virtualized (DataGrid.vue) — only the scrolled-into-view + overscan rows exist
// in the DOM at any moment, so "100 rows render" is asserted by scrolling to the bottom of the
// fetched page and reading the last gutter number, not by counting DOM nodes.
async function scrollGridToBottom(page: Page): Promise<void> {
  const grid = page.locator('[data-testid="data-grid"]');
  await grid.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(50);
}

async function firstGutterNumber(page: Page): Promise<string> {
  const grid = page.locator('[data-testid="data-grid"]');
  await grid.evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.waitForTimeout(50);
  return (await page.locator('[data-testid="grid-gutter-cell"]').first().innerText()).trim();
}

async function lastGutterNumber(page: Page): Promise<string> {
  await scrollGridToBottom(page);
  return (await page.locator('[data-testid="grid-gutter-cell"]').last().innerText()).trim();
}

async function cellText(page: Page, row: number, column: string): Promise<string> {
  return (
    await page.locator(`[data-testid="grid-cell"][data-row="${row}"][data-column="${column}"]`)
  ).innerText();
}

test('data view — pagination, count, projection, sort, filter, search, stop, cache', async ({
  kira,
  relaunch,
  consoleErrors,
}) => {
  test.setTimeout(300_000);
  if (!pg) throw new Error('postgres fixture did not start');
  const { window: page } = kira;

  const connectionId = await page.evaluate(
    (cfg) =>
      window.kira
        .connectionsCreate({
          name: 'Data View DB',
          kind: 'postgres',
          color: 'green',
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
      host: pg.config.host,
      port: pg.config.port,
      database: pg.config.database,
      username: pg.config.username,
      password: pg.config.password,
    },
  );

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

  // --- open: 100 rows, gutter starts at 1, header shows column names ----------------------
  const bigRowsRow = await findRow(page, BIG_ROWS_PATH);
  await bigRowsRow.dblclick();

  const grid = page.locator('[data-testid="data-grid"]');
  await expect(grid).toBeVisible();
  await expect(page.locator('[data-testid="grid-header-cell"][data-column="id"]')).toBeVisible();
  await expect(page.locator('[data-testid="grid-header-cell"][data-column="hash"]')).toBeVisible();
  await expect.poll(() => firstGutterNumber(page), { timeout: 15_000 }).toBe('1');
  await expect.poll(() => lastGutterNumber(page)).toBe('100');

  await page.screenshot({ path: 'test-results/screenshots/data-view.png' });

  // --- pagination: next/prev/first, page sizes, jump-to-page after Σ ----------------------
  await page.click('[data-testid="pager-next"]');
  await expect.poll(() => firstGutterNumber(page)).toBe('101');

  await page.click('[data-testid="pager-prev"]');
  await expect.poll(() => firstGutterNumber(page)).toBe('1');

  await page.click('[data-testid="page-size-1000"]');
  await expect.poll(() => lastGutterNumber(page), { timeout: 15_000 }).toBe('1000');

  await page.click('[data-testid="page-size-10000"]');
  await expect.poll(() => lastGutterNumber(page), { timeout: 15_000 }).toBe('10000');

  await page.click('[data-testid="page-size-10"]');
  await expect.poll(() => lastGutterNumber(page), { timeout: 15_000 }).toBe('10');

  // Σ count all fills in "of 10000" pages at pageSize 10 (1,000,000 / 10); survives a page
  // change; a Refresh recomputes it with exactly one new `count` op row. The count button is
  // icon-only (no visible badge) — the number lives in its title tooltip instead.
  await page.click('[data-testid="toolbar-count"]');
  await expect(page.locator('[data-testid="toolbar-count"]')).toHaveAttribute(
    'data-kira-tip',
    /1,000,000/,
    { timeout: 15_000 },
  );
  await expect(page.locator('[data-testid="pager"]')).toContainText('of 100000');

  await page.click('[data-testid="pager-next"]');
  await expect(page.locator('[data-testid="toolbar-count"]')).toHaveAttribute(
    'data-kira-tip',
    /1,000,000/,
  );

  const opsBeforeCountRefresh = await getOps(page, connectionId);
  await page.click('[data-testid="toolbar-refresh"]');
  await page.waitForTimeout(200);
  await page.click('[data-testid="toolbar-count"]');
  await expect
    .poll(async () => ofKind(await getOps(page, connectionId), 'count').length)
    .toBe(ofKind(opsBeforeCountRefresh, 'count').length + 1);

  // The page input only reacts to a native `change` event (@change="onJump"), which Enter does
  // not fire on its own — Tab moves focus away and blurs it, which does.
  await page.fill('[data-testid="pager-page-input"]', '100000');
  await page.press('[data-testid="pager-page-input"]', 'Tab');
  await expect.poll(() => firstGutterNumber(page), { timeout: 15_000 }).toBe('999991');
  await expect.poll(() => lastGutterNumber(page)).toBe('1000000');
  await page.click('[data-testid="pager-first"]');
  await expect.poll(() => firstGutterNumber(page)).toBe('1');

  // --- projection: half the columns, header shrinks, op command carries only those ---------
  await page.click('[data-testid="toolbar-columns"]');
  await expect(page.locator('[data-testid="columns-menu"]')).toBeVisible();
  const columnItems = page.locator('[data-testid="columns-menu-item"]');
  await columnItems.nth(1).click(); // uncheck "hash", leaving only "id"
  await page.click('[data-testid="columns-menu-backdrop"]');
  await expect(page.locator('[data-testid="grid-header-cell"]')).toHaveCount(1, {
    timeout: 10_000,
  });
  const opsAfterProjection = await getOps(page, connectionId);
  // getOps() is newest-first (recentOps() orders by startedAt desc) — the just-issued read is [0].
  const lastRead = ofKind(opsAfterProjection, 'read')[0];
  expect(lastRead?.command).toContain('"id"');
  expect(lastRead?.command).not.toContain('"hash"');

  // Restore the full projection for the remaining scenarios.
  await page.click('[data-testid="toolbar-columns"]');
  await page.locator('[data-testid="columns-select-all"]').click();
  await page.click('[data-testid="columns-menu-backdrop"]');
  await expect(page.locator('[data-testid="grid-header-cell"]')).toHaveCount(2, {
    timeout: 10_000,
  });

  // --- sort: header click asc -> desc -> none, then free-text ORDER BY wins ---------------
  await page.click('[data-testid="grid-header-cell"][data-column="id"]'); // -> asc (explicit)
  await expect
    .poll(() => page.locator('[data-testid="pager"]').getAttribute('data-pagination'))
    .toBe('keyset');
  await page.click('[data-testid="grid-header-cell"][data-column="id"]'); // -> desc
  await expect.poll(() => firstGutterNumber(page)).toBe('1');
  await expect.poll(() => cellText(page, 0, 'id')).toBe('1000000');

  await page.click('[data-testid="grid-header-cell"][data-column="id"]'); // -> none
  await expect(page.locator('.sort-chevron')).toHaveCount(0);
  await expect.poll(() => cellText(page, 0, 'id')).toBe('1'); // default order is still PK-ascending

  await page.fill('[data-testid="filter-orderby-input"]', 'id ASC');
  await page.press('[data-testid="filter-orderby-input"]', 'Enter');
  await expect.poll(() => cellText(page, 0, 'id')).toBe('1');
  await expect(page.locator('.sort-chevron')).toHaveCount(0);
  await page.fill('[data-testid="filter-orderby-input"]', '');
  await page.press('[data-testid="filter-orderby-input"]', 'Enter');

  await page.screenshot({ path: 'test-results/screenshots/filter-toolbar.png' });

  // --- filter toolbar: valid/invalid WHERE, history, saved filters ------------------------
  await page.fill('[data-testid="filter-where-input"]', 'id <= 5');
  await page.press('[data-testid="filter-where-input"]', 'Enter');
  await expect.poll(() => lastGutterNumber(page), { timeout: 10_000 }).toBe('5');

  const opsBeforeBadFilter = await getOps(page, connectionId);
  await page.fill('[data-testid="filter-where-input"]', 'not valid sql (((');
  await page.press('[data-testid="filter-where-input"]', 'Enter');
  await expect(page.locator('[data-testid="error-strip"]')).toBeVisible({ timeout: 10_000 });
  // The previous page is still on screen — the failed filter did not blank the grid.
  await expect.poll(() => firstGutterNumber(page)).toBe('1');
  expect(await getOps(page, connectionId)).toHaveLength(opsBeforeBadFilter.length + 1); // the failed attempt itself

  await page.fill('[data-testid="filter-where-input"]', 'id <= 5');
  await page.press('[data-testid="filter-where-input"]', 'Enter');
  await expect(page.locator('[data-testid="error-strip"]')).toHaveCount(0);

  await page.click('[data-testid="filter-history-button"]');
  await expect(page.locator('[data-testid="filter-history"]')).toBeVisible();
  await expect(page.locator('[data-testid="history-entry"]').first()).toContainText('id <= 5');
  await page.click('[data-testid="save-current-filter"]');
  await page.fill('[data-testid="text-prompt-input"]', 'Small ids');
  await page.click('[data-testid="text-prompt-ok"]');
  await expect(page.locator('[data-testid="saved-entry"]').first()).toContainText('Small ids');
  await page.click('[data-testid="filter-history-backdrop"]');
  await page.fill('[data-testid="filter-where-input"]', '');
  await page.press('[data-testid="filter-where-input"]', 'Enter');

  // --- search toolbar: match count, case, whole word, regex, prev/next, no new op rows -----
  const opsBeforeSearch = await getOps(page, connectionId);
  await page.click('[data-testid="toolbar-search"]');
  const searchToolbar = page.locator('[data-testid="search-toolbar"]');
  await expect(searchToolbar).toBeVisible();
  await page.fill('[data-testid="search-input"]', '1');
  await expect(page.locator('[data-testid="search-count"]')).not.toContainText('0 of 0');
  await page.click('[data-testid="search-match-case"]');
  await page.click('[data-testid="search-whole-word"]');
  await page.click('[data-testid="search-regex"]');
  await page.fill('[data-testid="search-input"]', '^1$');
  await expect(page.locator('[data-testid="search-count"]')).toContainText('1 of 1');
  await page.click('[data-testid="search-next"]');
  await page.click('[data-testid="search-prev"]');
  expect(await getOps(page, connectionId)).toHaveLength(opsBeforeSearch.length); // zero new op-log rows
  await page.screenshot({ path: 'test-results/screenshots/search-toolbar.png' });
  await page.click('[data-testid="search-close"]');
  await expect(searchToolbar).toHaveCount(0);

  // --- stop: a filtered read cancelled mid-flight, previous page stays on screen -----------
  await page.click('[data-testid="page-size-10000"]');
  await expect.poll(() => lastGutterNumber(page), { timeout: 15_000 }).toBe('10000');
  const firstBeforeStop = await firstGutterNumber(page);
  // `(SELECT pg_sleep(2)) IS NULL` is an uncorrelated subquery — Postgres hoists it into a
  // one-shot InitPlan regardless of row count, giving this filtered read a flat, deterministic
  // ~2s cost (Postgres/OS caches being warm from earlier reads would otherwise make a plain
  // 10 000-row read resolve too fast to reliably click Stop before it finishes). Applying the
  // filter itself is what starts the slow read here — not a follow-up pager click. It goes
  // first in an OR (not AND) with the real
  // predicate: pg_sleep() returns void, which is never NULL, so the left disjunct is always
  // false and the right one (`id > 0`, true for this table) alone decides the match — an AND
  // here would make the always-false left side veto every row.
  await page.fill('[data-testid="filter-where-input"]', '(SELECT pg_sleep(2)) IS NULL OR id > 0');
  await page.press('[data-testid="filter-where-input"]', 'Enter');
  await page.click('[data-testid="toolbar-stop"]');
  await expect
    .poll(async () => ofKind(await getOps(page, connectionId), 'read')[0]?.status, {
      timeout: 10_000,
    })
    .toBe('cancelled');
  await expect.poll(() => firstGutterNumber(page)).toBe(firstBeforeStop);
  await page.fill('[data-testid="filter-where-input"]', '');
  await page.press('[data-testid="filter-where-input"]', 'Enter');
  await page.click('[data-testid="page-size-100"]');
  await expect.poll(() => lastGutterNumber(page), { timeout: 15_000 }).toBe('100');

  // --- cache: revisiting the exact same cursor is a hit; ↻ forces exactly one -------------
  const opsBeforeCacheRoundTrip = await getOps(page, connectionId);
  // The page cache key includes the request's cursor verbatim (D12: "each page/cursor pair is
  // its own entry"), and this table's id-sorted default is keyset-eligible, so every hop after
  // the first uses a token cursor rather than plain offsets (§5c). That makes ► a miss (a fresh
  // 'after' cursor), ◄ back to page 1 a miss too (a *different*, 'before' cursor — not the
  // 'offset:0' one page 1 was originally cached under), and only the second ► a hit: its 'after'
  // cursor encodes page 1's own last row, which is identical both times, so it reuses the exact
  // cache entry the first ► already stored.
  await page.click('[data-testid="pager-next"]');
  await page.click('[data-testid="pager-prev"]');
  await page.click('[data-testid="pager-next"]');
  expect(ofKind(await getOps(page, connectionId), 'read')).toHaveLength(
    ofKind(opsBeforeCacheRoundTrip, 'read').length + 2, // ► and ◄ were misses, the second ► a hit
  );
  const opsBeforeRefresh = await getOps(page, connectionId);
  await page.click('[data-testid="toolbar-refresh"]');
  await page.waitForTimeout(200);
  expect(ofKind(await getOps(page, connectionId), 'read')).toHaveLength(
    ofKind(opsBeforeRefresh, 'read').length + 1,
  );

  // --- NULL vs '' -------------------------------------------------------------------------
  await (await findRow(page, NULLS_PATH)).dblclick();
  await expect(page.locator('[data-testid="data-grid"]')).toBeVisible();
  const nullCell = page.locator('[data-testid="grid-cell"][data-row="0"][data-column="label"]');
  const emptyCell = page.locator('[data-testid="grid-cell"][data-row="1"][data-column="label"]');
  await expect(nullCell).toHaveAttribute('data-null', 'true');
  await expect(nullCell).toContainText('NULL');
  await expect(emptyCell).toHaveAttribute('data-null', 'false');
  await expect(emptyCell).toHaveText('');

  // --- saved filter persistence: relaunch closes this window, so it runs last ------------
  const { window: reopened } = await relaunch();
  await expandRow(reopened, '');
  await openRowMenu(reopened, '');
  await reopened.click('[data-testid="menu-item-connect"]');
  await expect(
    reopened.locator('[data-testid="tree-row"][data-kind="connection"] .status-dot'),
  ).toHaveAttribute('data-status', 'connected', { timeout: 10_000 });
  await expandRow(reopened, DB_PATH);
  await expandRow(reopened, APP_PATH);
  await (await findRow(reopened, BIG_ROWS_PATH)).dblclick();
  await reopened.click('[data-testid="filter-history-button"]');
  await expect(reopened.locator('[data-testid="saved-entry"]').first()).toContainText('Small ids');
  await reopened.click('[data-testid="filter-history-backdrop"]');

  expect(consoleErrors).toEqual([]);
});
