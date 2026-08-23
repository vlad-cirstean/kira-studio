import type { ResolvedConnectionConfig } from '@shared/protocol/engine-ops';
import { MongoClient } from 'mongodb';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { seedMongo } from '../fixtures/0003_mongo_seed';
import { resolveDockerHost } from './docker';

resolveDockerHost();

const IMAGE = 'mongo:7';
const ROOT_USERNAME = 'root';
const ROOT_PASSWORD = 'kira';
const DATABASE = 'kira_test';
const ANALYTICS_DATABASE = 'kira_analytics';
const USERNAME = 'kira';
const PASSWORD = 'kira';
const MONGO_PORT = 27017;
const STARTUP_TIMEOUT_MS = 120_000;

export interface MongoFixture {
  container: StartedTestContainer;
  config: ResolvedConnectionConfig; // ready to hand to the adapter
  host: string;
  port: number;
  rootUri: string; // authSource=admin, full cluster access — for test-side assertions only
  stop(): Promise<void>;
}

// One container per test process, same discipline as support/postgres.ts and support/mariadb.ts
// (§11b) — a fresh container per test would make the suite unusable.
let memoized: Promise<MongoFixture> | null = null;

export function startMongo(): Promise<MongoFixture> {
  if (!memoized) memoized = start();
  return memoized;
}

async function start(): Promise<MongoFixture> {
  const container = await new GenericContainer(IMAGE)
    .withEnvironment({
      MONGO_INITDB_ROOT_USERNAME: ROOT_USERNAME,
      MONGO_INITDB_ROOT_PASSWORD: ROOT_PASSWORD,
    })
    .withExposedPorts(MONGO_PORT)
    // Same double-start shape as postgres/mariadb: with MONGO_INITDB_ROOT_USERNAME set, the
    // entrypoint boots a temporary auth-less instance to create the root user, shuts it down,
    // then starts the real instance with --auth — waiting for only the first "Waiting for
    // connections" gets a refused connection a moment later.
    .withWaitStrategy(Wait.forLogMessage(/Waiting for connections/, 2))
    .withStartupTimeout(STARTUP_TIMEOUT_MS)
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(MONGO_PORT);
  const rootUri = `mongodb://${ROOT_USERNAME}:${ROOT_PASSWORD}@${host}:${port}/admin`;

  const root = new MongoClient(rootUri);
  await root.connect();
  try {
    // Scoped to both test databases so the tree-enumeration test sees two non-system databases
    // (listDatabases with a non-admin user only returns databases it is authorized on) — mirrors
    // postgres.ts's `analytics` schema / mariadb.ts's second database.
    await root.db(DATABASE).command({
      createUser: USERNAME,
      pwd: PASSWORD,
      roles: [
        { role: 'readWrite', db: DATABASE },
        { role: 'readWrite', db: ANALYTICS_DATABASE },
      ],
    });

    await seedMongo(root.db(DATABASE));
    await root
      .db(ANALYTICS_DATABASE)
      .collection('events')
      .insertMany([{ name: 'signup' }, { name: 'login' }]);
  } finally {
    await root.close();
  }

  const now = new Date().toISOString();
  const config: ResolvedConnectionConfig = {
    id: 'test-mongo',
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    name: 'Test Mongo',
    kind: 'mongodb',
    color: 'green',
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
    host,
    port,
    rootUri,
    async stop() {
      // Playwright's workers:1 config runs every UI spec file sequentially in the same worker
      // process, sharing this module's state — without resetting `memoized`, a later spec file's
      // startMongo() would return this now-dead container instead of starting a fresh one.
      memoized = null;
      await container.stop();
    },
  };
}

export { ANALYTICS_DATABASE as MONGO_ANALYTICS_DATABASE, DATABASE as MONGO_DATABASE };
