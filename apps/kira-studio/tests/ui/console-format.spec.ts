import type { Locator, Page } from '@playwright/test';
import { DATA_OP } from '@shared/protocol/data-ops';
import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';
import {
  connectAndExpandControl as mongoConnectAndExpandControl,
  mongoConnectionSummary,
} from './support/mongoFixture';
import {
  APP_PATH,
  DB_PATH,
  ORDER_ITEMS_PATH,
  orderItemsFixture,
  postgresConnectionSummary,
} from './support/postgresFixture';
import {
  connectControl as redisConnectControl,
  redisConnectionSummary,
} from './support/redisFixture';
import { connectionRow, expandRow, openRowMenu } from './support/tree';

// P13 §6.1: no scenario here runs a statement, so no execute() port snapshot is needed at all —
// Format is pure renderer work, and the boot/connect control snapshots each fixture already
// exports are the whole setup.

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
    autoExplain: false,
    throttlePerSec: 0,
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
  await expandRow(page, APP_PATH);
}

async function connectMongo(page: Page, name: string, color: string): Promise<void> {
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

async function typeInto(view: Locator, page: Page, text: string): Promise<void> {
  await view.locator('.cm-content').click();
  await page.keyboard.type(text);
}

/** `.innerText()`, not `.textContent()` — CodeMirror renders one line per DOM block and only
 *  `.innerText()` reproduces the real line breaks (and the leading-space indentation) between
 *  them, the same helper cell-editor.spec.ts's own Beautify scenarios use. */
async function consoleText(view: Locator): Promise<string> {
  return view.locator('.cm-content').innerText();
}

test('Query console — Format reformats a Postgres statement in place', async ({ relaunch }) => {
  const CONNECTION_ID = 'conn-console-format-pg';
  const CONNECTION_SUMMARY = postgresConnectionSummary(CONNECTION_ID, 'Format DB', 'green');
  const FIXTURE = orderItemsFixture(CONNECTION_ID);

  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [] },
    {
      channel: IPC.connectionsCreate,
      args: postgresCreateArgs('Format DB', 'green'),
      response: CONNECTION_SUMMARY,
    },
    ...FIXTURE.control,
  ];

  const { window: page } = await relaunch({ control: CONTROL });
  await connectAndExpandPostgres(page, 'Format DB', 'green');
  await openConsoleFromMenu(page, ORDER_ITEMS_PATH);
  const view = page.locator('[data-testid="console-view"]');
  await expect(view).toBeVisible();

  await typeInto(view, page, 'SELECT a,b FROM t WHERE a=1 AND b IN (SELECT x FROM y)');

  const before = Date.now();
  await page.click('[data-testid="console-format"]');
  // §6.2: the emitted chunk's own cost (F4's ~180ms cold import + first format) lands here, on
  // the first press of the whole test run — a coarse in-process measurement, logged rather than
  // asserted on (docs/PERF.md's own rule for this timing tier).
  await expect(view.locator('.cm-line').first()).toHaveText('SELECT');
  console.log(`P13 §6.2 first Format press (cold import + format), ms: ${Date.now() - before}`);

  const text = await consoleText(view);
  const lines = text.split('\n');
  expect(lines[0]).toBe('SELECT');
  expect(lines).toContain('  a,');
  expect(lines).toContain('  b');
  expect(lines).toContain('FROM');
});

test('Query console — Format on unparseable SQL leaves the text untouched', async ({
  relaunch,
}) => {
  const CONNECTION_ID = 'conn-console-format-pg-err';
  const CONNECTION_SUMMARY = postgresConnectionSummary(CONNECTION_ID, 'Format Err DB', 'blue');
  const FIXTURE = orderItemsFixture(CONNECTION_ID);

  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [] },
    {
      channel: IPC.connectionsCreate,
      args: postgresCreateArgs('Format Err DB', 'blue'),
      response: CONNECTION_SUMMARY,
    },
    ...FIXTURE.control,
  ];

  const { window: page } = await relaunch({ control: CONTROL });
  await connectAndExpandPostgres(page, 'Format Err DB', 'blue');
  await openConsoleFromMenu(page, ORDER_ITEMS_PATH);
  const view = page.locator('[data-testid="console-view"]');
  await expect(view).toBeVisible();

  const broken = 'select from where (((';
  await typeInto(view, page, broken);
  await page.click('[data-testid="console-format"]');

  const strip = view.locator('[data-testid="console-format-error"]');
  await expect(strip).toBeVisible();
  // F5's own guard: the library's raw parse dump (a multi-thousand-character nearley
  // expectation list) must never reach the UI — only its first line is fit to show.
  const stripText = (await strip.innerText()).trim();
  expect(stripText.split('\n')).toHaveLength(1);
  await expect(view.locator('.cm-content')).toHaveText(broken);

  // D9: the strip clears on the very next edit, so it never outlives the text that caused it.
  await page.keyboard.type('x');
  await expect(strip).toHaveCount(0);
});

// P19 T12/D13 (reopening P13 §3): one statement the grammar rejects no longer takes the whole
// press down with it — it's emitted verbatim, in place, and a warn strip (not err — the press
// still did something useful) names which one.
test('Query console — one unparseable statement no longer blocks the rest (P19 D13)', async ({
  relaunch,
}) => {
  const CONNECTION_ID = 'conn-console-format-partial';
  const CONNECTION_SUMMARY = postgresConnectionSummary(CONNECTION_ID, 'Format Partial DB', 'cyan');
  const FIXTURE = orderItemsFixture(CONNECTION_ID);

  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [] },
    {
      channel: IPC.connectionsCreate,
      args: postgresCreateArgs('Format Partial DB', 'cyan'),
      response: CONNECTION_SUMMARY,
    },
    ...FIXTURE.control,
  ];

  const { window: page } = await relaunch({ control: CONTROL });
  await connectAndExpandPostgres(page, 'Format Partial DB', 'cyan');
  await openConsoleFromMenu(page, ORDER_ITEMS_PATH);
  const view = page.locator('[data-testid="console-view"]');
  await expect(view).toBeVisible();

  await typeInto(view, page, 'select a,b from t;\n\\dt');
  await page.click('[data-testid="console-format"]');

  await expect(view.locator('[data-testid="console-format-error"]')).toHaveCount(0);
  const warning = view.locator('[data-testid="console-format-warning"]');
  await expect(warning).toBeVisible();
  await expect(warning).toContainText('Formatted 1 of 2 statements');
  await expect(warning).toContainText('statement 2');

  const text = await consoleText(view);
  expect(text).toContain('\\dt'); // the broken statement, verbatim
  const lines = text.split('\n');
  expect(lines[0]).toBe('select'); // the first statement still reformatted (keywordCase: preserve)
});

// P19 T12/D13/F19: keywordCase: 'preserve' (P13 D4) means Format only ever changes whitespace —
// pressing it on an already-indented document changes nothing, and without this nothing
// distinguished "already formatted" from "the button is dead".
test('Query console — pressing Format twice shows "Already formatted" the second time (P19 D13)', async ({
  relaunch,
}) => {
  const CONNECTION_ID = 'conn-console-format-twice';
  const CONNECTION_SUMMARY = postgresConnectionSummary(CONNECTION_ID, 'Format Twice DB', 'magenta');
  const FIXTURE = orderItemsFixture(CONNECTION_ID);

  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [] },
    {
      channel: IPC.connectionsCreate,
      args: postgresCreateArgs('Format Twice DB', 'magenta'),
      response: CONNECTION_SUMMARY,
    },
    ...FIXTURE.control,
  ];

  const { window: page } = await relaunch({ control: CONTROL });
  await connectAndExpandPostgres(page, 'Format Twice DB', 'magenta');
  await openConsoleFromMenu(page, ORDER_ITEMS_PATH);
  const view = page.locator('[data-testid="console-view"]');
  await expect(view).toBeVisible();

  await typeInto(view, page, 'select a,b from t');
  await page.click('[data-testid="console-format"]');
  await expect(view.locator('[data-testid="console-format-note"]')).toHaveCount(0);

  await page.click('[data-testid="console-format"]');
  const note = view.locator('[data-testid="console-format-note"]');
  await expect(note).toBeVisible();
  await expect(note).toContainText('Already formatted');
});

test('Query console — Format reformats a Mongo aggregate pipeline', async ({ relaunch }) => {
  const CONNECTION_ID = 'conn-console-format-mongo';
  const CONNECTION_SUMMARY = mongoConnectionSummary(CONNECTION_ID, 'Format Mongo', 'green');
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [] },
    {
      channel: IPC.connectionsCreate,
      args: mongoCreateArgs('Format Mongo'),
      response: CONNECTION_SUMMARY,
    },
    ...mongoConnectAndExpandControl(CONNECTION_ID),
  ];

  const { window: page } = await relaunch({ control: CONTROL });
  await connectMongo(page, 'Format Mongo', 'green');
  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-open-console"]');
  const view = page.locator('[data-testid="console-view"]');
  await expect(view).toBeVisible();

  await typeInto(view, page, 'db.widgets.aggregate([{$match:{a:1}},{$group:{_id:"$a"}}])');
  await page.click('[data-testid="console-format"]');

  const lines = (await consoleText(view)).split('\n');
  expect(lines[0]).toBe('db.widgets.aggregate([');
  expect(lines.some((l) => l.trim() === '"$match": {')).toBe(true);
  expect(lines.some((l) => l.trim() === '"$group": {')).toBe(true);
});

test('Query console — Redis has no Format button (D6)', async ({ relaunch }) => {
  const CONNECTION_ID = 'conn-console-format-redis';
  const CONNECTION_SUMMARY = redisConnectionSummary(CONNECTION_ID, 'Format Redis', 'red');
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [] },
    {
      channel: IPC.connectionsCreate,
      args: redisCreateArgs('Format Redis'),
      response: CONNECTION_SUMMARY,
    },
    ...redisConnectControl(CONNECTION_ID),
  ];

  const { window: page } = await relaunch({ control: CONTROL });
  await connectRedis(page, 'Format Redis', 'red');
  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-open-console"]');
  const view = page.locator('[data-testid="console-view"]');
  await expect(view).toBeVisible();

  // D6: a Redis statement is a flat token list with nothing to reformat — the toolbar mounts
  // (Run is there) and the button is deliberately absent, not the whole view missing. This is
  // the assertion most likely to be quietly "fixed" later by someone who assumes the missing
  // button is an oversight rather than a deliberate decision.
  await expect(view.locator('[data-testid="console-run-statement"]')).toBeVisible();
  await expect(view.locator('[data-testid="console-format"]')).toHaveCount(0);
});

// P19 T11/D12: closes v1.1 P13's own OQ-2 — the caret used to jump to offset 0 on every format,
// which also silently re-pointed *Run statement* at the first statement regardless of where the
// user was actually working.
test('Query console — Format leaves the caret in the statement it was in, so Run statement still targets it (P19 D12)', async ({
  relaunch,
}) => {
  const CONNECTION_ID = 'conn-console-format-caret';
  const CONNECTION_SUMMARY = postgresConnectionSummary(CONNECTION_ID, 'Format Caret DB', 'amber');
  const FIXTURE = orderItemsFixture(CONNECTION_ID);

  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [] },
    {
      channel: IPC.connectionsCreate,
      args: postgresCreateArgs('Format Caret DB', 'amber'),
      response: CONNECTION_SUMMARY,
    },
    ...FIXTURE.control,
  ];

  const { window: page, stream } = await relaunch({ control: CONTROL });
  await connectAndExpandPostgres(page, 'Format Caret DB', 'amber');
  await openConsoleFromMenu(page, ORDER_ITEMS_PATH);
  const view = page.locator('[data-testid="console-view"]');
  await expect(view).toBeVisible();

  await typeInto(view, page, 'select 1 as a;\nselect 2 as b;\nselect 3 as c;');
  await expect(view.locator('.cm-line')).toHaveCount(3);

  // Put the caret in the SECOND statement — typing left it at the very end (line 3); one Up
  // arrow from there lands in line 2, deterministically (a mouse click's target coordinate can
  // land ambiguously between two adjacent lines under font-metric rounding). Escape first closes
  // any completion popup still open from typing, which would otherwise steal the Up arrow to
  // navigate its own suggestion list instead of moving the real caret.
  await page.keyboard.press('Escape');
  await page.keyboard.press('ArrowUp');
  // ArrowUp alone preserves the goal column, which (typing left the caret at the very end of
  // line 3, the same column as line 2's own last character) lands exactly on the boundary
  // between statement 2 and statement 3 rather than inside statement 2 — Home moves it
  // unambiguously into the middle of line 2's own text instead.
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');

  await page.click('[data-testid="console-format"]');
  // Formatting rewrote every offset in the document — this is only proof the press itself
  // completed, not that the caret landed anywhere in particular.
  await expect(view.locator('.cm-content')).toContainText('as c');

  await page.click('[data-testid="console-run-statement"]');
  const executed = (await stream.ops()).filter((o) => o.op === DATA_OP.execute).at(-1);
  const statements = (executed?.payload as { statements?: string[] } | undefined)?.statements;
  expect(statements).toHaveLength(1);
  expect(statements?.[0]).toContain('as b');
  expect(statements?.[0]).not.toContain('as a');
  expect(statements?.[0]).not.toContain('as c');
});
