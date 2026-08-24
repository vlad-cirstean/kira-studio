import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  DOCKER_UNAVAILABLE_MESSAGE,
  isDockerAvailable,
  type PgFixture,
  startPostgres,
} from './support/pg';
import { connectionRow, expandRow, findRow, openRowMenu, treeContainer } from './support/tree';

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

// Scrolling the tree closes any open context menu (a window-level capture-phase 'scroll'
// listener backs that, correctly, so a menu never floats over content that's moved out from
// under it) — and a programmatic scrollTop write dispatches its 'scroll' event asynchronously,
// on a timer the browser controls. A blind `waitForTimeout` after the write is a guess at that
// timing; under load it guesses wrong and the event fires later, right after a click that opened
// a fresh menu, closing it before the next assertion sees it. So this waits for the 'scroll'
// event itself (falling back to a short timeout for a write that doesn't actually move
// scrollTop, which fires no event at all) before ever proceeding — the row is only found or
// clicked once no scroll event from this helper's own writes can still be in flight.
// The project tree is virtualized (VirtualList.vue) — a row not currently scrolled into view
// simply is not in the DOM. Scroll the container down in pages until the target row appears
// (or the bottom is reached) instead of asserting on a DOM query that may just be off-screen.
async function getOps(page: Page): Promise<OpRecordLike[]> {
  return page.evaluate(() => window.kira.opsRecent({ limit: 1000 }));
}

// A right-click on a row that Playwright still considers not-quite-in-view triggers its own
// internal scroll-into-view as part of the click's actionability check — a scroll whose 'scroll'
// event (caught, correctly, by the same window-level listener) can otherwise land asynchronously
// right after the click opens a fresh menu, closing it before the next assertion sees it.
// Scrolling the row fully into view ourselves first, and waiting out any resulting event, means
// the click that follows has nothing left to scroll.
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

  // --- sticky ancestor band (P28 §5) ----------------------------------------------------------
  // ProjectTree.vue's own literal (rowDensity defaults to 'comfortable') — the steady-state slot
  // math (top = 0/H/2H) below depends on it exactly.
  const H = 28;
  const treeScroll = treeContainer(page);
  const stickyRows = page.locator('[data-testid="tree-sticky-row"]');

  // Nothing is pinned at the top of the list.
  await treeScroll.evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.waitForTimeout(100);
  await expect(stickyRows).toHaveCount(0);

  // The connection and database pin as soon as they leave, in order, at top 0/H/2H.
  await (await findRow(page, WIDE_TABLE_PATH)).evaluate((el) =>
    el.scrollIntoView({ block: 'start' }),
  );
  await page.waitForTimeout(100);
  await expect(stickyRows).toHaveCount(3);
  await expect(stickyRows.nth(0)).toHaveAttribute('data-path', '');
  await expect(stickyRows.nth(1)).toHaveAttribute('data-path', DB_PATH);
  await expect(stickyRows.nth(2)).toHaveAttribute('data-path', APP_PATH);
  await expect(stickyRows.nth(0)).toHaveAttribute('data-depth', '0');
  await expect(stickyRows.nth(1)).toHaveAttribute('data-depth', '1');
  await expect(stickyRows.nth(2)).toHaveAttribute('data-depth', '2');

  // The band never exceeds the cap: scrolled into the (depth-3) Sequences folder, still exactly
  // three rows, and the folder itself is not among them.
  await sequenceRow.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(100);
  await expect(stickyRows).toHaveCount(3);
  await expect(
    page.locator('[data-testid="tree-sticky-row"]', { hasText: 'Sequences' }),
  ).toHaveCount(0);

  // A pinned row is a real row: its twisty collapses the real schema (the band shrinks to two),
  // and it carries the connection's colour rail.
  await expect(stickyRows.last()).toHaveAttribute('data-path', APP_PATH);
  await expect(stickyRows.last().locator('.p-tree-rail')).toBeVisible();
  await stickyRows.last().locator('.twisty').click();
  await expect(stickyRows).toHaveCount(2);
  await expandRow(page, APP_PATH); // restore for the assertions that follow

  // The band does not duplicate anything the rest of the suite counts (F5): the connection-kind
  // row count is unaffected, and no sticky row carries the tree's own roving tab stop.
  await (await findRow(page, WIDE_TABLE_PATH)).evaluate((el) =>
    el.scrollIntoView({ block: 'start' }),
  );
  await page.waitForTimeout(100);
  expect(await page.locator('[data-testid="tree-row"][data-kind="connection"]').count()).toBe(1);
  expect(await page.locator('[data-testid="tree-sticky-row"][tabindex="0"]').count()).toBe(0);

  // A row under the band is still reachable: the shared findRow scrolls it clear before
  // returning, so a click on a row that would otherwise land at the very top succeeds unretried.
  await (await findRow(page, WIDE_TABLE_PATH)).click();
  await expect(page.locator('[data-testid="context-menu"]')).toHaveCount(0);

  await treeScroll.evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.waitForTimeout(100);

  // --- two-connection handoff (D4): scrolling from one connection's section into the next ----
  const conn2Id = await page.evaluate(
    (cfg) =>
      window.kira
        .connectionsCreate({
          name: 'Tree DB 2',
          kind: 'postgres',
          color: 'violet',
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
  const conn2Row = connectionRow(page, 'Tree DB 2');
  await expect(conn2Row).toBeVisible();

  // Right at the boundary: the band's outermost — only — row is now the second connection.
  await conn2Row.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(100);
  await expect(stickyRows.first()).toContainText('Tree DB 2');

  // One row shy of the boundary: the first connection is still pinned, its slot pushed to (or
  // below) zero as the second connection's own header arrives to replace it — no gap, no second
  // header at the same offset.
  await treeScroll.evaluate((el, h) => {
    el.scrollTop -= h;
  }, H);
  await page.waitForTimeout(100);
  const firstStickyBeforeHandoff = stickyRows.first();
  await expect(firstStickyBeforeHandoff).toContainText('Tree DB');
  await expect(firstStickyBeforeHandoff).not.toContainText('Tree DB 2');
  const topPx = await firstStickyBeforeHandoff.evaluate((el) => Number.parseFloat(el.style.top));
  expect(topPx).toBeLessThanOrEqual(0);

  // Deleting the second connection keeps every later `data-path=""` lookup in this test
  // unambiguous — `path` is per-connection-relative, so two expanded connections would both
  // render one.
  await page.evaluate((id) => window.kira.connectionsDelete({ id }), conn2Id);
  await expect(conn2Row).toHaveCount(0);
  await treeScroll.evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.waitForTimeout(100);

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

  // --- checkbox tree filter (P28 §5) --------------------------------------------------------
  const filtersDialog = page.locator('[data-testid="filters-dialog"]');
  function filterKindRow(kind: string) {
    return page.locator(`[data-testid="filter-kind-row-${kind}"]`);
  }
  function filterKindCheckbox(kind: string) {
    return filterKindRow(kind).locator('input[type="checkbox"]');
  }
  function filterObjectRow(path: string) {
    return page.locator(`[data-testid="filter-object-row"][data-path="${path}"]`);
  }
  function filterObjectCheckbox(path: string) {
    return filterObjectRow(path).locator('input[type="checkbox"]');
  }
  async function openFilters(path: string): Promise<void> {
    await openRowMenu(page, path);
    await page.click('[data-testid="menu-item-filters"]');
    await expect(filtersDialog).toBeVisible();
  }
  async function saveFilters(): Promise<void> {
    await page.locator('.dialog-footer button', { hasText: 'Save' }).click();
    await expect(filtersDialog).toHaveCount(0);
  }
  async function cancelFilters(): Promise<void> {
    await page.locator('.dialog-footer button', { hasText: 'Cancel' }).click();
    await expect(filtersDialog).toHaveCount(0);
  }

  // --- opens focused on the invoking row (D20); issues no query while open (D21/D23); cancel
  // discards (baseline parity) --------------------------------------------------------------
  const opsBeforeDialog = await getOps(page);
  await openFilters(APP_PATH);
  // D20: the schema's ancestor (the database) is pre-expanded, so the schema's own row is
  // listed without any manual expand click.
  await expect(filterObjectRow(APP_PATH)).toBeVisible();
  await expect(page.locator('[data-testid="filters-preview"]')).toBeVisible();
  await expect(page.locator('.cached-note')).toContainText('Only cached nodes are listed');
  // Expand one level deeper inside the dialog and untick a box — still zero queries while open.
  await filterObjectRow(APP_PATH).locator('.twisty-btn').click();
  await expect(filterObjectRow(WIDE_TABLE_PATH)).toBeVisible();
  await filterObjectCheckbox(APP_PATH).click();
  await expect(filterObjectRow(APP_PATH)).toHaveAttribute('data-state', 'off');
  await cancelFilters();
  expect(await getOps(page)).toHaveLength(opsBeforeDialog.length);
  // Reopening shows the box still ticked — Cancel discarded the untick above. Focused on
  // APP_PATH again so its ancestor (the database) is pre-expanded, revealing it without a
  // manual expand click (D20).
  await openFilters(APP_PATH);
  await expect(filterObjectCheckbox(APP_PATH)).toBeChecked();
  await expect(filterObjectRow(APP_PATH)).toHaveAttribute('data-state', 'on');
  await cancelFilters();

  // --- tri-state (D15): unticking both schemas of kira_test partials the database row;
  // ticking the database row restores both and leaves the persisted path set empty -----------
  // Focused on APP_PATH so the database (both schemas' shared parent) is pre-expanded,
  // revealing both app and analytics without a manual expand click.
  await openFilters(APP_PATH);
  await filterObjectCheckbox(APP_PATH).click();
  await filterObjectCheckbox(ANALYTICS_PATH).click();
  await expect(filterObjectRow(DB_PATH)).toHaveAttribute('data-state', 'partial');
  await filterObjectCheckbox(DB_PATH).click();
  await expect(filterObjectRow(APP_PATH)).toHaveAttribute('data-state', 'on');
  await expect(filterObjectRow(ANALYTICS_PATH)).toHaveAttribute('data-state', 'on');
  await saveFilters();
  expect(
    (await page.evaluate((id) => window.kira.filtersList({ connectionId: id }), connectionId))
      .hiddenPaths,
  ).toEqual([]);

  // --- unticking a type hides every object of that kind, and its P19 folder with it (D10/D14);
  // a node hidden by its kind says so rather than silently unticking (D16); the consequence
  // strip counts what the tree will show (D17) ------------------------------------------------
  await openFilters(APP_PATH);
  await filterKindCheckbox('sequence').click();
  await expect(filterKindRow('sequence')).toHaveAttribute('data-state', 'off');
  await filterObjectRow(APP_PATH).locator('.twisty-btn').click();
  await expect(filterObjectCheckbox(SEQUENCE_PATH)).toBeDisabled();
  await expect(filterObjectRow(SEQUENCE_PATH)).toHaveAttribute('data-state', 'off');
  await expect(filterObjectRow(SEQUENCE_PATH).locator('.object-checkbox-label')).toHaveAttribute(
    'data-kira-tip',
    /.+/,
  );
  const previewBefore = await page.locator('[data-testid="filters-preview"]').innerText();
  const [shownBefore, totalBefore] = [...previewBefore.matchAll(/\d+/g)].map((m) => Number(m[0]));
  await saveFilters();

  expect(await page.locator(`[data-path="${SEQUENCE_PATH}"]`).count()).toBe(0);
  expect(await page.locator(`[data-path="${SEQUENCES_FOLDER_PATH}"]`).count()).toBe(0);
  await expect(await findRow(page, `${APP_PATH}#view`)).toBeVisible();
  await expect(await findRow(page, `${APP_PATH}#function`)).toBeVisible();
  // The strip's own count dropped below the connection's full cached total once sequences
  // were unticked — the visible proof the number is live, not decorative.
  expect(shownBefore).toBeLessThan(totalBefore);

  // Un-hide sequences again so the rest of the suite (and later phases) see the tree unfiltered.
  await openFilters(APP_PATH);
  await filterKindCheckbox('sequence').click();
  await saveFilters();
  expect(await page.locator(`[data-path="${SEQUENCES_FOLDER_PATH}"]`).count()).toBeGreaterThan(0);

  // --- the name filter is a substring, not a pattern (D17/D19) -------------------------------
  await openFilters(DB_PATH);
  await page.fill('[data-testid="filter-name-input"]', 'analyt');
  await expect(filterObjectRow(ANALYTICS_PATH)).toBeVisible();
  await expect(filterObjectRow(APP_PATH)).toHaveCount(0);
  await page.fill('[data-testid="filter-name-input"]', '.*');
  await expect(page.locator('[data-testid="filter-object-row"]')).toHaveCount(0);
  await cancelFilters();

  // --- unticking one schema hides exactly it, costs no query, and survives a relaunch
  // (D10/D11/D23) ------------------------------------------------------------------------------
  const opsBeforeFilter = await getOps(page);
  await openFilters('');
  await filterObjectRow(DB_PATH).locator('.twisty-btn').click();
  await filterObjectCheckbox(ANALYTICS_PATH).click();
  await expect(filterObjectRow(APP_PATH)).toHaveAttribute('data-state', 'on');
  await saveFilters();

  expect(await page.locator(`[data-path="${ANALYTICS_PATH}"]`).count()).toBe(0);
  expect(await page.locator(`[data-path="${APP_PATH}"]`).count()).toBeGreaterThan(0);
  expect(await getOps(page)).toHaveLength(opsBeforeFilter.length);

  const { window: reopened } = await relaunch();
  await expandRow(reopened, '');
  await expandRow(reopened, DB_PATH);
  expect(await reopened.locator(`[data-path="${ANALYTICS_PATH}"]`).count()).toBe(0);
  await expect(await findRow(reopened, APP_PATH)).toBeVisible();

  expect(consoleErrors).toEqual([]);
});
