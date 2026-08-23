import type { ElectronApplication, Locator, Page } from '@playwright/test';
import type { ConnectionColor } from '@shared/domain/connection';
import { expect, test } from './fixtures';
import {
  DOCKER_UNAVAILABLE_MESSAGE,
  isDockerAvailable,
  type PgFixture,
  startPostgres,
} from './support/pg';

// P6 §8.14: the full right-click matrix (grid cell/row/header, ops panel), row/column
// selection accumulation, copy/paste, and the native-menu keyboard shortcuts (D11/D12).
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
// Same target mutations.spec.ts uses and for the same reason: a genuine 2-column primary key,
// no inbound FK, three known rows — a clean surface for selection/copy/paste/menu scenarios.
const COMPOSITE_PATH = `${APP_PATH}/table:composite_pk`;
// P7: the regions -> customers -> orders -> order_items <- products graph plus employees'
// self-referencing FK — see 0001_seed.sql's own comment for why this shape exists.
const EMPLOYEES_PATH = `${APP_PATH}/table:employees`;
const ORDERS_PATH = `${APP_PATH}/table:orders`;
const ORDER_ITEMS_PATH = `${APP_PATH}/table:order_items`;

function treeContainer(page: Page): Locator {
  return page.locator('[data-testid="tree-background"] .virtual-list');
}

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
        el.classList.contains('separator')
          ? '--separator--'
          : (el.getAttribute('data-testid') ?? '').replace('menu-item-', ''),
      ),
    );
}

// Mirrors tree.spec.ts's openRowMenu: Playwright's own actionability check can trigger an
// internal scroll-into-view whose 'scroll' event lands asynchronously right after the click
// opens a fresh menu — caught by ContextMenu.vue's own window-level capture listener — closing
// it before the next assertion sees it. Draining any pending scroll first avoids the race.
async function rightClick(locator: Locator): Promise<void> {
  const page = locator.page();
  const menu = page.locator('[data-testid="context-menu"]');
  for (let attempt = 0; attempt < 4; attempt++) {
    await locator.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await locator.click({ button: 'right' });
    await expect(menu).toBeVisible();
    // A residual async scroll — from this click's own actionability check, or from a plain
    // click just before it (e.g. gutter-row selection) — can still land after the menu opens.
    // ContextMenu.vue closes on any window-level 'scroll' event (capture phase, so it fires for
    // scroll on any nested scrollable descendant too), so a late-arriving one silently closes
    // the menu we just opened. Give it a moment to land, then confirm the menu actually stuck
    // before trusting it; retry the whole open if it didn't.
    await page.waitForTimeout(400);
    if (await menu.isVisible()) return;
  }
  await expect(menu).toBeVisible();
}

async function openSubmenu(page: Page, triggerId: string): Promise<void> {
  await page.locator(`[data-testid="menu-item-${triggerId}"]`).hover();
  await expect(page.locator('[data-testid="context-submenu"]')).toBeVisible();
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
  return page.evaluate(
    ({ cfg, opts }) =>
      window.kira
        .connectionsCreate({
          name: opts.name,
          kind: 'postgres',
          color: opts.color,
          mode: 'fields',
          readOnly: opts.readOnly,
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
    { cfg, opts },
  );
}

function gridCell(page: Page, row: number, column: string): Locator {
  return page.locator(`[data-testid="grid-cell"][data-row="${row}"][data-column="${column}"]`);
}

async function cellText(page: Page, row: number, column: string): Promise<string> {
  return (await gridCell(page, row, column)).innerText();
}

function cellNavButton(page: Page, row: number, column: string): Locator {
  return gridCell(page, row, column).locator('[data-testid="cell-nav-button"]');
}

// P7 D6: a cell's nav button only appears while its .grid-cell carries .selected (pure-CSS
// hover/selection gate, D5) — select it first the same way a real user's click would, then act
// on the now-visible button.
async function clickCellNav(page: Page, row: number, column: string): Promise<void> {
  await gridCell(page, row, column).click();
  await cellNavButton(page, row, column).click();
}

function gutterCell(page: Page, row: number): Locator {
  return page.locator('[data-testid="grid-gutter-cell"]').nth(row);
}

function headerCell(page: Page, column: string): Locator {
  return page.locator(`[data-testid="grid-header-cell"][data-column="${column}"]`);
}

async function clipboardText(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

async function discardChanges(page: Page): Promise<void> {
  await page.click('[data-testid="toolbar-discard-changes"]');
  await expect(page.locator('[data-testid="toolbar-commit-changes"]')).toHaveCount(0);
}

interface OpRecordLike {
  id: string;
  connectionId: string | null;
  kind: string;
  status: string;
  command: string | null;
}

async function getOps(page: Page): Promise<OpRecordLike[]> {
  return page.evaluate(() => window.kira.opsRecent({ limit: 1000 }));
}

async function typeInto(view: Locator, page: Page, text: string): Promise<void> {
  await view.locator('.cm-content').click();
  await page.keyboard.type(text);
}

// D11: every shortcut is wired through the app's native menu (main/menu.ts) rather than a
// second renderer-side keydown dispatcher — clicking the item by label exercises the exact
// same IPC round trip a real accelerator keypress would, without depending on the test
// runner's window having real OS-level keyboard focus under xvfb.
async function clickMenuItem(
  app: ElectronApplication,
  menuLabel: string,
  itemLabel: string,
): Promise<void> {
  await app.evaluate(
    ({ Menu }, args) => {
      const menu = Menu.getApplicationMenu();
      const top = menu?.items.find((i) => i.label === args.menuLabel);
      const item = top?.submenu?.items.find((i) => i.label === args.itemLabel);
      if (!item) throw new Error(`menu item not found: ${args.menuLabel} > ${args.itemLabel}`);
      item.click();
    },
    { menuLabel, itemLabel },
  );
}

test('interaction completeness — grid menus, selection, copy/paste, ops menu, shortcuts', async ({
  kira,
}) => {
  test.setTimeout(300_000);
  if (!pg) throw new Error('postgres fixture did not start');
  const { app, window: page } = kira;

  await page.evaluate(() => window.kira.settingsSet({ data: { prefetch: false } }));

  await page.click('[data-testid="toggle-operations-panel"]');
  await expect(page.locator('[data-testid="operations-panel"]')).toBeVisible();

  // The cell editor panel is visible by default (§8's own layout default) and, combined with the
  // operations panel this test needs open throughout, leaves too little vertical room for the
  // console/grid editor area — close it since none of D1-D14 here exercise it.
  await page.click('[data-testid="toggle-cell-editor-panel"]');
  await expect(page.locator('[data-testid="cell-editor"]')).toHaveCount(0);

  const cfg = {
    host: pg.config.host,
    port: pg.config.port,
    database: pg.config.database,
    username: pg.config.username,
    password: pg.config.password,
  };
  await createConnection(page, cfg, {
    name: 'Interaction DB',
    color: 'green',
    readOnly: false,
  });

  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-connect"]');
  await expect(
    page.locator('[data-testid="tree-row"][data-kind="connection"] .status-dot'),
  ).toHaveAttribute('data-status', 'connected', { timeout: 10_000 });
  await expandRow(page, '');
  await expandRow(page, DB_PATH);
  await expandRow(page, APP_PATH);

  const compositeRow = await findRow(page, COMPOSITE_PATH);
  await compositeRow.dblclick();
  const grid = page.locator('[data-testid="data-grid"]');
  await expect(grid).toBeVisible();
  await expect(headerCell(page, 'name')).toBeVisible();

  // =============================================================================================
  // D4: cell context menu — Copy / Copy with header / Copy as JSON / Edit / Set NULL /
  // Filter by this value.
  // =============================================================================================
  const row0Name = await cellText(page, 0, 'name');
  expect(row0Name).toBe('tenant 1 / entity 1');

  await rightClick(gridCell(page, 0, 'name'));
  expect(await menuItemIds(page)).toEqual([
    'copy',
    'copy-with-header',
    'copy-as-json',
    '--separator--',
    'edit',
    'set-null',
    'filter-by-value',
  ]);

  await page.click('[data-testid="menu-item-copy"]');
  expect(await clipboardText(page)).toBe(row0Name);

  await rightClick(gridCell(page, 0, 'name'));
  await page.click('[data-testid="menu-item-copy-with-header"]');
  expect(await clipboardText(page)).toBe(`name\n${row0Name}`);

  await rightClick(gridCell(page, 0, 'name'));
  await page.click('[data-testid="menu-item-copy-as-json"]');
  expect(await clipboardText(page)).toBe(JSON.stringify(row0Name));

  await rightClick(gridCell(page, 0, 'name'));
  await page.click('[data-testid="menu-item-edit"]');
  const cellInput = page.locator('[data-testid="grid-cell-input"]');
  await expect(cellInput).toBeVisible();
  await expect(cellInput).toHaveValue(row0Name);
  await cellInput.press('Escape');
  await expect(cellInput).toHaveCount(0);

  // Filter by this value replaces (D5) the WHERE box's effect — the "= value" branch, dialect
  // quoted with Postgres double quotes.
  await rightClick(gridCell(page, 0, 'name'));
  await page.click('[data-testid="menu-item-filter-by-value"]');
  await expect(page.locator('[data-testid="grid-row"]')).toHaveCount(1, { timeout: 10_000 });
  expect(await cellText(page, 0, 'name')).toBe(row0Name);

  await page.fill('[data-testid="filter-where-input"]', '');
  await page.press('[data-testid="filter-where-input"]', 'Enter');
  await expect(page.locator('[data-testid="grid-row"]')).toHaveCount(3, { timeout: 10_000 });

  // Set NULL stages an actual SQL NULL, never a string — the inline <input> can't express this.
  await rightClick(gridCell(page, 0, 'name'));
  await page.click('[data-testid="menu-item-set-null"]');
  await expect(gridCell(page, 0, 'name')).toHaveClass(/pending-edit/);
  await expect(gridCell(page, 0, 'name').locator('.cell-null')).toHaveText('NULL');

  // Filter by this value on the now-null cell exercises the "IS NULL" branch — no fixture row
  // has a real NULL name, so 0 rows matching proves the generated clause is IS NULL, not = ''.
  await rightClick(gridCell(page, 0, 'name'));
  await page.click('[data-testid="menu-item-filter-by-value"]');
  await expect(page.locator('.no-rows')).toBeVisible({ timeout: 10_000 });

  // D3: a pending-change set is scoped to the page/query it was staged against — applying the
  // filter above already reloaded the grid and dropped the staged NULL, so clearing the filter
  // just reveals the real, unedited value again. No discard is needed (or possible: the toolbar's
  // discard button only renders while pending changes exist).
  await page.fill('[data-testid="filter-where-input"]', '');
  await page.press('[data-testid="filter-where-input"]', 'Enter');
  await expect(page.locator('[data-testid="grid-row"]')).toHaveCount(3, { timeout: 10_000 });
  await expect(gridCell(page, 0, 'name')).not.toHaveClass(/pending-edit/);
  expect(await cellText(page, 0, 'name')).toBe(row0Name);

  // =============================================================================================
  // D2/D3/D6: row selection accumulation (Shift range, Ctrl toggle) and the row context menu's
  // selection convention — right-clicking inside the current selection acts on all of it,
  // right-clicking outside it replaces the selection with just that row first.
  // =============================================================================================
  await gutterCell(page, 0).click();
  await gutterCell(page, 2).click({ modifiers: ['Shift'] }); // rows [0,1,2]
  await rightClick(gutterCell(page, 1)); // inside the selection -> acts on all 3
  await openSubmenu(page, 'copy-rows');
  await page.click('[data-testid="menu-item-copy-rows-tsv"]');
  const allRowsTsv = await clipboardText(page);
  expect(allRowsTsv.split('\n')).toHaveLength(3);
  expect(allRowsTsv).toContain('tenant 1 / entity 1');
  expect(allRowsTsv).toContain('tenant 1 / entity 2');
  expect(allRowsTsv).toContain('tenant 2 / entity 1');

  await gutterCell(page, 0).click(); // plain click -> replaces with [0]
  await rightClick(gutterCell(page, 2)); // outside [0] -> replaces with [2] alone
  await openSubmenu(page, 'copy-rows');
  await page.click('[data-testid="menu-item-copy-rows-csv"]');
  const row2Csv = await clipboardText(page);
  expect(row2Csv.trim()).toBe('2,1,tenant 2 / entity 1');

  await gutterCell(page, 0).click(); // [0]
  await gutterCell(page, 2).click({ modifiers: ['Control'] }); // toggles row 2 in -> [0,2] disjoint
  await rightClick(gutterCell(page, 0)); // inside [0,2] -> acts on both
  await openSubmenu(page, 'copy-rows');
  await page.click('[data-testid="menu-item-copy-rows-json"]');
  const disjointJson = JSON.parse(await clipboardText(page)) as Array<Record<string, unknown>>;
  expect(disjointJson).toHaveLength(2);
  expect(disjointJson.map((r) => r.name).sort()).toEqual(
    ['tenant 1 / entity 1', 'tenant 2 / entity 1'].sort(),
  );

  // D6: Duplicate row(s) — non-PK columns copied, PK columns left blank.
  await gutterCell(page, 0).click();
  await rightClick(gutterCell(page, 0));
  await page.click('[data-testid="menu-item-duplicate-row"]');
  const insertRow = page.locator('[data-testid="grid-row-insert"]');
  await expect(insertRow).toHaveCount(1);
  const insertInputs = insertRow.locator('[data-testid="grid-cell-insert"] input');
  await expect(insertInputs.nth(0)).toHaveValue(''); // tenant_id (PK) left blank
  await expect(insertInputs.nth(1)).toHaveValue(''); // entity_id (PK) left blank
  await expect(insertInputs.nth(2)).toHaveValue('tenant 1 / entity 1'); // name copied
  await discardChanges(page);
  await expect(insertRow).toHaveCount(0);

  // Delete row(s) marks the acted-on rows struck-through, uncommitted.
  await gutterCell(page, 1).click();
  await rightClick(gutterCell(page, 1));
  await page.click('[data-testid="menu-item-delete-row"]');
  await expect(page.locator('[data-testid="grid-row"][data-row="1"]')).toHaveClass(
    /pending-delete/,
  );
  await discardChanges(page);

  // =============================================================================================
  // D7/D8: header context menu — Sort asc/desc/Clear sort, Hide column/Show all columns,
  // Copy column name/values.
  // =============================================================================================
  await rightClick(headerCell(page, 'entity_id'));
  expect(await menuItemIds(page)).toEqual([
    'sort-asc',
    'sort-desc',
    'clear-sort',
    '--separator--',
    'hide-column',
    'show-all-columns',
    '--separator--',
    'copy-column-name',
    'copy-column-values',
  ]);
  await page.click('[data-testid="menu-item-sort-asc"]');
  await expect(headerCell(page, 'entity_id').locator('.sort-chevron')).toHaveText('▲');

  await rightClick(headerCell(page, 'entity_id'));
  await page.click('[data-testid="menu-item-sort-desc"]');
  await expect(headerCell(page, 'entity_id').locator('.sort-chevron')).toHaveText('▼');

  await rightClick(headerCell(page, 'entity_id'));
  await page.click('[data-testid="menu-item-clear-sort"]');
  await expect(page.locator('.sort-chevron')).toHaveCount(0);

  await rightClick(headerCell(page, 'name'));
  await page.click('[data-testid="menu-item-copy-column-name"]');
  expect(await clipboardText(page)).toBe('name');

  await rightClick(headerCell(page, 'name'));
  await page.click('[data-testid="menu-item-copy-column-values"]');
  const columnValues = (await clipboardText(page)).split('\n');
  expect(columnValues).toEqual(
    expect.arrayContaining(['tenant 1 / entity 1', 'tenant 1 / entity 2', 'tenant 2 / entity 1']),
  );

  await rightClick(headerCell(page, 'entity_id'));
  await page.click('[data-testid="menu-item-hide-column"]');
  await expect(headerCell(page, 'entity_id')).toHaveCount(0);

  await rightClick(headerCell(page, 'tenant_id'));
  await page.click('[data-testid="menu-item-show-all-columns"]');
  await expect(headerCell(page, 'entity_id')).toBeVisible();

  // =============================================================================================
  // D1/D13: local grid copy/paste via Ctrl+C/Ctrl+V — anchor-and-fill, rows beyond the loaded
  // page become new pending inserts.
  // =============================================================================================
  await page.evaluate(() => navigator.clipboard.writeText('typed via paste'));
  await gridCell(page, 0, 'name').click();
  await grid.focus();
  await page.keyboard.press('Control+v');
  await expect(gridCell(page, 0, 'name')).toHaveClass(/pending-edit/);
  expect(await cellText(page, 0, 'name')).toBe('typed via paste');
  await discardChanges(page);

  // Two TSV rows starting at the last existing row: row 2 becomes a staged edit, the row past
  // the loaded page becomes a new pending insert.
  await page.evaluate(() =>
    navigator.clipboard.writeText('2\t1\tedited last row\n3\t3\tbrand new row'),
  );
  await gridCell(page, 2, 'tenant_id').click();
  await grid.focus();
  await page.keyboard.press('Control+v');
  await expect(gridCell(page, 2, 'name')).toHaveClass(/pending-edit/);
  expect(await cellText(page, 2, 'name')).toBe('edited last row');
  const pastedInsertRow = page.locator('[data-testid="grid-row-insert"]');
  await expect(pastedInsertRow).toHaveCount(1);
  const pastedInsertInputs = pastedInsertRow.locator('[data-testid="grid-cell-insert"] input');
  await expect(pastedInsertInputs.nth(0)).toHaveValue('3');
  await expect(pastedInsertInputs.nth(1)).toHaveValue('3');
  await expect(pastedInsertInputs.nth(2)).toHaveValue('brand new row');
  await discardChanges(page);

  // =============================================================================================
  // D10: Operations panel context menu additions — copy-command, copy-error, Re-run, Cancel.
  // =============================================================================================
  await openRowMenu(page, COMPOSITE_PATH);
  await page.click('[data-testid="menu-item-open-console"]');
  const consoleView = page.locator('[data-testid="console-view"]');
  await expect(consoleView).toBeVisible();
  await typeInto(consoleView, page, 'SELECT 111 AS answer;');
  await page.click('[data-testid="console-run-statement"]');
  await expect(consoleView.locator('[data-testid="console-result-grid"]')).toContainText('111');

  const okOpRow = page.locator('[data-testid="op-row"]').filter({ hasText: 'SELECT 111' });
  await expect(okOpRow).toBeVisible();
  await rightClick(okOpRow);
  expect(await menuItemIds(page)).toEqual([
    'reveal-tab',
    'copy-command',
    'copy-error',
    're-run',
    'cancel',
  ]);
  await expect(page.locator('[data-testid="menu-item-copy-error"]')).toHaveClass(/disabled/);
  await expect(page.locator('[data-testid="menu-item-cancel"]')).toHaveClass(/disabled/);

  await page.click('[data-testid="menu-item-copy-command"]');
  expect(await clipboardText(page)).toContain('SELECT 111');

  const tabsBeforeRerun = await page.locator('[data-testid="tab"]').count();
  await rightClick(okOpRow);
  await page.click('[data-testid="menu-item-re-run"]');
  await expect
    .poll(async () => page.locator('[data-testid="tab"]').count())
    .toBe(tabsBeforeRerun + 1);
  const activeConsoleView = page.locator('[data-testid="console-view"]');
  await expect(activeConsoleView.locator('[data-testid="console-result-grid"]')).toContainText(
    '111',
    { timeout: 10_000 },
  );

  // Error op: copy-error copies the adapter's verbatim message.
  await openRowMenu(page, COMPOSITE_PATH);
  await page.click('[data-testid="menu-item-open-console"]');
  const errorConsoleView = page.locator('[data-testid="console-view"]');
  await typeInto(errorConsoleView, page, 'SELECT * FROM this_table_does_not_exist_zzz;');
  await page.click('[data-testid="console-run-all"]');
  await expect(errorConsoleView.locator('[data-testid="console-error"]')).toBeVisible();

  const errorOpRow = page
    .locator('[data-testid="op-row"][data-status="error"]')
    .filter({ hasText: 'this_table_does_not_exist_zzz' });
  await expect(errorOpRow).toBeVisible();
  await rightClick(errorOpRow);
  await page.click('[data-testid="menu-item-copy-error"]');
  expect((await clipboardText(page)).toLowerCase()).toContain('does not exist');

  // Cancel: a slow statement is still 'running' long enough to right-click and cancel it.
  await openRowMenu(page, COMPOSITE_PATH);
  await page.click('[data-testid="menu-item-open-console"]');
  const slowConsoleView = page.locator('[data-testid="console-view"]');
  await typeInto(slowConsoleView, page, 'SELECT pg_sleep(2);');
  await page.click('[data-testid="console-run-statement"]');
  const runningOpRow = page.locator('[data-testid="op-row"][data-status="running"]');
  await expect(runningOpRow).toBeVisible();
  await rightClick(runningOpRow);
  await expect(page.locator('[data-testid="menu-item-cancel"]')).not.toHaveClass(/disabled/);
  await page.click('[data-testid="menu-item-cancel"]');
  await expect
    .poll(async () => (await getOps(page)).find((o) => o.command?.includes('pg_sleep'))?.status, {
      timeout: 10_000,
    })
    .toBe('cancelled');

  // =============================================================================================
  // D11/D12: native-menu keyboard shortcuts — Command Palette, tab next/prev/close, Find,
  // Refresh, Run Statement/Run All.
  // =============================================================================================
  await clickMenuItem(app, 'View', 'Command Palette…');
  await expect(page.locator('[data-testid="command-palette"]')).toBeVisible();
  await page.fill('[data-testid="command-palette-input"]', 'toggle project');
  const paletteItems = page.locator('[data-testid="command-palette-item"]');
  await expect(paletteItems).toHaveCount(1);
  await expect(paletteItems.first()).toHaveAttribute('data-command-id', 'toggle-project-panel');
  await expect(page.locator('[data-testid="project-panel"]')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-testid="command-palette-backdrop"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="project-panel"]')).toHaveCount(0);

  // Restore the project panel via the palette a second time — later steps don't need the tree,
  // but leaving the workbench in the state the rest of the app expects is cheap insurance.
  await clickMenuItem(app, 'View', 'Command Palette…');
  await page.fill('[data-testid="command-palette-input"]', 'toggle project');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-testid="project-panel"]')).toBeVisible();

  const tabIdsBefore = await page
    .locator('[data-testid="tab"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-tab-id')));
  const activeBefore = await page
    .locator('[data-testid="tab"][data-active="true"]')
    .getAttribute('data-tab-id');
  const beforeIndex = tabIdsBefore.indexOf(activeBefore);
  expect(beforeIndex).toBeGreaterThanOrEqual(0);
  const expectedNext = tabIdsBefore[(beforeIndex + 1) % tabIdsBefore.length];

  await clickMenuItem(app, 'Window', 'Next Tab');
  await expect(page.locator('[data-testid="tab"][data-active="true"]')).toHaveAttribute(
    'data-tab-id',
    expectedNext as string,
  );

  await clickMenuItem(app, 'Window', 'Previous Tab');
  await expect(page.locator('[data-testid="tab"][data-active="true"]')).toHaveAttribute(
    'data-tab-id',
    activeBefore as string,
  );

  const tabCountBeforeClose = await page.locator('[data-testid="tab"]').count();
  await clickMenuItem(app, 'Window', 'Close Tab');
  await expect(page.locator('[data-testid="tab"]')).toHaveCount(tabCountBeforeClose - 1);
  await expect(page.locator(`[data-testid="tab"][data-tab-id="${activeBefore}"]`)).toHaveCount(0);

  // View > Find toggles the active data tab's search bar.
  const dataTab = page.locator('[data-testid="tab"][data-tab-kind="data"]').first();
  await dataTab.click();
  await expect(grid).toBeVisible();
  await clickMenuItem(app, 'View', 'Find');
  await expect(page.locator('[data-testid="search-toolbar"]')).toBeVisible();
  await clickMenuItem(app, 'View', 'Find');
  await expect(page.locator('[data-testid="search-toolbar"]')).toHaveCount(0);

  // View > Refresh forces a real round trip: one new op for the active data tab.
  const opsBeforeRefresh = await getOps(page);
  await clickMenuItem(app, 'View', 'Refresh');
  await expect.poll(async () => (await getOps(page)).length).toBe(opsBeforeRefresh.length + 1);

  // View > Run Statement / Run All act on whichever console tab is active — open a fresh one
  // rather than reusing an earlier tab from the D10 section above, which already carries its
  // own result grids that would otherwise inflate the counts asserted below.
  await openRowMenu(page, COMPOSITE_PATH);
  await page.click('[data-testid="menu-item-open-console"]');
  const activeConsole = page.locator('[data-testid="console-view"]');
  await typeInto(activeConsole, page, 'SELECT 7 AS via_menu;');
  await clickMenuItem(app, 'View', 'Run Statement');
  await expect(activeConsole.locator('[data-testid="console-result-grid"]')).toContainText('7', {
    timeout: 10_000,
  });

  await typeInto(activeConsole, page, '\nSELECT 8 AS via_menu_all;');
  await clickMenuItem(app, 'View', 'Run All');
  await expect(activeConsole.locator('[data-testid="console-result-grid"]')).toHaveCount(2, {
    timeout: 10_000,
  });

  // =============================================================================================
  // P7 D1/D6/D7: PK/FK cell nav button — an outbound FK cell jumps straight to the referenced
  // row; a PK cell with exactly one referencing table jumps straight to it too (D6: single
  // candidate navigates immediately, no popup). Both spawn a *new*, pre-filtered tab.
  // =============================================================================================
  const ordersRow = await findRow(page, ORDERS_PATH);
  await ordersRow.dblclick();
  await expect(grid).toBeVisible();
  await expect(headerCell(page, 'customer_id')).toBeVisible();
  expect(await cellText(page, 0, 'customer_id')).toBe('1');

  let tabCount = await page.locator('[data-testid="tab"]').count();
  await clickCellNav(page, 0, 'customer_id');
  await expect(page.locator('[data-testid="tab"]')).toHaveCount(tabCount + 1);
  await expect(grid).toBeVisible();
  await expect(headerCell(page, 'name')).toBeVisible();
  await expect(page.locator('[data-testid="grid-row"]')).toHaveCount(1, { timeout: 10_000 });
  expect(await cellText(page, 0, 'name')).toBe('Acme Co');

  // customers.id is referenced by exactly one table (orders.customer_id) — a "pk"-kind button,
  // single candidate, direct nav to the filtered referencing rows.
  await expect(cellNavButton(page, 0, 'id')).toHaveAttribute('data-nav-kind', 'pk');
  tabCount = await page.locator('[data-testid="tab"]').count();
  await clickCellNav(page, 0, 'id');
  await expect(page.locator('[data-testid="tab"]')).toHaveCount(tabCount + 1);
  await expect(grid).toBeVisible();
  await expect(headerCell(page, 'customer_id')).toBeVisible();
  await expect(page.locator('[data-testid="grid-row"]')).toHaveCount(1, { timeout: 10_000 });
  expect(await cellText(page, 0, 'customer_id')).toBe('1');

  // =============================================================================================
  // P7: self-referencing FK — employees.manager_id -> employees.id. Ada (id 1) has no manager
  // (NULL): her manager_id cell renders no nav button at all (P7 D2: a missing/NULL source value
  // means there's no row to jump to). Her id cell's "Referenced by" is a single candidate
  // (employees itself) that opens a *new* tab on the same table, filtered to her direct reports.
  // =============================================================================================
  const employeesRow = await findRow(page, EMPLOYEES_PATH);
  await employeesRow.dblclick();
  await expect(grid).toBeVisible();
  await expect(headerCell(page, 'manager_id')).toBeVisible();
  expect(await cellText(page, 0, 'name')).toBe('Ada');
  await expect(gridCell(page, 0, 'manager_id').locator('.cell-null')).toHaveText('NULL');
  await gridCell(page, 0, 'manager_id').click();
  await expect(cellNavButton(page, 0, 'manager_id')).toHaveCount(0);

  tabCount = await page.locator('[data-testid="tab"]').count();
  await clickCellNav(page, 0, 'id');
  await expect(page.locator('[data-testid="tab"]')).toHaveCount(tabCount + 1);
  await expect(grid).toBeVisible();
  await expect(page.locator('[data-testid="grid-row"]')).toHaveCount(2, { timeout: 10_000 });
  const reportNames = [await cellText(page, 0, 'name'), await cellText(page, 1, 'name')].sort();
  expect(reportNames).toEqual(['Alan', 'Grace']);

  // Row 0 here (either direct report — both have manager_id 1) has a nav button on its
  // manager_id cell, and the right-click cell menu offers the same navigation as a "Go to
  // referenced row" item (P7 D3: the button and the menu share one function, so they can never
  // disagree about what's navigable).
  await rightClick(gridCell(page, 0, 'manager_id'));
  const fkMenuIds = await menuItemIds(page);
  expect(fkMenuIds.some((id) => id.startsWith('go-to-referenced-'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="context-menu"]')).toHaveCount(0);

  // =============================================================================================
  // P7: a row with two independent outbound FKs (order_items.order_id -> orders,
  // order_items.product_id -> products) gets two independent nav buttons, each targeting its own
  // table — the two never share or overwrite each other's target.
  // =============================================================================================
  const orderItemsRow = await findRow(page, ORDER_ITEMS_PATH);
  await orderItemsRow.dblclick();
  await expect(grid).toBeVisible();
  await expect(headerCell(page, 'order_id')).toBeVisible();
  await expect(headerCell(page, 'product_id')).toBeVisible();
  expect(await cellText(page, 0, 'order_id')).toBe('1');
  expect(await cellText(page, 0, 'product_id')).toBe('1');

  tabCount = await page.locator('[data-testid="tab"]').count();
  await clickCellNav(page, 0, 'product_id');
  await expect(page.locator('[data-testid="tab"]')).toHaveCount(tabCount + 1);
  await expect(grid).toBeVisible();
  await expect(headerCell(page, 'price')).toBeVisible();
  await expect(page.locator('[data-testid="grid-row"]')).toHaveCount(1, { timeout: 10_000 });
  expect(await cellText(page, 0, 'name')).toBe('Widget');

  const orderItemsRowAgain = await findRow(page, ORDER_ITEMS_PATH);
  await orderItemsRowAgain.dblclick();
  await expect(grid).toBeVisible();
  await expect(headerCell(page, 'order_id')).toBeVisible();
  tabCount = await page.locator('[data-testid="tab"]').count();
  await clickCellNav(page, 0, 'order_id');
  await expect(page.locator('[data-testid="tab"]')).toHaveCount(tabCount + 1);
  await expect(grid).toBeVisible();
  await expect(headerCell(page, 'ordered_at')).toBeVisible();
  await expect(page.locator('[data-testid="grid-row"]')).toHaveCount(1, { timeout: 10_000 });
  expect(await cellText(page, 0, 'customer_id')).toBe('1');
});
