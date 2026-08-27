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
  // .first(): the query editor's own CodeMirror instance is always first in DOM order (before
  // results-body/CellEditorDock, ConsoleView.vue's own template order) — once a result cell has
  // been clicked, a second .cm-content (the read-only cell editor's own) exists too.
  await view.locator('.cm-content').first().click();
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
  await page.click('[data-testid="color-magenta"]');
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

  // --- P43 iter3 D43/D44/F32: the same context menu, driven from the keyboard alone. -----------
  const contextMenu = page.locator('[data-testid="context-menu"]');
  const filterByValueItem = page.locator('[data-testid="menu-item-filter-by-value"]');
  await idCell.click({ button: 'right' });
  await expect(contextMenu).toBeVisible();
  for (let i = 0; i < 30; i++) {
    if (await filterByValueItem.evaluate((el) => el.classList.contains('is-active'))) break;
    await page.keyboard.press('ArrowDown');
  }
  await expect(filterByValueItem).toHaveClass(/is-active/);
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-testid="grid-row"]')).toHaveCount(1, { timeout: 10_000 });
  await expect(whereInput).toHaveValue(`"id" = '${idValue}'`);
  await whereInput.fill('');
  await whereInput.press('Enter');
  await expect(page.locator('[data-testid="grid-row"]')).toHaveCount(3, { timeout: 10_000 });

  // ArrowDown from nothing active lands on the first navigable row.
  await idCell.click({ button: 'right' });
  await expect(contextMenu).toBeVisible();
  await page.keyboard.press('ArrowDown');
  const firstActiveId = await contextMenu.locator('.is-active').getAttribute('data-testid');
  await page.keyboard.press('Escape');
  await expect(contextMenu).toHaveCount(0);

  // ArrowUp from nothing active wraps to the *last* navigable row, not off the end — and one more
  // ArrowDown from there wraps back around to the very first row, closing the loop.
  await idCell.click({ button: 'right' });
  await expect(contextMenu).toBeVisible();
  await page.keyboard.press('ArrowUp');
  await expect(contextMenu.locator('.is-active')).toHaveCount(1);
  const lastActiveId = await contextMenu.locator('.is-active').getAttribute('data-testid');
  expect(lastActiveId).not.toBe(firstActiveId);
  await page.keyboard.press('ArrowDown');
  await expect(contextMenu.locator('.is-active')).toHaveAttribute(
    'data-testid',
    firstActiveId ?? '',
  );

  // Escape still closes it, exactly as before.
  await page.keyboard.press('Escape');
  await expect(contextMenu).toHaveCount(0);

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

  // --- P43 iter3 D45/F33: a whole-row or whole-column selection draws its own end caps — before
  // this fix, isSelected(row, -1)/isSelected(row, columnCount) both read "selected" for a `row`
  // selection (the mirror for `column`), so the outermost cells thought they had a selected
  // neighbour just past the edge and drew no cap there. -----------------------------------------
  const columnNames = await grid
    .locator('[data-testid="grid-header-cell"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-column')));
  const firstColumnName = columnNames[0];
  const lastColumnName = columnNames[columnNames.length - 1];
  if (!firstColumnName || !lastColumnName) throw new Error('expected at least one grid column');

  await grid
    .locator('[data-testid="grid-row"][data-row="0"] [data-testid="grid-gutter-cell"]')
    .click();
  const rowFirstCell = page.locator(
    `[data-testid="grid-cell"][data-row="0"][data-column="${firstColumnName}"]`,
  );
  const rowLastCell = page.locator(
    `[data-testid="grid-cell"][data-row="0"][data-column="${lastColumnName}"]`,
  );
  await expect(rowFirstCell).toHaveClass(/sel-l/);
  await expect(rowFirstCell).not.toHaveClass(/sel-r/);
  await expect(rowLastCell).toHaveClass(/sel-r/);
  await expect(rowLastCell).not.toHaveClass(/sel-l/);

  await page.click(`[data-testid="grid-header-select"][data-column="${firstColumnName}"]`);
  const colFirstRowCell = page.locator(
    `[data-testid="grid-cell"][data-row="0"][data-column="${firstColumnName}"]`,
  );
  const colLastRowCell = page.locator(
    `[data-testid="grid-cell"][data-row="2"][data-column="${firstColumnName}"]`,
  );
  await expect(colFirstRowCell).toHaveClass(/sel-t/);
  await expect(colFirstRowCell).not.toHaveClass(/sel-b/);
  await expect(colLastRowCell).toHaveClass(/sel-b/);
  await expect(colLastRowCell).not.toHaveClass(/sel-t/);

  // Re-run P42's own 3×3 range assertions unchanged — the guard that bounding the probe did not
  // double any internal seam (the bug P42 D21 exists to prevent).
  await page.mouse.move(topLeftBox.x + topLeftBox.width / 2, topLeftBox.y + topLeftBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    bottomRightBox.x + bottomRightBox.width / 2,
    bottomRightBox.y + bottomRightBox.height / 2,
    { steps: 10 },
  );
  await page.mouse.up();
  await expect(grid.locator('.grid-cell.selected')).toHaveCount(9);
  await expect(cellTopLeft).toHaveClass(/sel-t/);
  await expect(cellTopLeft).toHaveClass(/sel-l/);
  await expect(cellTopLeft).not.toHaveClass(/sel-r/);
  await expect(cellTopLeft).not.toHaveClass(/sel-b/);
  await expect(cellBottomRight).toHaveClass(/sel-b/);
  await expect(cellBottomRight).toHaveClass(/sel-r/);
  await expect(cellBottomRight).not.toHaveClass(/sel-t/);
  await expect(cellBottomRight).not.toHaveClass(/sel-l/);
  await expect(middleCell).not.toHaveClass(/sel-t/);
  await expect(middleCell).not.toHaveClass(/sel-r/);
  await expect(middleCell).not.toHaveClass(/sel-b/);
  await expect(middleCell).not.toHaveClass(/sel-l/);
  await cellTopLeft.click();

  // --- P43 iter2 D35: an open inline editor is not a drag handle — a mousedown inside
  // grid-cell-input must not bubble to the cell's own drag-select handler. --------------------
  await cellTopLeft.dblclick();
  const cellInput = page.locator('[data-testid="grid-cell-input"]');
  await expect(cellInput).toBeVisible();
  const cellInputBox = await cellInput.boundingBox();
  if (!cellInputBox) throw new Error('cell input bounding box not found');
  await page.mouse.move(
    cellInputBox.x + cellInputBox.width / 2,
    cellInputBox.y + cellInputBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bottomRightBox.x + bottomRightBox.width / 2,
    bottomRightBox.y + bottomRightBox.height / 2,
    { steps: 10 },
  );
  await page.mouse.up();
  await expect(cellInput).toBeVisible();
  expect(await grid.locator('.grid-cell.selected').count()).toBeLessThanOrEqual(1);
  await page.keyboard.press('Escape');
  await expect(cellInput).toHaveCount(0);

  // --- P43 iter2 F22/D31: a generated ULID's timestamp half decodes to now, not the 22nd
  // century — the assertion that fails by a factor of four against the pre-fix encoder. ----------
  const ulidCellEditorPanel = page.locator('[data-testid="cell-editor-panel"]');
  await expect(ulidCellEditorPanel).toBeVisible();
  await page.click('[data-testid="cell-editor-generate"]');
  await page.click('[data-testid="cell-editor-generate-ulid"]');
  const ulid = (await ulidCellEditorPanel.locator('.cm-content').innerText()).trim();
  expect(ulid).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let decodedMs = 0;
  for (const c of ulid.slice(0, 10)) decodedMs = decodedMs * 32 + CROCKFORD.indexOf(c);
  expect(Math.abs(decodedMs - Date.now())).toBeLessThan(5 * 60 * 1000);

  // --- P43 iter3 D43/D44/F32: the cell editor's own format picker, driven from the keyboard
  // alone — P42 D27 replaced a native <select> (arrow-navigable, Enter-committable in every
  // browser) with a mouse-only context menu; this restores the capability that regression took
  // away. -----------------------------------------------------------------------------------
  await page.click('[data-testid="cell-editor-format"]');
  await expect(contextMenu).toBeVisible();
  const jsonFormatItem = page.locator('[data-testid="menu-item-format-json"]');
  for (let i = 0; i < 20; i++) {
    if (await jsonFormatItem.evaluate((el) => el.classList.contains('is-active'))) break;
    await page.keyboard.press('ArrowDown');
  }
  await expect(jsonFormatItem).toHaveClass(/is-active/);
  await page.keyboard.press('Enter');
  await expect(contextMenu).toHaveCount(0);
  await expect(ulidCellEditorPanel).toHaveAttribute('data-format', 'json');

  await page.click('[data-testid="toolbar-discard-changes"]');

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
  // P46-2: appending is the default now, shown unpressed — running again with no click adds a
  // second chip.
  await expect(newResultToggle).not.toHaveClass(/is-active/);
  await typeInto(consoleView, page, '\nSELECT 2;');
  await page.click('[data-testid="console-run-statement"]');
  const resultTabs = consoleView.locator('[data-testid="console-result-tab"]');
  await expect(resultTabs).toHaveCount(2);

  // --- P43 iter2 F20/D27: switching result chips clears the cell editor rather than leaving it
  // showing a cell from a result that is no longer the active one. --------------------------------
  await resultTabs.first().click();
  await consoleView.locator('[data-testid="console-result-cell"]').first().click();
  const cellEditorPanel = page.locator('[data-testid="cell-editor-panel"]');
  await expect(cellEditorPanel).toBeVisible();
  await resultTabs.last().click();
  await expect(cellEditorPanel).toHaveCount(0);

  await resultTabs.first().locator('[data-testid="console-result-close"]').click();
  await expect(resultTabs).toHaveCount(1);
  await expect(results).toContainText('2');

  // Pressing it (now shown active) is what makes a run replace the current result set instead of
  // appending.
  await newResultToggle.click();
  await expect(newResultToggle).toHaveClass(/is-active/);
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
  await page.click('[data-testid="console-search-close"]');

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

  // --- P43 iter2 F21/D29: a value the engine truncated is never reported as broken JSON. The
  // expression below generates an 80,001-byte value the page builder cuts at MAX_CELL_BYTES
  // (64 KB) and detectJson scores into its 0.35 bucket (P42's own intent) — exactly F21's path. --
  await typeInto(consoleView, page, "\nSELECT '{' || hex(zeroblob(40000)) AS big;");
  await page.click('[data-testid="console-run-statement"]');
  await expect(results).toContainText('big');
  await consoleView.locator('[data-testid="console-result-cell"]').first().click();
  const bigCellPanel = page.locator('[data-testid="cell-editor-panel"]');
  await expect(bigCellPanel).toBeVisible();
  await expect(bigCellPanel.locator('[data-testid="cell-editor-badge-truncated"]')).toBeVisible();
  await expect(bigCellPanel).toHaveAttribute('data-format', 'json');
  await expect(bigCellPanel.locator('[data-testid="cell-editor-invalid"]')).toHaveCount(0);

  // --- P49 F9/D4: the console's own column axis — a wide result no longer renders every column
  // of every visible row unconditionally. One row, 200 columns: the DOM-cell count below proves
  // real windowing (not an assertion that would pass either way), and scrolling to the far right
  // proves the windowed columns are still positioned correctly, not just fewer in number. --------
  const wideColumns = Array.from({ length: 200 }, (_, i) => `${i} AS c${i}`).join(', ');
  await typeInto(consoleView, page, `\nSELECT ${wideColumns};`);
  await page.click('[data-testid="console-run-statement"]');
  await expect(results).toContainText('c0');
  const wideCellCount = await results.locator('[data-testid="console-result-cell"]').count();
  expect(wideCellCount).toBeGreaterThan(0);
  expect(wideCellCount).toBeLessThan(200);
  const resultBody = results.locator('.body');
  await resultBody.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  await expect(
    results.locator('[data-testid="console-result-cell"]', { hasText: '199' }),
  ).toBeVisible();
  const wideCellCountAfterScroll = await results
    .locator('[data-testid="console-result-cell"]')
    .count();
  expect(wideCellCountAfterScroll).toBeLessThan(200);

  expect(consoleErrors).toEqual([]);
});

// P43: a second, focused test rather than growing the scenario above — this is the one Docker-free
// spec that can give commits 5/7/8/9's own findings real, executed coverage (§5).
test('sqlite — a failed commit reports the server error, verbatim; a filter change invalidates the count; a disconnect regates the tab; a commit reloads a sibling tab', async ({
  kira,
  consoleErrors,
}) => {
  if (!sqlite) throw new Error('sqlite fixture did not start');
  const { window: page } = kira;

  await page.click('[data-testid="add-connection"]');
  await page.click('[data-testid="connection-kind-sqlite"]');
  await page.fill('[data-testid="connection-name"]', 'Action Error DB');
  await page.fill('[data-testid="connection-database"]', sqlite.path);
  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);

  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-connect"]');
  await expect(
    page.locator('[data-testid="tree-row"][data-kind="connection"] .status-dot'),
  ).toHaveAttribute('data-status', 'connected', { timeout: 10_000 });
  await expandRow(page, '');
  await expandRow(page, DB_PATH);

  await (await findRow(page, ORDER_ITEMS_PATH)).dblclick();
  await expect(page.locator('[data-testid="data-grid"]')).toBeVisible();

  // --- P43 F5/D7: a failed commit reports the server's own error instead of an unhandled
  // rejection — id=1 already exists (0009_sqlite_seed.sql), so this insert violates the PK. ------
  await page.click('[data-testid="toolbar-add-row"]');
  const insertRow = page.locator('[data-testid="grid-row-insert"]');
  await expect(insertRow).toHaveCount(1);
  const insertInputs = insertRow.locator('[data-testid="grid-cell-insert"] input');
  await insertInputs.nth(0).fill('1');
  await insertInputs.nth(1).fill('1');
  await insertInputs.nth(2).fill('1');
  await insertInputs.nth(3).fill('1');
  await page.click('[data-testid="toolbar-commit-changes"]');
  const actionError = page.locator('[data-testid="data-action-error"]');
  await expect(actionError).toBeVisible();
  await expect(actionError).toContainText(/unique/i);

  // The staged insert survives the failure (clearPending only runs on success) — the explanation
  // was missing, not the data.
  await expect(insertRow).toHaveCount(1);
  await page.click('[data-testid="toolbar-discard-changes"]');
  await expect(insertRow).toHaveCount(0);
  await expect(actionError).toHaveCount(0);

  // The last assertion that actually proves the unhandled rejection is gone, not merely
  // accompanied by a strip.
  expect(consoleErrors).toEqual([]);

  // --- P43 F7/D10: a filter change invalidates the tab's count, rather than leaving a stale
  // total (and a ⏭ that can page past the end) pointing at the previous WHERE's row set. ---------
  const countButton = page.locator('[data-testid="toolbar-count"]');
  await countButton.click();
  await expect(countButton).toHaveAttribute('data-kira-tip', /Σ/, { timeout: 10_000 });
  const beforeTip = await countButton.getAttribute('data-kira-tip');
  expect(beforeTip).toMatch(/Σ\s*\d/);
  const pagerLast = page.locator('[data-testid="pager-last"]');
  await expect(pagerLast).toBeEnabled();

  const whereInput = page.locator('[data-testid="filter-where-input"]');
  await whereInput.fill('id = 1');
  await whereInput.press('Enter');
  await expect(page.locator('[data-testid="grid-row"]')).toHaveCount(1, { timeout: 10_000 });

  await expect(countButton).toHaveAttribute('data-kira-tip', 'Count all rows');
  await expect(pagerLast).toBeDisabled();

  await countButton.click();
  await expect(countButton).toHaveAttribute('data-kira-tip', /Σ\s*1(?!\d)/, { timeout: 10_000 });
  await expect(pagerLast).toBeEnabled();

  // --- P43 F9/D12: an explicit Disconnect regates every open tab of that connection back to
  // Reconnect & load — previously only a failed *load* did this, so a disconnected tab kept
  // showing its pre-disconnect rows until something happened to try reading it again. -----------
  const statusDot = page.locator('[data-testid="tree-row"][data-kind="connection"] .status-dot');
  const reconnectPanel = page.locator('[data-testid="reconnect-panel"]');
  const dataGrid = page.locator('[data-testid="data-grid"]');

  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-disconnect"]');
  await expect(statusDot).toHaveAttribute('data-status', 'disconnected', { timeout: 10_000 });
  await expect(reconnectPanel).toBeVisible();
  await expect(dataGrid).toHaveCount(0);

  // Reconnecting the connection itself does not re-fetch a gated tab — it stays gated until its
  // own "Reconnect & load" is pressed (D13: the tab's runtime, not just its rows, survived).
  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-connect"]');
  await expect(statusDot).toHaveAttribute('data-status', 'connected', { timeout: 10_000 });
  await expect(reconnectPanel).toBeVisible();
  await expect(dataGrid).toHaveCount(0);

  await page.click('[data-testid="reconnect-load"]');
  await expect(dataGrid).toBeVisible();
  await expect(reconnectPanel).toHaveCount(0);

  // --- P43 F10/D14: a committed mutation reloads every other hydrated tab on the same target —
  // no manual Refresh needed. This is the LAST step of this test: everything above runs against
  // an order_items table this step is the only one to actually mutate. --------------------------
  await openRowMenu(page, ORDER_ITEMS_PATH);
  await page.click('[data-testid="menu-item-open-data-new-tab"]');
  await expect(dataGrid).toBeVisible();
  await expect(page.locator('[data-testid="tab"]')).toHaveCount(2);

  const tabAId = await page.locator('[data-testid="tab"]').nth(0).getAttribute('data-tab-id');
  const tabBId = await page.locator('[data-testid="tab"]').nth(1).getAttribute('data-tab-id');
  if (!tabAId || !tabBId) throw new Error('tab ids not found');

  // tab B (just opened, no filter) sees id=1 — a real seeded row (0009_sqlite_seed.sql) that
  // every step above only staged-and-discarded or counted, never committed.
  const idCells = () => page.locator('[data-testid="grid-cell"][data-column="id"]');
  await expect
    .poll(async () => (await idCells().allInnerTexts()).includes('1'), { timeout: 10_000 })
    .toBe(true);

  // Back to tab A — still filtered to "id = 1" (the one row it shows) — delete and commit there.
  await page.click(`[data-testid="tab"][data-tab-id="${tabAId}"]`);
  await expect(page.locator('[data-testid="grid-row"]')).toHaveCount(1);
  await page.locator('[data-testid="grid-gutter-cell"]').nth(0).click();
  await page.click('[data-testid="toolbar-delete-row"]');
  await page.click('[data-testid="toolbar-commit-changes"]');
  await expect(page.locator('[data-testid="grid-row"]')).toHaveCount(0);

  // tab B never ran a manual Refresh — it must already be correct.
  await page.click(`[data-testid="tab"][data-tab-id="${tabBId}"]`);
  await expect
    .poll(async () => (await idCells().allInnerTexts()).includes('1'), { timeout: 10_000 })
    .toBe(false);
});
