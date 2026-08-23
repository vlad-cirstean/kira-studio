import { SQSClient } from '@aws-sdk/client-sqs';
import type { ResolvedConnectionConfig } from '@shared/protocol/engine-ops';
import { LocalstackContainer, type StartedLocalStackContainer } from '@testcontainers/localstack';
import { seedSqs } from '../fixtures/0006_sqs_seed';
import { resolveDockerHost } from './docker';

resolveDockerHost();

const IMAGE = 'localstack/localstack:3';
const REGION = 'us-east-1';
const STATIC_ACCESS_KEY = 'test';
const STATIC_SECRET_KEY = 'test';
const STARTUP_TIMEOUT_MS = 120_000;

export interface SqsFixture {
  container: StartedLocalStackContainer;
  config: ResolvedConnectionConfig; // ready to hand to the adapter
  endpoint: string;
  stop(): Promise<void>;
}

// One container per test process, same discipline as support/redis.ts (§11b).
let memoized: Promise<SqsFixture> | null = null;

export function startSqs(): Promise<SqsFixture> {
  if (!memoized) memoized = start();
  return memoized;
}

async function start(): Promise<SqsFixture> {
  const container = await new LocalstackContainer(IMAGE)
    .withStartupTimeout(STARTUP_TIMEOUT_MS)
    .start();
  const endpoint = container.getConnectionUri();

  const seedClient = new SQSClient({
    region: REGION,
    endpoint,
    credentials: { accessKeyId: STATIC_ACCESS_KEY, secretAccessKey: STATIC_SECRET_KEY },
  });
  try {
    await seedSqs(seedClient);
  } finally {
    seedClient.destroy();
  }

  // D9's URI-mode exception carries static keys directly (`sqs://accessKeyId:secretAccessKey@
  // region`) — the practical way to hand LocalStack a fixed test credential pair without relying
  // on a `~/.aws/credentials` profile file existing in CI (fields mode's only credential path,
  // via fromIni). `options.endpoint` is what actually redirects the adapter at LocalStack instead
  // of real AWS.
  const now = new Date().toISOString();
  const config: ResolvedConnectionConfig = {
    id: 'test-sqs',
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    name: 'Test SQS',
    kind: 'sqs',
    color: 'amber',
    mode: 'uri',
    readOnly: false,
    host: null,
    port: null,
    database: null,
    username: null,
    uri: `sqs://${STATIC_ACCESS_KEY}:${STATIC_SECRET_KEY}@${REGION}`,
    options: { endpoint },
    password: null,
  };

  return {
    container,
    config,
    endpoint,
    async stop() {
      // Playwright's workers:1 config runs every UI spec file sequentially in the same worker
      // process, sharing this module's state — without resetting `memoized`, a later spec file's
      // startSqs() would return this now-dead container instead of starting a fresh one.
      memoized = null;
      await container.stop();
    },
  };
}
