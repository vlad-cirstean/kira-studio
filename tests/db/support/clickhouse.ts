import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { splitSqlStatements } from '@shared/domain/sql-split';
import type { ResolvedConnectionConfig } from '@shared/protocol/engine-ops';
import { ClickHouseContainer, type StartedClickHouseContainer } from '@testcontainers/clickhouse';
import { resolveDockerHost } from './docker';

resolveDockerHost();

// P36 D34: 26.3 is the current LTS with the longest remaining support window.
const IMAGE = 'clickhouse/clickhouse-server:26.3';
// The container's own admin user (CLICKHOUSE_USER/CLICKHOUSE_PASSWORD) — the official image
// grants it full access, which is what lets it CREATE USER below. Never returned as `config`.
const ADMIN_USER = 'kira_admin';
const ADMIN_PASSWORD = 'kira';
const DATABASE = 'kira_test';
const USERNAME = 'kira';
const PASSWORD = 'kira';
export const READONLY_USERNAME = 'kira_ro';
const READONLY_PASSWORD = 'kira';
const STARTUP_TIMEOUT_MS = 120_000;
const SEED_SQL_PATH = resolve(__dirname, '../fixtures/0010_clickhouse_seed.sql');

export interface ClickHouseFixture {
  container: StartedClickHouseContainer;
  /** The unprivileged `kira` user — SELECT/INSERT/ALTER DELETE on kira_test.* (D35). */
  config: ResolvedConnectionConfig;
  /** The `kira_ro` user — SELECT only; scenario 43's server-side readonly-enforcement target. */
  readOnlyConfig: ResolvedConnectionConfig;
  uri: string;
  /** The container's own HTTP base URL — for a spec file's own side `@clickhouse/client` (system
   *  table assertions, admin-only DDL a fixed grant set can't do). */
  baseUrl: string;
  adminUsername: string;
  adminPassword: string;
  database: string;
  stop(): Promise<void>;
}

// One container per test process, same discipline as every other support/*.ts fixture (§11b).
let memoized: Promise<ClickHouseFixture> | null = null;

export function startClickHouse(): Promise<ClickHouseFixture> {
  if (!memoized) memoized = start();
  return memoized;
}

// The HTTP interface has no multi-statement exec (unlike mariadb's importFile or node-postgres's
// multi-statement query) — each statement in the seed file is sent as its own request, split the
// same quote/comment-aware way the app's own console splits a "Run all" batch.
async function runStatements(
  baseUrl: string,
  user: string,
  password: string,
  database: string,
  sql: string,
): Promise<void> {
  const clickhouseModule = await import('@clickhouse/client');
  const client = clickhouseModule.createClient({
    url: baseUrl,
    username: user,
    password,
    database,
  });
  try {
    for (const stmt of splitSqlStatements(sql)) {
      await client.command({ query: stmt.text });
    }
  } finally {
    await client.close();
  }
}

async function start(): Promise<ClickHouseFixture> {
  // F47: the preset's own Wait.forHttp('/') predicate on "Ok.\n" and its nofile ulimit bump are
  // exactly what a hand-rolled GenericContainer would get wrong here — mirrors support/mysql.ts's
  // and support/mariadb.ts's own move onto the equivalent presets.
  const container = await new ClickHouseContainer(IMAGE)
    .withDatabase(DATABASE)
    .withUsername(ADMIN_USER)
    .withPassword(ADMIN_PASSWORD)
    .withStartupTimeout(STARTUP_TIMEOUT_MS)
    .start();

  const host = container.getHost();
  const port = container.getHttpPort(); // D10/F2: the client is HTTP-only, never the 9000 native port.
  const baseUrl = `http://${host}:${port}`;
  const uri = `clickhouse://${USERNAME}:${PASSWORD}@${host}:${port}/${DATABASE}`;

  const seedSql = readFileSync(SEED_SQL_PATH, 'utf8');
  await runStatements(baseUrl, ADMIN_USER, ADMIN_PASSWORD, DATABASE, seedSql);

  // D35: two unprivileged users, created only after the seed lands — the same root-seeds/
  // app-user-connects split support/mysql.ts's own comment explains (§6e), which is what makes
  // scenario 7's cancel assertion and scenario 43's readonly assertion meaningful: neither is a
  // superuser connection.
  await runStatements(
    baseUrl,
    ADMIN_USER,
    ADMIN_PASSWORD,
    DATABASE,
    `
    CREATE USER IF NOT EXISTS ${USERNAME} IDENTIFIED WITH plaintext_password BY '${PASSWORD}';
    GRANT SELECT, INSERT, ALTER DELETE ON ${DATABASE}.* TO ${USERNAME};
    GRANT SELECT ON system.* TO ${USERNAME};
    CREATE USER IF NOT EXISTS ${READONLY_USERNAME} IDENTIFIED WITH plaintext_password BY '${READONLY_PASSWORD}';
    GRANT SELECT ON ${DATABASE}.* TO ${READONLY_USERNAME};
    GRANT SELECT ON system.* TO ${READONLY_USERNAME};
    `,
  );

  const now = new Date().toISOString();
  const config: ResolvedConnectionConfig = {
    id: 'test-clickhouse',
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    name: 'Test ClickHouse',
    kind: 'clickhouse',
    color: 'orange',
    mode: 'fields',
    readOnly: false,
    host,
    port,
    database: DATABASE,
    username: USERNAME,
    uri: null,
    options: {},
    password: PASSWORD,
  };
  const readOnlyConfig: ResolvedConnectionConfig = {
    ...config,
    id: 'test-clickhouse-ro',
    name: 'Test ClickHouse (read-only)',
    readOnly: true,
    username: READONLY_USERNAME,
    password: READONLY_PASSWORD,
  };

  return {
    container,
    config,
    readOnlyConfig,
    uri,
    baseUrl,
    adminUsername: ADMIN_USER,
    adminPassword: ADMIN_PASSWORD,
    database: DATABASE,
    async stop() {
      // Playwright's workers:1 config runs every UI spec file sequentially in the same worker
      // process, sharing this module's state (mirrors support/mysql.ts:196-201's own reset).
      memoized = null;
      await container.stop();
    },
  };
}
