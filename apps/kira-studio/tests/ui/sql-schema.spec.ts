import type { Locator, Page } from '@playwright/test';
import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';
import {
  APP_PATH,
  DB_PATH,
  orderItemsFixture,
  postgresConnectionSummary,
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

test('with no DDL document, the console is unchanged (D5)', async ({ relaunch, consoleErrors }) => {
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
  await openConsoleFromMenu(page, APP_PATH);
  const view = page.locator('[data-testid="console-view"]');
  await expect(view).toBeVisible();

  await typeInto(view, page, 'select * from ');
  await expect(page.locator('.cm-tooltip-autocomplete')).toHaveCount(0, { timeout: 3_000 });

  await page.keyboard.type('sel');
  const tooltip = page.locator('.cm-tooltip-autocomplete');
  await expect(tooltip).toBeVisible({ timeout: 5_000 });
  await expect(tooltip).toContainText('SELECT');

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
