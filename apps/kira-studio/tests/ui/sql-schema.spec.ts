import type { Locator, Page } from '@playwright/test';
import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';
import {
  APP_PATH,
  appSchemaColumnsSnapshot,
  connectAndExpandControl,
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
    throttlePerSec: 0,
  };
}

// P4: no expandRow calls at all — the honest-degradation case a root console gets when the
// connection was never expanded in the tree first (right-click a still-collapsed connection row
// and choose "Open query console" directly).
async function connectPostgresOnly(page: Page, name: string, color: string): Promise<void> {
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

// P4: the DDL editor's :autocomplete was hardcoded false — flipped on with no completionSources,
// so lang-sql's own dialect-correct keyword/type-name source applies here the same way it does
// for a console with no schema at all (D5's "override replaces language-data sources wholesale"
// applies in reverse: no override at all means lang-sql stays in charge).
test('the Schema (DDL) editor now offers keyword completion (P4)', async ({ relaunch }) => {
  const CONNECTION_ID = 'conn-sql-schema-ddl-autocomplete';
  const CONNECTION_SUMMARY = postgresConnectionSummary(CONNECTION_ID, 'Schema DB', 'red');
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [] },
    {
      channel: IPC.connectionsCreate,
      args: postgresCreateArgs('Schema DB', 'red'),
      response: CONNECTION_SUMMARY,
    },
    ...orderItemsFixture(CONNECTION_ID).control,
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  await connectAndExpandPostgres(page, 'Schema DB', 'red');
  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-schema"]');
  const dialog = page.locator('[data-testid="schema-dialog"]');
  await expect(dialog).toBeVisible();

  await dialog.locator('.cm-content').click();
  await page.keyboard.type('sel');
  // G20 D7: every CodeMirrorHost's tooltip escapes its own container to `document.body`
  // (theme.ts/CodeMirrorHost.vue's own tooltips({ parent: document.body })) — it renders outside
  // the dialog's DOM subtree entirely, so the locator must be page-scoped, not dialog-scoped.
  const tooltip = page.locator('.cm-tooltip-autocomplete');
  await expect(tooltip).toBeVisible({ timeout: 5_000 });
  await expect(tooltip).toContainText('SELECT');
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

// P19 D14: table names come from the tree's own cache (consoleRelationNames, mongoCollectionNames'
// identical technique carried to SQL) even with no DDL document. P22c D4 widens this: with no
// document, the metadata cache's own columns for this console's container (state/schemaColumns.ts,
// filled automatically the moment the console opens — no manual step) now complete columns too,
// with their types in the completion detail, exactly as a DDL document would have. Keyword
// completion is untouched.
test('with no DDL document, table names and columns complete from the cache (D4/D5/D14)', async ({
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
    appSchemaColumnsSnapshot(CONNECTION_ID),
    // No schemaGet override — mockRuntime's own WILDCARD_DEFAULTS answers it with an empty
    // document, the same "absent until the user writes one" state a brand-new connection has.
  ];
  const { window: page, control } = await relaunch({ control: CONTROL });

  await connectAndExpandPostgres(page, 'Schema DB', 'green');
  // D14's own supply: the tree's cache of this console's own container — expanding it is what
  // populates treeState.children, exactly the way opening it in the project tree already would.
  await expandRow(page, APP_PATH);
  await openConsoleFromMenu(page, APP_PATH);
  const view = page.locator('[data-testid="console-view"]');
  await expect(view).toBeVisible();

  const tooltip = page.locator('.cm-tooltip-autocomplete');
  // lang-sql's own schemaCompletionSource returns null for an "empty" (no partial word typed
  // yet) non-explicit context — the cached-columns branch (P22c D4) now goes through the same
  // schemaCompletionSource the document branch always did, so this asks for it explicitly, same
  // as the sibling "…once a DDL document exists" test above.
  await typeInto(view, page, 'select * from ');
  await page.keyboard.press('Control+Space');
  await expect(tooltip).toBeVisible({ timeout: 5_000 });
  await expect(tooltip).toContainText('order_items');
  await expect(tooltip).toContainText('customers');
  await page.keyboard.press('Escape');

  // Keyword completion is untouched.
  await clearAndType(view, page, 'sel');
  await expect(tooltip).toBeVisible({ timeout: 5_000 });
  await expect(tooltip).toContainText('SELECT');
  await page.keyboard.press('Escape');

  // P22c D4: column completion now works from the cache — order_items' own columns, with their
  // declared type in the completion detail, the same as a DDL document would have offered.
  await clearAndType(view, page, 'select * from order_items oi where oi.');
  await expect(tooltip).toBeVisible({ timeout: 5_000 });
  await expect(tooltip).toContainText('quantity');
  await expect(tooltip).toContainText('integer');
  await page.keyboard.press('Escape');

  // P22c D5: one treeSchemaColumns call for this console's container, not one per keystroke —
  // the language layer never fetches on its own (§4.4 item 3).
  const schemaColumnsCalls = control
    .log()
    .filter((e) => e.channel === IPC.treeSchemaColumns).length;
  await typeInto(view, page, ' and oi.quantity > 1');
  expect(control.log().filter((e) => e.channel === IPC.treeSchemaColumns).length).toBe(
    schemaColumnsCalls,
  );

  expect(consoleErrors).toEqual([]);
});

// P4: a console opened at the connection ROOT (right-click the connection row itself, not a
// table/schema row) used to get no schema-aware completion at all — containerPathFor/
// consoleRelationNames both bailed the instant the path had no database:/schema: segment, even
// though the tree already had everything cached. This fixture's own kira_test database has TWO
// schemas (analytics, app — DB_CHILDREN), so the schema half of the fix can't resolve a single
// container here (correctly ambiguous, no "public"); this proves the OTHER half instead — the
// relation-names union fallback (completion.ts's rootRelationNames) still surfaces order_items and
// customers, because the tree already has them loaded from expanding APP_PATH below, and a root
// console no longer throws that away.
test('a console opened at the connection root still completes table names from whatever the tree already has loaded (P4)', async ({
  relaunch,
  consoleErrors,
}) => {
  const CONNECTION_ID = 'conn-sql-schema-root';
  const CONNECTION_SUMMARY = postgresConnectionSummary(CONNECTION_ID, 'Schema DB', 'amber');
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [] },
    {
      channel: IPC.connectionsCreate,
      args: postgresCreateArgs('Schema DB', 'amber'),
      response: CONNECTION_SUMMARY,
    },
    ...orderItemsFixture(CONNECTION_ID).control,
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  await connectAndExpandPostgres(page, 'Schema DB', 'amber');
  // Loads order_items/customers into treeState.children for APP_PATH — the data a root console's
  // relation-names union now reads instead of discarding.
  await expandRow(page, APP_PATH);

  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-open-console"]');
  const view = page.locator('[data-testid="console-view"]');
  await expect(view).toBeVisible();

  const tooltip = page.locator('.cm-tooltip-autocomplete');
  await typeInto(view, page, 'select * from ');
  await page.keyboard.press('Control+Space');
  await expect(tooltip).toBeVisible({ timeout: 5_000 });
  await expect(tooltip).toContainText('order_items');
  await expect(tooltip).toContainText('customers');
  await page.keyboard.press('Escape');

  // Keyword completion is untouched, same as every other console.
  await clearAndType(view, page, 'sel');
  await expect(tooltip).toBeVisible({ timeout: 5_000 });
  await expect(tooltip).toContainText('SELECT');
  await page.keyboard.press('Escape');

  expect(consoleErrors).toEqual([]);
});

// P4: the honest-degradation boundary — a root console opened on a connection that was NEVER
// expanded in the tree has nothing cached to offer (no round trip fired to find out), so it falls
// all the way through to lang-sql's own keyword source, same as before this phase.
test('a console opened at the connection root with nothing expanded gets keywords only (P4)', async ({
  relaunch,
  consoleErrors,
}) => {
  const CONNECTION_ID = 'conn-sql-schema-root-cold';
  const CONNECTION_SUMMARY = postgresConnectionSummary(CONNECTION_ID, 'Schema DB', 'cyan');
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [] },
    {
      channel: IPC.connectionsCreate,
      args: postgresCreateArgs('Schema DB', 'cyan'),
      response: CONNECTION_SUMMARY,
    },
    // connectPostgresOnly needs the connect response; the treeChildren snapshots this also
    // provides are deliberately never consumed — nothing here is ever expanded.
    ...connectAndExpandControl(CONNECTION_ID),
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  await connectPostgresOnly(page, 'Schema DB', 'cyan');
  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-open-console"]');
  const view = page.locator('[data-testid="console-view"]');
  await expect(view).toBeVisible();

  const tooltip = page.locator('.cm-tooltip-autocomplete');
  await clearAndType(view, page, 'sel');
  await expect(tooltip).toBeVisible({ timeout: 5_000 });
  await expect(tooltip).toContainText('SELECT');
  await expect(tooltip).not.toContainText('order_items');
  await page.keyboard.press('Escape');

  expect(consoleErrors).toEqual([]);
});

// P22c D6: a column the user never opened (no treeDescribe for order_items in this fixture) still
// hovers with its real type, and the linter never flags it — completion, diagnostics and hover all
// read the same effective schema (state/schemaColumns.ts's effectiveSchema), so they cannot
// disagree about what the console knows.
test('hovering a column the cache knows about, that the user never opened, shows its type (D6)', async ({
  relaunch,
}) => {
  const CONNECTION_ID = 'conn-sql-schema-cache-hover';
  const CONNECTION_SUMMARY = postgresConnectionSummary(CONNECTION_ID, 'Schema DB', 'green');
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [] },
    {
      channel: IPC.connectionsCreate,
      args: postgresCreateArgs('Schema DB', 'green'),
      response: CONNECTION_SUMMARY,
    },
    ...orderItemsFixture(CONNECTION_ID).control,
    appSchemaColumnsSnapshot(CONNECTION_ID),
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  await connectAndExpandPostgres(page, 'Schema DB', 'green');
  await openConsoleFromMenu(page, APP_PATH);
  const view = page.locator('[data-testid="console-view"]');
  await expect(view).toBeVisible();

  await typeInto(view, page, 'select quantity from order_items');
  await hoverWord(page, view, 'quantity');
  const hover = page.locator('.cm-kira-hover');
  await expect(hover).toBeVisible({ timeout: 5_000 });
  await expect(hover).toContainText('integer');

  // The linter agrees — a column the cache knows about is never flagged as unknown.
  await expect(view.locator('.cm-lintRange-warning')).toHaveCount(0, { timeout: 3_000 });
});

// P22c D4: the hand-authored document still wins wholesale the moment it declares any table, even
// when the cache also has an answer for this container — a user who pasted a document
// deliberately (a read replica they cannot introspect, a schema they are designing before it
// exists) keeps getting exactly what they get today.
test('a DDL document still wins over the cache (D4)', async ({ relaunch, consoleErrors }) => {
  const CONNECTION_ID = 'conn-sql-schema-doc-wins';
  const CONNECTION_SUMMARY = postgresConnectionSummary(CONNECTION_ID, 'Schema DB', 'green');
  const DOC_ONLY_DDL = `CREATE TABLE widgets (
  id integer PRIMARY KEY,
  label text NOT NULL
);`;
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [] },
    {
      channel: IPC.connectionsCreate,
      args: postgresCreateArgs('Schema DB', 'green'),
      response: CONNECTION_SUMMARY,
    },
    ...orderItemsFixture(CONNECTION_ID).control,
    appSchemaColumnsSnapshot(CONNECTION_ID),
    {
      channel: IPC.schemaGet,
      args: { connectionId: CONNECTION_ID },
      response: {
        connectionId: CONNECTION_ID,
        ddl: DOC_ONLY_DDL,
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    },
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  await connectAndExpandPostgres(page, 'Schema DB', 'green');
  await openConsoleFromMenu(page, APP_PATH);
  const view = page.locator('[data-testid="console-view"]');
  await expect(view).toBeVisible();

  const tooltip = page.locator('.cm-tooltip-autocomplete');
  // widgets (the document's own table, not in the cache's own order_items relation) completes —
  // proof the document, not the cache, is driving completion. An empty non-explicit context needs
  // an explicit request the same as the sibling DDL-document test above.
  await typeInto(view, page, 'select * from ');
  await page.keyboard.press('Control+Space');
  await expect(tooltip).toBeVisible({ timeout: 5_000 });
  await expect(tooltip).toContainText('widgets');
  await page.keyboard.press('Escape');

  await clearAndType(view, page, 'select * from widgets w where w.');
  await expect(tooltip).toBeVisible({ timeout: 5_000 });
  await expect(tooltip).toContainText('label');
  await page.keyboard.press('Escape');

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

// P22c D7: P19 D15's "Fill from connection" button and D16's no-schema hint strip are gone — the
// schema metadata they staged/explained is now served automatically by the cache, with no manual
// step, so a strip explaining that completion is "off" would be false the moment D4 lands. The
// Schema (DDL) dialog itself still opens from the connection row's menu and still saves.
test('the "Fill from connection" button and the no-schema hint are gone (D7)', async ({
  relaunch,
}) => {
  const CONNECTION_ID = 'conn-sql-schema-no-fill';
  const CONNECTION_SUMMARY = postgresConnectionSummary(CONNECTION_ID, 'Schema DB', 'green');
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [] },
    {
      channel: IPC.connectionsCreate,
      args: postgresCreateArgs('Schema DB', 'green'),
      response: CONNECTION_SUMMARY,
    },
    ...orderItemsFixture(CONNECTION_ID).control,
    // No schemaGet/treeSchemaColumns override — an empty document and an empty cache, the same
    // "absent until something fills it" state a brand-new connection has.
    {
      channel: IPC.schemaSet,
      args: { connectionId: CONNECTION_ID, ddl: 'CREATE TABLE t (id integer PRIMARY KEY);' },
      response: {
        connectionId: CONNECTION_ID,
        ddl: 'CREATE TABLE t (id integer PRIMARY KEY);',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    },
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  await connectAndExpandPostgres(page, 'Schema DB', 'green');
  await openConsoleFromMenu(page, APP_PATH);
  const view = page.locator('[data-testid="console-view"]');
  await expect(view).toBeVisible();
  await expect(view.locator('[data-testid="console-no-schema-hint"]')).toHaveCount(0);
  await expect(view.locator('[data-testid="console-no-schema-hint-setup"]')).toHaveCount(0);
  await expect(view.locator('[data-testid="console-no-schema-hint-dismiss"]')).toHaveCount(0);

  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-schema"]');
  const dialog = page.locator('[data-testid="schema-dialog"]');
  await expect(dialog).toBeVisible();
  await expect(page.locator('[data-testid="schema-fill-from-connection"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="schema-fill-cancel"]')).toHaveCount(0);

  // The dialog still saves.
  await dialog.locator('.cm-content').click();
  await page.keyboard.type('CREATE TABLE t (id integer PRIMARY KEY);');
  await page.locator('.dialog-footer button', { hasText: 'Save schema' }).click();
  await expect(dialog).toHaveCount(0);
});
