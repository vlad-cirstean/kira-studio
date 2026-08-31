import { execFileSync } from 'node:child_process';
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
// run before a second adapter went native: MariaDB (native as of M6.2) and a still-Node-served kind
// coexisting in one running app, proving P58 D4's coexistence property for real rather than only in
// adapterhost's own router unit tests. This sandbox has no real X display (P58a §13), so — as with
// E2 — this is tests/e2e-real/'s own substitute: a real -tags server Go binary, real bindings, a
// real MariaDB container and a real second container, reached over http://127.0.0.1 from a headless
// browser tab.
//
// The Node-served half is Kafka, not MongoDB (P58c C15) — MongoDB went native in this same
// sub-phase (M7.3), which would otherwise have made this test's own coexistence assertion pass for
// the wrong reason (both connections native, both surviving the kill, proving nothing). Kafka is
// the last of the ten kinds to go native (P58e), so this is the last re-pointing this vehicle needs
// before P58f retires the whole coexistence concept — see AGENTS.md's P58a/P58b/P58c findings for
// why "the kind that goes native last" is the rule, not "whichever kind is convenient today".

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

  // Step 10: the Node child is still alive and still answering ping — the coexistence property's
  // other half is proven by the second test below, but this confirms the child is up throughout a
  // wholly-native session too (P58a A17).
  await expect(page.locator('[data-testid="engine-status"]')).toHaveAttribute('data-status', 'ok', {
    timeout: 15_000,
  });

  expect(consoleErrors).toEqual([]);
});

// Steps 11-12 of C1b's own checklist: the coexistence half. This is the load-bearing test in this
// file — the only evidence in the entire P58 phase that the coexistence property (P58 D4) holds in
// a running app, not only in adapterhost's own router unit tests.
test('C1b: MariaDB (native) survives killing the Node engine child; Kafka (Node-served) does not', async ({
  kira,
  consoleErrors,
}) => {
  if (!maria) throw new Error('mariadb fixture did not start');
  if (!kafka) throw new Error('kafka fixture did not start');
  const { window: page, serverPid } = kira;
  await installPassthrough(page);

  // The native half, connected first.
  await page.click('[data-testid="add-connection"]');
  await page.click('[data-testid="connection-kind-mariadb"]');
  await page.fill('[data-testid="connection-name"]', 'Coexist MariaDB');
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
    .filter({ hasText: 'Coexist MariaDB' });
  await mariaRow.click({ button: 'right' });
  await page.click('[data-testid="menu-item-connect"]');
  await expect(mariaRow.locator('.status-dot')).toHaveAttribute('data-status', 'connected', {
    timeout: 15_000,
  });

  // Step 11: the Node-served half, in the same session — its own tree expands and a topic opens
  // and renders a stream page, all via the Node child's own index-keyed chunk encoding (still the
  // proof toTypedArray's second branch is needed and still works, P58a A10). Kafka has no
  // database:/schema: levels at all — topics sit directly under the connection root — so unlike
  // MongoDB there is no `kira_test`-named-database collision with MariaDB's own tree to sidestep.
  await page.click('[data-testid="add-connection"]');
  await page.click('[data-testid="connection-kind-kafka"]');
  await page.fill('[data-testid="connection-name"]', 'Coexist Kafka');
  await page.fill('[data-testid="connection-host"]', kafka.host);
  await page.fill('[data-testid="connection-port"]', String(kafka.port));
  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);
  await page.reload();
  await page.waitForSelector('[data-testid="status-bar"]');

  const kafkaRow = page
    .locator('[data-testid="tree-row"][data-kind="connection"]')
    .filter({ hasText: 'Coexist Kafka' });
  await kafkaRow.click({ button: 'right' });
  await page.click('[data-testid="menu-item-connect"]');
  const kafkaStatusDot = kafkaRow.locator('.status-dot');
  await expect(kafkaStatusDot).toHaveAttribute('data-status', 'connected', { timeout: 15_000 });

  await kafkaRow.locator('.twisty').click();
  const ordersTopicRow = page.locator('[data-testid="tree-row"][data-path="topic:orders"]');
  await expect(ordersTopicRow).toBeVisible();
  await ordersTopicRow.dblclick();
  const streamView = page.locator('[data-testid="stream-view"][data-path="topic:orders"]');
  await expect(streamView).toBeVisible({ timeout: 10_000 });
  // The seeded orders topic's real messages, rendered through a real stream page — proof this
  // is a live read from the Node-served adapter, not a canned fixture.
  await expect(streamView.locator('[data-testid="stream-row"]').first()).toBeVisible({
    timeout: 10_000,
  });

  // After reload, the MariaDB row above is stale — re-locate both by their now-restored state.
  const mariaRowAfterReload = page
    .locator('[data-testid="tree-row"][data-kind="connection"]')
    .filter({ hasText: 'Coexist MariaDB' });
  await expect(mariaRowAfterReload.locator('.status-dot')).toHaveAttribute(
    'data-status',
    'connected',
    {
      timeout: 15_000,
    },
  );

  // Step 12: the Node child is a direct child of the real server process — found the same way the
  // plan's own checklist describes (`ps --forest`-equivalent), not guessed at by name, since the
  // vendored Node runtime's own binary name is an implementation detail this test should not
  // depend on.
  const childPidsRaw = execFileSync('pgrep', ['-P', String(serverPid)], {
    encoding: 'utf8',
  }).trim();
  const childPids = childPidsRaw.split('\n').filter(Boolean).map(Number);
  expect(childPids.length).toBeGreaterThan(0);
  for (const pid of childPids) {
    process.kill(pid, 'SIGKILL');
  }

  // The Kafka connection (Node-served) flips to error; the MariaDB connection (native) stays
  // connected and still serves a read. If MariaDB also flips, MarkAllErrored was not narrowed to
  // Node-served kinds (P58a A15) — or was narrowed against a stale nativeKinds snapshot.
  await expect(kafkaStatusDot).toHaveAttribute('data-status', 'error', { timeout: 15_000 });
  await expect(mariaRowAfterReload.locator('.status-dot')).toHaveAttribute(
    'data-status',
    'connected',
  );

  // Both connections' states persist across a reload too, not just in the live session — unlike
  // the MongoDB pairing this test used before P58c (P58c C15), Kafka's tree has no `database:`
  // segment at all, so there is no `kira_test`-named-node collision with MariaDB's own tree left
  // to sidestep here.
  await page.reload();
  await page.waitForSelector('[data-testid="status-bar"]');
  const mariaRowFinal = page
    .locator('[data-testid="tree-row"][data-kind="connection"]')
    .filter({ hasText: 'Coexist MariaDB' });
  await expect(mariaRowFinal.locator('.status-dot')).toHaveAttribute('data-status', 'connected', {
    timeout: 15_000,
  });
  const kafkaRowFinal = page
    .locator('[data-testid="tree-row"][data-kind="connection"]')
    .filter({ hasText: 'Coexist Kafka' });
  await expect(kafkaRowFinal.locator('.status-dot')).toHaveAttribute('data-status', 'error', {
    timeout: 15_000,
  });

  await mariaRowFinal.locator('.twisty').click();
  const mariaDbRow = page.locator('[data-testid="tree-row"][data-path="database:kira_test"]');
  await expect(mariaDbRow).toBeVisible({ timeout: 10_000 });
  await mariaDbRow.locator('.twisty').click();

  // A read through the still-native, still-connected MariaDB adapter — proof it never depended on
  // the Node child that just died.
  const regionsRow = page.locator(
    '[data-testid="tree-row"][data-path="database:kira_test/table:regions"]',
  );
  await expect(regionsRow).toBeVisible({ timeout: 10_000 });
  await regionsRow.dblclick();
  await expect(page.locator('[data-testid="data-grid"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="grid-row"]').first()).toBeVisible({ timeout: 10_000 });

  expect(consoleErrors.filter((e) => !e.includes('WebSocket'))).toEqual([]);
});
