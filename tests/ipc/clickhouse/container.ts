import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { splitSqlStatements } from '@shared/domain/sql-split';
import type { ResolvedConnectionConfig } from '@shared/protocol/engine-ops';
import { ClickHouseContainer, type StartedClickHouseContainer } from '@testcontainers/clickhouse';
import { resolveDockerHost } from '../../db/support/docker';

// Not `tests/db/support/clickhouse.ts`'s own `startClickHouse()` (P50 D1 forbids editing
// tests/db/, and that file's `ClickHouseContainer` construction is private to its own `start()`,
// not exposed for subclassing) — this is a deliberate, minimal duplication of its container-setup
// logic, needed for exactly one reason: `ClickHouseContainer`'s constructor hardcodes
// `.withUlimits({ nofile: { hard: 262144, soft: 262144 } })`, and this sandbox's own `ulimit -Hn`
// ceiling is fixed at 20000 and cannot be raised even as root (AGENTS.md's ClickHouse section) —
// so a container started the stock way never comes up here at all. `hostConfig` is `protected` on
// testcontainers' own `GenericContainer`, so clearing it from a subclass (never reachable through
// `ClickHouseContainer`'s public API) is the narrowest fix; everything else below is unchanged from
// support/clickhouse.ts's own `start()`.
class NoUlimitClickHouseContainer extends ClickHouseContainer {
  constructor(image: string) {
    super(image);
    this.hostConfig.Ulimits = [];
  }
}

resolveDockerHost();

const IMAGE = 'clickhouse/clickhouse-server:26.3';
const ADMIN_USER = 'kira_admin';
const ADMIN_PASSWORD = 'kira';
const DATABASE = 'kira_test';
const USERNAME = 'kira';
const PASSWORD = 'kira';
const STARTUP_TIMEOUT_MS = 120_000;
// tests/db/fixtures/ rather than a relative `__dirname` walk — once this file is esbuild-bundled
// (scripts/run-ipc-backend.sh), every module's `__dirname` collapses to the bundle's own output
// directory (capture.ts's own comment explains this), so `process.cwd()` (the runner script always
// invokes from repo root) is the reliable anchor, same as capture.ts's own fixturePathFor.
const SEED_SQL_PATH = resolve(process.cwd(), 'tests/db/fixtures/0010_clickhouse_seed.sql');

export interface ClickHouseIpcFixture {
  container: StartedClickHouseContainer;
  config: ResolvedConnectionConfig;
  uri: string;
  database: string;
  stop(): Promise<void>;
}

let memoized: Promise<ClickHouseIpcFixture> | null = null;

export function startClickHouse(): Promise<ClickHouseIpcFixture> {
  if (!memoized) memoized = start();
  return memoized;
}

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

async function start(): Promise<ClickHouseIpcFixture> {
  const container = await new NoUlimitClickHouseContainer(IMAGE)
    .withDatabase(DATABASE)
    .withUsername(ADMIN_USER)
    .withPassword(ADMIN_PASSWORD)
    .withStartupTimeout(STARTUP_TIMEOUT_MS)
    .withEnvironment({ CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1' })
    .start();

  const host = container.getHost();
  const port = container.getHttpPort();
  const baseUrl = `http://${host}:${port}`;
  const uri = `clickhouse://${USERNAME}:${PASSWORD}@${host}:${port}/${DATABASE}`;

  const seedSql = readFileSync(SEED_SQL_PATH, 'utf8');
  await runStatements(baseUrl, ADMIN_USER, ADMIN_PASSWORD, DATABASE, seedSql);

  await runStatements(
    baseUrl,
    ADMIN_USER,
    ADMIN_PASSWORD,
    DATABASE,
    `
    CREATE USER IF NOT EXISTS ${USERNAME} IDENTIFIED WITH plaintext_password BY '${PASSWORD}';
    GRANT SELECT, INSERT, ALTER DELETE ON ${DATABASE}.* TO ${USERNAME};
    GRANT SELECT ON system.* TO ${USERNAME};
    GRANT SELECT ON default.* TO ${USERNAME};
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

  return {
    container,
    config,
    uri,
    database: DATABASE,
    async stop() {
      memoized = null;
      await container.stop();
    },
  };
}
