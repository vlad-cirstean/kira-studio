import { expect, test } from './fixtures';
import { installPassthrough } from './support/passthrough';
import {
  SQLITE_UNAVAILABLE_MESSAGE,
  type SqliteFixture,
  sqliteAvailable,
  startSqlite,
} from './support/sqlite';

// E1 (P57-e2e-revisit.md §6/§8) — the Docker-free anchor for the real-backend tier: a real SQLite
// connection through the real dialog, through the real Go bridge, through the real vendored Node
// engine, to a real file seeded from tests/db/fixtures/0009_sqlite_seed.sql, and back. This is a
// *wiring* proof, not a UI-fidelity one (D5) — everything about rendering/interaction (selection
// edges, keyboard nav, the cell editor, sticky bands, virtualisation, word wrap) already has a
// verified tests/ui/ port against a mock; this spec exists to prove the real bytes travel the
// whole way, which no mocked tier can.

let sqlite: SqliteFixture | null = null;

test.beforeAll(async () => {
  if (!(await sqliteAvailable())) {
    test.skip(true, SQLITE_UNAVAILABLE_MESSAGE);
    return;
  }
  // Default options, deliberately — `ANALYZE big_rows` is what gives the database a
  // `sqlite_stat1` table at all (§3.3/§7 item 1: the SQLite adapter's tree-children query joins
  // it unconditionally, and a database that has never been ANALYZE'd at all — not just missing an
  // estimate for one table — surfaces a real `E_QUERY` on the very first tree expansion). Skipping
  // the big_rows seed here would trade this spec's own real backend for a real error it isn't
  // trying to assert.
  sqlite = await startSqlite();
});

test.afterAll(async () => {
  await sqlite?.stop();
});

test('real backend through a plain browser tab: connect, tree, rows', async ({
  kira,
  consoleErrors,
}) => {
  if (!sqlite) throw new Error('sqlite fixture did not start');
  const { window: page } = kira;

  // SQLite needs no dialog and no network credentials — an empty allowlist still exercises the
  // passthrough route for real, proving it stays out of the way when a spec has nothing to fake.
  await installPassthrough(page);

  await page.click('[data-testid="add-connection"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toBeVisible();
  await page.click('[data-testid="connection-kind-sqlite"]');
  await page.fill('[data-testid="connection-name"]', 'Real SQLite');
  await page.fill('[data-testid="connection-database"]', sqlite.path);
  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);

  // §5: server mode delivers the create-connection event on an independent WebSocket, which can
  // (and here does) land before the create call's own HTTP response resolves — the renderer's
  // optimistic append then duplicates the just-replaced record in the tree, and every downstream
  // row (database, table, …) duplicates right along with it, since both copies share the same
  // expanded-path state. That's a real, separately-tracked app finding (P57-e2e-revisit.md §5/D6),
  // not this spec's to fix. A reload re-hydrates from a plain `ConnectionsService.List` call —
  // real backend state, not a UI row count the harness itself can make non-deterministic — which
  // the doc's own §5 confirms shows exactly one row.
  await page.reload();
  await page.waitForSelector('[data-testid="status-bar"]');

  const connRow = page
    .locator('[data-testid="tree-row"][data-kind="connection"]')
    .filter({ hasText: 'Real SQLite' });
  await expect(connRow).toBeVisible();
  await connRow.click({ button: 'right' });
  await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();
  await page.click('[data-testid="menu-item-connect"]');

  // The real adapter's own version string, not a canned one — assert().toStartWith would be
  // nicer, but toHaveAttribute's regex form does the same job.
  const statusDot = connRow.locator('.status-dot');
  await expect(statusDot).toHaveAttribute('data-status', 'connected', { timeout: 15_000 });
  await expect(statusDot).toHaveAttribute('data-kira-tip', /^SQLite 3\./);

  await connRow.locator('.twisty').click();
  const dbRow = page.locator('[data-testid="tree-row"][data-path="database:main"]');
  await expect(dbRow).toBeVisible();
  await dbRow.locator('.twisty').click();

  const orderItemsRow = page.locator(
    '[data-testid="tree-row"][data-path="database:main/table:order_items"]',
  );
  await expect(orderItemsRow).toBeVisible();
  await orderItemsRow.dblclick();

  // A real DATA_OP page over the bulk WebSocket stream, through bridge/port.ts's reviveChunks.
  await expect(page.locator('[data-testid="data-grid"]')).toBeVisible();
  await expect(page.locator('[data-testid="grid-row"]')).toHaveCount(3, { timeout: 10_000 });
  const firstIdCell = page.locator('[data-testid="grid-cell"][data-row="0"][data-column="id"]');
  await expect(firstIdCell).toHaveText('1');

  // P56's own named symptom ("engine connecting" forever) turning `ok` is the single clearest
  // signal the whole stack — bridge/port.ts's JSONStream, the Go stream, the vendored Node
  // engine — is really wired, not stubbed (P57-e2e-revisit.md §3.3).
  await expect(page.locator('[data-testid="engine-status"]')).toHaveAttribute('data-status', 'ok', {
    timeout: 15_000,
  });

  // A handled bound-call error is a real HTTP 422 under Wails (AGENTS.md P57 finding) — nothing in
  // this scenario should trigger one, so the console should carry nothing at all, not even that.
  expect(consoleErrors).toEqual([]);
});
