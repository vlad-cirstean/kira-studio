import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { type KafkaFixture, startKafka } from './support/kafka';
import {
  isDockerAvailable as isMariadbDockerAvailable,
  DOCKER_UNAVAILABLE_MESSAGE as MARIADB_DOCKER_UNAVAILABLE_MESSAGE,
  type MariaFixture,
  startMariadb,
} from './support/mariadb';
import { installPassthrough } from './support/passthrough';

// C1b (docs/v1/plans/P58b-mysql-sqlite-clickhouse.md §7) — the half of P58a's own C1 that could not
// run before a second adapter went native: MariaDB (native as of M6.2), proven end to end against a
// real Go-native adapter in a running app, rather than only in adapterhost's own router unit tests.
// This sandbox has no real X display (P58a §13), so — as with E2 — this is tests/e2e-real/'s own
// substitute: a real -tags server Go binary, real bindings and a real MariaDB container, reached
// over http://127.0.0.1 from a headless browser tab.
//
// This file's second test used to prove a coexistence property against a Node child process: first
// a native kind surviving that child's death alongside a still-Node-served one (checkpoint C1b), then
// — once Kafka went native in P58e M9.3, the last of the ten kinds to do so — every connection
// surviving the child's own SIGKILL entirely (checkpoint C2, P58e E21). P58f's own M10 deletes that
// child (`internal/enginehost/`) outright, which retires the property: there is no child left to
// kill, and `EngineService.Status()` now just reports this process (P58f D11). What is still worth
// proving, and covered nowhere else, is that two different Go-native kinds — MariaDB and Kafka —
// coexist in one session and both keep serving real reads across a `page.reload()`.

let maria: MariaFixture | null = null;
let kafka: KafkaFixture | null = null;

test.beforeAll(async () => {
  if (!(await isMariadbDockerAvailable())) {
    test.skip(true, MARIADB_DOCKER_UNAVAILABLE_MESSAGE);
    return;
  }
  maria = await startMariadb({ seedBigTable: true });
  kafka = await startKafka();
});

test.afterAll(async () => {
  await maria?.stop();
  await kafka?.stop();
});

async function firstGutterNumber(page: Page): Promise<string> {
  return (await page.locator('[data-testid="grid-gutter-cell"]').first().innerText()).trim();
}

// Steps 5-10 of C1b's own checklist: the native half.
test('C1b: real MariaDB (native), end to end, keyset paging over big_rows', async ({
  kira,
  consoleErrors,
}) => {
  if (!maria) throw new Error('mariadb fixture did not start');
  const { window: page } = kira;
  await installPassthrough(page);

  await page.click('[data-testid="add-connection"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toBeVisible();
  await page.click('[data-testid="connection-kind-mariadb"]');
  await page.fill('[data-testid="connection-name"]', 'Real MariaDB');
  await page.fill('[data-testid="connection-host"]', maria.config.host ?? '');
  await page.fill('[data-testid="connection-port"]', String(maria.config.port));
  await page.fill('[data-testid="connection-database"]', maria.config.database ?? '');
  await page.fill('[data-testid="connection-username"]', maria.config.username ?? '');
  await page.fill('[data-testid="connection-password"]', maria.config.password ?? '');
  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);

  // §5: the same non-idempotent optimistic-update finding E1/E2 already work around.
  await page.reload();
  await page.waitForSelector('[data-testid="status-bar"]');

  const mariaRow = page
    .locator('[data-testid="tree-row"][data-kind="connection"]')
    .filter({ hasText: 'Real MariaDB' });
  await expect(mariaRow).toBeVisible();
  await mariaRow.click({ button: 'right' });
  await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();
  await page.click('[data-testid="menu-item-connect"]');

  // Step 6: the real Go-native adapter's own server-version handshake, not a canned one.
  const mariaStatusDot = mariaRow.locator('.status-dot');
  await expect(mariaStatusDot).toHaveAttribute('data-status', 'connected', { timeout: 15_000 });
  await expect(mariaStatusDot).toHaveAttribute('data-kira-tip', /^MariaDB \d+\./);

  // Step 7: tree expands straight to relations — MariaDB has no schema level, unlike Postgres's
  // database -> schema -> relation depth.
  await mariaRow.locator('.twisty').click();
  const dbRow = page.locator('[data-testid="tree-row"][data-path="database:kira_test"]');
  await expect(dbRow).toBeVisible();
  await dbRow.locator('.twisty').click();

  const orderItemsRow = page.locator(
    '[data-testid="tree-row"][data-path="database:kira_test/table:order_items"]',
  );
  await expect(orderItemsRow).toBeVisible();

  // Step 8: a real DATA_OP page over the bulk WebSocket stream, through bridge/port.ts's own
  // reviveChunks — real rows from 0002_mariadb_seed.sql, not a canned fixture. This is exactly the
  // step that caught P58a's own toTypedArray bug for Postgres.
  await orderItemsRow.dblclick();
  await expect(page.locator('[data-testid="data-grid"]')).toBeVisible();
  await expect(page.locator('[data-testid="grid-row"]')).toHaveCount(3, { timeout: 10_000 });
  const firstIdCell = page.locator('[data-testid="grid-cell"][data-row="0"][data-column="id"]');
  await expect(firstIdCell).toHaveText('1');

  // Step 9: keyset paging (BuildKeysetPosition) over a real 1,000,000-row table, forward then back
  // — the pagination mode itself is asserted, not just row counts, so a silent fall back to offset
  // paging fails this step rather than producing correct-looking rows.
  const bigRowsRow = page.locator(
    '[data-testid="tree-row"][data-path="database:kira_test/table:big_rows"]',
  );
  await expect(bigRowsRow).toBeVisible();
  await bigRowsRow.dblclick();
  await expect(page.locator('[data-testid="data-grid"]')).toBeVisible();
  await expect.poll(() => firstGutterNumber(page), { timeout: 15_000 }).toBe('1');
  await expect
    .poll(() => page.locator('[data-testid="pager"]').getAttribute('data-pagination'))
    .toBe('keyset');

  await page.click('[data-testid="pager-next"]');
  await expect.poll(() => firstGutterNumber(page), { timeout: 15_000 }).toBe('101');
  await page.click('[data-testid="pager-prev"]');
  await expect.poll(() => firstGutterNumber(page), { timeout: 15_000 }).toBe('1');

  // Step 10: the status bar's own engine indicator reads 'ok' throughout a wholly-native session
  // too — it reports this process itself now (P58f D11), not a child that no longer exists.
  await expect(page.locator('[data-testid="engine-status"]')).toHaveAttribute('data-status', 'ok', {
    timeout: 15_000,
  });

  expect(consoleErrors).toEqual([]);
});

// Two Go-native kinds, MariaDB and Kafka, live in one session, and both survive a page.reload() and
// still serve a real read afterwards (P58f D3) — the only tests/e2e-real/ coverage of a StreamPage,
// of the Kafka adapter, and of two kinds coexisting in one app at all.
test('two native kinds in one session: both survive a reload and serve a real read afterwards', async ({
  kira,
  consoleErrors,
}) => {
  if (!maria) throw new Error('mariadb fixture did not start');
  if (!kafka) throw new Error('kafka fixture did not start');
  const { window: page } = kira;
  await installPassthrough(page);

  await page.click('[data-testid="add-connection"]');
  await page.click('[data-testid="connection-kind-mariadb"]');
  await page.fill('[data-testid="connection-name"]', 'Survive MariaDB');
  await page.fill('[data-testid="connection-host"]', maria.config.host ?? '');
  await page.fill('[data-testid="connection-port"]', String(maria.config.port));
  await page.fill('[data-testid="connection-database"]', maria.config.database ?? '');
  await page.fill('[data-testid="connection-username"]', maria.config.username ?? '');
  await page.fill('[data-testid="connection-password"]', maria.config.password ?? '');
  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);
  await page.reload();
  await page.waitForSelector('[data-testid="status-bar"]');

  const mariaRow = page
    .locator('[data-testid="tree-row"][data-kind="connection"]')
    .filter({ hasText: 'Survive MariaDB' });
  await mariaRow.click({ button: 'right' });
  await page.click('[data-testid="menu-item-connect"]');
  await expect(mariaRow.locator('.status-dot')).toHaveAttribute('data-status', 'connected', {
    timeout: 15_000,
  });

  // Kafka, in the same session — Kafka has no database:/schema: levels at all, topics sit directly
  // under the connection root, so there is no `kira_test`-named node collision with MariaDB's own
  // tree to sidestep.
  await page.click('[data-testid="add-connection"]');
  await page.click('[data-testid="connection-kind-kafka"]');
  await page.fill('[data-testid="connection-name"]', 'Survive Kafka');
  await page.fill('[data-testid="connection-host"]', kafka.host);
  await page.fill('[data-testid="connection-port"]', String(kafka.port));
  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);
  await page.reload();
  await page.waitForSelector('[data-testid="status-bar"]');

  const kafkaRow = page
    .locator('[data-testid="tree-row"][data-kind="connection"]')
    .filter({ hasText: 'Survive Kafka' });
  await kafkaRow.click({ button: 'right' });
  await page.click('[data-testid="menu-item-connect"]');
  await expect(kafkaRow.locator('.status-dot')).toHaveAttribute('data-status', 'connected', {
    timeout: 15_000,
  });

  // Both connections are live in one session — the reload below is the actual point of the test:
  // both survive it and both still serve a real read afterwards.
  await page.reload();
  await page.waitForSelector('[data-testid="status-bar"]');

  const mariaRowFinal = page
    .locator('[data-testid="tree-row"][data-kind="connection"]')
    .filter({ hasText: 'Survive MariaDB' });
  await expect(mariaRowFinal.locator('.status-dot')).toHaveAttribute('data-status', 'connected', {
    timeout: 15_000,
  });
  const kafkaRowFinal = page
    .locator('[data-testid="tree-row"][data-kind="connection"]')
    .filter({ hasText: 'Survive Kafka' });
  await expect(kafkaRowFinal.locator('.status-dot')).toHaveAttribute('data-status', 'connected', {
    timeout: 15_000,
  });

  // A real read through each adapter, after the reload — MariaDB's own TabularPage over `regions`,
  // Kafka's own StreamPage over `topic:orders` (through the Go-native adapter's base64-encoded
  // chunks, toTypedArray's first branch — Kafka has no database:/schema: level, so topics sit
  // directly under the connection root).
  await mariaRowFinal.locator('.twisty').click();
  const mariaDbRow = page.locator('[data-testid="tree-row"][data-path="database:kira_test"]');
  await expect(mariaDbRow).toBeVisible({ timeout: 10_000 });
  await mariaDbRow.locator('.twisty').click();
  const regionsRow = page.locator(
    '[data-testid="tree-row"][data-path="database:kira_test/table:regions"]',
  );
  await expect(regionsRow).toBeVisible({ timeout: 10_000 });
  await regionsRow.dblclick();
  await expect(page.locator('[data-testid="data-grid"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="grid-row"]').first()).toBeVisible({ timeout: 10_000 });

  await kafkaRowFinal.locator('.twisty').click();
  const ordersTopicRowFinal = page.locator('[data-testid="tree-row"][data-path="topic:orders"]');
  await expect(ordersTopicRowFinal).toBeVisible({ timeout: 10_000 });
  await ordersTopicRowFinal.dblclick();
  const streamViewFinal = page.locator('[data-testid="stream-view"][data-path="topic:orders"]');
  await expect(streamViewFinal).toBeVisible({ timeout: 10_000 });
  await expect(streamViewFinal.locator('[data-testid="stream-row"]').first()).toBeVisible({
    timeout: 10_000,
  });

  expect(consoleErrors).toEqual([]);
});
