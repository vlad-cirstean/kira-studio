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
  // seedBigTable:false — this spec never touches app.big_rows, and skipping its 1M-row insert (and
  // matching ANALYZE) is safe here in a way it wasn't for E1's SQLite fixture (§3.3/§7 item 1):
  // that ANALYZE was load-bearing because the SQLite adapter's tree-children query joins
  // sqlite_stat1 unconditionally, so a never-ANALYZE'd database 422s on the very first expand. The
  // Postgres adapter's tree-children query carries no such dependency on app.big_rows specifically.
  pg = await startPostgres({ seedBigTable: false });
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

  // A real DATA_OP page over the bulk WebSocket stream, through bridge/port.ts's reviveChunks —
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
