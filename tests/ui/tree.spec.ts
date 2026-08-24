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
//
// The Playwright Page fixture is bound to a local variable named `page` (not `window`, unlike
// fixtures.ts's own naming) so that a bare `window` reference inside a `page.evaluate()`
// callback below resolves to the real browser global (`window.kira`, from src/preload/index.ts)
// instead of being shadowed by a same-named local variable — see tests/ui/global.d.ts.
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
const ANALYTICS_PATH = `${DB_PATH}/schema:analytics`;
const WIDE_TABLE_PATH = `${APP_PATH}/table:wide_table`;
const ORDER_ITEMS_PATH = `${APP_PATH}/table:order_items`;
const ORDERS_PATH = `${APP_PATH}/table:orders`;
const ORDER_SUMMARY_PATH = `${APP_PATH}/view:order_summary`;
const SEQUENCE_PATH = `${APP_PATH}/sequence:invoice_number_seq`;
// P19 D2: a group folder's path is its parent's path plus `#<kind>` — a renderer-only synthetic
// path, never sent to an adapter (project/state/tree.ts's groupPath()).
const SEQUENCES_FOLDER_PATH = `${APP_PATH}#sequence`;

interface OpRecordLike {
  id: string;
  connectionId: string | null;
  kind: string;
  status: string;
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

// The project tree is virtualized (VirtualList.vue) — a row not currently scrolled into view
// simply is not in the DOM. Scroll the container down in pages until the target row appears
// (or the bottom is reached) instead of asserting on a DOM query that may just be off-screen.
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

async function getOps(page: Page): Promise<OpRecordLike[]> {
  return page.evaluate(() => window.kira.opsRecent({ limit: 1000 }));
}

// A right-click on a row that Playwright still considers not-quite-in-view triggers its own
// internal scroll-into-view as part of the click's actionability check — a scroll whose 'scroll'
// event (caught, correctly, by the same window-level listener) can otherwise land asynchronously
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

test('project tree — expansion, caching, disconnect/reconnect, search, filters, menus', async ({
  kira,
  relaunch,
  consoleErrors,
}) => {
  test.setTimeout(240_000);
  if (!pg) throw new Error('postgres fixture did not start');
  const { window: page } = kira;

  await page.click('[data-testid="toggle-operations-panel"]');
  await expect(page.locator('[data-testid="operations-panel"]')).toBeVisible();

  // --- setup: create the connection via IPC directly (12c: faster/less brittle than the
  // dialog, which connections.spec.ts already covers) and connect it through the real UI. ----
  const connectionId = await page.evaluate(
    (cfg) =>
      window.kira
        .connectionsCreate({
          name: 'Tree DB',
          kind: 'postgres',
          color: 'blue',
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

  const opsAfterConnect = await getOps(page);
  expect(
    opsAfterConnect.filter((o) => o.connectionId === connectionId && o.kind === 'connect'),
  ).toHaveLength(1);

  // --- expand connection -> database -> app -----------------------------------------------
  await expandRow(page, '');
  await expandRow(page, DB_PATH);
  const appRow = await expandRow(page, APP_PATH);
  await expect(appRow).toHaveAttribute('data-kind', 'schema');

  // P19 D5: tables are tree leaves — no twisty, and children() returns [] regardless of what a
  // pre-upgrade cache entry might still say. Columns moved into the definition view.
  const wideTableRow = await findRow(page, WIDE_TABLE_PATH);
  await expect(wideTableRow).toHaveAttribute('data-kind', 'table');
  await expect(wideTableRow.locator('.twisty')).not.toBeVisible();

  const wideTableChildren = await page.evaluate(
    ({ id, path }) => window.kira.treeChildren({ connectionId: id, path }),
    { id: connectionId, path: WIDE_TABLE_PATH },
  );
  expect(wideTableChildren.nodes).toEqual([]);

  // P19 D1-D3: every other listed kind (views, materialized views, sequences, functions)
  // collapses into its own per-kind folder below the ungrouped tables, collapsed by default.
  const viewsFolder = await findRow(page, `${APP_PATH}#view`);
  await expect(viewsFolder).toBeVisible();
  await expect(viewsFolder).toHaveAttribute('data-kind', 'group');
  await expect(viewsFolder).toContainText('Views');
  const matviewsFolder = await findRow(page, `${APP_PATH}#matview`);
  await expect(matviewsFolder).toBeVisible();
  await expect(matviewsFolder).toContainText('Materialized views');
  const functionsFolder = await findRow(page, `${APP_PATH}#function`);
  await expect(functionsFolder).toBeVisible();
  await expect(functionsFolder).toContainText('Functions');
  const sequencesFolder = await findRow(page, SEQUENCES_FOLDER_PATH);
  await expect(sequencesFolder).toBeVisible();
  await expect(sequencesFolder).toContainText('Sequences');
  await expect(sequencesFolder).toHaveAttribute('data-kind', 'group');

  // D2/D4's own acceptance bar: expanding a folder is a pure render over already-fetched
  // children — zero IPC calls, zero op-log rows, asserted rather than assumed.
  const opsBeforeFolderExpand = await getOps(page);
  await sequencesFolder.locator('.twisty').click();
  const sequenceRow = await findRow(page, SEQUENCE_PATH);
  await expect(sequenceRow).toBeVisible();
  await expect(sequenceRow).toHaveAttribute('data-kind', 'sequence');
  expect(await getOps(page)).toHaveLength(opsBeforeFolderExpand.length);

  await page.screenshot({ path: 'test-results/screenshots/project-tree.png' });
  await page.screenshot({ path: 'test-results/screenshots/operations-panel.png' });

  // --- cache assertion (§7/§9.2): a cache hit produces zero new op-log rows --------------
  const opsBeforeCollapse = await getOps(page);
  await (await findRow(page, '')).locator('.twisty').click(); // collapse the whole connection
  await expandRow(page, '');
  const opsAfterReexpand = await getOps(page);
  expect(opsAfterReexpand).toHaveLength(opsBeforeCollapse.length);

  // Refresh from the context menu forces a real round trip: exactly one new `children` row.
  await openRowMenu(page, APP_PATH);
  await page.click('[data-testid="menu-item-refresh"]');
  await expect.poll(async () => (await getOps(page)).length).toBe(opsBeforeCollapse.length + 1);

  // --- context menus: exact item id list per kind (§9b), plus the connection screenshot ---
  await openRowMenu(page, '');
  await page.screenshot({ path: 'test-results/screenshots/context-menu-connection.png' });
  expect(await menuItemIds(page)).toEqual([
    'disconnect',
    'refresh',
    'edit',
    'duplicate',
    'copy-name',
    'copy-uri',
    'filters',
    'open-console',
    'color',
    'readonly',
    '--separator--',
    'delete',
  ]);
  await page.keyboard.press('Escape');

  await openRowMenu(page, DB_PATH);
  expect(await menuItemIds(page)).toEqual([
    'refresh',
    'copy-name',
    'filters',
    'open-console',
    'set-as-default',
  ]);
  await page.keyboard.press('Escape');

  await openRowMenu(page, APP_PATH);
  expect(await menuItemIds(page)).toEqual([
    'refresh',
    'copy-name',
    'filters',
    'open-console',
    'set-as-default',
  ]);
  // D9: "Set as default" is unchecked until chosen, then stays checked on this row and clears
  // on the previously-default one — Postgres-only (§8.9), same connection this spec already has.
  await expect(
    page.locator('[data-testid="menu-item-set-as-default"] .icon-box .codicon-check'),
  ).toHaveCount(0);
  await page.click('[data-testid="menu-item-set-as-default"]');

  await openRowMenu(page, DB_PATH);
  await expect(
    page.locator('[data-testid="menu-item-set-as-default"] .icon-box .codicon-check'),
  ).toHaveCount(0);
  await page.keyboard.press('Escape');

  await openRowMenu(page, APP_PATH);
  await expect(
    page.locator('[data-testid="menu-item-set-as-default"] .icon-box .codicon-check'),
  ).toBeVisible();
  await page.keyboard.press('Escape');

  await openRowMenu(page, WIDE_TABLE_PATH);
  expect(await menuItemIds(page)).toEqual([
    'open-data',
    'open-data-new-tab',
    'open-definition',
    'open-console',
    'refresh',
    'copy-name',
    'copy-qualified-name',
    'count-rows',
    'saved-filters',
  ]);
  await page.keyboard.press('Escape');

  // P19 D2/D9: a group folder's own menu — Refresh (targets the *parent*, not the synthetic
  // path itself) and Collapse all, nothing that needs a real node.
  await openRowMenu(page, SEQUENCES_FOLDER_PATH);
  expect(await menuItemIds(page)).toEqual(['refresh', 'collapse-all']);
  await page.keyboard.press('Escape');

  // The Sequences folder is still expanded from the earlier expansion step —
  // sequence:invoice_number_seq is already one of its rendered children.
  await openRowMenu(page, SEQUENCE_PATH);
  expect(await menuItemIds(page)).toEqual(['copy-name', 'copy-qualified-name']);
  await page.keyboard.press('Escape');

  // Column rows no longer live in the tree (P19 D5) — the "Copy name / Add to projection /
  // Sort by" menu relocated into the definition view's Columns section; covered there in
  // definition.spec.ts (D9).

  // Collapse everything down to the bare connection row so a right-click well below it lands
  // on the virtual list's empty spacer, not on a `.tree-row` (which stops propagation itself).
  await (await findRow(page, '')).locator('.twisty').click();
  await page.locator('[data-testid="tree-background"]').click({
    button: 'right',
    position: { x: 10, y: 200 },
  });
  await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();
  expect(await menuItemIds(page)).toEqual(['new-connection', 'refresh-all', 'collapse-all']);
  await page.keyboard.press('Escape');
  await expandRow(page, ''); // restore — later steps expect the tree still expanded

  // --- disconnect: cached nodes still render; expanding any node (cached or not) reconnects
  // first rather than surfacing a disconnected error — the twisty is the primary way users
  // browse, so it shouldn't require a separate explicit "Connect" click first (P16 §8,
  // state/tree.ts's expand()). ---------------------------------------------------------------
  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-disconnect"]');
  await expect(connRow.locator('.status-dot')).toHaveAttribute('data-status', 'disconnected');

  // app is cached (L1 survives disconnect) — collapse/re-expand reconnects first (silently),
  // then still renders from cache with no error. Tables/collections no longer have their own
  // expand cycle to exercise here (P19 D5); a schema is the closest still-lazy level.
  const opsBeforeReconnect = await getOps(page);
  await (await findRow(page, APP_PATH)).locator('.twisty').click();
  const appRowAgain = await expandRow(page, APP_PATH);
  await expect(appRowAgain.locator('[data-testid="error-popover-trigger"]')).toHaveCount(0);
  await expect(connRow.locator('.status-dot')).toHaveAttribute('data-status', 'connected', {
    timeout: 10_000,
  });

  // D11: reconnecting invalidates the cache and re-fetches every currently-expanded *real* path
  // for this connection — '', database, app schema — 3 — plus the connect op itself. The
  // Sequences folder is also still "expanded" but is a synthetic '#'-path with no adapter path
  // of its own, so it is skipped, not re-fetched (project/state/tree.ts's refreshExpanded()) —
  // its members already reload with its parent.
  await expect
    .poll(async () => (await getOps(page)).length, { timeout: 10_000 })
    .toBe(opsBeforeReconnect.length + 1 + 3);

  // analytics was never expanded — no cache entry — but the connection is already back up (the
  // app-row expand above reconnected it), so this is a normal fresh fetch with real children,
  // not an error.
  const analyticsRow = await findRow(page, ANALYTICS_PATH);
  await analyticsRow.locator('.twisty').click();
  await expect(analyticsRow.locator('[data-testid="error-popover-trigger"]')).toHaveCount(0, {
    timeout: 10_000,
  });

  // --- search: cached-only, matches + ancestors, incomplete note --------------------------
  await page.fill('[data-testid="tree-search"]', 'order');
  await expect(page.locator('[data-testid="search-incomplete-note"]')).toBeVisible();
  await expect(await findRow(page, ORDER_ITEMS_PATH)).toBeVisible();
  await expect(await findRow(page, ORDERS_PATH)).toBeVisible();
  await expect(await findRow(page, ORDER_SUMMARY_PATH)).toBeVisible();
  expect(await page.locator(`[data-path="${WIDE_TABLE_PATH}"]`).count()).toBe(0);

  await page.click('[aria-label="Clear search"]');
  await expect(page.locator('[data-testid="search-incomplete-note"]')).toHaveCount(0);
  await expect(await findRow(page, WIDE_TABLE_PATH)).toBeVisible();

  // --- filters: hide the analytics schema, no new op-log rows, persists across relaunch ---
  const opsBeforeFilter = await getOps(page);
  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-filters"]');
  await expect(page.locator('[data-testid="filters-dialog"]')).toBeVisible();
  await page.click('.add-rule');
  const rule = page.locator('.rule-row').last();
  await rule.locator('select').first().selectOption('schema');
  await rule.locator('.pattern-input').fill('analytics');
  await page.locator('.dialog-footer button', { hasText: 'Save' }).click();
  await expect(page.locator('[data-testid="filters-dialog"]')).toHaveCount(0);

  expect(await page.locator(`[data-path="${ANALYTICS_PATH}"]`).count()).toBe(0);
  expect(await getOps(page)).toHaveLength(opsBeforeFilter.length);

  const { window: reopened } = await relaunch();
  await expandRow(reopened, '');
  await expandRow(reopened, DB_PATH);
  expect(await reopened.locator(`[data-path="${ANALYTICS_PATH}"]`).count()).toBe(0);
  await expect(await findRow(reopened, APP_PATH)).toBeVisible();

  expect(consoleErrors).toEqual([]);
});
