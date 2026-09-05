import type { Locator, Page } from '@playwright/test';
import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';
import {
  APP_PATH,
  DB_PATH,
  ORDER_ITEMS_PATH,
  orderItemsFixture,
  POSTGRES_CAPS,
  postgresConnectionSummary,
  SERVER_VERSION,
} from './support/postgresFixture';
import { connectionRow, expandRow, openRowMenu } from './support/tree';

// P18 (v1.1) C7: the DDL dialog round-trips through P17's own staging shape, and the language
// service it feeds — completion, diagnostics, hovers — behaves exactly as today's console with no
// DDL document (D5) and picks up real schema-aware behaviour once one is saved. §7.1's own
// scenarios, ported to this file's postgres fixture.

function postgresCreateArgs(name: string, color: string) {
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

async function connectAndExpandPostgres(page: Page, name: string, color: string): Promise<void> {
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
}

async function openConsoleFromMenu(page: Page, path: string): Promise<void> {
  await openRowMenu(page, path);
  await page.click('[data-testid="menu-item-open-console"]');
}

async function typeInto(view: Locator, page: Page, text: string): Promise<void> {
  await view.locator('.cm-content').click();
  await page.keyboard.type(text);
}

async function clearAndType(view: Locator, page: Page, text: string): Promise<void> {
  await view.locator('.cm-content').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(text);
}

// CodeMirror splits a line's text across several highlighting spans, so a word is not reliably
// its own element for Playwright's getByText — this finds the exact text-node offset via a real
// DOM Range instead, robust to however the syntax highlighter chunked the line.
async function hoverWord(page: Page, view: Locator, word: string): Promise<void> {
  const point = await view.locator('.cm-content').evaluate((el, w) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const idx = (node.textContent ?? '').indexOf(w);
      if (idx >= 0) {
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + w.length);
        const rect = range.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }
    }
    return null;
  }, word);
  if (!point) throw new Error(`hoverWord: "${word}" not found in .cm-content`);
  await page.mouse.move(point.x, point.y);
}

const TWO_TABLE_DDL = `CREATE TABLE users (
  id integer PRIMARY KEY,
  name text NOT NULL
);
CREATE TABLE orders (
  id integer PRIMARY KEY,
  user_id integer REFERENCES users(id),
  total numeric(10,2)
);`;

test('Schema (DDL)… dialog stages until Save (D3)', async ({ relaunch }) => {
  const CONNECTION_ID = 'conn-sql-schema-1';
  const CONNECTION_SUMMARY = postgresConnectionSummary(CONNECTION_ID, 'Schema DB', 'green');
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [] },
    {
      channel: IPC.connectionsCreate,
      args: postgresCreateArgs('Schema DB', 'green'),
      response: CONNECTION_SUMMARY,
    },
    ...orderItemsFixture(CONNECTION_ID).control,
    {
      channel: IPC.schemaSet,
      args: { connectionId: CONNECTION_ID, ddl: TWO_TABLE_DDL },
      response: {
        connectionId: CONNECTION_ID,
        ddl: TWO_TABLE_DDL,
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    },
  ];
  const { window: page, control } = await relaunch({ control: CONTROL });

  await connectAndExpandPostgres(page, 'Schema DB', 'green');

  const dialog = page.locator('[data-testid="schema-dialog"]');
  const summary = page.locator('[data-testid="schema-parse-summary"]');
  async function openSchemaDialog(): Promise<void> {
    await openRowMenu(page, '');
    await page.click('[data-testid="menu-item-schema"]');
    await expect(dialog).toBeVisible();
  }

  // Type a two-table DDL script, assert the live parse summary, then discard it.
  await openSchemaDialog();
  await dialog.locator('.cm-content').click();
  await page.keyboard.type(TWO_TABLE_DDL);
  await expect(summary).toContainText('2 tables, 5 columns');
  await page.locator('.dialog-footer button', { hasText: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);

  // Reopening after Cancel shows the document exactly as it was before (empty) — Cancel
  // discarded the typed draft, and nothing was saved.
  await openSchemaDialog();
  await expect(dialog.locator('.cm-content')).toHaveText('');
  await expect(summary).not.toContainText('tables');

  // Type it again and Save this time.
  await dialog.locator('.cm-content').click();
  await page.keyboard.type(TWO_TABLE_DDL);
  const opsBeforeSave = control.log().length;
  await page.locator('.dialog-footer button', { hasText: 'Save schema' }).click();
  await expect(dialog).toHaveCount(0);
  expect(control.log().length).toBeGreaterThan(opsBeforeSave);

  // Reopening now shows the saved document.
  await openSchemaDialog();
  await expect(dialog.locator('.cm-content')).toContainText('CREATE TABLE users');
  await expect(summary).toContainText('2 tables, 5 columns');
});

// P12 round 1 finding #14: Save had no catch at all — a rejected schemaSet became an unhandled
// promise rejection from a template @click, and the dialog stayed open with nothing shown.
test('a rejected Save shows the error and leaves the dialog open', async ({ relaunch }) => {
  const CONNECTION_ID = 'conn-sql-schema-save-error';
  const CONNECTION_SUMMARY = postgresConnectionSummary(CONNECTION_ID, 'Schema DB', 'green');
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [] },
    {
      channel: IPC.connectionsCreate,
      args: postgresCreateArgs('Schema DB', 'green'),
      response: CONNECTION_SUMMARY,
    },
    ...orderItemsFixture(CONNECTION_ID).control,
    {
      channel: IPC.schemaSet,
      args: { connectionId: CONNECTION_ID, ddl: TWO_TABLE_DDL },
      error: { code: 'E_QUERY', message: 'schema write failed' },
    },
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  await connectAndExpandPostgres(page, 'Schema DB', 'green');

  const dialog = page.locator('[data-testid="schema-dialog"]');
  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-schema"]');
  await expect(dialog).toBeVisible();

  await dialog.locator('.cm-content').click();
  await page.keyboard.type(TWO_TABLE_DDL);
  await page.locator('.dialog-footer button', { hasText: 'Save schema' }).click();

  await expect(dialog.locator('[data-testid="schema-save-error"]')).toContainText(
    'schema write failed',
  );
  await expect(dialog).toBeVisible();
});

test('SQL console completes tables, columns and aliases once a DDL document exists (D5/F2)', async ({
  relaunch,
  consoleErrors,
}) => {
  const CONNECTION_ID = 'conn-sql-schema-2';
  const CONNECTION_SUMMARY = postgresConnectionSummary(CONNECTION_ID, 'Schema DB', 'green');
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [] },
    {
      channel: IPC.connectionsCreate,
      args: postgresCreateArgs('Schema DB', 'green'),
      response: CONNECTION_SUMMARY,
    },
    ...orderItemsFixture(CONNECTION_ID).control,
    // Seeding the DDL document directly, rather than round-tripping it through the dialog again
    // (already proven above) — this test is about what a *saved* document does to the console.
    {
      channel: IPC.schemaGet,
      args: { connectionId: CONNECTION_ID },
      response: {
        connectionId: CONNECTION_ID,
        ddl: TWO_TABLE_DDL,
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    },
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  await connectAndExpandPostgres(page, 'Schema DB', 'green');
  await openConsoleFromMenu(page, APP_PATH);
  const view = page.locator('[data-testid="console-view"]');
  await expect(view).toBeVisible();

  // Table completion after FROM. lang-sql's own schemaCompletionSource returns null for an
  // "empty" (no partial word typed yet) non-explicit context (dist/index.js's own
  // `if (empty && !context.explicit) return null`) — the same rule a bare Ctrl+Space request
  // exists for in every editor, so this asks for it explicitly rather than assuming a bare
  // trailing space proactively pops the list.
  await typeInto(view, page, 'select * from ');
  await page.keyboard.press('Control+Space');
  const tooltip = page.locator('.cm-tooltip-autocomplete');
  await expect(tooltip).toBeVisible({ timeout: 5_000 });
  await expect(tooltip).toContainText('users');
  await expect(tooltip).toContainText('orders');
  await page.keyboard.press('Escape');

  // Keyword completion still fires, and still uppercases (F3's own guard: the schema source
  // didn't drop lang-sql's own keyword source).
  await clearAndType(view, page, 'sel');
  await expect(tooltip).toBeVisible({ timeout: 5_000 });
  await expect(tooltip).toContainText('SELECT');
  await page.keyboard.press('Escape');

  // Alias-resolved column completion: "u." after "from users u" resolves to users' own columns.
  await clearAndType(view, page, 'select * from users u where u.');
  await expect(tooltip).toBeVisible({ timeout: 5_000 });
  await expect(tooltip).toContainText('id');
  await expect(tooltip).toContainText('name');
  await page.keyboard.press('Escape');

  expect(consoleErrors).toEqual([]);
});

// P19 D14: the language service's own behaviour with an empty schema is exactly what this phase
// changes — table names now come from the tree's own cache (consoleRelationNames,
// mongoCollectionNames' identical technique carried to SQL) even with no DDL document, while
// column completion still needs one (F25: a table/view is a leaf in the tree, its columns moved
// into the definition view — the tree has relation names only). Keyword completion is untouched.
test('with no DDL document, table names still complete from the tree; columns do not (D5/D14)', async ({
  relaunch,
  consoleErrors,
}) => {
  const CONNECTION_ID = 'conn-sql-schema-3';
  const CONNECTION_SUMMARY = postgresConnectionSummary(CONNECTION_ID, 'Schema DB', 'green');
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [] },
    {
      channel: IPC.connectionsCreate,
      args: postgresCreateArgs('Schema DB', 'green'),
      response: CONNECTION_SUMMARY,
    },
    ...orderItemsFixture(CONNECTION_ID).control,
    // No schemaGet override — mockRuntime's own WILDCARD_DEFAULTS answers it with an empty
    // document, the same "absent until the user writes one" state a brand-new connection has.
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  await connectAndExpandPostgres(page, 'Schema DB', 'green');
  // D14's own supply: the tree's cache of this console's own container — expanding it is what
  // populates treeState.children, exactly the way opening it in the project tree already would.
  await expandRow(page, APP_PATH);
  await openConsoleFromMenu(page, APP_PATH);
  const view = page.locator('[data-testid="console-view"]');
  await expect(view).toBeVisible();

  const tooltip = page.locator('.cm-tooltip-autocomplete');
  await typeInto(view, page, 'select * from ');
  await expect(tooltip).toBeVisible({ timeout: 5_000 });
  await expect(tooltip).toContainText('order_items');
  await expect(tooltip).toContainText('customers');
  await page.keyboard.press('Escape');

  // Keyword completion is untouched.
  await clearAndType(view, page, 'sel');
  await expect(tooltip).toBeVisible({ timeout: 5_000 });
  await expect(tooltip).toContainText('SELECT');
  await page.keyboard.press('Escape');

  // No column completion — F25's own "columns aren't in the tree" limitation, D15's own reason
  // to exist.
  await clearAndType(view, page, 'select * from order_items oi where oi.');
  await expect(tooltip).toHaveCount(0, { timeout: 3_000 });

  expect(consoleErrors).toEqual([]);
});

test('a diagnostic fires only for what the DDL cannot prove (D7)', async ({
  relaunch,
  consoleErrors,
}) => {
  const CONNECTION_ID = 'conn-sql-schema-4';
  const CONNECTION_SUMMARY = postgresConnectionSummary(CONNECTION_ID, 'Schema DB', 'green');
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [] },
    {
      channel: IPC.connectionsCreate,
      args: postgresCreateArgs('Schema DB', 'green'),
      response: CONNECTION_SUMMARY,
    },
    ...orderItemsFixture(CONNECTION_ID).control,
    {
      channel: IPC.schemaGet,
      args: { connectionId: CONNECTION_ID },
      response: {
        connectionId: CONNECTION_ID,
        ddl: TWO_TABLE_DDL,
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    },
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  await connectAndExpandPostgres(page, 'Schema DB', 'green');
  await openConsoleFromMenu(page, APP_PATH);
  const view = page.locator('[data-testid="console-view"]');
  await expect(view).toBeVisible();

  await typeInto(view, page, 'select * from oredrs');
  await expect(view.locator('.cm-lintRange-warning')).toHaveCount(1, { timeout: 5_000 });

  await clearAndType(view, page, 'select * from users u join orders o on o.user_id = u.id');
  await expect(view.locator('.cm-lintRange-warning')).toHaveCount(0, { timeout: 5_000 });

  expect(consoleErrors).toEqual([]);
});

test('hovering a known column shows its verbatim declared type (D8)', async ({ relaunch }) => {
  const CONNECTION_ID = 'conn-sql-schema-5';
  const CONNECTION_SUMMARY = postgresConnectionSummary(CONNECTION_ID, 'Schema DB', 'green');
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [] },
    {
      channel: IPC.connectionsCreate,
      args: postgresCreateArgs('Schema DB', 'green'),
      response: CONNECTION_SUMMARY,
    },
    ...orderItemsFixture(CONNECTION_ID).control,
    {
      channel: IPC.schemaGet,
      args: { connectionId: CONNECTION_ID },
      response: {
        connectionId: CONNECTION_ID,
        ddl: TWO_TABLE_DDL,
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    },
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  await connectAndExpandPostgres(page, 'Schema DB', 'green');
  await openConsoleFromMenu(page, APP_PATH);
  const view = page.locator('[data-testid="console-view"]');
  await expect(view).toBeVisible();

  await typeInto(view, page, 'select total from orders');
  await hoverWord(page, view, 'total');
  const hover = page.locator('.cm-kira-hover');
  await expect(hover).toBeVisible({ timeout: 5_000 });
  await expect(hover).toContainText('numeric(10,2)');
});

// P19 T14/D15: "Fill from connection" stages TreeService.Definition's real output for every
// relation the tree already has cached — one call per relation, never a saved write until Save
// is pressed. A small, purpose-built two-table schema (rather than orderItemsFixture's own ~16
// relation APP_PATH) so the fixture stays reviewable: one treeDefinition snapshot per table.
test('the Schema (DDL) dialog fills itself from the connection (D15)', async ({ relaunch }) => {
  const CONNECTION_ID = 'conn-sql-schema-fill';
  const CONNECTION_SUMMARY = postgresConnectionSummary(CONNECTION_ID, 'Fill DB', 'blue');
  const SCHEMA_PATH = 'database:small_db/schema:pub';
  const T1_PATH = `${SCHEMA_PATH}/table:t1`;
  const T2_PATH = `${SCHEMA_PATH}/table:t2`;

  const T1_DEFINITION = {
    path: T1_PATH,
    kind: 'table' as const,
    qualifiedName: 'pub.t1',
    statements: ['CREATE TABLE pub.t1 (\n    id integer NOT NULL\n)'],
    language: 'sql' as const,
    origin: 'composed' as const,
    notes: [],
    constraints: [],
    documentSchema: null,
    sections: [],
    generatedAt: '2026-01-01T00:00:00.000Z',
  };
  const T2_DEFINITION = {
    ...T1_DEFINITION,
    path: T2_PATH,
    qualifiedName: 'pub.t2',
    statements: ['CREATE TABLE pub.t2 (\n    id integer NOT NULL\n)'],
  };

  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [] },
    {
      channel: IPC.connectionsCreate,
      args: postgresCreateArgs('Fill DB', 'blue'),
      response: CONNECTION_SUMMARY,
    },
    {
      channel: IPC.connectionsConnect,
      args: { id: CONNECTION_ID },
      response: {
        connectionId: CONNECTION_ID,
        status: 'connected',
        serverVersion: SERVER_VERSION,
        error: null,
        since: 1735689600000,
        caps: POSTGRES_CAPS,
      },
    },
    {
      channel: IPC.treeChildren,
      args: { connectionId: CONNECTION_ID, path: '', refresh: false },
      response: {
        nodes: [
          { kind: 'database', name: 'small_db', path: 'database:small_db', hasChildren: true },
        ],
        source: 'server',
        truncated: false,
      },
    },
    {
      channel: IPC.treeChildren,
      args: { connectionId: CONNECTION_ID, path: 'database:small_db', refresh: false },
      response: {
        nodes: [{ kind: 'schema', name: 'pub', path: SCHEMA_PATH, hasChildren: true }],
        source: 'server',
        truncated: false,
      },
    },
    {
      channel: IPC.treeChildren,
      args: { connectionId: CONNECTION_ID, path: SCHEMA_PATH, refresh: false },
      response: {
        nodes: [
          { kind: 'table', name: 't1', path: T1_PATH, hasChildren: false },
          { kind: 'table', name: 't2', path: T2_PATH, hasChildren: false },
        ],
        source: 'server',
        truncated: false,
      },
    },
    {
      channel: IPC.treeDefinition,
      args: { connectionId: CONNECTION_ID, path: T1_PATH, refresh: false, tabId: null },
      response: { definition: T1_DEFINITION, source: 'server' },
    },
    {
      channel: IPC.treeDefinition,
      args: { connectionId: CONNECTION_ID, path: T2_PATH, refresh: false, tabId: null },
      response: { definition: T2_DEFINITION, source: 'server' },
    },
  ];

  const { window: page, control } = await relaunch({ control: CONTROL });

  await page.click('[data-testid="add-connection"]');
  await page.click('[data-testid="connection-kind-postgres"]');
  await page.fill('[data-testid="connection-name"]', 'Fill DB');
  await page.fill('[data-testid="connection-host"]', '127.0.0.1');
  await page.fill('[data-testid="connection-port"]', '5432');
  await page.fill('[data-testid="connection-database"]', 'kira_test');
  await page.fill('[data-testid="connection-username"]', 'postgres');
  await page.click('[data-testid="color-blue"]');
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
  await expandRow(page, 'database:small_db');
  await expandRow(page, SCHEMA_PATH); // populates treeState.children for consoleRelationNames/D15

  const fillButton = page.locator('[data-testid="schema-fill-from-connection"]');

  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-schema"]');
  const dialog = page.locator('[data-testid="schema-dialog"]');
  await expect(dialog).toBeVisible();
  const summary = page.locator('[data-testid="schema-parse-summary"]');

  await expect(fillButton).toBeEnabled();
  await fillButton.click();
  await expect(fillButton).toBeVisible({ timeout: 5_000 }); // filling finished, button is back

  expect(control.log().filter((e) => e.channel === IPC.treeDefinition)).toHaveLength(2);
  await expect(dialog.locator('.cm-content')).toContainText('CREATE TABLE pub.t1');
  await expect(dialog.locator('.cm-content')).toContainText('CREATE TABLE pub.t2');
  await expect(summary).toContainText('2 tables');

  // Nothing was saved — the user still presses Save themselves.
  expect(control.log().filter((e) => e.channel === IPC.schemaSet)).toHaveLength(0);
});

// P19 T14/D16: without this, D14/D15 are two features nobody can find, which is how the current
// one ended up reported as broken. Dismissal is per connection, not per tab — opening a SECOND
// console on the same connection keeps it dismissed.
test('a SQL console with no schema document says so, dismissibly, per connection (D16)', async ({
  relaunch,
}) => {
  const CONNECTION_ID = 'conn-sql-schema-hint';
  const CONNECTION_SUMMARY = postgresConnectionSummary(CONNECTION_ID, 'Hint DB', 'magenta');
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [] },
    {
      channel: IPC.connectionsCreate,
      args: postgresCreateArgs('Hint DB', 'magenta'),
      response: CONNECTION_SUMMARY,
    },
    ...orderItemsFixture(CONNECTION_ID).control,
    // No schemaGet override — an empty document, same as "with no DDL document" above.
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  await connectAndExpandPostgres(page, 'Hint DB', 'magenta');
  await openConsoleFromMenu(page, APP_PATH);
  const view = page.locator('[data-testid="console-view"]');
  await expect(view).toBeVisible();

  const hint = view.locator('[data-testid="console-no-schema-hint"]');
  await expect(hint).toBeVisible();
  await expect(hint).toContainText('table and column completion is off');

  await hint.locator('[data-testid="console-no-schema-hint-setup"]').click();
  await expect(page.locator('[data-testid="schema-dialog"]')).toBeVisible();
  await page.click('[data-testid="schema-dialog-close"]');

  await hint.locator('[data-testid="console-no-schema-hint-dismiss"]').click();
  await expect(hint).toHaveCount(0);

  // A second console on the SAME connection stays dismissed — the preference is per connection.
  // Only one view is ever mounted at a time (MainView.vue's own single-<component> invariant), so
  // this checks the new tab is the active one, not that two console-views coexist.
  await expandRow(page, APP_PATH);
  await openConsoleFromMenu(page, ORDER_ITEMS_PATH);
  const activeTab = page.locator('[data-testid="tab"][data-active="true"]');
  await expect(activeTab).toHaveAttribute('data-tab-kind', 'console');
  await expect(view).toBeVisible();
  await expect(view.locator('[data-testid="console-no-schema-hint"]')).toHaveCount(0);
});
