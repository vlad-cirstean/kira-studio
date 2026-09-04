import type { Locator, Page } from '@playwright/test';
import { DATA_OP } from '@shared/protocol/data-ops';
import type { ColumnDescriptor } from '@shared/protocol/page';
import type { ControlSnapshot, LogicalPage, PortSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';
import {
  APP_PATH,
  DB_PATH,
  ORDER_ITEMS_PATH,
  orderItemsFixture,
  postgresConnectionSummary,
} from './support/postgresFixture';
import { connectionRow, expandRow, openRowMenu } from './support/tree';

// Ported from tests/e2e/console.spec.ts (P57 D16), against real captures of app.order_items'
// execute() responses (scripts/capture-postgres-tree.ts, including the real "relation ... does
// not exist" error text). Scenario 6 (session restore) is dropped — no backing store in this
// tier, same category as workbench.spec.ts's five. Scenario 7 (undo/redo) keeps only its
// keyboard-driven half: @codemirror/commands' own history()/historyKeymap is pure client-side and
// fully portable, but the native Electron Edit▸Undo/Redo menu path (role: 'undo'/'redo' dispatched
// through ElectronApplication.evaluate) has no equivalent here — there is no ElectronApplication,
// and ConsoleView.vue's own CodeMirror instance already handles the identical keyboard accelerator
// either way, so nothing about the *feature* goes untested, only one of two ways of triggering it.
// The op-count bookkeeping the original had no equivalent of here (window.kira never existed in
// this test) is not reintroduced — see definition.spec.ts's own note on the same subject.

const UNDO_KEY = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO_KEY = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y';

const INVOICE_SEQ_PATH = `${APP_PATH}/sequence:invoice_number_seq`;
const FULL_NAME_PATH = `${APP_PATH}/function:full_name`;
const SEQUENCES_FOLDER_PATH = `${APP_PATH}#sequence`;
const FUNCTIONS_FOLDER_PATH = `${APP_PATH}#function`;

function connectionCreateArgs(name: string, color: string) {
  return {
    name,
    kind: 'postgres',
    color,
    mode: 'fields',
    readOnly: false,
    host: '127.0.0.1',
    port: 5432,
    database: 'kira_test',
    username: 'postgres',
    password: null,
    uri: null,
    options: {},
    preconnect: null,
    preconnectSidecar: false,
    autoExplain: false,
    throttlePerSec: 0,
  };
}

async function connectAndExpand(page: Page, name: string, color: string): Promise<void> {
  await page.click('[data-testid="add-connection"]');
  await page.click('[data-testid="connection-kind-postgres"]');
  await page.fill('[data-testid="connection-name"]', name);
  await page.fill('[data-testid="connection-host"]', '127.0.0.1');
  await page.fill('[data-testid="connection-port"]', '5432');
  await page.fill('[data-testid="connection-database"]', 'kira_test');
  await page.fill('[data-testid="connection-username"]', 'postgres');
  await page.click(`[data-testid="color-${color}"]`);
  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);

  const connRow = connectionRow(page);
  await expect(connRow).toBeVisible();
  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-connect"]');
  await expect(connRow.locator('.status-dot')).toHaveAttribute('data-status', 'connected', {
    timeout: 10_000,
  });
  await expandRow(page, '');
  await expandRow(page, DB_PATH);
  await expandRow(page, APP_PATH);
}

async function openConsoleFromMenu(page: Page, path: string): Promise<void> {
  await openRowMenu(page, path);
  await page.click('[data-testid="menu-item-open-console"]');
}

async function typeInto(view: Locator, page: Page, text: string): Promise<void> {
  await view.locator('.cm-content').click();
  await page.keyboard.type(text);
}

function executeSnap(
  connectionId: string,
  statements: string[],
  pages: LogicalPage[],
): PortSnapshot {
  return {
    op: DATA_OP.execute,
    payload: { connectionId, path: ORDER_ITEMS_PATH, statements },
    response: { kind: 'execute', pages },
  };
}

function intColumnPage(column: string, values: string[]): LogicalPage {
  const columns: ColumnDescriptor[] = [
    {
      name: column,
      dataType: 'int4',
      typeClass: 'number',
      nullable: true,
      isPrimaryKey: false,
      generated: false,
    },
  ];
  return {
    kind: 'tabular',
    columns,
    rows: values.map((v) => [v]),
    position: {
      offset: 0,
      pageSize: values.length,
      hasMore: false,
      nextToken: null,
      prevToken: null,
      strategy: 'offset',
    },
    truncatedCells: 0,
  };
}

function numberPage(column: string, value: string): LogicalPage {
  return intColumnPage(column, [value]);
}

test('Query console — open, run statement/all, errors, saved queries', async ({ relaunch }) => {
  const CONNECTION_ID = 'conn-console';
  const CONNECTION_SUMMARY = postgresConnectionSummary(CONNECTION_ID, 'Console DB', 'green');
  const FIXTURE = orderItemsFixture(CONNECTION_ID);
  const SAVED_QUERY = {
    kind: 'console' as const,
    id: 'saved-query-1',
    connectionId: CONNECTION_ID,
    path: ORDER_ITEMS_PATH,
    name: 'My saved query',
    pinned: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    usedAt: null,
    body: { text: 'SELECT 42 AS answer;' },
  };

  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [] },
    {
      channel: IPC.connectionsCreate,
      args: connectionCreateArgs('Console DB', 'green'),
      response: CONNECTION_SUMMARY,
    },
    ...FIXTURE.control,
    // First open of the saved-queries popover: nothing saved yet.
    {
      channel: IPC.queriesListConsole,
      args: { connectionId: CONNECTION_ID, path: ORDER_ITEMS_PATH },
      response: [],
    },
    // Every subsequent open (saveCurrent()'s own reload, and every later mount) sees the one
    // saved entry — the mock's own cursor clamps to this, the group's last snapshot, once
    // exhausted (mockRuntime.ts's findSnap).
    {
      channel: IPC.queriesListConsole,
      args: { connectionId: CONNECTION_ID, path: ORDER_ITEMS_PATH },
      response: [SAVED_QUERY],
    },
    {
      channel: IPC.queriesSaveConsole,
      args: {
        connectionId: CONNECTION_ID,
        path: ORDER_ITEMS_PATH,
        name: 'My saved query',
        body: { text: 'SELECT 42 AS answer;' },
        pinned: false,
      },
      response: SAVED_QUERY,
    },
    { channel: IPC.queriesTouch, args: { id: SAVED_QUERY.id }, response: undefined },
  ];

  const PORT: PortSnapshot[] = [
    ...FIXTURE.port,
    executeSnap(CONNECTION_ID, ['SELECT 10 AS a'], [numberPage('a', '10')]),
    executeSnap(CONNECTION_ID, ['SELECT 20 AS b'], [numberPage('b', '20')]),
    executeSnap(
      CONNECTION_ID,
      ['SELECT 10 AS a', 'SELECT 20 AS b'],
      [numberPage('a', '10'), numberPage('b', '20')],
    ),
    {
      op: DATA_OP.execute,
      payload: {
        connectionId: CONNECTION_ID,
        path: ORDER_ITEMS_PATH,
        statements: ['SELECT * FROM this_table_does_not_exist_zzz'],
      },
      error: {
        code: 'E_QUERY',
        message: 'relation "this_table_does_not_exist_zzz" does not exist',
      },
    },
  ];

  const { window: page } = await relaunch({ control: CONTROL, stream: PORT });
  await connectAndExpand(page, 'Console DB', 'green');

  // --- scenario 1: menu coverage, gated on caps.sql (D5) — offered on connection/container/
  // relation rows, absent on sequences and functions (§8.10 lists no console entry for those
  // kinds). --------------------------------------------------------------------------------
  await openRowMenu(page, '');
  await expect(page.locator('[data-testid="menu-item-open-console"]')).toBeVisible();
  await page.keyboard.press('Escape');

  await openRowMenu(page, DB_PATH);
  await expect(page.locator('[data-testid="menu-item-open-console"]')).toBeVisible();
  await page.keyboard.press('Escape');

  await openRowMenu(page, ORDER_ITEMS_PATH);
  await expect(page.locator('[data-testid="menu-item-open-console"]')).toBeVisible();
  await page.keyboard.press('Escape');

  await expandRow(page, SEQUENCES_FOLDER_PATH);
  await expandRow(page, FUNCTIONS_FOLDER_PATH);

  await openRowMenu(page, INVOICE_SEQ_PATH);
  await expect(page.locator('[data-testid="menu-item-open-console"]')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await openRowMenu(page, FULL_NAME_PATH);
  await expect(page.locator('[data-testid="menu-item-open-console"]')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // --- scenario 2: opening always creates a fresh tab, never reuses one ----------------------
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

  // --- scenario 3: run statement (the one under the cursor) vs. run all ----------------------
  await typeInto(consoleView1, page, 'SELECT 10 AS a;');
  await page.click('[data-testid="console-run-statement"]');
  const results1 = consoleView1.locator('[data-testid="console-result-grid"]');
  const resultTabs1 = consoleView1.locator('[data-testid="console-result-tab"]');
  await expect(results1).toHaveCount(1);
  await expect(results1.first()).toContainText('10');

  await typeInto(consoleView1, page, '\nSELECT 20 AS b;');
  await page.click('[data-testid="console-run-statement"]');
  await expect(resultTabs1).toHaveCount(2);
  await expect(results1).toHaveCount(1);
  await expect(results1.first()).toContainText('20');
  await expect(consoleView1.locator('[data-testid="console-status"]')).toContainText('2 results');

  await page.click('[data-testid="console-run-all"]');
  await expect(resultTabs1).toHaveCount(4);
  await expect(consoleView1.locator('[data-testid="console-status"]')).toContainText('4 results');
  await expect(results1.first()).toContainText('10');
  await resultTabs1.nth(1).click();
  await expect(results1.first()).toContainText('20');

  // --- scenario 4: an adapter error is surfaced verbatim, not swallowed ----------------------
  await openConsoleFromMenu(page, ORDER_ITEMS_PATH);
  const consoleView2 = page.locator('[data-testid="console-view"]');
  await typeInto(consoleView2, page, 'SELECT * FROM this_table_does_not_exist_zzz;');
  await page.click('[data-testid="console-run-all"]');
  const error2 = consoleView2.locator('[data-testid="console-error"]');
  await expect(error2).toBeVisible();
  await expect(error2).toContainText(/does not exist/i);

  // --- scenario 5: saved queries --------------------------------------------------------------
  await openConsoleFromMenu(page, ORDER_ITEMS_PATH);
  const consoleView3 = page.locator('[data-testid="console-view"]');
  await typeInto(consoleView3, page, 'SELECT 42 AS answer;');
  await page.click('[data-testid="console-saved-toggle"]');
  await page.click('[data-testid="console-save-current"]');
  await expect(page.locator('[data-testid="text-prompt"]')).toBeVisible();
  await page.fill('[data-testid="text-prompt-input"]', 'My saved query');
  await page.click('[data-testid="text-prompt-ok"]');
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

  // --- scenario 6: undo/redo (P18 addendum D15), keyboard only — see file header note --------
  await openConsoleFromMenu(page, ORDER_ITEMS_PATH);
  const consoleView5 = page.locator('[data-testid="console-view"]');
  const editor5 = consoleView5.locator('.cm-content');

  await typeInto(consoleView5, page, 'SELECT 1;');
  await expect(editor5).toContainText('SELECT 1;');
  await page.keyboard.press(UNDO_KEY);
  await expect(editor5).toHaveText('');
  await page.keyboard.press(REDO_KEY);
  await expect(editor5).toContainText('SELECT 1;');

  await typeInto(consoleView5, page, ' -- more');
  await expect(editor5).toContainText('SELECT 1; -- more');
  await page.keyboard.press(UNDO_KEY);
  await expect(editor5).toHaveText('SELECT 1;');
  await page.keyboard.press(REDO_KEY);
  await expect(editor5).toContainText('SELECT 1; -- more');

  // Undoing a saved-query load restores the previous text and leaves the cursor where typing was
  // left off, not pinned at 0 — typing after undo appends at the end.
  await page.click('[data-testid="console-saved-toggle"]');
  await page.locator('[data-testid="console-saved-entry"]', { hasText: 'My saved query' }).click();
  await expect(editor5).toContainText('SELECT 42 AS answer;');
  await page.keyboard.press(UNDO_KEY);
  await expect(editor5).toContainText('SELECT 1; -- more');
  await page.keyboard.type('!');
  await expect(editor5).toContainText('SELECT 1; -- more!');
});

// P40: the result-set strip (new-vs-reuse toggle, per-result ×, chip switching) and the shared
// find toolbar over the active result set — a separate test rather than folding into the scenario
// above, since it needs its own connection/tab and shouldn't perturb that test's own tab-id-keyed
// assertions.
test('Query console — result-set strip, new-vs-reuse toggle, find toolbar (P40)', async ({
  relaunch,
}) => {
  const CONNECTION_ID = 'conn-console-p40';
  const CONNECTION_SUMMARY = postgresConnectionSummary(CONNECTION_ID, 'Console Results DB', 'blue');
  const FIXTURE = orderItemsFixture(CONNECTION_ID);

  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [] },
    {
      channel: IPC.connectionsCreate,
      args: connectionCreateArgs('Console Results DB', 'blue'),
      response: CONNECTION_SUMMARY,
    },
    ...FIXTURE.control,
  ];
  const PORT: PortSnapshot[] = [
    ...FIXTURE.port,
    executeSnap(CONNECTION_ID, ['SELECT 1 AS n'], [numberPage('n', '1')]),
    executeSnap(CONNECTION_ID, ['SELECT 2 AS n'], [numberPage('n', '2')]),
    executeSnap(CONNECTION_ID, ['SELECT 3 AS n'], [numberPage('n', '3')]),
    executeSnap(
      CONNECTION_ID,
      ['SELECT 4 AS n UNION ALL SELECT 55 AS n ORDER BY n'],
      [intColumnPage('n', ['4', '55'])],
    ),
  ];

  const { window: page } = await relaunch({ control: CONTROL, stream: PORT });
  await connectAndExpand(page, 'Console Results DB', 'blue');

  await openConsoleFromMenu(page, ORDER_ITEMS_PATH);
  const consoleView = page.locator('[data-testid="console-view"]');
  const resultTabs = consoleView.locator('[data-testid="console-result-tab"]');
  const results = consoleView.locator('[data-testid="console-result-grid"]');

  // --- default (P46-2): running again appends a new result set instead of replacing ---------
  const newResultToggle = consoleView.locator('[data-testid="console-new-result-toggle"]');
  await expect(newResultToggle).not.toHaveClass(/is-active/);

  await typeInto(consoleView, page, 'SELECT 1 AS n;');
  await page.click('[data-testid="console-run-statement"]');
  await expect(resultTabs).toHaveCount(1);
  await expect(results).toContainText('1');

  await typeInto(consoleView, page, '\nSELECT 2 AS n;');
  await page.click('[data-testid="console-run-statement"]');
  await expect(resultTabs).toHaveCount(2);
  await expect(results).toContainText('2');

  // --- the strip: one grid is mounted at a time, switched by clicking a chip (D2/D3) ----------
  await resultTabs.nth(0).click();
  await expect(resultTabs.nth(0)).toHaveClass(/is-active/);
  await expect(results).toHaveCount(1);
  await expect(results).toContainText('1');

  // --- ×: closes one result set; the remaining chip renumbers, a neighbour becomes active (D5) -
  await resultTabs.nth(0).locator('[data-testid="console-result-close"]').click();
  await expect(resultTabs).toHaveCount(1);
  await expect(resultTabs.first()).toContainText('Result 1');
  await expect(results).toContainText('2');

  // --- toggle on: running replaces the current result set instead of appending (D6) ----------
  await newResultToggle.click();
  await expect(newResultToggle).toHaveClass(/is-active/);

  await typeInto(consoleView, page, '\nSELECT 3 AS n;');
  await page.click('[data-testid="console-run-statement"]');
  await expect(resultTabs).toHaveCount(1);
  await expect(results).toContainText('3');

  // --- find toolbar: opens over the active result set, filters, and counts matches -----------
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
  await expect(results.locator('[data-testid="console-result-row"]')).toHaveCount(2);
});

// Finding 6 — the one-cell selection highlight (ConsoleSlickGrid.vue) used to be keyed straight
// off the DISPLAY position at click time, which goes stale the moment `matchedRows` changes what
// that position means. Reproduced here concretely: click row n=2 (page row 1) while unfiltered
// (display position == page row, so the layer keys on position 1); then filter to rows n=2 and
// n=4 (page rows 1 and 3), which re-numbers n=4 down onto display position 1 — exactly the slot
// the stale layer entry still points at. Pre-fix, the highlight visibly jumps onto n=4's row
// instead of staying on n=2's. The gutter-click half (clearing a stale highlight instead of
// leaving it behind) is covered in the same test, at the end.
test('Query console — the one-cell selection highlight tracks its row through a filter change and a gutter click (finding 6)', async ({
  relaunch,
}) => {
  const CONNECTION_ID = 'conn-console-select-filter';
  const CONNECTION_SUMMARY = postgresConnectionSummary(
    CONNECTION_ID,
    'Console Select Filter DB',
    'amber',
  );
  const FIXTURE = orderItemsFixture(CONNECTION_ID);

  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [] },
    {
      channel: IPC.connectionsCreate,
      args: connectionCreateArgs('Console Select Filter DB', 'amber'),
      response: CONNECTION_SUMMARY,
    },
    ...FIXTURE.control,
  ];
  const PORT: PortSnapshot[] = [
    ...FIXTURE.port,
    executeSnap(
      CONNECTION_ID,
      [
        'SELECT 1 AS n UNION ALL SELECT 2 AS n UNION ALL SELECT 3 AS n UNION ALL SELECT 4 AS n UNION ALL SELECT 5 AS n ORDER BY n',
      ],
      [intColumnPage('n', ['1', '2', '3', '4', '5'])],
    ),
  ];

  const { window: page } = await relaunch({ control: CONTROL, stream: PORT });
  await connectAndExpand(page, 'Console Select Filter DB', 'amber');
  await openConsoleFromMenu(page, ORDER_ITEMS_PATH);
  const consoleView = page.locator('[data-testid="console-view"]');
  const results = consoleView.locator('[data-testid="console-result-grid"]');

  await typeInto(
    consoleView,
    page,
    'SELECT 1 AS n UNION ALL SELECT 2 AS n UNION ALL SELECT 3 AS n UNION ALL SELECT 4 AS n UNION ALL SELECT 5 AS n ORDER BY n;',
  );
  await page.click('[data-testid="console-run-statement"]');
  await expect(results.locator('[data-testid="console-result-row"]')).toHaveCount(5);

  const cellAt = (row: number) =>
    results.locator(
      `[data-testid="console-result-row"][data-row="${row}"] [data-testid="console-result-cell"][data-column="n"]`,
    );
  // The gutter (frozenColumn: 0) renders in a separate left-pane row clone from the data columns
  // — `tagRenderedRows` (ConsoleSlickGrid.vue) only tags the right-pane clone with
  // `data-testid="console-result-row"`, but both clones carry the same corrected `data-row`, so
  // this reaches the gutter cell via that shared attribute rather than the right-pane testid.
  const gutterAt = (row: number) =>
    results.locator(`.slick-row[data-row="${row}"] [data-testid="console-result-gutter-cell"]`);

  // --- click n=2 (page row 1) while unfiltered — display position 1 == page row 1 --------------
  await cellAt(1).click();
  await expect(cellAt(1)).toHaveClass(/kira-cell-selected/);

  // --- filter to n=2/n=4 (page rows 1 and 3): n=4 now renders at display position 1, the exact
  // slot a stale, position-keyed highlight would still be pointing at ------------------------
  await page.click('[data-testid="console-search"]');
  const searchToolbar = consoleView.locator('[data-testid="console-search-toolbar"]');
  await expect(searchToolbar).toBeVisible();
  await page.click('[data-testid="console-search-regex"]');
  await page.fill('[data-testid="console-search-input"]', '^[24]$');
  await expect(searchToolbar.locator('[data-testid="console-search-count"]')).toContainText('of 2');
  await page.click('[data-testid="console-search-filter-rows"]');
  await expect(results.locator('[data-testid="console-result-row"]')).toHaveCount(2);

  // The highlight followed n=2 (page row 1), not the display slot it used to occupy.
  await expect(cellAt(1)).toHaveClass(/kira-cell-selected/);
  await expect(cellAt(3)).not.toHaveClass(/kira-cell-selected/);

  // --- a gutter click clears the highlight instead of leaving it stuck on n=2 -------------------
  await gutterAt(1).click();
  await expect(cellAt(1)).not.toHaveClass(/kira-cell-selected/);
});

// Finding 2 (round 2) — round 1's fix (finding 6, above) recomputed the highlight's display
// position on every `matchedRows` change with no membership check: `displayPositionOf` is
// documented to fall through to the NEAREST visible row on a miss (correct for scroll-into-view,
// wrong for a highlight). Reproduced here concretely: click n=3 (page row 2) while unfiltered,
// then filter such that page row 2 itself (n=3) is hidden but page row 3 (n=4) stays visible —
// pre-fix, `displayPositionOf`'s nearest-match fallback lands the highlight on n=4's cell instead
// of clearing it, a visible mismatch against the cell-editor dock (still showing n=3's actual
// value). Only the membership check itself is under test here; the round-1 regression (a
// selected row that STAYS visible after filtering) is covered above.
test('Query console — the one-cell selection highlight clears (not jumps) when its own row is filtered out (finding 2)', async ({
  relaunch,
}) => {
  const CONNECTION_ID = 'conn-console-select-filtered-out';
  const CONNECTION_SUMMARY = postgresConnectionSummary(
    CONNECTION_ID,
    'Console Select Filtered Out DB',
    'amber',
  );
  const FIXTURE = orderItemsFixture(CONNECTION_ID);

  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [] },
    {
      channel: IPC.connectionsCreate,
      args: connectionCreateArgs('Console Select Filtered Out DB', 'amber'),
      response: CONNECTION_SUMMARY,
    },
    ...FIXTURE.control,
  ];
  const PORT: PortSnapshot[] = [
    ...FIXTURE.port,
    executeSnap(
      CONNECTION_ID,
      [
        'SELECT 1 AS n UNION ALL SELECT 2 AS n UNION ALL SELECT 3 AS n UNION ALL SELECT 4 AS n UNION ALL SELECT 5 AS n ORDER BY n',
      ],
      [intColumnPage('n', ['1', '2', '3', '4', '5'])],
    ),
  ];

  const { window: page } = await relaunch({ control: CONTROL, stream: PORT });
  await connectAndExpand(page, 'Console Select Filtered Out DB', 'amber');
  await openConsoleFromMenu(page, ORDER_ITEMS_PATH);
  const consoleView = page.locator('[data-testid="console-view"]');
  const results = consoleView.locator('[data-testid="console-result-grid"]');

  await typeInto(
    consoleView,
    page,
    'SELECT 1 AS n UNION ALL SELECT 2 AS n UNION ALL SELECT 3 AS n UNION ALL SELECT 4 AS n UNION ALL SELECT 5 AS n ORDER BY n;',
  );
  await page.click('[data-testid="console-run-statement"]');
  await expect(results.locator('[data-testid="console-result-row"]')).toHaveCount(5);

  const cellAt = (row: number) =>
    results.locator(
      `[data-testid="console-result-row"][data-row="${row}"] [data-testid="console-result-cell"][data-column="n"]`,
    );

  // --- click n=3 (page row 2) while unfiltered ---------------------------------------------------
  await cellAt(2).click();
  await expect(cellAt(2)).toHaveClass(/kira-cell-selected/);

  // --- filter to n=1/2/4/5: page row 2 (n=3, the selected row) is hidden; page row 3 (n=4) stays
  // visible and renders at display position 2 — the exact slot a nearest-match fallback would
  // wrongly paint the highlight onto ---------------------------------------------------------------
  await page.click('[data-testid="console-search"]');
  const searchToolbar = consoleView.locator('[data-testid="console-search-toolbar"]');
  await expect(searchToolbar).toBeVisible();
  await page.click('[data-testid="console-search-regex"]');
  await page.fill('[data-testid="console-search-input"]', '^[1245]$');
  await expect(searchToolbar.locator('[data-testid="console-search-count"]')).toContainText('of 4');
  await page.click('[data-testid="console-search-filter-rows"]');
  await expect(results.locator('[data-testid="console-result-row"]')).toHaveCount(4);

  // The highlight cleared entirely — it did not jump onto n=4's cell, the display position (2)
  // n=3's stale slot used to occupy (n=3's own row, `data-row="2"`, no longer renders at all).
  await expect(results.locator('.kira-cell-selected')).toHaveCount(0);
});

// P42 D8: a result chip's own right-click menu — Close, Close others, Close to the right, each
// acting on the clicked chip and disabled (never hidden) when it would be a no-op.
test('Query console — result-tab right-click: close, close others, close to the right (P42)', async ({
  relaunch,
}) => {
  const CONNECTION_ID = 'conn-console-p42';
  const CONNECTION_SUMMARY = postgresConnectionSummary(CONNECTION_ID, 'Console Menu DB', 'blue');
  const FIXTURE = orderItemsFixture(CONNECTION_ID);

  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [] },
    {
      channel: IPC.connectionsCreate,
      args: connectionCreateArgs('Console Menu DB', 'blue'),
      response: CONNECTION_SUMMARY,
    },
    ...FIXTURE.control,
  ];
  const PORT: PortSnapshot[] = [
    ...FIXTURE.port,
    executeSnap(CONNECTION_ID, ['SELECT 1 AS n'], [numberPage('n', '1')]),
    executeSnap(CONNECTION_ID, ['SELECT 2 AS n'], [numberPage('n', '2')]),
    executeSnap(CONNECTION_ID, ['SELECT 3 AS n'], [numberPage('n', '3')]),
    executeSnap(CONNECTION_ID, ['SELECT 4 AS n'], [numberPage('n', '4')]),
    executeSnap(CONNECTION_ID, ['SELECT 5 AS n'], [numberPage('n', '5')]),
  ];

  const { window: page } = await relaunch({ control: CONTROL, stream: PORT });
  await connectAndExpand(page, 'Console Menu DB', 'blue');

  await openConsoleFromMenu(page, ORDER_ITEMS_PATH);
  const consoleView = page.locator('[data-testid="console-view"]');
  const resultTabs = consoleView.locator('[data-testid="console-result-tab"]');
  const results = consoleView.locator('[data-testid="console-result-grid"]');

  await typeInto(consoleView, page, 'SELECT 1 AS n;');
  await page.click('[data-testid="console-run-statement"]');
  await typeInto(consoleView, page, '\nSELECT 2 AS n;');
  await page.click('[data-testid="console-run-statement"]');
  await typeInto(consoleView, page, '\nSELECT 3 AS n;');
  await page.click('[data-testid="console-run-statement"]');
  await expect(resultTabs).toHaveCount(3);

  // --- close others: right-click the middle chip, keep only it ------------------------------
  await resultTabs.nth(1).click({ button: 'right' });
  await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();
  await page.click('[data-testid="menu-item-close-other-results"]');
  await expect(resultTabs).toHaveCount(1);
  await expect(results).toContainText('2');

  await typeInto(consoleView, page, '\nSELECT 4 AS n;');
  await page.click('[data-testid="console-run-statement"]');
  await typeInto(consoleView, page, '\nSELECT 5 AS n;');
  await page.click('[data-testid="console-run-statement"]');
  await expect(resultTabs).toHaveCount(3);

  // --- close to the right: right-click the first chip, drop everything after it -------------
  await resultTabs.nth(0).click({ button: 'right' });
  await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();
  await page.click('[data-testid="menu-item-close-results-to-the-right"]');
  await expect(resultTabs).toHaveCount(1);
  await expect(results).toContainText('2');

  // --- disabled, never hidden, when it would be a no-op — the sole surviving chip's own menu -
  await resultTabs.first().click({ button: 'right' });
  await expect(page.locator('[data-testid="menu-item-close-other-results"]')).toHaveClass(
    /is-disabled/,
  );
  await expect(page.locator('[data-testid="menu-item-close-results-to-the-right"]')).toHaveClass(
    /is-disabled/,
  );

  // --- plain close: the panel goes empty once the only result set closes --------------------
  await page.click('[data-testid="menu-item-close"]');
  await expect(page.locator('[data-testid="console-results"]')).toHaveCount(0);
});

// Regression test — duplicate column names in an ad-hoc result (routine for a JOIN where both
// sides have an `id` column, or `SELECT 1 AS x, 2 AS x`). ConsoleSlickGrid.vue used to address
// cells with a `Map<string, number>` keyed by `column.name`, which collapses duplicate names onto
// the LAST matching index — every "dup" cell would have rendered/selected column 1's value, never
// column 0's. Fixed by addressing SlickGrid columns by an index-derived field instead of by name.
function dupColumnPage(values: [string, string]): LogicalPage {
  const columns: ColumnDescriptor[] = [
    {
      name: 'dup',
      dataType: 'int4',
      typeClass: 'number',
      nullable: true,
      isPrimaryKey: false,
      generated: false,
    },
    {
      name: 'dup',
      dataType: 'int4',
      typeClass: 'number',
      nullable: true,
      isPrimaryKey: false,
      generated: false,
    },
  ];
  return {
    kind: 'tabular',
    columns,
    rows: [values],
    position: {
      offset: 0,
      pageSize: 1,
      hasMore: false,
      nextToken: null,
      prevToken: null,
      strategy: 'offset',
    },
    truncatedCells: 0,
  };
}

test('Query console — two duplicate-named columns render and select their own distinct values', async ({
  relaunch,
}) => {
  const CONNECTION_ID = 'conn-console-dup-cols';
  const CONNECTION_SUMMARY = postgresConnectionSummary(CONNECTION_ID, 'Console Dup DB', 'blue');
  const FIXTURE = orderItemsFixture(CONNECTION_ID);

  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [] },
    {
      channel: IPC.connectionsCreate,
      args: connectionCreateArgs('Console Dup DB', 'blue'),
      response: CONNECTION_SUMMARY,
    },
    ...FIXTURE.control,
  ];
  const PORT: PortSnapshot[] = [
    ...FIXTURE.port,
    executeSnap(CONNECTION_ID, ['SELECT 111 AS dup, 222 AS dup'], [dupColumnPage(['111', '222'])]),
  ];

  const { window: page } = await relaunch({ control: CONTROL, stream: PORT });
  await connectAndExpand(page, 'Console Dup DB', 'blue');

  await openConsoleFromMenu(page, ORDER_ITEMS_PATH);
  const consoleView = page.locator('[data-testid="console-view"]');
  const results = consoleView.locator('[data-testid="console-result-grid"]');

  await typeInto(consoleView, page, 'SELECT 111 AS dup, 222 AS dup;');
  await page.click('[data-testid="console-run-statement"]');

  const row0 = results.locator('[data-testid="console-result-row"][data-row="0"]');
  const firstDupCell = row0.locator('[data-testid="console-result-cell"][data-col-index="0"]');
  const secondDupCell = row0.locator('[data-testid="console-result-cell"][data-col-index="1"]');

  // --- rendering: each same-named column shows its own value, not both collapsed onto one ----
  await expect(firstDupCell).toHaveText('111');
  await expect(secondDupCell).toHaveText('222');

  // --- selection: clicking each publishes its own distinct value to the cell-editor dock -----
  const cellEditorText = () =>
    page.locator('[data-testid="cell-editor-panel"] .cm-content').innerText();

  await firstDupCell.click();
  await expect(page.locator('[data-testid="cell-editor"]')).toBeVisible();
  await expect.poll(cellEditorText).toBe('111');

  await secondDupCell.click();
  await expect.poll(cellEditorText).toBe('222');
});

// Finding 6 (round 2) — round 1's duplicate-column fix (above) addresses cells/selection by
// index, but ConsoleSlickGrid.vue's own column WIDTH still read `initialWidths(page)[col.name]`
// (columns.ts, name-keyed) — a duplicate name silently collapses onto whichever duplicate was
// measured LAST, so both columns rendered at that one's own width. Reproduced here concretely: a
// short value in the first "dup" column, a much longer one in the second — pre-fix, both columns
// render at the second (longer) column's own measured width; post-fix, the first stays narrow.
test("Query console — two duplicate-named columns each measure their own width, not the last one's (finding 6)", async ({
  relaunch,
}) => {
  const CONNECTION_ID = 'conn-console-dup-cols-width';
  const CONNECTION_SUMMARY = postgresConnectionSummary(
    CONNECTION_ID,
    'Console Dup Width DB',
    'cyan',
  );
  const FIXTURE = orderItemsFixture(CONNECTION_ID);
  const LONG_VALUE = '123456789012345678901234567890123456789012345678901234567890';

  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [] },
    {
      channel: IPC.connectionsCreate,
      args: connectionCreateArgs('Console Dup Width DB', 'cyan'),
      response: CONNECTION_SUMMARY,
    },
    ...FIXTURE.control,
  ];
  const PORT: PortSnapshot[] = [
    ...FIXTURE.port,
    executeSnap(CONNECTION_ID, ['SELECT 1 AS dup, 2 AS dup'], [dupColumnPage(['1', LONG_VALUE])]),
  ];

  const { window: page } = await relaunch({ control: CONTROL, stream: PORT });
  await connectAndExpand(page, 'Console Dup Width DB', 'cyan');

  await openConsoleFromMenu(page, ORDER_ITEMS_PATH);
  const consoleView = page.locator('[data-testid="console-view"]');
  const results = consoleView.locator('[data-testid="console-result-grid"]');

  await typeInto(consoleView, page, 'SELECT 1 AS dup, 2 AS dup;');
  await page.click('[data-testid="console-run-statement"]');

  const row0 = results.locator('[data-testid="console-result-row"][data-row="0"]');
  const firstDupCell = row0.locator('[data-testid="console-result-cell"][data-col-index="0"]');
  const secondDupCell = row0.locator('[data-testid="console-result-cell"][data-col-index="1"]');
  await expect(firstDupCell).toHaveText('1');
  await expect(secondDupCell).toHaveText(LONG_VALUE);

  const firstWidth = await firstDupCell.evaluate((el) => el.getBoundingClientRect().width);
  const secondWidth = await secondDupCell.evaluate((el) => el.getBoundingClientRect().width);
  // Pre-fix, both columns collapsed onto whichever duplicate was measured last (the long value),
  // so firstWidth would equal secondWidth here — asserting a clear gap catches that regression
  // without pinning to exact font-metric-dependent pixel counts.
  expect(secondWidth - firstWidth).toBeGreaterThan(100);
});
