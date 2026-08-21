import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from 'pg';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import type { ResolvedConnectionConfig } from '../../../src/shared/engine-ops';
import { resolveDockerHost } from './docker';

// Postgres Testcontainers fixture (P1 Step 11b). One container per test process, started lazily and
// stopped in the spec's afterAll. Image postgres:17-alpine, waited on the readiness log line seen
// TWICE (the image emits it once during init and once for real — waiting on the first gives an
// ECONNREFUSED a moment later).

export interface PgFixture {
  container: StartedTestContainer;
  config: ResolvedConnectionConfig;
  uri: string;
  stop(): Promise<void>;
}

// Gated behind seedBigTable (default true) — P1 needs it only to prove the harness can build it and
// to populate reltuples for the row-estimate assertion.
const BIG_ROWS_SQL =
  'INSERT INTO app.big_rows SELECT i, md5(i::text) FROM generate_series(1, 1000000) i; ANALYZE app.big_rows;';

let memo: PgFixture | null = null;

export async function startPostgres(opts: { seedBigTable?: boolean } = {}): Promise<PgFixture> {
  if (memo) return memo;
  await resolveDockerHost();

  const container = await new GenericContainer('postgres:17-alpine')
    .withEnvironment({ POSTGRES_PASSWORD: 'kira', POSTGRES_DB: 'kira_test' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
    .withStartupTimeout(120_000)
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(5432);

  const config: ResolvedConnectionConfig = {
    id: 'test-pg',
    name: 'test-pg',
    kind: 'postgres',
    color: 'blue',
    mode: 'fields',
    readOnly: false,
    host,
    port,
    database: 'kira_test',
    username: 'postgres',
    password: 'kira',
    uri: null,
    options: {},
  };

  const client = new Client({
    host,
    port,
    database: 'kira_test',
    user: 'postgres',
    password: 'kira',
  });
  await client.connect();
  try {
    // cwd-based path so the fixture works identically under `bun test` (ESM) and Playwright (CJS).
    const seedPath = join(process.cwd(), 'tests', 'db', 'fixtures', '0001_seed.sql');
    const seedSql = await readFile(seedPath, 'utf8');
    await client.query(seedSql);
    if (opts.seedBigTable !== false) await client.query(BIG_ROWS_SQL);
  } finally {
    await client.end();
  }

  memo = {
    container,
    config,
    uri: `postgres://postgres:kira@${host}:${port}/kira_test`,
    stop: async () => {
      await container.stop();
      memo = null;
    },
  };
  return memo;
}
