import type { Page } from '@playwright/test';
import { expect } from '../fixtures';
import { APP_PATH, DB_PATH } from './postgresFixture';
import { connectionRow, expandRow, openRowMenu } from './tree';

// P107 I2-25: connectionCreateArgs/connectAndExpand/connectRedis/connectMongo/openConsoleFromMenu
// were copied, byte-identically or nearly so, across 8/5/2/2/6 spec files (a genuinely divergent
// connectAndExpand stays local to cell-editor.spec.ts and leaks.spec.ts — see their own doc
// comments). One copy here, imported everywhere.

export interface ConnectionCreateArgsOptions {
  readonly readOnly?: boolean;
  readonly autoExplain?: boolean;
  /** Adds the six `mcp*` fields (`mcpEnabled`/`mcpDescription`/`mcpReadMode`/`mcpWriteMode`/
   *  `mcpDdlMode`/`mcpAutoExplain`), all at their own off/default value. */
  readonly mcp?: boolean;
}

/** A `connections.create` args fixture for a Postgres connection — `name`/`color` are always the
 *  caller's own, every other field a fixed default unless `options` overrides it. */
export function connectionCreateArgs(
  name: string,
  color: string,
  options: ConnectionCreateArgsOptions = {},
): Record<string, unknown> {
  const { readOnly = false, autoExplain = false, mcp = false } = options;
  return {
    name,
    kind: 'postgres',
    color,
    mode: 'fields',
    readOnly,
    host: '127.0.0.1',
    port: 5432,
    database: 'kira_test',
    username: 'postgres',
    password: null,
    uri: null,
    options: {},
    preconnect: null,
    preconnectSidecar: false,
    autoExplain,
    throttlePerSec: 0,
    ...(mcp
      ? {
          mcpEnabled: false,
          mcpDescription: '',
          mcpReadMode: 'allow',
          mcpWriteMode: 'prompt',
          mcpDdlMode: 'deny',
          mcpAutoExplain: true,
        }
      : {}),
  };
}

export interface ConnectAndExpandOptions {
  readonly autoExplain?: boolean;
}

/** Fills the "add connection" dialog for a Postgres connection through the UI, connects it, and
 *  expands the root row plus `DB_PATH`/`APP_PATH` — the shape `console.spec.ts`, `console-
 *  explain.spec.ts`, `interaction.spec.ts`, `data-view.spec.ts` and `definition.spec.ts` all
 *  shared already. */
export async function connectAndExpand(
  page: Page,
  name: string,
  color: string,
  options: ConnectAndExpandOptions = {},
): Promise<void> {
  await page.click('[data-testid="add-connection"]');
  await page.click('[data-testid="connection-kind-postgres"]');
  await page.fill('[data-testid="connection-name"]', name);
  await page.fill('[data-testid="connection-host"]', '127.0.0.1');
  await page.fill('[data-testid="connection-port"]', '5432');
  await page.fill('[data-testid="connection-database"]', 'kira_test');
  await page.fill('[data-testid="connection-username"]', 'postgres');
  await page.click(`[data-testid="color-${color}"]`);
  if (options.autoExplain) {
    await page.click('[data-testid="connection-tab-advanced"]');
    await page.click('[data-testid="connection-auto-explain"]');
  }
  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);

  const connRow = connectionRow(page);
  await expect(connRow).toBeVisible();
  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-connect"]');
  await expect(connRow.locator('.status-dot')).toHaveAttribute('data-status', 'connected', {
    timeout: 10_000,
  });
  await expandRow(page, '');
  await expandRow(page, DB_PATH);
  await expandRow(page, APP_PATH);
}

/** Fills the "add connection" dialog for a Redis connection and connects it — no tree expand (no
 *  schema/database hierarchy to descend into). */
export async function connectRedis(page: Page, name: string, color: string): Promise<void> {
  await page.click('[data-testid="add-connection"]');
  await page.click('[data-testid="connection-kind-redis"]');
  await page.fill('[data-testid="connection-name"]', name);
  await page.fill('[data-testid="connection-host"]', '127.0.0.1');
  await page.fill('[data-testid="connection-port"]', '6379');
  await page.fill('[data-testid="connection-database"]', '0');
  await page.click(`[data-testid="color-${color}"]`);
  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);

  const connRow = connectionRow(page);
  await expect(connRow).toBeVisible();
  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-connect"]');
  await expect(connRow.locator('.status-dot')).toHaveAttribute('data-status', 'connected', {
    timeout: 10_000,
  });
}

export interface ConnectMongoOptions {
  /** Expands the root row plus `dbPath` after connecting — off by default (console-format.spec.ts's
   *  own shape never expands); pass `dbPath` whenever `expand` is true. */
  readonly expand?: boolean;
  readonly dbPath?: string;
}

/** Fills the "add connection" dialog for a MongoDB connection and connects it. */
export async function connectMongo(
  page: Page,
  name: string,
  color: string,
  options: ConnectMongoOptions = {},
): Promise<void> {
  await page.click('[data-testid="add-connection"]');
  await page.click('[data-testid="connection-kind-mongodb"]');
  await page.fill('[data-testid="connection-name"]', name);
  await page.fill('[data-testid="connection-host"]', '127.0.0.1');
  await page.fill('[data-testid="connection-port"]', '27017');
  await page.fill('[data-testid="connection-database"]', 'kira_test');
  await page.fill('[data-testid="connection-username"]', 'kira');
  await page.click(`[data-testid="color-${color}"]`);
  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);

  const connRow = connectionRow(page);
  await expect(connRow).toBeVisible();
  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-connect"]');
  await expect(connRow.locator('.status-dot')).toHaveAttribute('data-status', 'connected', {
    timeout: 10_000,
  });
  if (options.expand) {
    if (!options.dbPath) throw new Error('connectMongo: dbPath is required when expand is true');
    await expandRow(page, '');
    await expandRow(page, options.dbPath);
  }
}

export async function openConsoleFromMenu(page: Page, path: string): Promise<void> {
  await openRowMenu(page, path);
  await page.click('[data-testid="menu-item-open-console"]');
}
