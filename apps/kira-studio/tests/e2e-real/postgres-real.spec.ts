import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { installPassthrough } from './support/passthrough';
import {
  DOCKER_UNAVAILABLE_MESSAGE,
  isDockerAvailable,
  type PgFixture,
  startPostgres,
} from './support/postgres';

// E2 (P57-e2e-revisit.md §3.4/§6/§8) — the network-adapter counterpart to E1's file-based anchor.
// SQLite is a file opened in-process; Postgres exercises the parts of the chain only a network
// adapter has: credentials typed into the real dialog travelling through `internal/secrets` and
// back out through `resolve()` into a real driver, a real connection pool, a real server-version
// handshake over a real TCP connect that is not localhost-with-no-auth. As with E1, this is a
// *wiring* proof (D5) — rendering/interaction fidelity already has a verified tests/ui/ port
// against a mock built from this same seed data (tests/ui/support/postgresFixture.ts).

let pg: PgFixture | null = null;

test.beforeAll(async () => {
  if (!(await isDockerAvailable())) {
    test.skip(true, DOCKER_UNAVAILABLE_MESSAGE);
    return;
  }
  // seedBigTable:true (P58a's own addition, C1 §7 step 11) — the second test below pages
  // app.big_rows through the real keyset wire path (BuildKeysetPosition against a real 1M-row
  // table, not a canned fixture); the first test's own assertions are unaffected either way.
  pg = await startPostgres({ seedBigTable: true });
});

test.afterAll(async () => {
  await pg?.stop();
});

test('real Postgres container round-trips through the real Go bridge', async ({
  kira,
  consoleErrors,
}) => {
  if (!pg) throw new Error('postgres fixture did not start');
  const { window: page } = kira;

  // No dialogs used in this scenario, but installed for the same reason E1 installs it with an
  // empty allowlist — proves the passthrough route stays out of the way when nothing needs faking.
  await installPassthrough(page);

  await page.click('[data-testid="add-connection"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toBeVisible();
  await page.click('[data-testid="connection-kind-postgres"]');
  await page.fill('[data-testid="connection-name"]', 'Real Postgres');
  await page.fill('[data-testid="connection-host"]', pg.config.host ?? '');
  await page.fill('[data-testid="connection-port"]', String(pg.config.port));
  await page.fill('[data-testid="connection-database"]', pg.config.database ?? '');
  await page.fill('[data-testid="connection-username"]', pg.config.username ?? '');
  await page.fill('[data-testid="connection-password"]', pg.config.password ?? '');
  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);

  // §5: the same non-idempotent optimistic-update finding E1 works around — a reload re-hydrates
  // from a real ConnectionsService.List call instead of relying on the duplicated tree row the
  // independent create-event WebSocket message can otherwise produce.
  await page.reload();
  await page.waitForSelector('[data-testid="status-bar"]');

  const connRow = page
    .locator('[data-testid="tree-row"][data-kind="connection"]')
    .filter({ hasText: 'Real Postgres' });
  await expect(connRow).toBeVisible();
  await connRow.click({ button: 'right' });
  await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();
  await page.click('[data-testid="menu-item-connect"]');

  // The real adapter's own server-version handshake, not a canned one.
  const statusDot = connRow.locator('.status-dot');
  await expect(statusDot).toHaveAttribute('data-status', 'connected', { timeout: 15_000 });
  await expect(statusDot).toHaveAttribute('data-kira-tip', /^PostgreSQL \d+\./);

  await connRow.locator('.twisty').click();
  const dbRow = page.locator('[data-testid="tree-row"][data-path="database:kira_test"]');
  await expect(dbRow).toBeVisible();
  await dbRow.locator('.twisty').click();
  const schemaRow = page.locator(
    '[data-testid="tree-row"][data-path="database:kira_test/schema:app"]',
  );
  await expect(schemaRow).toBeVisible();
  await schemaRow.locator('.twisty').click();

  const orderItemsRow = page.locator(
    '[data-testid="tree-row"][data-path="database:kira_test/schema:app/table:order_items"]',
  );
  await expect(orderItemsRow).toBeVisible();
  await orderItemsRow.dblclick();

  // A real DATA_OP page over the bulk WebSocket stream, through bridge/port.ts's decodeFrame —
  // real rows from 0001_seed.sql, not a canned fixture.
  await expect(page.locator('[data-testid="data-grid"]')).toBeVisible();
  await expect(page.locator('[data-testid="grid-row"]')).toHaveCount(3, { timeout: 10_000 });
  const firstIdCell = page.locator('[data-testid="grid-cell"][data-row="0"][data-column="id"]');
  await expect(firstIdCell).toHaveText('1');

  await expect(page.locator('[data-testid="engine-status"]')).toHaveAttribute('data-status', 'ok', {
    timeout: 15_000,
  });

  expect(consoleErrors).toEqual([]);
});

async function firstGutterNumber(page: Page): Promise<string> {
  return (await page.locator('[data-testid="grid-gutter-cell"]').first().innerText()).trim();
}

// C1 §7 step 11 — keyset paging (BuildKeysetPosition) against a real 1,000,000-row table, over the
// real base64 wire path, forward then back: the pagination mode itself (not just row counts) is
// asserted, since an adapter that silently fell back to offset paging on a keyset-eligible sort
// would still show correct rows here, just not via the code path this step exists to prove.
test('real Postgres: keyset paging over app.big_rows, forward then back', async ({
  kira,
  consoleErrors,
}) => {
  if (!pg) throw new Error('postgres fixture did not start');
  const { window: page } = kira;
  await installPassthrough(page);

  await page.click('[data-testid="add-connection"]');
  await page.click('[data-testid="connection-kind-postgres"]');
  await page.fill('[data-testid="connection-name"]', 'Real Postgres Paging');
  await page.fill('[data-testid="connection-host"]', pg.config.host ?? '');
  await page.fill('[data-testid="connection-port"]', String(pg.config.port));
  await page.fill('[data-testid="connection-database"]', pg.config.database ?? '');
  await page.fill('[data-testid="connection-username"]', pg.config.username ?? '');
  await page.fill('[data-testid="connection-password"]', pg.config.password ?? '');
  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);
  await page.reload();
  await page.waitForSelector('[data-testid="status-bar"]');

  const connRow = page
    .locator('[data-testid="tree-row"][data-kind="connection"]')
    .filter({ hasText: 'Real Postgres Paging' });
  await connRow.click({ button: 'right' });
  await page.click('[data-testid="menu-item-connect"]');
  await expect(connRow.locator('.status-dot')).toHaveAttribute('data-status', 'connected', {
    timeout: 15_000,
  });

  await connRow.locator('.twisty').click();
  await page.locator('[data-testid="tree-row"][data-path="database:kira_test"] .twisty').click();
  await page
    .locator('[data-testid="tree-row"][data-path="database:kira_test/schema:app"] .twisty')
    .click();
  const bigRowsRow = page.locator(
    '[data-testid="tree-row"][data-path="database:kira_test/schema:app/table:big_rows"]',
  );
  await expect(bigRowsRow).toBeVisible();
  await bigRowsRow.dblclick();

  await expect(page.locator('[data-testid="data-grid"]')).toBeVisible();
  await expect.poll(() => firstGutterNumber(page), { timeout: 15_000 }).toBe('1');

  // A `nextToken`/`prevToken` pair, not an offset — BuildKeysetPosition against a real 1M-row
  // table with an id-PK default sort.
  await expect
    .poll(() => page.locator('[data-testid="pager"]').getAttribute('data-pagination'))
    .toBe('keyset');

  await page.click('[data-testid="pager-next"]');
  await expect.poll(() => firstGutterNumber(page), { timeout: 15_000 }).toBe('101');

  await page.click('[data-testid="pager-prev"]');
  await expect.poll(() => firstGutterNumber(page), { timeout: 15_000 }).toBe('1');

  expect(consoleErrors).toEqual([]);
});
