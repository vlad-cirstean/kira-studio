import { resolve } from 'node:path';
import type { ResolvedConnectionConfig } from '@shared/protocol/engine-ops';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import { createConnection, importFile } from 'mariadb';
import { Wait } from 'testcontainers';
import { resolveDockerHost } from './docker';

resolveDockerHost();

// P34 D24: MySQL's current LTS — defaults to caching_sha2_password, has dropped
// --default-authentication-plugin in favour of authentication_policy, and ships
// mysql_native_password present-but-disabled. This is the version D3/D4's auth handling exists for.
const IMAGE = 'mysql:8.4';
const ROOT_PASSWORD = 'kira';
const DATABASE = 'kira_test';
const ANALYTICS_DATABASE = 'kira_analytics';
const USERNAME = 'kira';
const PASSWORD = 'kira';
const STARTUP_TIMEOUT_MS = 120_000;
const SEED_SQL_PATH = resolve(__dirname, '../fixtures/0008_mysql_seed.sql');

// P34 D29/F4: never-authenticated users, created once by the fixture solely for the
// plaintext-caching_sha2_password scenario. After any successful authentication, MySQL's SHA2
// cache serves the fast path and a plaintext connection for that user *succeeds* — so the scenario
// needs a user whose first-ever authentication is the one under test. Two, not one: scenario 2b's
// (a)+(b) subparts reuse NOCACHE_USER (the (a) attempt fails closed, so it never warms the cache;
// the (b) attempt succeeds over TLS and does warm it, but nothing plaintext against this user runs
// after that), and (c) needs its own still-cold user, PUBKEY_USER.
export const NOCACHE_USER = 'kira_nocache';
export const PUBKEY_USER = 'kira_pubkey';
const NOCACHE_PASSWORD = 'kira';

export interface MysqlFixture {
  container: StartedMySqlContainer;
  config: ResolvedConnectionConfig; // ready to hand to the adapter
  uri: string;
  stop(): Promise<void>;
}

/** A connection config for one of the never-authenticated users above, options merged onto the
 *  fixture's own host/port/database — never the fixture's own `config` (that carries `sslmode:
 *  'require'` and the main `kira` user, D26). */
export function nocacheConfig(
  fixture: MysqlFixture,
  username: string,
  options: Record<string, string>,
): ResolvedConnectionConfig {
  return { ...fixture.config, username, password: NOCACHE_PASSWORD, options };
}

// One container per test process, same discipline as support/mariadb.ts (§11b).
let memoized: Promise<MysqlFixture> | null = null;

export function startMysql(opts?: { seedBigTable?: boolean }): Promise<MysqlFixture> {
  if (!memoized) memoized = start(opts);
  return memoized;
}

async function start(opts?: { seedBigTable?: boolean }): Promise<MysqlFixture> {
  // P34 D25/F25: @testcontainers/mysql sets no wait strategy or healthcheck of its own (as of
  // 12.1.0, same gap support/mariadb.ts:36-38 documents for @testcontainers/mariadb) — and the
  // official MySQL entrypoint boots the server twice during initialisation, the first boot on a
  // socket only, so a TCP-reaching healthcheck is what actually distinguishes "initialising" from
  // "ready" (the same double-boot hazard the MariaDB fixture's own comment names).
  const container = await new MySqlContainer(IMAGE)
    .withDatabase(DATABASE)
    .withUsername(USERNAME)
    .withUserPassword(PASSWORD)
    .withRootPassword(ROOT_PASSWORD)
    .withHealthCheck({
      test: [
        'CMD',
        'mysqladmin',
        'ping',
        '-h',
        '127.0.0.1',
        '-u',
        'root',
        `-p${ROOT_PASSWORD}`,
        '--silent',
      ],
      interval: 2000,
      timeout: 5000,
      retries: 60,
    })
    .withWaitStrategy(Wait.forHealthCheck())
    .withStartupTimeout(STARTUP_TIMEOUT_MS)
    .start();

  const host = container.getHost();
  const port = container.getPort();
  const uri = `mysql://${USERNAME}:${PASSWORD}@${host}:${port}/${DATABASE}`;

  // Seeded as root (CREATE/GRANT need it); the returned config connects as the unprivileged
  // `kira` user — the entrypoint already grants it full rights on kira_test, so the read path
  // proves KILL QUERY on your own query needs no PROCESS privilege (§6e), same as MariaDB's.
  await importFile({
    host,
    port,
    user: 'root',
    password: ROOT_PASSWORD,
    database: DATABASE,
    multipleStatements: true,
    ssl: false,
    file: SEED_SQL_PATH,
  });

  const rootConn = await createConnection({
    host,
    port,
    user: 'root',
    password: ROOT_PASSWORD,
    database: DATABASE,
    ssl: false,
  });
  try {
    // A second database, mirroring the MariaDB fixture's kira_analytics (support/mariadb.ts:91-93)
    // — MySQL has no schema level either, so a second *database* is the equivalent (§6d).
    await rootConn.query(`CREATE DATABASE IF NOT EXISTS \`${ANALYTICS_DATABASE}\``);
    await rootConn.query(
      `CREATE TABLE IF NOT EXISTS \`${ANALYTICS_DATABASE}\`.events (
         id INT AUTO_INCREMENT PRIMARY KEY,
         event_name VARCHAR(255) NOT NULL,
         occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
       )`,
    );
    await rootConn.query(
      `INSERT INTO \`${ANALYTICS_DATABASE}\`.events (event_name) VALUES ('signup'), ('login')`,
    );
    await rootConn.query(`GRANT SELECT ON \`${ANALYTICS_DATABASE}\`.* TO '${USERNAME}'@'%'`);

    // P34 D29: created here, as a plain CREATE USER over the root connection — that authenticates
    // *root*, never these two users themselves, so their own SHA2 cache stays cold until a
    // scenario deliberately authenticates as one of them.
    await rootConn.query(
      `CREATE USER IF NOT EXISTS '${NOCACHE_USER}'@'%' IDENTIFIED BY '${NOCACHE_PASSWORD}'`,
    );
    await rootConn.query(`GRANT SELECT ON \`${DATABASE}\`.* TO '${NOCACHE_USER}'@'%'`);
    await rootConn.query(
      `CREATE USER IF NOT EXISTS '${PUBKEY_USER}'@'%' IDENTIFIED BY '${NOCACHE_PASSWORD}'`,
    );
    await rootConn.query(`GRANT SELECT ON \`${DATABASE}\`.* TO '${PUBKEY_USER}'@'%'`);
    await rootConn.query('FLUSH PRIVILEGES');

    // P34 D28: MySQL has no SEQUENCE storage engine (F13), so the 1,000,000-row bulk insert uses
    // the conventional numbers-table idiom instead — a six-way cross join over a 10-row digits
    // table, chunked into ten 100,000-row statements (one per outer-digit value) so any single
    // InnoDB transaction stays bounded. Materialisation-free, unlike a 1,000,000-deep recursive
    // CTE, which would need cte_max_recursion_depth raised past its 1,000 default.
    if (opts?.seedBigTable ?? true) {
      await rootConn.query('CREATE TEMPORARY TABLE digits (d INT PRIMARY KEY)');
      await rootConn.query('INSERT INTO digits (d) VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)');
      for (let outer = 0; outer < 10; outer++) {
        await rootConn.query(
          `INSERT INTO \`${DATABASE}\`.big_rows (id, payload)
           SELECT d1.d*100000 + d2.d*10000 + d3.d*1000 + d4.d*100 + d5.d*10 + d6.d + 1 AS id,
                  MD5(d1.d*100000 + d2.d*10000 + d3.d*1000 + d4.d*100 + d5.d*10 + d6.d + 1) AS payload
           FROM digits d1, digits d2, digits d3, digits d4, digits d5, digits d6
           WHERE d1.d = ?`,
          [outer],
        );
      }
      await rootConn.query(`ANALYZE TABLE \`${DATABASE}\`.big_rows`);
    }
  } finally {
    await rootConn.end();
  }

  const now = new Date().toISOString();
  const config: ResolvedConnectionConfig = {
    id: 'test-mysql',
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    name: 'Test MySQL',
    kind: 'mysql',
    color: 'teal',
    mode: 'fields',
    readOnly: false,
    host,
    port,
    database: DATABASE,
    username: USERNAME,
    uri: null,
    // P34 D5/D26: the documented working configuration against a stock MySQL 8 server — TLS is
    // available on a stock server (MySQL auto-generates a self-signed certificate at init), so
    // this exercises the real remedy path rather than working by accident (F5).
    options: { sslmode: 'require' },
    password: PASSWORD,
  };

  return {
    container,
    config,
    uri,
    async stop() {
      // Playwright's workers:1 config runs every UI spec file sequentially in the same worker
      // process, sharing this module's state — without resetting `memoized`, a later spec file's
      // startMysql() would return this now-dead container instead of starting a fresh one.
      memoized = null;
      await container.stop();
    },
  };
}
