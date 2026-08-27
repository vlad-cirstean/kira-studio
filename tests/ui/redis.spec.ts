import {
  BIG_HASH_KEY,
  HASH_FIELDS,
  HASH_KEY,
  LIST_KEY,
  LIST_LENGTH,
  TTL_KEY,
} from '../db/fixtures/0004_redis_seed';
import { expect, test } from './fixtures';
import { acceptConfirm } from './support/dialogs';
import {
  DOCKER_UNAVAILABLE_MESSAGE,
  isDockerAvailable,
  type RedisFixture,
  startRedis,
} from './support/redis';
import { expandRow, findRow, openRowMenu } from './support/tree';

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
const BIG_HASH_KEY_PATH = `${USER_1_NS_PATH}/key:${encodeURIComponent(BIG_HASH_KEY)}`;
const QUEUE_NS_PATH = `${DB0_PATH}/namespace:queue`;
const LIST_KEY_PATH = `${QUEUE_NS_PATH}/key:${encodeURIComponent(LIST_KEY)}`;
const SESSION_NS_PATH = `${DB0_PATH}/namespace:session`;
const TTL_KEY_PATH = `${SESSION_NS_PATH}/key:${encodeURIComponent(TTL_KEY)}`;
const DB1_OTHER_NS_PATH = `${DB1_PATH}/namespace:other-db`;

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

  // --- tree: two logical dbs — now leaves (P41 D5): their ':'-namespace tree moved to a Browse
  // tab (§8.18), reached by double-clicking the (now childless) database row. -------------------
  await expandRow(page, '');
  const db0Row = await findRow(page, DB0_PATH);
  await expect(db0Row).toHaveAttribute('data-kind', 'database');
  await expect(db0Row.locator('.twisty')).toHaveClass(/invisible/);
  const db1Row = await findRow(page, DB1_PATH);
  await expect(db1Row).toBeVisible();
  await expect(db1Row.locator('.twisty')).toHaveClass(/invisible/);

  await page.screenshot({ path: 'test-results/screenshots/redis.png' });

  const browseView = page.locator('[data-testid="browse-view"]');

  // --- db1's own Browse tab: one namespace level down --------------------------------------
  await db1Row.dblclick();
  await expect(browseView).toBeVisible();
  await expect(browseView).toHaveAttribute('data-level', DB1_PATH);
  const otherNsRow = browseView.locator(
    `[data-testid="browse-row"][data-path="${DB1_OTHER_NS_PATH}"]`,
  );
  await expect(otherNsRow).toBeVisible();
  await expect(otherNsRow).toHaveAttribute('data-kind', 'namespace');
  // P43 iter2 F16/D23: a small, ordinary namespace never shows the truncated strip.
  await expect(browseView.locator('[data-testid="browse-truncated"]')).toHaveCount(0);

  // --- db0's own Browse tab: descend user -> 1 -> the hash key, open its keyvalue tab ----------
  await db0Row.dblclick();
  await expect(browseView).toBeVisible();
  await expect(browseView).toHaveAttribute('data-level', DB0_PATH);
  const userRow = browseView.locator(`[data-testid="browse-row"][data-path="${USER_NS_PATH}"]`);
  await expect(userRow).toHaveAttribute('data-kind', 'namespace');
  await userRow.dblclick();
  await expect(browseView).toHaveAttribute('data-level', USER_NS_PATH);
  const user1Row = browseView.locator(`[data-testid="browse-row"][data-path="${USER_1_NS_PATH}"]`);
  await expect(user1Row).toHaveAttribute('data-kind', 'namespace');
  await user1Row.dblclick();
  await expect(browseView).toHaveAttribute('data-level', USER_1_NS_PATH);
  const hashKeyRow = browseView.locator(`[data-testid="browse-row"][data-path="${HASH_KEY_PATH}"]`);
  await expect(hashKeyRow).toBeVisible();
  await expect(hashKeyRow).toHaveAttribute('data-kind', 'key');

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

  // --- P43 iter2 F20/D27: a reload clears the cell editor rather than leaving it showing the
  // previous page's row value. --------------------------------------------------------------
  await view.locator('[data-testid="keyvalue-row"]').first().click();
  const hashCellEditorPanel = page.locator('[data-testid="cell-editor-panel"]');
  await expect(hashCellEditorPanel).toBeVisible();
  await page.click('[data-testid="keyvalue-refresh"]');
  await expect(hashCellEditorPanel).toHaveCount(0);

  // --- P43 iter3 D40/F37: a Refresh on a cursor-paged key (hash/set/zset/stream) returns the
  // pager to the rows it actually served — a SCAN cursor cannot be resumed once the page that
  // minted it is gone, so a reload must go back to page one and say so, rather than silently
  // serving page one's rows under a pager that still claims to be further in. -------------------
  await (await findRow(page, DB0_PATH)).dblclick();
  await expect(browseView).toBeVisible();
  await browseView.locator('[data-testid="browse-crumb"]').first().click();
  await expect(browseView).toHaveAttribute('data-level', DB0_PATH);
  await userRow.dblclick();
  await expect(browseView).toHaveAttribute('data-level', USER_NS_PATH);
  await user1Row.dblclick();
  await expect(browseView).toHaveAttribute('data-level', USER_1_NS_PATH);
  const bigHashRow = browseView.locator(
    `[data-testid="browse-row"][data-path="${BIG_HASH_KEY_PATH}"]`,
  );
  await expect(bigHashRow).toBeVisible();
  await bigHashRow.dblclick();
  const bigHashView = page.locator(
    `[data-testid="keyvalue-view"][data-path="${BIG_HASH_KEY_PATH}"]`,
  );
  await expect(bigHashView).toBeVisible();
  const bigHashFirstField = bigHashView.locator('[data-testid="keyvalue-field"]').first();
  await expect(bigHashFirstField).toBeVisible({ timeout: 15_000 });
  // P49 F7/D5: this page holds 100 rows (defaultKeyValueTabState's own pageSize) — with rows now
  // virtualized, the DOM should hold far fewer, proving this is real windowing rather than an
  // assertion that would pass either way.
  const bigHashRowCount = await bigHashView.locator('[data-testid="keyvalue-row"]').count();
  expect(bigHashRowCount).toBeLessThan(100);
  const firstFieldAtPageOne = await bigHashFirstField.innerText();
  const bigHashNext = bigHashView.locator('[data-testid="keyvalue-next"]');
  await bigHashNext.click(); // clicking a disabled button times out — the guard that this key
  await bigHashNext.click(); // genuinely has more than one page to page through.
  await bigHashView.locator('[data-testid="keyvalue-refresh"]').click();
  await expect
    .poll(() => bigHashFirstField.innerText(), { timeout: 15_000 })
    .toBe(firstFieldAtPageOne);

  // --- open a list key's keyvalue tab: index/value rows, one page holds every seeded job ----
  // Opening the hash key's tab switched the active tab away from db0's Browse tab (still open,
  // just not active) — double-clicking the tree row again reactivates the same tab (§8.4's
  // identity rule), still sitting at user/1; the first breadcrumb crumb jumps straight back to
  // the container root rather than clicking Up twice.
  await (await findRow(page, DB0_PATH)).dblclick();
  await expect(browseView).toBeVisible();
  await browseView.locator('[data-testid="browse-crumb"]').first().click();
  await expect(browseView).toHaveAttribute('data-level', DB0_PATH);
  const queueRow = browseView.locator(`[data-testid="browse-row"][data-path="${QUEUE_NS_PATH}"]`);
  await expect(queueRow).toHaveAttribute('data-kind', 'namespace');
  await queueRow.dblclick();
  await expect(browseView).toHaveAttribute('data-level', QUEUE_NS_PATH);
  const listKeyRow = browseView.locator(`[data-testid="browse-row"][data-path="${LIST_KEY_PATH}"]`);
  await expect(listKeyRow).toBeVisible();
  await listKeyRow.dblclick();
  const listView = page.locator(`[data-testid="keyvalue-view"][data-path="${LIST_KEY_PATH}"]`);
  await expect(listView).toBeVisible();
  await expect(listView.locator('[data-testid="keyvalue-type"]')).toHaveText('list');
  // P49 F7/D5: rows are virtualized now — a DOM node count can no longer stand in for "the whole
  // list loaded in one page" (the viewport may render fewer nodes than LIST_LENGTH), so this reads
  // the status line's own loaded-count instead, the same number the DOM-node count used to imply.
  await expect(listView.locator('[data-testid="keyvalue-status"]')).toContainText(
    `${LIST_LENGTH} loaded`,
    { timeout: 15_000 },
  );
  await expect(listView.locator('[data-testid="keyvalue-row"]').first()).toBeVisible();
  await expect(listView.locator('[data-testid="keyvalue-prev"]')).toBeDisabled();
  await expect(listView.locator('[data-testid="keyvalue-next"]')).toBeDisabled();

  // --- open the TTL key: TTL/memory badges are populated, not the "no data" placeholders ----
  await (await findRow(page, DB0_PATH)).dblclick();
  await expect(browseView).toBeVisible();
  await browseView.locator('[data-testid="browse-crumb"]').first().click();
  await expect(browseView).toHaveAttribute('data-level', DB0_PATH);
  const sessionRow = browseView.locator(
    `[data-testid="browse-row"][data-path="${SESSION_NS_PATH}"]`,
  );
  await expect(sessionRow).toHaveAttribute('data-kind', 'namespace');
  await sessionRow.dblclick();
  await expect(browseView).toHaveAttribute('data-level', SESSION_NS_PATH);
  const ttlKeyRow = browseView.locator(`[data-testid="browse-row"][data-path="${TTL_KEY_PATH}"]`);
  await expect(ttlKeyRow).toBeVisible();
  await ttlKeyRow.dblclick();
  const ttlView = page.locator(`[data-testid="keyvalue-view"][data-path="${TTL_KEY_PATH}"]`);
  await expect(ttlView).toBeVisible();
  await expect(ttlView.locator('[data-testid="keyvalue-type"]')).toHaveText('string');
  await expect(ttlView.locator('[data-testid="keyvalue-ttl"]')).not.toContainText('no expiry');
  await expect(ttlView.locator('[data-testid="keyvalue-memory"]')).not.toContainText('unknown');

  // --- P43 F11/D15: deleting the TTL key from its own tab refreshes the Browse tab still
  // sitting on its container level (session) — no manual Refresh. browseInvalidate() updates the
  // Browse tab's own store state regardless of whether it's mounted right now (only one tab's
  // view is ever mounted at a time, §8.4), so the effect is checked by switching back to it
  // afterward and finding the row already gone, with no Refresh click in between. --------------
  await ttlView.locator('[data-testid="keyvalue-delete"]').click();
  await acceptConfirm(page);
  await expect(ttlView.locator('[data-testid="keyvalue-error"]')).toBeVisible({ timeout: 10_000 });
  await (await findRow(page, DB0_PATH)).dblclick();
  await expect(browseView).toBeVisible();
  await expect(browseView).toHaveAttribute('data-level', SESSION_NS_PATH);
  await expect(ttlKeyRow).toHaveCount(0);

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
  // 11: the original 10 (P43 iter1's TTL_KEY delete above already removed one) plus D40's own
  // BIG_HASH_KEY fixture (below), which this test's own db0 traversal never visits.
  await expect(consoleResult.locator('[data-testid="console-result-kv-row"]')).toContainText('11');

  expect(consoleErrors).toEqual([]);
});

// P41: the Browse panel's own filter and Up affordances — a separate test rather than folding
// into the scenario above, since it needs its own connection and shouldn't perturb that test's
// own path-by-path navigation.
test('redis — browse tab: filter and Up (P41)', async ({ kira, consoleErrors }) => {
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

  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-connect"]');
  await expect(
    page.locator('[data-testid="tree-row"][data-kind="connection"] .status-dot'),
  ).toHaveAttribute('data-status', 'connected', { timeout: 10_000 });
  await expandRow(page, '');

  const db0Row = await findRow(page, DB0_PATH);
  await db0Row.dblclick();
  const browseView = page.locator('[data-testid="browse-view"]');
  await expect(browseView).toBeVisible();
  await expect(browseView).toHaveAttribute('data-level', DB0_PATH);

  const userRow = browseView.locator(`[data-testid="browse-row"][data-path="${USER_NS_PATH}"]`);
  await userRow.dblclick();
  await expect(browseView).toHaveAttribute('data-level', USER_NS_PATH);
  const user1Row = browseView.locator(`[data-testid="browse-row"][data-path="${USER_1_NS_PATH}"]`);
  await user1Row.dblclick();
  await expect(browseView).toHaveAttribute('data-level', USER_1_NS_PATH);

  // --- filter: a plain substring match over the loaded level (D18) — 'user:1:name'/'user:1:email'
  // /'user:1:profile'/BIG_HASH_KEY ('user:1:bighash') are the four keys at this level; 'profile'
  // matches only the hash key. -----------------------------------------------------------------
  const totalRows = await browseView.locator('[data-testid="browse-row"]').count();
  expect(totalRows).toBe(4);
  await browseView.locator('[data-testid="browse-filter"]').fill('profile');
  await expect(browseView.locator('[data-testid="browse-row"]')).toHaveCount(1);
  await expect(browseView.locator('[data-testid="browse-count"]')).toContainText(
    `1 of ${totalRows}`,
  );
  const hashKeyRow = browseView.locator(`[data-testid="browse-row"][data-path="${HASH_KEY_PATH}"]`);
  await expect(hashKeyRow).toBeVisible();
  await hashKeyRow.dblclick();
  const view = page.locator(`[data-testid="keyvalue-view"][data-path="${HASH_KEY_PATH}"]`);
  await expect(view).toBeVisible();

  // --- Up: reactivating the tab resumes at the level it was left (user/1) — clear the filter
  // first so it doesn't hide siblings at the levels Up walks back through. ------------------------
  await db0Row.dblclick();
  await expect(browseView).toBeVisible();
  await expect(browseView).toHaveAttribute('data-level', USER_1_NS_PATH);
  await browseView.locator('[data-testid="browse-filter"]').fill('');
  await expect(browseView.locator('[data-testid="browse-row"]')).toHaveCount(totalRows);

  const upButton = browseView.locator('[data-testid="browse-up"]');
  await upButton.click();
  await expect(browseView).toHaveAttribute('data-level', USER_NS_PATH);
  await upButton.click();
  await expect(browseView).toHaveAttribute('data-level', DB0_PATH);
  await expect(upButton).toBeDisabled();

  // --- P43 iter3 D39/F35: descend into a namespace and press Up right behind it, with no wait
  // between the two — the level the breadcrumb and the row list settle on must be the level Up
  // actually asked for. This local fixture answers too fast to force the race F35 describes (a
  // slow adapter's listing landing after the user has already moved on); this is the regression
  // guard `load()`'s new `loadSeq` check exists to keep passing, not the race's reproduction. ------
  const db0RowCount = await browseView.locator('[data-testid="browse-row"]').count();
  await userRow.dblclick();
  await upButton.click();
  await expect(browseView).toHaveAttribute('data-level', DB0_PATH);
  await expect(browseView.locator('[data-testid="browse-row"]')).toHaveCount(db0RowCount);

  expect(consoleErrors).toEqual([]);
});
