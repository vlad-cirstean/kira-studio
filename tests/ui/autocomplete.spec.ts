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
import {
  isDockerAvailable as isRedisAvailable,
  DOCKER_UNAVAILABLE_MESSAGE as REDIS_UNAVAILABLE,
  type RedisFixture,
  startRedis,
} from './support/redis';

// P18 (D14): one feature crossing three surfaces, mirroring console.spec.ts's own "one file per
// feature" shape rather than three scattered additions to data-view.spec.ts/mongo.spec.ts/
// console.spec.ts. The single most important thing under test is D6: every one of these boxes
// must keep meaning "Enter = run/apply" for anyone who ignores the popup entirely, exactly as
// data-view.spec.ts:278-291 and mongo.spec.ts already drive them, with zero edits to either file.
test.describe.configure({ timeout: 240_000 });

let mariadb: MariaFixture | null = null;
let mongo: MongoFixture | null = null;
let redis: RedisFixture | null = null;

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
  if (!(await isRedisAvailable())) {
    test.skip(true, REDIS_UNAVAILABLE);
    return;
  }
  redis = await startRedis();
});

test.afterAll(async () => {
  await mariadb?.stop();
  await mongo?.stop();
  await redis?.stop();
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

async function connectRedis(page: Page): Promise<void> {
  if (!redis) throw new Error('redis fixture did not start');
  const cfg = redis.config;
  await page.evaluate(
    (c) =>
      window.kira.connectionsCreate({
        name: 'Redis',
        kind: 'redis',
        color: 'red',
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

test('autocomplete — Mongo console completes collections, methods and operators', async ({
  kira,
  consoleErrors,
}) => {
  test.setTimeout(240_000);
  if (!mongo) throw new Error('mongo fixture did not start');
  const { window: page } = kira;

  await connectMongo(page);
  await expandRow(page, '');
  // The database node must be expanded before the console opens — F5's degradation only kicks
  // in when it hasn't been, which the next test covers separately.
  await expandRow(page, DB_PATH);

  // realities #10's wart, fixed in the addendum (D23): the console used to be handed
  // `language="sql"` for every engine, including Mongo. It now gets its own `mongo` mode, so a
  // shell command like `find` is no longer coloured as a SQL keyword, and completion offers only
  // what mongo/console.ts's own grammar accepts.
  await openRowMenu(page, DB_PATH);
  await page.click('[data-testid="menu-item-open-console"]');
  const mongoConsole = page.locator('[data-testid="console-view"]');
  await expect(mongoConsole).toBeVisible();
  const tooltip = page.locator('.cm-tooltip-autocomplete');

  // Position 1: after `db.`, collection names (F5 — read from the tree's own cache, no round trip).
  await mongoConsole.locator('.cm-content').click();
  await page.keyboard.type('db.');
  await expect(tooltip).toBeVisible({ timeout: 5_000 });
  await expect(tooltip).toContainText('widgets');
  // Collections sort alphabetically when unfiltered (empty_collection, validated_widgets,
  // widgets), so Tab would accept whichever ranks first, not necessarily "widgets" — click the
  // exact option instead of relying on ranking order.
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
  kira,
  consoleErrors,
}) => {
  test.setTimeout(240_000);
  if (!mongo) throw new Error('mongo fixture did not start');
  const { window: page } = kira;

  await connectMongo(page);
  // F5: opened from the connection root, with the database node never expanded — no
  // `treeState.children` entry exists for it, so collection-name completion has nothing to
  // offer, but the method/operator positions don't depend on it at all.
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
  kira,
  consoleErrors,
}) => {
  test.setTimeout(240_000);
  if (!redis) throw new Error('redis fixture did not start');
  const { window: page } = kira;

  await connectRedis(page);

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

test('console lint — SQL diagnostics (D24)', async ({ kira, consoleErrors }) => {
  test.setTimeout(240_000);
  if (!mariadb) throw new Error('mariadb fixture did not start');
  const { window: page } = kira;

  await connectMariadb(page);
  await expandRow(page, '');
  await expandRow(page, DB_PATH);

  await openRowMenu(page, DB_PATH);
  await page.click('[data-testid="menu-item-open-console"]');
  const stringConsole = page.locator('[data-testid="console-view"]');
  await expect(stringConsole).toBeVisible();
  await stringConsole.locator('.cm-content').click();

  // A statement that would run cleanly carries no diagnostic underline.
  await page.keyboard.type('SELECT 1;');
  await expect(stringConsole.locator('.cm-lintRange-error')).toHaveCount(0, { timeout: 5_000 });

  // An unterminated string literal is flagged.
  await page.keyboard.type(" SELECT '");
  await expect(stringConsole.locator('.cm-lintRange-error')).toHaveCount(1, { timeout: 5_000 });

  await openRowMenu(page, DB_PATH);
  await page.click('[data-testid="menu-item-open-console"]');
  const parenConsole = page.locator('[data-testid="console-view"]');
  await expect(parenConsole).toBeVisible();
  await parenConsole.locator('.cm-content').click();

  // An unbalanced parenthesis is flagged too.
  await page.keyboard.type('SELECT (1;');
  await expect(parenConsole.locator('.cm-lintRange-error')).toHaveCount(1, { timeout: 5_000 });

  expect(consoleErrors).toEqual([]);
});

test('console lint — Mongo diagnostics (D24)', async ({ kira, consoleErrors }) => {
  test.setTimeout(240_000);
  if (!mongo) throw new Error('mongo fixture did not start');
  const { window: page } = kira;

  await connectMongo(page);
  await expandRow(page, '');
  await expandRow(page, DB_PATH);

  await openRowMenu(page, DB_PATH);
  await page.click('[data-testid="menu-item-open-console"]');
  const mongoConsole = page.locator('[data-testid="console-view"]');
  await expect(mongoConsole).toBeVisible();
  await mongoConsole.locator('.cm-content').click();

  // A statement matching the grammar with a supported method carries no diagnostic.
  await page.keyboard.type('db.widgets.find()');
  await expect(mongoConsole.locator('.cm-lintRange-error')).toHaveCount(0, { timeout: 5_000 });

  await openRowMenu(page, DB_PATH);
  await page.click('[data-testid="menu-item-open-console"]');
  const methodConsole = page.locator('[data-testid="console-view"]');
  await expect(methodConsole).toBeVisible();
  await methodConsole.locator('.cm-content').click();

  // An unsupported method is flagged, worded exactly the way mongo/console.ts's own parser
  // rejects it (D24).
  await page.keyboard.type('db.widgets.upsert({})');
  const underline = methodConsole.locator('.cm-lintRange-error');
  await expect(underline).toHaveCount(1, { timeout: 5_000 });
  await expect(underline).toContainText('upsert');

  expect(consoleErrors).toEqual([]);
});

test('console lint — Redis diagnostics (D24)', async ({ kira, consoleErrors }) => {
  test.setTimeout(240_000);
  if (!redis) throw new Error('redis fixture did not start');
  const { window: page } = kira;

  await connectRedis(page);

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
