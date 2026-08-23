import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  isDockerAvailable as isMariadbAvailable,
  DOCKER_UNAVAILABLE_MESSAGE as MARIADB_UNAVAILABLE,
  type MariaFixture,
  startMariadb,
} from './support/mariadb';
import {
  isDockerAvailable as isMongoAvailable,
  DOCKER_UNAVAILABLE_MESSAGE as MONGO_UNAVAILABLE,
  type MongoFixture,
  startMongo,
} from './support/mongo';

// P18 (D14): one feature crossing three surfaces, mirroring console.spec.ts's own "one file per
// feature" shape rather than three scattered additions to data-view.spec.ts/mongo.spec.ts/
// console.spec.ts. The single most important thing under test is D6: every one of these boxes
// must keep meaning "Enter = run/apply" for anyone who ignores the popup entirely, exactly as
// data-view.spec.ts:278-291 and mongo.spec.ts already drive them, with zero edits to either file.
test.describe.configure({ timeout: 240_000 });

let mariadb: MariaFixture | null = null;
let mongo: MongoFixture | null = null;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  if (!(await isMariadbAvailable())) {
    test.skip(true, MARIADB_UNAVAILABLE);
    return;
  }
  mariadb = await startMariadb();
  if (!(await isMongoAvailable())) {
    test.skip(true, MONGO_UNAVAILABLE);
    return;
  }
  mongo = await startMongo();
});

test.afterAll(async () => {
  await mariadb?.stop();
  await mongo?.stop();
});

const DB_PATH = 'database:kira_test';
const ORDER_ITEMS_PATH = `${DB_PATH}/table:order_items`;
const WIDGETS_PATH = `${DB_PATH}/collection:widgets`;

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
  await row.click({ button: 'right' });
  await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();
}

async function connectMariadb(page: Page): Promise<void> {
  if (!mariadb) throw new Error('mariadb fixture did not start');
  const cfg = mariadb.config;
  await page.evaluate(
    (cfg) =>
      window.kira.connectionsCreate({
        name: 'MariaDB',
        kind: 'mariadb',
        color: 'orange',
        mode: 'fields',
        readOnly: false,
        host: cfg.host,
        port: cfg.port,
        database: cfg.database,
        username: cfg.username,
        password: cfg.password,
        uri: null,
        options: {},
        preconnect: null,
        preconnectSidecar: false,
      }),
    {
      host: cfg.host,
      port: cfg.port,
      database: cfg.database,
      username: cfg.username,
      password: cfg.password,
    },
  );
  const connRow = page.locator('[data-testid="tree-row"][data-kind="connection"]');
  await expect(connRow).toBeVisible();
  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-connect"]');
  await expect(connRow.locator('.status-dot')).toHaveAttribute('data-status', 'connected', {
    timeout: 10_000,
  });
}

async function connectMongo(page: Page): Promise<void> {
  if (!mongo) throw new Error('mongo fixture did not start');
  const cfg = mongo.config;
  await page.evaluate(
    (c) =>
      window.kira.connectionsCreate({
        name: 'Mongo',
        kind: 'mongodb',
        color: 'green',
        mode: 'fields',
        readOnly: false,
        host: c.host,
        port: c.port,
        database: c.database,
        username: c.username,
        password: c.password,
        uri: null,
        options: {},
        preconnect: null,
        preconnectSidecar: false,
      }),
    {
      host: cfg.host,
      port: cfg.port,
      database: cfg.database,
      username: cfg.username,
      password: cfg.password,
    },
  );
  const connRow = page.locator('[data-testid="tree-row"][data-kind="connection"]');
  await expect(connRow).toBeVisible();
  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-connect"]');
  await expect(connRow.locator('.status-dot')).toHaveAttribute('data-status', 'connected', {
    timeout: 10_000,
  });
}

test('autocomplete — SQL filter row (WHERE)', async ({ kira, consoleErrors }) => {
  test.setTimeout(240_000);
  if (!mariadb) throw new Error('mariadb fixture did not start');
  const { window: page } = kira;

  await connectMariadb(page);
  await expandRow(page, '');
  await expandRow(page, DB_PATH);
  await (await findRow(page, ORDER_ITEMS_PATH)).dblclick();
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

test('autocomplete — Mongo filter row', async ({ kira, consoleErrors }) => {
  test.setTimeout(240_000);
  if (!mongo) throw new Error('mongo fixture did not start');
  const { window: page } = kira;

  await connectMongo(page);
  await expandRow(page, '');
  await expandRow(page, DB_PATH);
  await (await findRow(page, WIDGETS_PATH)).dblclick();
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

test('autocomplete — console shows SQL keywords on a resolved dialect (MariaDB)', async ({
  kira,
  consoleErrors,
}) => {
  test.setTimeout(240_000);
  if (!mariadb) throw new Error('mariadb fixture did not start');
  const { window: page } = kira;

  await connectMariadb(page);
  await expandRow(page, '');
  await expandRow(page, DB_PATH);

  await openRowMenu(page, DB_PATH);
  await page.click('[data-testid="menu-item-open-console"]');
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

test('autocomplete — console shows no popup for a dialect-less shell console (Mongo)', async ({
  kira,
  consoleErrors,
}) => {
  test.setTimeout(240_000);
  if (!mongo) throw new Error('mongo fixture did not start');
  const { window: page } = kira;

  await connectMongo(page);
  await expandRow(page, '');
  await expandRow(page, DB_PATH);

  // caps.sql === true for Mongo (its console offers a shell-style command form), but
  // ConsoleView.vue's `dialect` computed only ever resolves to 'postgres'/'mariadb' — realities
  // #10's pre-existing wart, which D10 relies on: no resolved dialect means no autocompletion at
  // all, rather than incorrectly offering SQL keywords inside a Mongo shell command.
  await openRowMenu(page, WIDGETS_PATH);
  await page.click('[data-testid="menu-item-open-console"]');
  const mongoConsole = page.locator('[data-testid="console-view"]');
  await expect(mongoConsole).toBeVisible();
  await mongoConsole.locator('.cm-content').click();
  await page.keyboard.type('db.widgets.find(SEL');
  await page.waitForTimeout(300);
  await expect(page.locator('.cm-tooltip-autocomplete')).toHaveCount(0);

  expect(consoleErrors).toEqual([]);
});
