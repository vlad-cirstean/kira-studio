import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { type SqliteFixture, startSqlite } from './support/sqlite';
import { expandRow, findRow, openRowMenu, treeContainer } from './support/tree';

// The fourth SQL engine through the real UI, and the only one that runs unconditionally (D35):
// no Docker gate, no container, no timeout budget for a healthcheck to pass — a temp-file
// fixture needs none of that. That makes this the one DB-backed UI spec that actually executes in
// every environment this repo runs in, including Claude Code's own Linux web container, where
// every other engine's UI spec self-skips for lack of Docker (AGENTS.md).

let sqlite: SqliteFixture | null = null;

test.beforeAll(async () => {
  sqlite = await startSqlite();
});

test.afterAll(async () => {
  await sqlite?.stop();
});

const DB_PATH = 'database:main';
const ORDER_ITEMS_PATH = `${DB_PATH}/table:order_items`;
const VIEWS_FOLDER_PATH = `${DB_PATH}#view`;

async function typeInto(
  view: ReturnType<Page['locator']>,
  page: Page,
  text: string,
): Promise<void> {
  await view.locator('.cm-content').click();
  await page.keyboard.type(text);
}

test('sqlite — engine picker, no network fields, database file, connect, tree, filter-by-value quoting, console', async ({
  kira,
  consoleErrors,
}) => {
  if (!sqlite) throw new Error('sqlite fixture did not start');
  const { window: page } = kira;

  // --- D12/D14: the engine picker shows a real SQLite tile, and picking it shows no network
  // fields at all — a missing branch would silently render the host/port/password form instead.
  await page.click('[data-testid="add-connection"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toBeVisible();
  const sqliteTile = page.locator('[data-testid="connection-kind-sqlite"]');
  await expect(sqliteTile).toBeVisible();
  const markHtml = await sqliteTile.locator('svg').innerHTML();
  expect(markHtml.trim().length).toBeGreaterThan(0);
  await sqliteTile.click();
  await expect(page.locator('[data-testid="connection-host"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="connection-port"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="connection-password"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="connection-credential-note"]')).toHaveCount(0);

  // --- D14: the Database file field is a plain, typeable text input ---------------------------
  await expect(page.locator('[data-testid="connection-database"]')).toBeVisible();
  await expect(page.locator('[data-testid="connection-browse"]')).toBeVisible();

  await page.fill('[data-testid="connection-name"]', 'Test SQLite');
  await page.fill('[data-testid="connection-database"]', sqlite.path);
  await page.click('[data-testid="color-violet"]');
  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);

  // --- D6: connecting shows the green dot and a SQLite 3.x server version ---------------------
  const connRow = page.locator('[data-testid="tree-row"][data-kind="connection"]').filter({
    hasText: 'Test SQLite',
  });
  await expect(connRow).toBeVisible();
  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-connect"]');
  const statusDot = connRow.locator('.status-dot');
  await expect(statusDot).toHaveAttribute('data-status', 'connected', { timeout: 10_000 });
  await expect(statusDot).toHaveAttribute('data-kira-tip', /^SQLite 3\./);

  // --- D19: main, its tables ungrouped, and a "Views" folder ----------------------------------
  await expandRow(page, '');
  const dbRow = await expandRow(page, DB_PATH);
  await expect(dbRow).toHaveAttribute('data-kind', 'database');
  const orderItemsRow = await findRow(page, ORDER_ITEMS_PATH);
  await expect(orderItemsRow).toHaveAttribute('data-kind', 'table');
  const viewsFolder = await findRow(page, VIEWS_FOLDER_PATH);
  await expect(viewsFolder).toBeVisible();
  await expect(viewsFolder).toContainText('Views');

  // --- P41 D4: the sticky ancestor band pins to the *top* of the scrollport — verified for real
  // here, since this is the one project-tree-touching spec that runs without Docker in this
  // sandbox. An inline height override on the scroll container itself (highest specificity, so it
  // wins over the CSS `height: 100%` chain) is what forces main's 16 tables + Views folder to
  // overflow deterministically, rather than depending on the fixture's default 1440x960 window —
  // roomy enough to fit them all without scrolling — or on window.ts's own 600px minHeight, which
  // would clamp a resize attempt short of forcing overflow anyway.
  const treeScroll = treeContainer(page);
  await treeScroll.evaluate((el) => {
    el.style.height = '150px';
  });
  await treeScroll.evaluate((el) => {
    el.scrollTop = 3 * 28; // ProjectTree.vue's own row-height literal (comfortable density)
  });
  await page.waitForTimeout(100);
  const stickyRows = page.locator('[data-testid="tree-sticky-row"]');
  await expect(stickyRows).toHaveCount(2); // connection + database — sqlite has no schema level
  const treeScrollBox = await treeScroll.boundingBox();
  const firstStickyBox = await stickyRows.first().boundingBox();
  if (!treeScrollBox || !firstStickyBox) throw new Error('expected both boxes to be measurable');
  expect(Math.abs(firstStickyBox.y - treeScrollBox.y)).toBeLessThanOrEqual(1);
  await treeScroll.evaluate((el) => {
    el.scrollTop = 0;
    el.style.height = '';
  });

  // --- D28: the load-bearing assertion — Filter by this value must double-quote, mirroring the
  // MySQL spec's own backtick assertion ---------------------------------------------------------
  await (await findRow(page, ORDER_ITEMS_PATH)).dblclick();
  await expect(page.locator('[data-testid="data-grid"]')).toBeVisible();
  const idHeader = page.locator('[data-testid="grid-header-cell"][data-column="id"]');
  await expect(idHeader).toBeVisible();

  // --- P42 D19/D20: the header tooltip renders name/type/description as separate elements. -----
  await idHeader.hover();
  const appTooltip = page.locator('[data-testid="app-tooltip"]');
  await expect(appTooltip).toBeVisible({ timeout: 1_000 });
  await expect(appTooltip.locator('.tip-title')).toHaveText('id');
  await expect(appTooltip.locator('.tip-meta')).not.toBeEmpty();
  await expect(appTooltip.locator('.tip-body')).not.toBeEmpty();
  const idMeta = (await appTooltip.locator('.tip-meta').innerText()).trim();
  const idBody = (await appTooltip.locator('.tip-body').innerText()).trim();
  await expect(idHeader).toHaveAttribute('data-kira-tip', ['id', idMeta, idBody].join('\n'));
  await page.mouse.move(4, 4);

  const idCell = page.locator('[data-testid="grid-cell"][data-row="0"][data-column="id"]');
  await expect(idCell).toBeVisible();
  const idValue = (await idCell.innerText()).trim();
  await idCell.click({ button: 'right' });
  await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();
  await page.click('[data-testid="menu-item-filter-by-value"]');
  await expect(page.locator('[data-testid="grid-row"]')).toHaveCount(1, { timeout: 10_000 });
  const whereInput = page.locator('[data-testid="filter-where-input"]');
  await expect(whereInput).toHaveValue(`"id" = '${idValue}'`);

  await whereInput.fill('');
  await whereInput.press('Enter');
  await expect(page.locator('[data-testid="grid-row"]')).toHaveCount(3, { timeout: 10_000 });

  // --- P42 D15/D16/D17: press-drag across cells builds a rectangular range; the corner cell
  // selects everything (order_items has exactly 4 columns/3 rows, so this covers 3 of each). -----
  const grid = page.locator('[data-testid="data-grid"]');
  const cellTopLeft = page.locator('[data-testid="grid-cell"][data-row="0"][data-column="id"]');
  const cellBottomRight = page.locator(
    '[data-testid="grid-cell"][data-row="2"][data-column="product_id"]',
  );
  const topLeftBox = await cellTopLeft.boundingBox();
  const bottomRightBox = await cellBottomRight.boundingBox();
  if (!topLeftBox || !bottomRightBox) throw new Error('cell bounding boxes not found');
  await page.mouse.move(topLeftBox.x + topLeftBox.width / 2, topLeftBox.y + topLeftBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    bottomRightBox.x + bottomRightBox.width / 2,
    bottomRightBox.y + bottomRightBox.height / 2,
    { steps: 10 },
  );
  await page.mouse.up();
  await expect(grid.locator('.grid-cell.selected')).toHaveCount(9);

  // --- P42 D21/F15: only the selection's own outer perimeter draws an edge — a seam shared with
  // a selected neighbour draws none, so a 3x3 block shows one uniform border, not doubled lines
  // at the internal seams. -------------------------------------------------------------------
  await expect(cellTopLeft).toHaveClass(/sel-t/);
  await expect(cellTopLeft).toHaveClass(/sel-l/);
  await expect(cellTopLeft).not.toHaveClass(/sel-r/);
  await expect(cellTopLeft).not.toHaveClass(/sel-b/);
  await expect(cellBottomRight).toHaveClass(/sel-b/);
  await expect(cellBottomRight).toHaveClass(/sel-r/);
  await expect(cellBottomRight).not.toHaveClass(/sel-t/);
  await expect(cellBottomRight).not.toHaveClass(/sel-l/);
  const middleCell = page.locator(
    '[data-testid="grid-cell"][data-row="1"][data-column="order_id"]',
  );
  await expect(middleCell).not.toHaveClass(/sel-t/);
  await expect(middleCell).not.toHaveClass(/sel-r/);
  await expect(middleCell).not.toHaveClass(/sel-b/);
  await expect(middleCell).not.toHaveClass(/sel-l/);

  // A single selected cell (no selected neighbour in any direction) still draws all four edges.
  await cellTopLeft.click();
  await expect(cellTopLeft).toHaveClass(/sel-t/);
  await expect(cellTopLeft).toHaveClass(/sel-r/);
  await expect(cellTopLeft).toHaveClass(/sel-b/);
  await expect(cellTopLeft).toHaveClass(/sel-l/);

  // Shift-click still extends a range exactly as it did before drag-select existed.
  await cellTopLeft.click();
  await cellBottomRight.click({ modifiers: ['Shift'] });
  await expect(grid.locator('.grid-cell.selected')).toHaveCount(9);

  const totalCells = await grid.locator('[data-testid="grid-cell"]').count();
  await page.click('[data-testid="grid-select-all"]');
  await expect(grid.locator('.grid-cell.selected')).toHaveCount(totalCells);

  // --- D28's other half: the console tab is really in SQL mode, not plain text ----------------
  await openRowMenu(page, DB_PATH);
  await page.click('[data-testid="menu-item-open-console"]');
  const consoleView = page.locator('[data-testid="console-view"]');
  await expect(consoleView).toBeVisible();
  await typeInto(consoleView, page, 'SELECT 1;');
  await page.click('[data-testid="console-run-statement"]');
  const results = consoleView.locator('[data-testid="console-result-grid"]');
  await expect(results).toHaveCount(1);
  await expect(results.first()).toContainText('1');

  // --- P40: the result-set strip, the new-vs-reuse toggle and the find toolbar — this is the
  // one console-touching spec that runs unconditionally in this repo's own sandbox (no Docker
  // gate), so it is where these get real, non-Docker-gated coverage. Kept short — console.spec.ts
  // (Postgres-backed) covers the deeper scenarios (chip switching, ×, filtering).
  const newResultToggle = consoleView.locator('[data-testid="console-new-result-toggle"]');
  // P42 D5: appending is the default now — running again with no click adds a second chip.
  await expect(newResultToggle).toHaveClass(/is-active/);
  await typeInto(consoleView, page, '\nSELECT 2;');
  await page.click('[data-testid="console-run-statement"]');
  const resultTabs = consoleView.locator('[data-testid="console-result-tab"]');
  await expect(resultTabs).toHaveCount(2);

  await resultTabs.first().locator('[data-testid="console-result-close"]').click();
  await expect(resultTabs).toHaveCount(1);
  await expect(results).toContainText('2');

  // Toggling it off is what makes a run reuse the current result set instead of appending.
  await newResultToggle.click();
  await expect(newResultToggle).not.toHaveClass(/is-active/);
  await typeInto(consoleView, page, '\nSELECT 3;');
  await page.click('[data-testid="console-run-statement"]');
  await expect(resultTabs).toHaveCount(1);
  await expect(results).toContainText('3');

  await page.click('[data-testid="console-search"]');
  const searchToolbar = consoleView.locator('[data-testid="console-search-toolbar"]');
  await expect(searchToolbar).toBeVisible();
  await page.fill('[data-testid="console-search-input"]', '3');
  await expect(searchToolbar.locator('[data-testid="console-search-count"]')).toContainText(
    '1 of 1',
  );

  // --- P42 D14/D14a: word wrap is on by default in every CodeMirror surface (F11) — this is the
  // one Docker-free spec that can exercise the new setting for real. -----------------------------
  const consoleContent = consoleView.locator('.cm-content');
  const wrappedWhiteSpace = await consoleContent.evaluate((el) => getComputedStyle(el).whiteSpace);
  await page.click('[data-testid="open-settings"]');
  await page.click('[data-testid="settings-section-Appearance"]');
  const wordWrapToggle = page.locator('[data-testid="settings-word-wrap"]');
  await expect(wordWrapToggle).toBeChecked();
  await wordWrapToggle.uncheck();
  await page.click('[data-testid="settings-close"]');
  const unwrappedWhiteSpace = await consoleContent.evaluate(
    (el) => getComputedStyle(el).whiteSpace,
  );
  expect(unwrappedWhiteSpace).not.toBe(wrappedWhiteSpace);

  expect(consoleErrors).toEqual([]);
});
