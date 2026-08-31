import type { Page } from '@playwright/test';
import { IPC } from '@shared/protocol/ipc';
import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import {
  DB_PATH as MARIADB_DB_PATH,
  connectAndExpandControl as mariadbConnectAndExpandControl,
  mariadbConnectionSummary,
  orderItemsFixture,
} from './support/mariadbFixture';
import {
  DB_PATH as MONGO_DB_PATH,
  connectAndExpandControl as mongoConnectAndExpandControl,
  mongoConnectionSummary,
  widgetsFixture,
} from './support/mongoFixture';
import {
  connectControl as redisConnectControl,
  redisConnectionSummary,
} from './support/redisFixture';
import { connectionRow, expandRow, findRow, openRowMenu } from './support/tree';

// Ported from tests/e2e/autocomplete.spec.ts (P57 D16) — the one file in this migration wave
// backed by three non-Postgres real adapters (MariaDB, MongoDB, Redis) rather than one. All three
// port in full: every scenario here drives real DOM/keyboard interaction against real Vue
// component behaviour, and P18 D14's own feature under test (Enter still means "run/apply" with
// the completion popup open) is entirely renderer-side, so nothing about it depended on a real
// Electron process or a real container at *test-run* time — only at *fixture-capture* time.
//
// Fixture provenance (P50 D5 discipline — never hand-write a captured response):
//   - MariaDB: tests/ui/support/mariadbFixture.ts, real captures via
//     `scripts/capture-tree.ts mariadb` against a real MariaDB container seeded with
//     tests/db/fixtures/0002_mariadb_seed.sql.
//   - MongoDB: tests/ui/support/mongoFixture.ts, real captures via
//     `scripts/capture-tree.ts mongo` against a real Mongo 7 container seeded with
//     tests/db/fixtures/0003_mongo_seed.ts.
//   - Redis: tests/ui/support/redisFixture.ts, a real captured `connect()` response only — see
//     that file's own header comment for why nothing else is needed (every Redis scenario here
//     exercises pure client-side completion/lint vocabulary, never a data-plane round trip).
// scripts/capture-tree.ts generalizes the Postgres-only scripts/capture-postgres-tree.ts to any
// tests/db/support/<adapter>.ts fixture — see its own header comment.
//
// A genuine environment finding surfaced capturing these: AGENTS.md's Docker section confirms
// Postgres's own `forListeningPorts()` wait strategy hangs indefinitely under `bun run`'s
// testcontainers integration in this sandbox. MariaDB, Mongo and Redis do **not** — all three
// containers started and every capture used here completed fine under plain `bun run`
// (MariaDB's own Wait.forHealthCheck(), Mongo's Wait.forLogMessage(), Redis's default strategy —
// none of the three combine with forListeningPorts() the way @testcontainers/postgresql's default
// does). The MariaDB capture was additionally run once through the esbuild+vendored-Node path
// anyway (matching scripts/capture-postgres-tree.ts's own documented invocation) to double-check;
// both runs produced byte-identical output.
//
// window.kira no longer exists (M2/M3) — every `window.kira.connectionsCreate(...)` call the
// original used to seed a connection is replaced with the real add-connection dialog flow, the
// same as every other P57 M5 port. 'orange' (the original MariaDB fixture's colour) is not one of
// ConnectionDialog.vue's offered `CONNECTION_COLOR_CHOICES` (P42 D34/D35 retired it from the
// picker, though it stays a valid *stored* value for a connection created before that change) —
// swapped for 'amber' here, the nearest offered hue, since this port creates the connection
// through the picker rather than injecting a stored record directly.

test.describe.configure({ timeout: 60_000 });

function mariadbCreateArgs(name: string) {
  return {
    name,
    kind: 'mariadb',
    color: 'amber',
    mode: 'fields',
    readOnly: false,
    host: '127.0.0.1',
    port: 3306,
    database: 'kira_test',
    username: 'kira',
    password: null,
    uri: null,
    options: {},
    preconnect: null,
    preconnectSidecar: false,
  };
}

function mongoCreateArgs(name: string) {
  return {
    name,
    kind: 'mongodb',
    color: 'green',
    mode: 'fields',
    readOnly: false,
    host: '127.0.0.1',
    port: 27017,
    database: 'kira_test',
    username: 'kira',
    password: null,
    uri: null,
    options: {},
    preconnect: null,
    preconnectSidecar: false,
  };
}

function redisCreateArgs(name: string) {
  return {
    name,
    kind: 'redis',
    color: 'red',
    mode: 'fields',
    readOnly: false,
    host: '127.0.0.1',
    port: 6379,
    database: '0',
    username: null,
    password: null,
    uri: null,
    options: {},
    preconnect: null,
    preconnectSidecar: false,
  };
}

interface ConnectOptions {
  expand?: boolean;
}

async function connectMariadb(
  page: Page,
  name: string,
  color: string,
  opts: ConnectOptions = {},
): Promise<void> {
  await page.click('[data-testid="add-connection"]');
  await page.click('[data-testid="connection-kind-mariadb"]');
  await page.fill('[data-testid="connection-name"]', name);
  await page.fill('[data-testid="connection-host"]', '127.0.0.1');
  await page.fill('[data-testid="connection-port"]', '3306');
  await page.fill('[data-testid="connection-database"]', 'kira_test');
  await page.fill('[data-testid="connection-username"]', 'kira');
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
  if (opts.expand ?? true) {
    await expandRow(page, '');
    await expandRow(page, MARIADB_DB_PATH);
  }
}

async function connectMongo(
  page: Page,
  name: string,
  color: string,
  opts: ConnectOptions = {},
): Promise<void> {
  await page.click('[data-testid="add-connection"]');
  await page.click('[data-testid="connection-kind-mongodb"]');
  await page.fill('[data-testid="connection-name"]', name);
  await page.fill('[data-testid="connection-host"]', '127.0.0.1');
  await page.fill('[data-testid="connection-port"]', '27017');
  await page.fill('[data-testid="connection-database"]', 'kira_test');
  await page.fill('[data-testid="connection-username"]', 'kira');
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
  if (opts.expand ?? true) {
    await expandRow(page, '');
    await expandRow(page, MONGO_DB_PATH);
  }
}

async function connectRedis(page: Page, name: string, color: string): Promise<void> {
  await page.click('[data-testid="add-connection"]');
  await page.click('[data-testid="connection-kind-redis"]');
  await page.fill('[data-testid="connection-name"]', name);
  await page.fill('[data-testid="connection-host"]', '127.0.0.1');
  await page.fill('[data-testid="connection-port"]', '6379');
  await page.fill('[data-testid="connection-database"]', '0');
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

async function openConsoleFromMenu(page: Page, path: string): Promise<void> {
  await openRowMenu(page, path);
  await page.click('[data-testid="menu-item-open-console"]');
}

test('autocomplete — SQL filter row (WHERE)', async ({ relaunch, consoleErrors }) => {
  const CONNECTION_ID = 'conn-ac-mariadb-1';
  const CONNECTION_SUMMARY = mariadbConnectionSummary(CONNECTION_ID, 'MariaDB', 'amber');
  const FIXTURE = orderItemsFixture(CONNECTION_ID);
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [] },
    {
      channel: IPC.connectionsCreate,
      args: mariadbCreateArgs('MariaDB'),
      response: CONNECTION_SUMMARY,
    },
    ...FIXTURE.control,
  ];
  const { window: page } = await relaunch({ control: CONTROL, stream: FIXTURE.port });

  await connectMariadb(page, 'MariaDB', 'amber');
  await (await findRow(page, `${MARIADB_DB_PATH}/table:order_items`)).dblclick();
  await expect(page.locator('[data-testid="data-grid"]')).toBeVisible();
  await expect(page.locator('[data-testid="grid-row"]').first()).toBeVisible({ timeout: 15_000 });

  const whereInput = page.locator('[data-testid="filter-where-input"]');
  await whereInput.click();
  await whereInput.pressSequentially('quan');
  const suggestions = page.locator('.autocomplete-suggestions li');
  await expect(suggestions.filter({ hasText: 'quantity' })).toBeVisible({ timeout: 5_000 });

  // Tab accepts the top match without running the query — the grid must not have refetched yet.
  await page.keyboard.press('Tab');
  await expect(whereInput).toHaveValue('quantity');
  await expect(suggestions).toHaveCount(0);

  // D6: finishing the filter by hand and pressing Enter still applies it — no edits needed to
  // data-view.spec.ts's own fill()+press('Enter') pattern for this to keep working.
  await whereInput.fill('quantity > 1');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-testid="grid-row"]')).toHaveCount(2, { timeout: 10_000 });

  await whereInput.fill('');
  await page.keyboard.press('Enter');

  expect(consoleErrors).toEqual([]);
});

test('autocomplete — Mongo filter row', async ({ relaunch, consoleErrors }) => {
  const CONNECTION_ID = 'conn-ac-mongo-1';
  const CONNECTION_SUMMARY = mongoConnectionSummary(CONNECTION_ID, 'Mongo', 'green');
  const FIXTURE = widgetsFixture(CONNECTION_ID);
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [] },
    {
      channel: IPC.connectionsCreate,
      args: mongoCreateArgs('Mongo'),
      response: CONNECTION_SUMMARY,
    },
    ...FIXTURE.control,
  ];
  const { window: page } = await relaunch({ control: CONTROL, stream: FIXTURE.port });

  await connectMongo(page, 'Mongo', 'green');
  await (await findRow(page, `${MONGO_DB_PATH}/collection:widgets`)).dblclick();
  const view = page.locator('[data-testid="document-view"]');
  await expect(view).toBeVisible();
  await expect(page.locator('[data-testid="document-row"]').first()).toBeVisible({
    timeout: 15_000,
  });

  const filterInput = page.locator('[data-testid="document-search"]');
  await filterInput.click();
  await filterInput.pressSequentially('nam');
  const suggestions = page.locator('.autocomplete-suggestions li');
  await expect(suggestions.filter({ hasText: 'name' })).toBeVisible({ timeout: 5_000 });

  // A bare field name accepts as "name: " (D9) — the box's own JSON5-lite grammar takes it from
  // there, same as typing it by hand.
  await page.keyboard.press('Tab');
  await expect(filterInput).toHaveValue('name: ');

  // D6 again: fill()+press('Enter') on a complete filter still applies it untouched.
  await filterInput.fill("{ name: 'widget-1' }");
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-testid="document-row"]')).toHaveCount(1, { timeout: 10_000 });

  await filterInput.fill('');
  await page.keyboard.press('Enter');

  expect(consoleErrors).toEqual([]);
});

// These two "Copy document" cases live here, not in a documents-only file, because this file
// already owns the local connectMongo/mongoCreateArgs helpers a Mongo document-view test needs —
// splitting them out would duplicate that setup rather than share it, for a UI suite with no
// existing dedicated documents-view spec file to add them to.
//
// Same clipboard-spy approach as data-view.spec.ts's own installClipboardSpy: this tier runs
// WebKit, which has no Chromium-style clipboard-permission grant to make, so spying on writeText
// proves what actually landed without a real OS clipboard round trip.
async function installClipboardSpy(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __clipboard: string[] }).__clipboard = [];
    navigator.clipboard.writeText = (text: string) => {
      (window as unknown as { __clipboard: string[] }).__clipboard.push(text);
      return Promise.resolve();
    };
  });
}

async function lastClipboardWrite(page: Page): Promise<string> {
  return page.evaluate(
    () => (window as unknown as { __clipboard: string[] }).__clipboard.at(-1) ?? '',
  );
}

test('Mongo document row — Copy document / Copy _id', async ({ relaunch, consoleErrors }) => {
  const CONNECTION_ID = 'conn-ac-mongo-copy';
  const CONNECTION_SUMMARY = mongoConnectionSummary(CONNECTION_ID, 'Mongo', 'green');
  const FIXTURE = widgetsFixture(CONNECTION_ID);
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [] },
    {
      channel: IPC.connectionsCreate,
      args: mongoCreateArgs('Mongo'),
      response: CONNECTION_SUMMARY,
    },
    ...FIXTURE.control,
  ];
  const { window: page } = await relaunch({ control: CONTROL, stream: FIXTURE.port });

  await connectMongo(page, 'Mongo', 'green');
  await (await findRow(page, `${MONGO_DB_PATH}/collection:widgets`)).dblclick();
  await expect(page.locator('[data-testid="document-view"]')).toBeVisible();
  const firstRow = page.locator('[data-testid="document-row"]').first();
  await expect(firstRow).toBeVisible({ timeout: 15_000 });

  await installClipboardSpy(page);

  await firstRow.click({ button: 'right' });
  await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();
  await page.click('[data-testid="menu-item-copy-document"]');
  await expect(page.locator('[data-testid="context-menu"]')).toHaveCount(0);
  const copiedDoc = await lastClipboardWrite(page);
  expect(copiedDoc).toContain('ObjectId("000000000000000000000000")');
  expect(copiedDoc).toContain('"name": "widget-0"');

  await firstRow.click({ button: 'right' });
  await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();
  await page.click('[data-testid="menu-item-copy-id"]');
  await expect(page.locator('[data-testid="context-menu"]')).toHaveCount(0);
  expect(await lastClipboardWrite(page)).toBe('ObjectId("000000000000000000000000")');

  expect(consoleErrors).toEqual([]);
});

// A rejected navigator.clipboard.writeText (denied permission, an unfocused window — real on
// macOS per docs/ARCHITECTURE.md's own "WebKit's clipboard gesture heuristics" note) used to
// vanish with nothing on the clipboard and no visible error at all: ContextMenu.vue's
// `onItemClick` is never awaited by its own `@click` binding, and documents/menu.ts's two copy
// items called `navigator.clipboard.writeText` directly with no catch of their own — the exact
// silent failure a "Mongo objects can't be copied" report describes. Confirmed empirically before
// the fix (this test failed: 0 actionError elements, `[]` consoleErrors, nothing surfaced
// anywhere) — now documents/menu.ts's copyOrReportError mirrors the delete-document handler's own
// try/catch + setActionError.
test('Mongo document row — Copy document surfaces a rejected clipboard write', async ({
  relaunch,
  consoleErrors,
}) => {
  const CONNECTION_ID = 'conn-ac-mongo-copy-fail';
  const CONNECTION_SUMMARY = mongoConnectionSummary(CONNECTION_ID, 'Mongo', 'green');
  const FIXTURE = widgetsFixture(CONNECTION_ID);
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [] },
    {
      channel: IPC.connectionsCreate,
      args: mongoCreateArgs('Mongo'),
      response: CONNECTION_SUMMARY,
    },
    ...FIXTURE.control,
  ];
  const { window: page } = await relaunch({ control: CONTROL, stream: FIXTURE.port });

  await connectMongo(page, 'Mongo', 'green');
  await (await findRow(page, `${MONGO_DB_PATH}/collection:widgets`)).dblclick();
  await expect(page.locator('[data-testid="document-view"]')).toBeVisible();
  const firstRow = page.locator('[data-testid="document-row"]').first();
  await expect(firstRow).toBeVisible({ timeout: 15_000 });

  await page.evaluate(() => {
    navigator.clipboard.writeText = () => Promise.reject(new Error('NotAllowedError: denied'));
  });

  await firstRow.click({ button: 'right' });
  await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();
  await page.click('[data-testid="menu-item-copy-document"]');

  await expect(page.locator('[data-testid="document-action-error"]')).toBeVisible();
  await expect(page.locator('[data-testid="document-action-error"]')).toContainText(
    'NotAllowedError',
  );

  expect(consoleErrors).toEqual([]);
});

test('autocomplete — console shows SQL keywords on a resolved dialect (MariaDB)', async ({
  relaunch,
  consoleErrors,
}) => {
  const CONNECTION_ID = 'conn-ac-mariadb-2';
  const CONNECTION_SUMMARY = mariadbConnectionSummary(CONNECTION_ID, 'MariaDB', 'amber');
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [] },
    {
      channel: IPC.connectionsCreate,
      args: mariadbCreateArgs('MariaDB'),
      response: CONNECTION_SUMMARY,
    },
    ...mariadbConnectAndExpandControl(CONNECTION_ID),
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  await connectMariadb(page, 'MariaDB', 'amber');
  await openConsoleFromMenu(page, MARIADB_DB_PATH);
  const sqlConsole = page.locator('[data-testid="console-view"]');
  await expect(sqlConsole).toBeVisible();
  await sqlConsole.locator('.cm-content').click();
  await page.keyboard.type('SEL');
  await expect(page.locator('.cm-tooltip-autocomplete')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('SELECT');
  await page.keyboard.press('Escape');
  await expect(page.locator('.cm-tooltip-autocomplete')).toHaveCount(0);

  expect(consoleErrors).toEqual([]);
});

// P31 item 14/D36: ArrowUp/ArrowDown used to be shadowed by CodeMirror's defaultKeymap (bound
// earlier in the extension array), so the completion popup never saw them — Prec.highest on the
// completion keymap fixes that without depending on array order.
test('autocomplete — arrow keys navigate the completion popup, Tab still accepts, Enter still newlines (P31 D36/D37)', async ({
  relaunch,
  consoleErrors,
}) => {
  const CONNECTION_ID = 'conn-ac-mariadb-3';
  const CONNECTION_SUMMARY = mariadbConnectionSummary(CONNECTION_ID, 'MariaDB', 'amber');
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [] },
    {
      channel: IPC.connectionsCreate,
      args: mariadbCreateArgs('MariaDB'),
      response: CONNECTION_SUMMARY,
    },
    ...mariadbConnectAndExpandControl(CONNECTION_ID),
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  await connectMariadb(page, 'MariaDB', 'amber');
  await openConsoleFromMenu(page, MARIADB_DB_PATH);
  const sqlConsole = page.locator('[data-testid="console-view"]');
  await expect(sqlConsole).toBeVisible();
  await sqlConsole.locator('.cm-content').click();
  await page.keyboard.type('SEL');
  const tooltip = page.locator('.cm-tooltip-autocomplete');
  await expect(tooltip).toBeVisible({ timeout: 5_000 });

  const options = tooltip.locator('li[role="option"]');
  await expect(options.first()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  const thirdText = await options.nth(2).innerText();
  await expect(options.nth(2)).toHaveAttribute('aria-selected', 'true');
  await expect(options.first()).not.toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('Tab');
  await expect(tooltip).toHaveCount(0);
  await expect(sqlConsole.locator('.cm-content')).toContainText(thirdText);

  // Enter still inserts a newline while a fresh popup is open (P18 D18's guarantee).
  await page.keyboard.type(' SEL');
  await expect(tooltip).toBeVisible({ timeout: 5_000 });
  const beforeEnterLines = await sqlConsole.locator('.cm-line').count();
  await page.keyboard.press('Enter');
  await expect(sqlConsole.locator('.cm-line')).toHaveCount(beforeEnterLines + 1);

  expect(consoleErrors).toEqual([]);
});

test('autocomplete — Mongo console completes collections, methods and operators', async ({
  relaunch,
  consoleErrors,
}) => {
  const CONNECTION_ID = 'conn-ac-mongo-2';
  const CONNECTION_SUMMARY = mongoConnectionSummary(CONNECTION_ID, 'Mongo', 'green');
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [] },
    {
      channel: IPC.connectionsCreate,
      args: mongoCreateArgs('Mongo'),
      response: CONNECTION_SUMMARY,
    },
    ...mongoConnectAndExpandControl(CONNECTION_ID),
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  await connectMongo(page, 'Mongo', 'green');

  // realities #10's wart, fixed in the addendum (D23): the console used to be handed
  // `language="sql"` for every engine, including Mongo. It now gets its own `mongo` mode, so a
  // shell command like `find` is no longer coloured as a SQL keyword, and completion offers only
  // what mongo/console.ts's own grammar accepts.
  await openConsoleFromMenu(page, MONGO_DB_PATH);
  const mongoConsole = page.locator('[data-testid="console-view"]');
  await expect(mongoConsole).toBeVisible();
  const tooltip = page.locator('.cm-tooltip-autocomplete');

  // Position 1: after `db.`, collection names (F5 — read from the tree's own cache, no round
  // trip).
  await mongoConsole.locator('.cm-content').click();
  await page.keyboard.type('db.');
  await expect(tooltip).toBeVisible({ timeout: 5_000 });
  await expect(tooltip).toContainText('widgets');
  // Collections sort alphabetically when unfiltered (big_widgets, empty_collection,
  // oversized_widgets, validated_widgets, widgets), so Tab would accept whichever ranks first, not
  // necessarily "widgets" — click the exact option instead of relying on ranking order.
  await tooltip.getByText('widgets', { exact: true }).click();
  await expect(mongoConsole.locator('.cm-content')).toContainText('db.widgets');

  // Position 2: after `db.<collection>.`, the ten supported methods.
  await page.keyboard.type('.');
  await expect(tooltip).toBeVisible({ timeout: 5_000 });
  await expect(tooltip).toContainText('find');
  await expect(tooltip).toContainText('aggregate');
  // Methods sort alphabetically when unfiltered (aggregate first) — click the exact option
  // instead of relying on Tab picking whichever ranks first.
  await tooltip.getByText('find', { exact: true }).click();
  await expect(mongoConsole.locator('.cm-content')).toContainText('db.widgets.find');

  // Position 3: a `$`-prefixed token, the query-operator vocabulary — and no SQL keyword
  // anywhere, since the mongo mode never registers lang-sql's keyword source.
  await page.keyboard.type('({ name: $');
  await expect(tooltip).toBeVisible({ timeout: 5_000 });
  await expect(tooltip).toContainText('$eq');
  await expect(tooltip).not.toContainText('SELECT');
  await page.keyboard.press('Escape');
  await expect(tooltip).toHaveCount(0);

  expect(consoleErrors).toEqual([]);
});

test('autocomplete — Mongo console degrades to methods/operators when the database was never expanded', async ({
  relaunch,
  consoleErrors,
}) => {
  const CONNECTION_ID = 'conn-ac-mongo-3';
  const CONNECTION_SUMMARY = mongoConnectionSummary(CONNECTION_ID, 'Mongo', 'green');
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [] },
    {
      channel: IPC.connectionsCreate,
      args: mongoCreateArgs('Mongo'),
      response: CONNECTION_SUMMARY,
    },
    ...mongoConnectAndExpandControl(CONNECTION_ID),
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  // F5: opened from the connection root, with the database node never expanded — no
  // `treeState.children` entry exists for it, so collection-name completion has nothing to
  // offer, but the method/operator positions don't depend on it at all.
  await connectMongo(page, 'Mongo', 'green', { expand: false });
  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-open-console"]');
  const mongoConsole = page.locator('[data-testid="console-view"]');
  await expect(mongoConsole).toBeVisible();
  const tooltip = page.locator('.cm-tooltip-autocomplete');

  await mongoConsole.locator('.cm-content').click();
  await page.keyboard.type('db.');
  await page.waitForTimeout(300);
  await expect(tooltip).toHaveCount(0);

  await page.keyboard.type('widgets.');
  await expect(tooltip).toBeVisible({ timeout: 5_000 });
  await expect(tooltip).toContainText('find');

  expect(consoleErrors).toEqual([]);
});

test('autocomplete — Redis console completes command names on the first token only', async ({
  relaunch,
  consoleErrors,
}) => {
  const CONNECTION_ID = 'conn-ac-redis-1';
  const CONNECTION_SUMMARY = redisConnectionSummary(CONNECTION_ID, 'Redis', 'red');
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [] },
    {
      channel: IPC.connectionsCreate,
      args: redisCreateArgs('Redis'),
      response: CONNECTION_SUMMARY,
    },
    ...redisConnectControl(CONNECTION_ID),
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  await connectRedis(page, 'Redis', 'red');

  // D23's highlighting-mode fix applies here too, and D22 restricts completion to the first
  // token of a statement — never a key name or a value.
  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-open-console"]');
  const redisConsole = page.locator('[data-testid="console-view"]');
  await expect(redisConsole).toBeVisible();
  const tooltip = page.locator('.cm-tooltip-autocomplete');

  await redisConsole.locator('.cm-content').click();
  await page.keyboard.type('GE');
  await expect(tooltip).toBeVisible({ timeout: 5_000 });
  await expect(tooltip).toContainText('GET key');
  await page.keyboard.press('Tab');
  await expect(redisConsole.locator('.cm-content')).toContainText('GET');

  // Second token: no completion at all — this is a key name, not a command.
  await page.keyboard.type(' somek');
  await page.waitForTimeout(300);
  await expect(tooltip).toHaveCount(0);

  expect(consoleErrors).toEqual([]);
});

test('console lint — SQL diagnostics (D24)', async ({ relaunch, consoleErrors }) => {
  const CONNECTION_ID = 'conn-ac-mariadb-4';
  const CONNECTION_SUMMARY = mariadbConnectionSummary(CONNECTION_ID, 'MariaDB', 'amber');
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [] },
    {
      channel: IPC.connectionsCreate,
      args: mariadbCreateArgs('MariaDB'),
      response: CONNECTION_SUMMARY,
    },
    ...mariadbConnectAndExpandControl(CONNECTION_ID),
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  await connectMariadb(page, 'MariaDB', 'amber');
  await openConsoleFromMenu(page, MARIADB_DB_PATH);
  const stringConsole = page.locator('[data-testid="console-view"]');
  await expect(stringConsole).toBeVisible();
  await stringConsole.locator('.cm-content').click();

  // A statement that would run cleanly carries no diagnostic underline.
  await page.keyboard.type('SELECT 1;');
  await expect(stringConsole.locator('.cm-lintRange-error')).toHaveCount(0, { timeout: 5_000 });

  // An unterminated string literal is flagged.
  await page.keyboard.type(" SELECT '");
  await expect(stringConsole.locator('.cm-lintRange-error')).toHaveCount(1, { timeout: 5_000 });

  await openConsoleFromMenu(page, MARIADB_DB_PATH);
  const parenConsole = page.locator('[data-testid="console-view"]');
  await expect(parenConsole).toBeVisible();
  await parenConsole.locator('.cm-content').click();

  // An unbalanced parenthesis is flagged too.
  await page.keyboard.type('SELECT (1;');
  await expect(parenConsole.locator('.cm-lintRange-error')).toHaveCount(1, { timeout: 5_000 });

  expect(consoleErrors).toEqual([]);
});

test('console lint — Mongo diagnostics (D24)', async ({ relaunch, consoleErrors }) => {
  const CONNECTION_ID = 'conn-ac-mongo-4';
  const CONNECTION_SUMMARY = mongoConnectionSummary(CONNECTION_ID, 'Mongo', 'green');
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [] },
    {
      channel: IPC.connectionsCreate,
      args: mongoCreateArgs('Mongo'),
      response: CONNECTION_SUMMARY,
    },
    ...mongoConnectAndExpandControl(CONNECTION_ID),
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  await connectMongo(page, 'Mongo', 'green');
  await openConsoleFromMenu(page, MONGO_DB_PATH);
  const mongoConsole = page.locator('[data-testid="console-view"]');
  await expect(mongoConsole).toBeVisible();
  await mongoConsole.locator('.cm-content').click();

  // A statement matching the grammar with a supported method carries no diagnostic.
  await page.keyboard.type('db.widgets.find()');
  await expect(mongoConsole.locator('.cm-lintRange-error')).toHaveCount(0, { timeout: 5_000 });

  await openConsoleFromMenu(page, MONGO_DB_PATH);
  const methodConsole = page.locator('[data-testid="console-view"]');
  await expect(methodConsole).toBeVisible();
  await methodConsole.locator('.cm-content').click();

  // An unsupported method is flagged, worded exactly the way mongo/console.ts's own parser
  // rejects it (D24).
  await page.keyboard.type('db.widgets.upsert({})');
  const underline = methodConsole.locator('.cm-lintRange-error');
  await expect(underline).toHaveCount(1, { timeout: 5_000 });
  await expect(underline).toContainText('upsert');

  // --- P42 D12: the argument itself is validated against this app's own Mongo shell-literal
  // grammar — not JSON.parse, which would reject valid shell input this console accepts. -------
  await openConsoleFromMenu(page, MONGO_DB_PATH);
  const brokenArgConsole = page.locator('[data-testid="console-view"]');
  await expect(brokenArgConsole).toBeVisible();
  await brokenArgConsole.locator('.cm-content').click();
  await page.keyboard.type('db.widgets.find({a:})');
  await expect(brokenArgConsole.locator('.cm-lintRange-error')).toHaveCount(1, { timeout: 5_000 });

  await openConsoleFromMenu(page, MONGO_DB_PATH);
  const shellLiteralConsole = page.locator('[data-testid="console-view"]');
  await expect(shellLiteralConsole).toBeVisible();
  await shellLiteralConsole.locator('.cm-content').click();
  // A shell constructor call and an unquoted key are both valid shell literals, even though
  // neither would survive a plain JSON.parse — the not-JSON.parse guarantee.
  await page.keyboard.type('db.widgets.find({_id: ObjectId("507f191e810c19729de860ea")})');
  await expect(shellLiteralConsole.locator('.cm-lintRange-error')).toHaveCount(0, {
    timeout: 5_000,
  });

  expect(consoleErrors).toEqual([]);
});

test('console lint — Redis diagnostics (D24)', async ({ relaunch, consoleErrors }) => {
  const CONNECTION_ID = 'conn-ac-redis-2';
  const CONNECTION_SUMMARY = redisConnectionSummary(CONNECTION_ID, 'Redis', 'red');
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [] },
    {
      channel: IPC.connectionsCreate,
      args: redisCreateArgs('Redis'),
      response: CONNECTION_SUMMARY,
    },
    ...redisConnectControl(CONNECTION_ID),
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  await connectRedis(page, 'Redis', 'red');

  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-open-console"]');
  const stringConsole = page.locator('[data-testid="console-view"]');
  await expect(stringConsole).toBeVisible();
  await stringConsole.locator('.cm-content').click();

  // A well-formed command carries no diagnostic.
  await page.keyboard.type('GET somekey');
  await expect(stringConsole.locator('.cm-lintRange-error')).toHaveCount(0, { timeout: 5_000 });

  // An unterminated quoted string is flagged, reusing redis/console.ts's own tokenizer wording.
  await page.keyboard.type(" SET k '");
  await expect(stringConsole.locator('.cm-lintRange-error')).toHaveCount(1, { timeout: 5_000 });

  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-open-console"]');
  const multilineConsole = page.locator('[data-testid="console-view"]');
  await expect(multilineConsole).toBeVisible();
  await multilineConsole.locator('.cm-content').click();

  // F10's known splitter bug (out of scope to fix here): a statement spanning more than one
  // non-empty line warns instead of silently mis-executing. It's a single diagnostic (one issue,
  // `from`→`to` spanning both lines) — CodeMirror can't render one inline mark decoration across
  // a line break, so it splits it into one `.cm-lintRange-warning` span per line, not one total.
  await page.keyboard.type('GET a\nGET b');
  await expect(multilineConsole.locator('.cm-lintRange-warning')).toHaveCount(2, {
    timeout: 5_000,
  });

  expect(consoleErrors).toEqual([]);
});
