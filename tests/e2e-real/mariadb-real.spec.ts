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
// run before a second adapter went native: MariaDB (native as of M6.2), proven end to end against a
// real Go-native adapter in a running app, rather than only in adapterhost's own router unit tests.
// This sandbox has no real X display (P58a §13), so — as with E2 — this is tests/e2e-real/'s own
// substitute: a real -tags server Go binary, real bindings and a real MariaDB container, reached
// over http://127.0.0.1 from a headless browser tab.
//
// This file's second test used to be C1b's coexistence half: MariaDB (native) proven to survive
// killing the Node engine child while a still-Node-served kind (Kafka, moved here by P58c C14) did
// not — the only evidence in the whole of P58 that P58 D4's coexistence property held in a running
// app. Kafka went native in P58e M9.3, the last of the ten kinds to do so, and that retires the
// property it proved: after M9.3 there is no Node-served kind left to coexist with. The second test
// is now checkpoint C2's automated half instead (docs/v1/plans/P58e-kafka.md §7.3, P58e E21) — the
// all-native survival proof that replaces it, using the same two connections and the same real
// pgrep+SIGKILL vehicle.

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

// C2: every connection survives killing the Node engine child — nothing is Node-served any more
// (docs/v1/plans/P58e-kafka.md §7.3, P58e E21). P58 D4's coexistence property was proven three
// times (checkpoint C1b, checkpoint C1c, and every P58d flip's own sweep) and cannot be proven a
// fourth time, because after P58e M9.3 there is nothing left for a native kind to coexist with. What
// replaces it: kill the child entirely, and both connections — one that was native from M6.2, one
// that only became native in this same milestone — keep their status, keep serving reads, and the
// status bar's own engine indicator is the only thing that notices the child is gone.
test('C2: every connection survives killing the Node engine child — nothing is Node-served any more', async ({
  kira,
  consoleErrors,
}) => {
  // bridge/port.ts's own request() has a 30s DEFAULT_TIMEOUT_MS with no override for "ping"
  // (src/ is untouched, P58e E23) — the engine-status "down" assertion below cannot resolve faster
  // than that timeout fires, so this test needs more room than the file's other, faster ones.
  test.setTimeout(120_000);

  if (!maria) throw new Error('mariadb fixture did not start');
  if (!kafka) throw new Error('kafka fixture did not start');
  const { window: page, serverPid } = kira;
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

  // Kafka, in the same session — its own tree expands and a topic opens and renders a stream page,
  // now through the Go-native adapter's own base64-encoded StreamPage (toTypedArray's first branch)
  // rather than the Node child's index-keyed chunks: the app's first native Kafka read, and the
  // first native offsetWindow position ever to cross the wire. Kafka has no database:/schema:
  // levels at all — topics sit directly under the connection root — so there is no `kira_test`-named
  // node collision with MariaDB's own tree to sidestep.
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
  const kafkaStatusDot = kafkaRow.locator('.status-dot');
  await expect(kafkaStatusDot).toHaveAttribute('data-status', 'connected', { timeout: 15_000 });

  await kafkaRow.locator('.twisty').click();
  const ordersTopicRow = page.locator('[data-testid="tree-row"][data-path="topic:orders"]');
  await expect(ordersTopicRow).toBeVisible();
  await ordersTopicRow.dblclick();
  const streamView = page.locator('[data-testid="stream-view"][data-path="topic:orders"]');
  await expect(streamView).toBeVisible({ timeout: 10_000 });
  // The seeded orders topic's real messages, rendered through a real stream page — proof this is a
  // live read from the native Go adapter, not a canned fixture.
  await expect(streamView.locator('[data-testid="stream-row"]').first()).toBeVisible({
    timeout: 10_000,
  });

  // Both connections are up and the child is confirmed alive before it dies — a zero-traffic count
  // from a child that never started proves nothing (P58e §7.3 step 5).
  await expect(page.locator('[data-testid="engine-status"]')).toHaveAttribute('data-status', 'ok', {
    timeout: 15_000,
  });

  // The Node child is a direct child of the real server process — found the same way the plan's own
  // checklist describes (`ps --forest`-equivalent), not guessed at by name, since the vendored Node
  // runtime's own binary name is an implementation detail this test should not depend on.
  const childPidsRaw = execFileSync('pgrep', ['-P', String(serverPid)], {
    encoding: 'utf8',
  }).trim();
  const childPids = childPidsRaw.split('\n').filter(Boolean).map(Number);
  expect(childPids.length).toBeGreaterThan(0);
  for (const pid of childPids) {
    process.kill(pid, 'SIGKILL');
  }

  // Give the death-detection loop (connections.Service's own engine:down subscription,
  // MarkAllErrored's trigger) a window to have fired — it reacts to the same local process-exit
  // event the log line above proves already happened, so this is generous, not a guess at a real
  // delay — then confirm neither connection moved: MarkAllErrored still runs on every engine exit,
  // but its Node-served narrowing (P58a A15) now skips every kind, so it emits nothing.
  await page.waitForTimeout(2_000);
  await expect(mariaRow.locator('.status-dot')).toHaveAttribute('data-status', 'connected');
  await expect(kafkaStatusDot).toHaveAttribute('data-status', 'connected');

  // The status bar's engine indicator is the one thing that does notice — it pings once per
  // boot/reload with no timer of its own (P58a A17), so the reload below is what surfaces the dead
  // child. Unlike everything else in this file, this cannot resolve quickly: bridge/port.ts's
  // request() has a 30s DEFAULT_TIMEOUT_MS and "ping" gets no override, so the dead child's silent
  // non-answer only becomes "down" once that timeout fires.
  await page.reload();
  await page.waitForSelector('[data-testid="status-bar"]');
  await expect(page.locator('[data-testid="engine-status"]')).toHaveAttribute(
    'data-status',
    'down',
    {
      timeout: 35_000,
    },
  );

  // Both connections' states persist across the reload too, not just in the live session.
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

  // A read through each still-connected adapter, after the reload — proof neither ever depended on
  // the Node child that is now dead.
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

  expect(consoleErrors.filter((e) => !e.includes('WebSocket'))).toEqual([]);
});
