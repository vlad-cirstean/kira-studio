import type { ResolvedConnectionConfig } from '@shared/protocol/engine-ops';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Redis } from 'ioredis';
import { seedRedis } from '../fixtures/0004_redis_seed';
import { resolveDockerHost } from './docker';

resolveDockerHost();

const IMAGE = 'redis:7';
const PASSWORD = 'kira';
const STARTUP_TIMEOUT_MS = 60_000;
// Two logical dbs so scenario 3 (tree enumeration) sees more than one non-empty entry from
// `INFO keyspace` — a fixed 0-15 sweep would pass even if listDatabases() only ever looked at
// db0 (P9's D5).
const PRIMARY_DB_INDEX = 0;
const SECONDARY_DB_INDEX = 1;

export interface RedisFixture {
  container: StartedRedisContainer;
  config: ResolvedConnectionConfig; // ready to hand to the adapter
  host: string;
  port: number;
  stop(): Promise<void>;
}

// One container per test process, same discipline as support/mongo.ts (§11b).
let memoized: Promise<RedisFixture> | null = null;

export function startRedis(): Promise<RedisFixture> {
  if (!memoized) memoized = start();
  return memoized;
}

async function start(): Promise<RedisFixture> {
  const container = await new RedisContainer(IMAGE)
    .withPassword(PASSWORD)
    .withStartupTimeout(STARTUP_TIMEOUT_MS)
    .start();

  const host = container.getHost();
  const port = container.getPort();

  const primary = new Redis({ host, port, password: PASSWORD, db: PRIMARY_DB_INDEX });
  const secondary = new Redis({ host, port, password: PASSWORD, db: SECONDARY_DB_INDEX });
  try {
    await seedRedis(primary);
    await secondary.set('other-db:marker', 'present');
  } finally {
    primary.disconnect();
    secondary.disconnect();
  }

  const now = new Date().toISOString();
  const config: ResolvedConnectionConfig = {
    id: 'test-redis',
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    name: 'Test Redis',
    kind: 'redis',
    color: 'red',
    mode: 'fields',
    readOnly: false,
    host,
    port,
    database: String(PRIMARY_DB_INDEX),
    username: null,
    uri: null,
    options: {},
    password: PASSWORD,
  };

  return {
    container,
    config,
    host,
    port,
    async stop() {
      // Playwright's workers:1 config runs every UI spec file sequentially in the same worker
      // process, sharing this module's state — without resetting `memoized`, a later spec file's
      // startRedis() would return this now-dead container instead of starting a fresh one.
      memoized = null;
      await container.stop();
    },
  };
}

export {
  PASSWORD as REDIS_PASSWORD,
  PRIMARY_DB_INDEX as REDIS_PRIMARY_DB_INDEX,
  SECONDARY_DB_INDEX as REDIS_SECONDARY_DB_INDEX,
};
