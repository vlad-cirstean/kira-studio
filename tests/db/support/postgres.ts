import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ResolvedConnectionConfig } from '@shared/protocol/engine-ops';
import { Client } from 'pg';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { resolveDockerHost } from './docker';

resolveDockerHost();

const IMAGE = 'postgres:17-alpine';
const PASSWORD = 'kira';
const DATABASE = 'kira_test';
const PG_PORT = 5432;
const STARTUP_TIMEOUT_MS = 120_000;
const BIG_ROWS = 1_000_000;
const SEED_SQL_PATH = resolve(__dirname, '../fixtures/0001_seed.sql');

export interface PgFixture {
  container: StartedTestContainer;
  config: ResolvedConnectionConfig; // ready to hand to the adapter
  uri: string;
  stop(): Promise<void>;
}

// One container per test process, started lazily on first call and reused by every later call —
// starting a fresh container per test would make the suite unusable (§11b).
let memoized: Promise<PgFixture> | null = null;

export function startPostgres(opts?: { seedBigTable?: boolean }): Promise<PgFixture> {
  if (!memoized) memoized = start(opts);
  return memoized;
}

async function start(opts?: { seedBigTable?: boolean }): Promise<PgFixture> {
  const container = await new GenericContainer(IMAGE)
    .withEnvironment({ POSTGRES_PASSWORD: PASSWORD, POSTGRES_DB: DATABASE })
    .withExposedPorts(PG_PORT)
    // The image emits this log line once during its own init phase and once for real — waiting
    // for only the first occurrence gets you a "connection refused" a moment later. This is the
    // classic Postgres/Testcontainers flake; waiting for it twice is the fix.
    .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
    .withStartupTimeout(STARTUP_TIMEOUT_MS)
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(PG_PORT);
  const uri = `postgres://postgres:${PASSWORD}@${host}:${port}/${DATABASE}`;

  const seedClient = new Client({ connectionString: uri });
  await seedClient.connect();
  try {
    await seedClient.query(readFileSync(SEED_SQL_PATH, 'utf8'));
    // Gated: P1 only needs to prove the harness can build the table, P2's paging is what
    // actually consumes 1M rows. Default true so the harness is exercised end to end unless a
    // caller opts out for a faster run.
    if (opts?.seedBigTable ?? true) {
      await seedClient.query(
        'INSERT INTO app.big_rows SELECT i, md5(i::text) FROM generate_series(1, $1) i',
        [BIG_ROWS],
      );
      await seedClient.query('ANALYZE app.big_rows');
    }
  } finally {
    await seedClient.end();
  }

  const now = new Date().toISOString();
  const config: ResolvedConnectionConfig = {
    id: 'test-postgres',
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    name: 'Test Postgres',
    kind: 'postgres',
    color: 'blue',
    mode: 'fields',
    readOnly: false,
    host,
    port,
    database: DATABASE,
    username: 'postgres',
    uri: null,
    options: {},
    password: PASSWORD,
  };

  return {
    container,
    config,
    uri,
    async stop() {
      // Playwright's workers:1 config runs every UI spec file sequentially in the same worker
      // process, sharing this module's state — without resetting `memoized`, a later spec file's
      // startPostgres() would return this now-dead container instead of starting a fresh one.
      memoized = null;
      await container.stop();
    },
  };
}
