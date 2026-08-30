import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ResolvedConnectionConfig } from '@shared/protocol/engine-ops';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolveDockerHost } from './docker';

resolveDockerHost();

const IMAGE = 'postgres:17-alpine';
const PASSWORD = 'kira';
const DATABASE = 'kira_test';
const STARTUP_TIMEOUT_MS = 120_000;
const BIG_ROWS = 1_000_000;
const SEED_SQL_PATH = resolve(__dirname, '../fixtures/0001_seed.sql');

export interface PgFixture {
  container: StartedPostgreSqlContainer;
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
  // @testcontainers/postgresql's own wait strategy (Wait.forAll([forHealthCheck(),
  // forListeningPorts()]), with a pg_isready-based healthcheck it installs automatically) solves
  // the classic Postgres double-boot-during-init flake by polling the real server rather than
  // matching a log line twice — no manual Wait.forLogMessage(..., 2) needed here anymore.
  const container = await new PostgreSqlContainer(IMAGE)
    .withDatabase(DATABASE)
    .withUsername('postgres')
    .withPassword(PASSWORD)
    .withStartupTimeout(STARTUP_TIMEOUT_MS)
    .start();

  const host = container.getHost();
  const port = container.getPort();
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

const SCROLL_GRID_COLUMNS = 60;
const SCROLL_GRID_ROWS = 5_000;

// P29 D14: neither the standard seed's `big_rows` (many rows, few columns) nor `wide_table` (few
// rows, many columns) can show the scroll-render gap — this creates the wide-AND-tall shape P29's
// own F5/F8 need, against whichever container `startPostgres()` handed back (never
// `tests/db/fixtures/0001_seed.sql`, which every other suite's row counts/ordering already depend
// on staying unchanged). Moved here from `tests/e2e/support/pg.ts` (P57 M5: `tests/e2e/` retired)
// — `scripts/capture-postgres-tree.ts`'s own `seedScrollGrid` step kind still needs it to
// reproduce `tests/ui/budgets.spec.ts`/`perf.spec.ts`'s real `app.scroll_grid` captures.
/** `app.scroll_grid`: 60 text columns x 5 000 rows, one integer primary key, no foreign keys. */
export async function seedScrollFixture(uri: string): Promise<void> {
  const client = new Client({ connectionString: uri });
  await client.connect();
  try {
    const columns = Array.from({ length: SCROLL_GRID_COLUMNS }, (_, i) => `col${i + 1}`);
    const createCols = columns.map((c) => `${c} text NOT NULL`).join(',\n        ');
    await client.query(`
      CREATE TABLE app.scroll_grid (
        id integer PRIMARY KEY,
        ${createCols}
      );
    `);
    const selectCols = columns
      .map((c, i) => `'row ' || i || ' col ${i + 1}' AS ${c}`)
      .join(',\n        ');
    await client.query(`
      INSERT INTO app.scroll_grid
      SELECT i AS id, ${selectCols}
      FROM generate_series(1, ${SCROLL_GRID_ROWS}) i;
    `);
    await client.query('ANALYZE app.scroll_grid');
  } finally {
    await client.end();
  }
}
