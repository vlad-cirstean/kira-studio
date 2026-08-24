import type { Locator, Page } from '@playwright/test';
import { TTL_KEY } from '../db/fixtures/0004_redis_seed';
import { expect, test } from './fixtures';
import {
  DOCKER_UNAVAILABLE_MESSAGE,
  isDockerAvailable,
  type MariaFixture,
  startMariadb,
} from './support/mariadb';
import { formatRssSeries, sampleRssSeries } from './support/measure';
import { type MongoFixture, startMongo } from './support/mongo';
import { type PgFixture, startPostgres } from './support/pg';
import { type RedisFixture, startRedis } from './support/redis';
import { expandRow, findRow, openRowMenu } from './support/tree';

// P12's §2.2 budget (D2, D4): < 350 MB total RSS across 5 live connections and 10 open tabs.
// Fully automated — not a manual procedure — because the whole scenario is scriptable against
// the existing Testcontainers fixtures and the existing window.kira surface.
test.describe.configure({ timeout: 600_000 });

let pg: PgFixture | null = null;
let mariadb: MariaFixture | null = null;
let mongo: MongoFixture | null = null;
let redis: RedisFixture | null = null;

test.beforeAll(async () => {
  test.setTimeout(600_000);
  if (!(await isDockerAvailable())) {
    test.skip(true, DOCKER_UNAVAILABLE_MESSAGE);
    return;
  }
  [pg, mariadb, mongo, redis] = await Promise.all([
    startPostgres(),
    startMariadb(),
    startMongo(),
    startRedis(),
  ]);
});

test.afterAll(async () => {
  await Promise.all([pg?.stop(), mariadb?.stop(), mongo?.stop(), redis?.stop()]);
});

const PG_DB_PATH = 'database:kira_test';
const PG_APP_PATH = `${PG_DB_PATH}/schema:app`;
const PG_BIG_ROWS_PATH = `${PG_APP_PATH}/table:big_rows`;

const MARIA_DB_PATH = 'database:kira_test';
const MARIA_BIG_ROWS_PATH = `${MARIA_DB_PATH}/table:big_rows`;

const MONGO_DB_PATH = 'database:kira_test';
const WIDGETS_PATH = `${MONGO_DB_PATH}/collection:widgets`;

const REDIS_DB0_PATH = 'database:db0';
const COUNTER_KEY_PATH = `${REDIS_DB0_PATH}/key:counter`;
const SESSION_NS_PATH = `${REDIS_DB0_PATH}/namespace:session`;
const TTL_KEY_PATH = `${SESSION_NS_PATH}/key:${encodeURIComponent(TTL_KEY)}`;

function connectionRootRow(page: Page, name: string): Locator {
  return page.locator('[data-testid="tree-row"][data-kind="connection"]').filter({ hasText: name });
}

async function connectAndExpand(page: Page, name: string): Promise<void> {
  const root = connectionRootRow(page, name);
  await expect(root).toBeVisible();
  await root.click({ button: 'right' });
  await page.click('[data-testid="menu-item-connect"]');
  await expect(root.locator('.status-dot')).toHaveAttribute('data-status', 'connected', {
    timeout: 15_000,
  });
  await root.locator('.twisty').click();
  await expect(root.locator('.twisty .spin')).toHaveCount(0, { timeout: 15_000 });
}

async function collapseRoot(page: Page, name: string): Promise<void> {
  await connectionRootRow(page, name).locator('.twisty').click();
}

async function waitForGrid(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="data-grid"]')).toBeVisible();
  await expect
    .poll(async () => page.locator('[data-testid="grid-gutter-cell"]').count(), { timeout: 15_000 })
    .toBeGreaterThan(0);
}

test('5 connections / 10 tabs total RSS stays under 350 MB', async ({ kira }) => {
  test.setTimeout(600_000);
  if (!pg || !mariadb || !mongo || !redis) throw new Error('a fixture did not start');
  const { app, window: page } = kira;

  // Page size 1000 for every table tab opened below (D4) — one setting, not four manual clicks.
  await page.evaluate(() => window.kira.settingsSet({ data: { defaultPageSize: 1000 } }));

  const baseline = await sampleRssSeries(app);
  console.log(`memory.spec.ts baseline (0 connections):\n${formatRssSeries(baseline)}`);

  // --- create all 5 connections ---------------------------------------------------------------
  const pgCfg = pg.config;
  const mariaCfg = mariadb.config;
  const mongoCfg = mongo.config;
  const redisCfg = redis.config;

  await page.evaluate(
    (c) =>
      window.kira.connectionsCreate({
        name: 'Memory PG A',
        kind: 'postgres',
        color: 'blue',
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
      host: pgCfg.host,
      port: pgCfg.port,
      database: pgCfg.database,
      username: pgCfg.username,
      password: pgCfg.password,
    },
  );
  await page.evaluate(
    (c) =>
      window.kira.connectionsCreate({
        name: 'Memory PG B',
        kind: 'postgres',
        color: 'cyan',
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
      host: pgCfg.host,
      port: pgCfg.port,
      database: pgCfg.database,
      username: pgCfg.username,
      password: pgCfg.password,
    },
  );
  await page.evaluate(
    (c) =>
      window.kira.connectionsCreate({
        name: 'Memory MariaDB',
        kind: 'mariadb',
        color: 'orange',
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
      host: mariaCfg.host,
      port: mariaCfg.port,
      database: mariaCfg.database,
      username: mariaCfg.username,
      password: mariaCfg.password,
    },
  );
  await page.evaluate(
    (c) =>
      window.kira.connectionsCreate({
        name: 'Memory Mongo',
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
      host: mongoCfg.host,
      port: mongoCfg.port,
      database: mongoCfg.database,
      username: mongoCfg.username,
      password: mongoCfg.password,
    },
  );
  await page.evaluate(
    (c) =>
      window.kira.connectionsCreate({
        name: 'Memory Redis',
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
      host: redisCfg.host,
      port: redisCfg.port,
      database: redisCfg.database,
      username: redisCfg.username,
      password: redisCfg.password,
    },
  );

  // --- Postgres A: 2 tabs on app.big_rows -------------------------------------------------------
  await connectAndExpand(page, 'Memory PG A');
  await expandRow(page, PG_DB_PATH);
  await expandRow(page, PG_APP_PATH);
  await (await findRow(page, PG_BIG_ROWS_PATH)).dblclick();
  await waitForGrid(page);
  await openRowMenu(page, PG_BIG_ROWS_PATH);
  await page.click('[data-testid="menu-item-open-data-new-tab"]');
  await waitForGrid(page);
  await collapseRoot(page, 'Memory PG A');

  // --- Postgres B: 2 tabs on app.big_rows -------------------------------------------------------
  await connectAndExpand(page, 'Memory PG B');
  await expandRow(page, PG_DB_PATH);
  await expandRow(page, PG_APP_PATH);
  await (await findRow(page, PG_BIG_ROWS_PATH)).dblclick();
  await waitForGrid(page);
  await openRowMenu(page, PG_BIG_ROWS_PATH);
  await page.click('[data-testid="menu-item-open-data-new-tab"]');
  await waitForGrid(page);
  await collapseRoot(page, 'Memory PG B');

  // --- MariaDB: 2 tabs on big_rows ---------------------------------------------------------------
  await connectAndExpand(page, 'Memory MariaDB');
  await expandRow(page, MARIA_DB_PATH);
  await (await findRow(page, MARIA_BIG_ROWS_PATH)).dblclick();
  await waitForGrid(page);
  await openRowMenu(page, MARIA_BIG_ROWS_PATH);
  await page.click('[data-testid="menu-item-open-data-new-tab"]');
  await waitForGrid(page);
  await collapseRoot(page, 'Memory MariaDB');

  // --- Mongo: 2 document tabs on widgets ----------------------------------------------------------
  await connectAndExpand(page, 'Memory Mongo');
  await expandRow(page, MONGO_DB_PATH);
  await (await findRow(page, WIDGETS_PATH)).dblclick();
  await expect(page.locator('[data-testid="document-view"]')).toBeVisible();
  await openRowMenu(page, WIDGETS_PATH);
  await page.click('[data-testid="menu-item-open-document-new-tab"]');
  await expect(page.locator('[data-testid="document-view"]')).toBeVisible();
  await collapseRoot(page, 'Memory Mongo');

  // --- Redis: 2 keyvalue tabs (counter, session:abc) ----------------------------------------------
  await connectAndExpand(page, 'Memory Redis');
  await expandRow(page, REDIS_DB0_PATH);
  await (await findRow(page, COUNTER_KEY_PATH)).dblclick();
  await expect(page.locator('[data-testid="keyvalue-view"]')).toBeVisible();
  await expandRow(page, SESSION_NS_PATH);
  await (await findRow(page, TTL_KEY_PATH)).dblclick();
  await expect(page.locator('[data-testid="keyvalue-view"]')).toBeVisible();
  await collapseRoot(page, 'Memory Redis');

  await expect(page.locator('[data-testid="tab"]')).toHaveCount(10);

  // --- measure: min of 10 readings over an idle window, asserted against the budget -------------
  const series = await sampleRssSeries(app);
  console.log(`memory.spec.ts loaded (5 connections / 10 tabs):\n${formatRssSeries(series)}`);
  const minTotal = Math.min(...series.map((s) => s.totalBytes));
  expect(minTotal).toBeLessThan(350 * 1024 * 1024);

  // --- record L2 hit rate / usage for docs/v1/PERF.md (logged, not asserted here) -------------------
  await page.click('[data-testid="open-settings"]');
  await page.click('[data-testid="settings-section-Cache"]');
  const usageValue = (
    await page
      .locator('.section-pane .field', { hasText: 'Current usage' })
      .locator('input')
      .inputValue()
  ).trim();
  const hitRateValue = (
    await page
      .locator('.section-pane .field', { hasText: 'Hit rate' })
      .locator('input')
      .inputValue()
  ).trim();
  console.log(`memory.spec.ts L2 usage: ${usageValue}, hit rate: ${hitRateValue}`);
  await page.click('[data-testid="settings-close"]');

  // --- disconnect + close everything: logged, not asserted (P13's leak sweep owns the assert) ----
  for (const name of [
    'Memory PG A',
    'Memory PG B',
    'Memory MariaDB',
    'Memory Mongo',
    'Memory Redis',
  ]) {
    await connectionRootRow(page, name).click({ button: 'right' });
    await page.click('[data-testid="menu-item-disconnect"]');
    await expect(connectionRootRow(page, name).locator('.status-dot')).toHaveAttribute(
      'data-status',
      'disconnected',
      { timeout: 10_000 },
    );
  }
  await page.click('[data-testid="tab"]', { button: 'right' });
  await page.click('[data-testid="menu-item-close-all"]');
  await expect(page.locator('[data-testid="tab"]')).toHaveCount(0);

  const afterTeardown = await sampleRssSeries(app);
  console.log(
    `memory.spec.ts after disconnect/close (5 connections / 10 tabs released):\n${formatRssSeries(afterTeardown)}`,
  );
});
