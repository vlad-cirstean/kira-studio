import type { Locator, Page } from '@playwright/test';
import {
  HASH_FIELDS,
  HASH_KEY,
  LIST_KEY,
  LIST_LENGTH,
  TTL_KEY,
} from '../db/fixtures/0004_redis_seed';
import { expect, test } from './fixtures';
import {
  DOCKER_UNAVAILABLE_MESSAGE,
  isDockerAvailable,
  type RedisFixture,
  startRedis,
} from './support/redis';

// The fourth engine through the real UI (P9, mirrors mongo.spec.ts's discipline for the third):
// key/value-shaped pages, not tabular grids or documents, are the point of this spec — it proves
// KeyValueView.vue's per-type rendering and the generic command console against a live server.
test.describe.configure({ timeout: 240_000 });

let redis: RedisFixture | null = null;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  if (!(await isDockerAvailable())) {
    test.skip(true, DOCKER_UNAVAILABLE_MESSAGE);
    return;
  }
  redis = await startRedis();
});

test.afterAll(async () => {
  await redis?.stop();
});

const DB0_PATH = 'database:db0';
const DB1_PATH = 'database:db1';
const USER_NS_PATH = `${DB0_PATH}/namespace:user`;
const USER_1_NS_PATH = `${USER_NS_PATH}/namespace:1`;
const HASH_KEY_PATH = `${USER_1_NS_PATH}/key:${encodeURIComponent(HASH_KEY)}`;
const QUEUE_NS_PATH = `${DB0_PATH}/namespace:queue`;
const LIST_KEY_PATH = `${QUEUE_NS_PATH}/key:${encodeURIComponent(LIST_KEY)}`;
const SESSION_NS_PATH = `${DB0_PATH}/namespace:session`;
const TTL_KEY_PATH = `${SESSION_NS_PATH}/key:${encodeURIComponent(TTL_KEY)}`;
const DB1_OTHER_NS_PATH = `${DB1_PATH}/namespace:other-db`;

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

test('redis — connect, tree, keyvalue tabs, console', async ({ kira, consoleErrors }) => {
  test.setTimeout(240_000);
  if (!redis) throw new Error('redis fixture did not start');
  const { window: page } = kira;

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

  // --- tree: two logical dbs, each with a ':'-namespace tree under it (P9's D3/D4/D5) ---------
  await expandRow(page, '');
  const db0Row = await expandRow(page, DB0_PATH);
  await expect(db0Row).toHaveAttribute('data-kind', 'database');
  const db1Row = await findRow(page, DB1_PATH);
  await expect(db1Row).toBeVisible();
  await expandRow(page, DB1_PATH);
  const otherNsRow = await findRow(page, DB1_OTHER_NS_PATH);
  await expect(otherNsRow).toBeVisible();
  await expect(otherNsRow).toHaveAttribute('data-kind', 'namespace');

  const userNsRow = await expandRow(page, USER_NS_PATH);
  await expect(userNsRow).toHaveAttribute('data-kind', 'namespace');
  const user1NsRow = await expandRow(page, USER_1_NS_PATH);
  await expect(user1NsRow).toHaveAttribute('data-kind', 'namespace');
  const hashKeyRow = await findRow(page, HASH_KEY_PATH);
  await expect(hashKeyRow).toBeVisible();
  await expect(hashKeyRow).toHaveAttribute('data-kind', 'key');

  await page.screenshot({ path: 'test-results/screenshots/redis.png' });

  // --- open a hash key's keyvalue tab: type badge, field/value rows ------------------------
  await hashKeyRow.dblclick();
  const view = page.locator('[data-testid="keyvalue-view"]');
  await expect(view).toBeVisible();
  await expect(view.locator('[data-testid="keyvalue-type"]')).toHaveText('hash');
  await expect(page.locator('[data-testid="keyvalue-row"]')).toHaveCount(
    Object.keys(HASH_FIELDS).length,
    { timeout: 15_000 },
  );
  const hashFields = await page.locator('[data-testid="keyvalue-field"]').allTextContents();
  expect(hashFields.slice().sort()).toEqual(Object.keys(HASH_FIELDS).slice().sort());

  // --- open a list key's keyvalue tab: index/value rows, one page holds every seeded job ----
  await expandRow(page, QUEUE_NS_PATH);
  const listKeyRow = await findRow(page, LIST_KEY_PATH);
  await expect(listKeyRow).toBeVisible();
  await listKeyRow.dblclick();
  const listView = page.locator(`[data-testid="keyvalue-view"][data-path="${LIST_KEY_PATH}"]`);
  await expect(listView).toBeVisible();
  await expect(listView.locator('[data-testid="keyvalue-type"]')).toHaveText('list');
  await expect(listView.locator('[data-testid="keyvalue-row"]')).toHaveCount(LIST_LENGTH, {
    timeout: 15_000,
  });
  await expect(listView.locator('[data-testid="keyvalue-prev"]')).toBeDisabled();
  await expect(listView.locator('[data-testid="keyvalue-next"]')).toBeDisabled();

  // --- open the TTL key: TTL/memory badges are populated, not the "no data" placeholders ----
  await expandRow(page, SESSION_NS_PATH);
  const ttlKeyRow = await findRow(page, TTL_KEY_PATH);
  await expect(ttlKeyRow).toBeVisible();
  await ttlKeyRow.dblclick();
  const ttlView = page.locator(`[data-testid="keyvalue-view"][data-path="${TTL_KEY_PATH}"]`);
  await expect(ttlView).toBeVisible();
  await expect(ttlView.locator('[data-testid="keyvalue-type"]')).toHaveText('string');
  await expect(ttlView.locator('[data-testid="keyvalue-ttl"]')).not.toContainText('no expiry');
  await expect(ttlView.locator('[data-testid="keyvalue-memory"]')).not.toContainText('unknown');

  // --- console: generic redis command against db0, opened from the database node's menu -----
  await openRowMenu(page, DB0_PATH);
  await page.click('[data-testid="menu-item-open-console"]');
  const consoleView = page.locator('[data-testid="console-view"]');
  await expect(consoleView).toBeVisible();
  await expect(consoleView.locator('[data-testid="console-target"]')).toHaveText('db0');
  await consoleView.locator('.cm-content').click();
  await page.keyboard.type('DBSIZE');
  await page.click('[data-testid="console-run-statement"]');
  const consoleResult = consoleView.locator('[data-testid="console-result-grid"]');
  await expect(consoleResult).toHaveCount(1);
  await expect(consoleResult.locator('[data-testid="console-result-kv-row"]')).toHaveCount(1);
  await expect(consoleResult.locator('[data-testid="console-result-kv-row"]')).toContainText('10');

  expect(consoleErrors).toEqual([]);
});
