import { S3Client } from '@aws-sdk/client-s3';
import type { ResolvedConnectionConfig } from '@shared/protocol/engine-ops';
import { LocalstackContainer, type StartedLocalStackContainer } from '@testcontainers/localstack';
import { seedS3 } from '../fixtures/0007_s3_seed';
import { resolveDockerHost } from './docker';

resolveDockerHost();

const IMAGE = 'localstack/localstack:3';
const REGION = 'us-east-1';
const STATIC_ACCESS_KEY = 'test';
const STATIC_SECRET_KEY = 'test';
const STARTUP_TIMEOUT_MS = 120_000;

export interface S3Fixture {
  container: StartedLocalStackContainer;
  config: ResolvedConnectionConfig; // ready to hand to the adapter
  endpoint: string;
  stop(): Promise<void>;
}

// One container per test process, same discipline as support/sqs.ts (§11b).
let memoized: Promise<S3Fixture> | null = null;

export function startS3(): Promise<S3Fixture> {
  if (!memoized) memoized = start();
  return memoized;
}

async function start(): Promise<S3Fixture> {
  const container = await new LocalstackContainer(IMAGE)
    .withStartupTimeout(STARTUP_TIMEOUT_MS)
    .start();
  const endpoint = container.getConnectionUri();

  const seedClient = new S3Client({
    region: REGION,
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: STATIC_ACCESS_KEY, secretAccessKey: STATIC_SECRET_KEY },
  });
  try {
    await seedS3(seedClient);
  } finally {
    seedClient.destroy();
  }

  // Mirrors support/sqs.ts's own URI-mode static-key exception exactly — `options.endpoint` is
  // what redirects the adapter at LocalStack instead of real AWS (s3/client.ts turns on
  // forcePathStyle automatically whenever this is set).
  const now = new Date().toISOString();
  const config: ResolvedConnectionConfig = {
    id: 'test-s3',
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    name: 'Test S3',
    kind: 's3',
    color: 'olive',
    mode: 'uri',
    readOnly: false,
    host: null,
    port: null,
    database: null,
    username: null,
    uri: `s3://${STATIC_ACCESS_KEY}:${STATIC_SECRET_KEY}@${REGION}`,
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
      // startS3() would return this now-dead container instead of starting a fresh one.
      memoized = null;
      await container.stop();
    },
  };
}
