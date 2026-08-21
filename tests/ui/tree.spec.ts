import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { api } from './support/api';
import { isDockerAvailable, type PgFixture, startPostgres } from './support/pg';

// Container-backed tree spec (P1 §12c). Each DB-backed spec skips with a Colima reason when the
// daemon is unreachable; the connection-CRUD spec (connections.spec.ts) never skips. The tree is
// virtualized, so node *counts* are asserted through the IPC bridge (api.treeChildren) while the
// DOM asserts only what is visible.

let pg: PgFixture | null = null;
let unavailable = false;

test.beforeAll(async () => {
  unavailable = !(await isDockerAvailable());
  if (!unavailable) pg = await startPostgres();
});

test.afterAll(async () => {
  await pg?.stop();
});

function fixture(): PgFixture {
  if (!pg) throw new Error('postgres fixture unavailable');
  return pg;
}

async function createTestConnection(window: Page): Promise<string> {
  const cfg = fixture().config;
  const created = await api.connectionsCreate(window, {
    name: 'Test PG',
    kind: 'postgres',
    color: 'teal',
    mode: 'fields',
    readOnly: false,
    host: cfg.host,
    port: cfg.port,
    database: 'kira_test',
    username: 'postgres',
    password: 'kira',
    uri: null,
    options: {},
  });
  return created.id;
}

function row(window: Page, kind: string, name: string) {
  return window.locator(`[data-testid="tree-row"][data-kind="${kind}"]`, { hasText: name });
}

async function opCount(window: Page): Promise<number> {
  return (await api.opsRecent(window, 500)).length;
}

test('connect turns the dot green, expansion is cached, refresh issues exactly one op', async ({
  kira,
  relaunch,
  consoleErrors,
}) => {
  test.skip(unavailable, 'Docker daemon unreachable — run `colima start`');

  let { window } = kira;
  const id = await createTestConnection(window);
  ({ window } = await relaunch());

  const conn = row(window, 'connection', 'Test PG');
  await expect(conn).toHaveCount(1);
  await conn.click({ button: 'right' });
  await window.click('[data-testid="menu-item-connect"]');
  await expect(conn).toHaveAttribute('data-status', 'connected', { timeout: 10_000 });

  // Expand connection → database (visible).
  await conn.dblclick();
  await expect(row(window, 'database', 'kira_test')).toHaveCount(1);
  await expect(row(window, 'database', 'postgres')).toHaveCount(1);

  // The full catalog is available through the bridge (node counts, not DOM).
  const schemas = await api.treeChildren(window, { connectionId: id, path: 'database:kira_test' });
  expect(schemas.nodes.map((n) => n.name)).toContain('app');
  expect(schemas.nodes.map((n) => n.name)).not.toContain('pg_catalog');

  const columns = await api.treeChildren(window, {
    connectionId: id,
    path: 'database:kira_test/schema:app/table:wide_table',
  });
  expect(columns.nodes).toHaveLength(60);
  expect(columns.source).toBe('server');

  await window.screenshot({ path: 'test-results/screenshots/project-tree.png' });

  // Cache: collapse + re-expand the connection issues no new op.
  const before = await opCount(window);
  await conn.dblclick();
  await conn.dblclick();
  await expect(row(window, 'database', 'kira_test')).toHaveCount(1);
  expect(await opCount(window)).toBe(before);

  // Refresh on the schema issues exactly one new children op.
  const beforeRefresh = await opCount(window);
  await row(window, 'database', 'kira_test').dblclick();
  await row(window, 'schema', 'app').click({ button: 'right' });
  await window.click('[data-testid="menu-item-refresh"]');
  await expect.poll(() => opCount(window)).toBeGreaterThan(beforeRefresh);
  expect(await opCount(window)).toBe(beforeRefresh + 1);

  expect(consoleErrors).toEqual([]);
});

test('disconnect keeps cached nodes renderable', async ({ kira, relaunch }) => {
  test.skip(unavailable, 'Docker daemon unreachable — run `colima start`');

  let { window } = kira;
  await createTestConnection(window);
  ({ window } = await relaunch());

  const conn = row(window, 'connection', 'Test PG');
  await conn.click({ button: 'right' });
  await window.click('[data-testid="menu-item-connect"]');
  await expect(conn).toHaveAttribute('data-status', 'connected', { timeout: 10_000 });

  // Cache the schema level.
  await conn.dblclick();
  await row(window, 'database', 'kira_test').dblclick();
  await expect(row(window, 'schema', 'app')).toHaveCount(1);

  await conn.click({ button: 'right' });
  await window.click('[data-testid="menu-item-disconnect"]');
  await expect(conn).toHaveAttribute('data-status', 'disconnected', { timeout: 10_000 });

  // Cached nodes still render (L1 survives disconnect).
  await expect(row(window, 'schema', 'app')).toHaveCount(1);
});

test('context menus expose the P1 item set per node kind', async ({ kira, relaunch }) => {
  test.skip(unavailable, 'Docker daemon unreachable — run `colima start`');

  let { window } = kira;
  await createTestConnection(window);
  ({ window } = await relaunch());

  const conn = row(window, 'connection', 'Test PG');

  // Disconnected → Connect, no Disconnect.
  await conn.click({ button: 'right' });
  await expect(window.locator('[data-testid="context-menu"]')).toBeVisible();
  for (const item of [
    'connect',
    'refresh',
    'edit',
    'duplicate',
    'copy-name',
    'copy-uri',
    'filters',
    'color',
    'readonly',
    'delete',
  ]) {
    await expect(window.locator(`[data-testid="menu-item-${item}"]`)).toHaveCount(1);
  }
  await expect(window.locator('[data-testid="menu-item-disconnect"]')).toHaveCount(0);
  await window.screenshot({ path: 'test-results/screenshots/context-menu-connection.png' });
  await window.keyboard.press('Escape');

  // Connect, then the menu flips to Disconnect.
  await conn.click({ button: 'right' });
  await window.click('[data-testid="menu-item-connect"]');
  await expect(conn).toHaveAttribute('data-status', 'connected', { timeout: 10_000 });
  await conn.click({ button: 'right' });
  await expect(window.locator('[data-testid="menu-item-disconnect"]')).toHaveCount(1);
  await expect(window.locator('[data-testid="menu-item-connect"]')).toHaveCount(0);
  await window.keyboard.press('Escape');

  // Column menu is minimal (copy name only).
  await conn.dblclick();
  await row(window, 'database', 'kira_test').dblclick();
  await row(window, 'schema', 'app').dblclick();
  await row(window, 'table', 'wide_table').dblclick();
  const column = window.locator('[data-testid="tree-row"][data-kind="column"]').first();
  await expect(column).toHaveCount(1);
  await column.click({ button: 'right' });
  await expect(window.locator('[data-testid="menu-item-copy-name"]')).toHaveCount(1);
  await expect(window.locator('[data-testid="menu-item-copy-qualified"]')).toHaveCount(0);
});
