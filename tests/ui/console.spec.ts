import type { ElectronApplication, Locator, Page } from '@playwright/test';
import type { ConnectionColor } from '@shared/domain/connection';
import { expect, test } from './fixtures';
import {
  DOCKER_UNAVAILABLE_MESSAGE,
  isDockerAvailable,
  type PgFixture,
  startPostgres,
} from './support/pg';
import { expandRow, openRowMenu } from './support/tree';

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

// @codemirror/commands' historyKeymap binds undo/redo to "Mod-z"/"Mod-y" (redo is "Mod-Shift-z"
// specifically on mac, not "Mod-y") — "Mod" resolves to Cmd on macOS, Ctrl elsewhere, so a
// literal 'Control+z'/'Control+y' silently no-ops on macOS.
const UNDO_KEY = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO_KEY = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y';

const DB_PATH = 'database:kira_test';
const APP_PATH = `${DB_PATH}/schema:app`;
const ORDER_ITEMS_PATH = `${APP_PATH}/table:order_items`;
const INVOICE_SEQ_PATH = `${APP_PATH}/sequence:invoice_number_seq`;
const FULL_NAME_PATH = `${APP_PATH}/function:full_name`;
const SEQUENCES_FOLDER_PATH = `${APP_PATH}#sequence`;
const FUNCTIONS_FOLDER_PATH = `${APP_PATH}#function`;

// See definition.spec.ts's identically named helper for why this waits on the container's own 'scroll'
// event rather than a fixed timeout.
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

async function openConsoleFromMenu(page: Page, path: string): Promise<void> {
  await openRowMenu(page, path);
  await page.click('[data-testid="menu-item-open-console"]');
}

async function typeInto(view: Locator, page: Page, text: string): Promise<void> {
  await view.locator('.cm-content').click();
  await page.keyboard.type(text);
}

// Mirrors interaction.spec.ts's identically named helper: clicking the native Edit ▸ Undo/Redo
// item exercises the exact role: 'undo'/'redo' path (main/menu.ts), distinct from the
// history()/historyKeymap path a Control+Z keystroke exercises (P18 addendum F1).
async function clickMenuItem(
  app: ElectronApplication,
  menuLabel: string,
  itemLabel: string,
): Promise<void> {
  await app.evaluate(
    ({ Menu, BrowserWindow }, args) => {
      const menu = Menu.getApplicationMenu();
      const top = menu?.items.find((i) => i.label === args.menuLabel);
      const item = top?.submenu?.items.find((i) => i.label === args.itemLabel);
      if (!item) throw new Error(`menu item not found: ${args.menuLabel} > ${args.itemLabel}`);
      const win = BrowserWindow.getAllWindows()[0];
      // role: 'undo'/'redo' (and cut/copy/paste/selectAll) on macOS dispatch through the native
      // NSResponder first-responder chain rather than calling into webContents directly — real
      // menu-bar clicks and OS undo gestures resolve that chain correctly, but a MenuItem#click()
      // invoked programmatically here (not a real native click) does not, and silently no-ops even
      // though the target webContents is focused (confirmed empirically: window/webContents both
      // report focused, and CodeMirror's own history() extension already handles the resulting
      // "historyUndo"/"historyRedo" beforeinput event correctly). webContents.undo()/.redo() were
      // tried as a replacement, but redo() alone doesn't reapply CM6's own undone edit — Chromium's
      // internal edit-command stack never recorded the edit in the first place (CM6's beforeinput
      // handler calls preventDefault() before Chromium's native editing commands run), so
      // webContents.redo() has nothing queued even though the historyUndo synthesis for undo()
      // happened to work. Simulate the actual accelerator keypress instead — the same path already
      // proven reliable for UNDO_KEY/REDO_KEY elsewhere in this file — so CM6's own keymap handles
      // it directly, for both undo and redo.
      const isMac = process.platform === 'darwin';
      const pressAccelerator = (
        key: string,
        modifiers: Array<'meta' | 'control' | 'shift'>,
      ): void => {
        win?.webContents.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers });
        win?.webContents.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers });
      };
      const roleCommand: Record<string, () => void> = {
        undo: () => pressAccelerator('Z', [isMac ? 'meta' : 'control']),
        redo: () => pressAccelerator(isMac ? 'Z' : 'Y', isMac ? ['meta', 'shift'] : ['control']),
        cut: () => win?.webContents.cut(),
        copy: () => win?.webContents.copy(),
        paste: () => win?.webContents.paste(),
        selectAll: () => win?.webContents.selectAll(),
      };
      const role = item.role as string | undefined;
      if (role && roleCommand[role]) {
        roleCommand[role]();
      } else {
        item.click(undefined, win, win?.webContents);
      }
    },
    { menuLabel, itemLabel },
  );
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
  // relation rows, absent on sequences and functions (§8.10 lists no console entry for those
  // kinds). Columns no longer have their own tree row (P19 D5: tables are leaves) or a console
  // item in the definition view's Columns section either (project/menus.ts's
  // columnsSectionMenu offers only Copy name/Add to projection/Sort by). ----------------------
  await openRowMenu(page, '');
  await expect(page.locator('[data-testid="menu-item-open-console"]')).toBeVisible();
  await page.keyboard.press('Escape');

  await openRowMenu(page, DB_PATH);
  await expect(page.locator('[data-testid="menu-item-open-console"]')).toBeVisible();
  await page.keyboard.press('Escape');

  await openRowMenu(page, ORDER_ITEMS_PATH);
  await expect(page.locator('[data-testid="menu-item-open-console"]')).toBeVisible();
  await page.keyboard.press('Escape');

  // P19 groups sequences/functions into folders, collapsed by default — expand each so the rows
  // below are actually in the tree.
  await expandRow(page, SEQUENCES_FOLDER_PATH);
  await expandRow(page, FUNCTIONS_FOLDER_PATH);

  await openRowMenu(page, INVOICE_SEQ_PATH);
  await expect(page.locator('[data-testid="menu-item-open-console"]')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await openRowMenu(page, FULL_NAME_PATH);
  await expect(page.locator('[data-testid="menu-item-open-console"]')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // --- scenario 2: opening always creates a fresh tab, never reuses one (unlike definition/data) --
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
  const resultTabs1 = consoleView1.locator('[data-testid="console-result-tab"]');
  await expect(results1).toHaveCount(1);
  await expect(results1.first()).toContainText('10');

  // P42 D5: appending is the default now, so "Run statement" on the second statement (cursor
  // lands inside it after typing) adds a new chip rather than replacing the first one's — one
  // grid stays MOUNTED at a time regardless (P40 D2), and the newest run's result is the active one.
  await typeInto(consoleView1, page, '\nSELECT 20 AS b;');
  await page.click('[data-testid="console-run-statement"]');
  await expect(resultTabs1).toHaveCount(2);
  await expect(results1).toHaveCount(1);
  await expect(results1.first()).toContainText('20');
  await expect(consoleView1.locator('[data-testid="console-status"]')).toContainText(
    '2 result sets',
  );

  // "Run all" appends both statements' results on top of the two chips already there.
  await page.click('[data-testid="console-run-all"]');
  await expect(resultTabs1).toHaveCount(4);
  await expect(consoleView1.locator('[data-testid="console-status"]')).toContainText(
    '4 result sets',
  );
  await expect(results1.first()).toContainText('10');
  await resultTabs1.nth(1).click();
  await expect(results1.first()).toContainText('20');

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

  // --- scenario 7: undo/redo (P18 addendum D15) ---------------------------------------------
  // relaunch() above closed the original app/window (fixtures.ts's launch() calls
  // current.app.close() before opening the next one) — the original `page`/`app` are dead, so
  // everything from here on must go through `relaunched`, not the stale destructured bindings.
  const page7 = relaunched.window;
  const app7 = relaunched.app;
  // The fresh window's tree starts fully collapsed regardless of what the previous window had
  // expanded (only tabs/state, not tree-expansion UI state, survives a relaunch) — re-expand down
  // to the table before finding the row, same as the initial expand at the top of the test.
  await expandRow(page7, '');
  await expandRow(page7, DB_PATH);
  await expandRow(page7, APP_PATH);
  await openConsoleFromMenu(page7, ORDER_ITEMS_PATH);
  const consoleView5 = page7.locator('[data-testid="console-view"]');
  const editor5 = consoleView5.locator('.cm-content');

  // A run of typed characters lands as one history step, not one per keystroke — a single
  // Control+Z removes the whole statement, not its last character.
  await typeInto(consoleView5, page7, 'SELECT 1;');
  await expect(editor5).toContainText('SELECT 1;');
  await page7.keyboard.press(UNDO_KEY);
  await expect(editor5).toHaveText('');
  await page7.keyboard.press(REDO_KEY);
  await expect(editor5).toContainText('SELECT 1;');

  // The Edit ▸ Undo/Redo menu items (role: 'undo'/'redo') reach the same history, and a further
  // burst of typing groups as its own separate step rather than merging with the first.
  await typeInto(consoleView5, page7, ' -- more');
  await expect(editor5).toContainText('SELECT 1; -- more');
  await clickMenuItem(app7, 'Edit', 'Undo');
  await expect(editor5).toHaveText('SELECT 1;');
  await clickMenuItem(app7, 'Edit', 'Redo');
  await expect(editor5).toContainText('SELECT 1; -- more');

  // Undoing a saved-query load restores the previous text and leaves the cursor where typing was
  // left off, not pinned at 0 in a document undo did not reset (P18 addendum acceptance
  // checklist) — typing after undo appends at the end instead of landing at the front.
  await page7.click('[data-testid="console-saved-toggle"]');
  await page7.locator('[data-testid="console-saved-entry"]', { hasText: 'My saved query' }).click();
  await expect(editor5).toContainText('SELECT 42 AS answer;');
  await page7.keyboard.press(UNDO_KEY);
  await expect(editor5).toContainText('SELECT 1; -- more');
  await page7.keyboard.type('!');
  await expect(editor5).toContainText('SELECT 1; -- more!');

  expect(consoleErrors).toEqual([]);
});

// P40: the result-set strip (new-vs-reuse toggle, per-result ×, chip switching) and the shared
// find toolbar over the active result set — a separate test rather than folding into the scenario
// above, since it needs its own connection/tab and shouldn't perturb that test's own tab-id-keyed
// assertions.
test('Query console — result-set strip, new-vs-reuse toggle, find toolbar (P40)', async ({
  kira,
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
  await createConnection(page, cfg, { name: 'Console Results DB', color: 'blue', readOnly: false });
  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-connect"]');
  await expandRow(page, '');
  await expandRow(page, DB_PATH);
  await expandRow(page, APP_PATH);

  await openConsoleFromMenu(page, ORDER_ITEMS_PATH);
  const consoleView = page.locator('[data-testid="console-view"]');
  const resultTabs = consoleView.locator('[data-testid="console-result-tab"]');
  const results = consoleView.locator('[data-testid="console-result-grid"]');

  // --- default (on, P42 D5): running again appends a new result set instead of replacing --------
  const newResultToggle = consoleView.locator('[data-testid="console-new-result-toggle"]');
  await expect(newResultToggle).toHaveClass(/is-active/);

  await typeInto(consoleView, page, 'SELECT 1 AS n;');
  await page.click('[data-testid="console-run-statement"]');
  await expect(resultTabs).toHaveCount(1);
  await expect(results).toContainText('1');

  await typeInto(consoleView, page, '\nSELECT 2 AS n;');
  await page.click('[data-testid="console-run-statement"]');
  await expect(resultTabs).toHaveCount(2);
  await expect(results).toContainText('2'); // the newest run becomes the active result (D6)

  // --- the strip: one grid is mounted at a time, switched by clicking a chip (D2/D3) ------------
  await resultTabs.nth(0).click();
  await expect(resultTabs.nth(0)).toHaveClass(/is-active/);
  await expect(results).toHaveCount(1);
  await expect(results).toContainText('1');

  // --- ×: closes one result set; the remaining chip renumbers, a neighbour becomes active (D5) --
  await resultTabs.nth(0).locator('[data-testid="console-result-close"]').click();
  await expect(resultTabs).toHaveCount(1);
  await expect(resultTabs.first()).toContainText('Result 1');
  await expect(results).toContainText('2');

  // --- toggle off: running now replaces the current result set instead of appending (D6) --------
  await newResultToggle.click();
  await expect(newResultToggle).not.toHaveClass(/is-active/);

  await typeInto(consoleView, page, '\nSELECT 3 AS n;');
  await page.click('[data-testid="console-run-statement"]');
  await expect(resultTabs).toHaveCount(1); // replace: no new chip, the one result set swapped
  await expect(results).toContainText('3');

  // --- find toolbar: opens over the active result set, filters, and counts matches (D8/D9/D10) —
  // still in replace mode from the toggle above, so this run keeps a single result set. -----------
  await typeInto(consoleView, page, '\nSELECT 4 AS n UNION ALL SELECT 55 AS n ORDER BY n;');
  await page.click('[data-testid="console-run-statement"]');
  await expect(results.locator('[data-testid="console-result-row"]')).toHaveCount(2);

  await page.click('[data-testid="console-search"]');
  const searchToolbar = consoleView.locator('[data-testid="console-search-toolbar"]');
  await expect(searchToolbar).toBeVisible();
  await page.fill('[data-testid="console-search-input"]', '55');
  await expect(searchToolbar.locator('[data-testid="console-search-count"]')).toContainText(
    '1 of 1',
  );

  await page.click('[data-testid="console-search-filter-rows"]');
  await expect(results.locator('[data-testid="console-result-row"]')).toHaveCount(1);
  await expect(results).toContainText('55');

  await page.click('[data-testid="console-search-close"]');
  await expect(searchToolbar).toHaveCount(0);
  // P24 D7: closing the toolbar leaves no rows hidden with no visible cause.
  await expect(results.locator('[data-testid="console-result-row"]')).toHaveCount(2);

  expect(consoleErrors).toEqual([]);
});
