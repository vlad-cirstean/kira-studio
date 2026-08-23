import type { ResolvedConnectionConfig } from '@shared/protocol/engine-ops';
import { KafkaContainer, type StartedKafkaContainer } from '@testcontainers/kafka';
import { Kafka } from 'kafkajs';
import { seedKafka } from '../fixtures/0005_kafka_seed';
import { resolveDockerHost } from './docker';

resolveDockerHost();

// D15 (P10's plan doc): confluentinc/cp-kafka, not apache/kafka — the latter's listener never
// opens under Testcontainers' bootstrap. 7.6.1 is old enough that KafkaContainer defaults to
// embedded ZooKeeper unless KRaft is requested explicitly, so `.withKraft()` is required — a
// single-container KRaft broker is both simpler and faster to boot than a two-container
// broker+ZooKeeper pair.
const IMAGE = 'confluentinc/cp-kafka:7.6.1';
// KafkaContainer's own internal PLAINTEXT listener port — not exported by @testcontainers/kafka,
// so pinned here (kafka-container.js's own `KAFKA_PORT` constant).
const KAFKA_PORT = 9093;
const STARTUP_TIMEOUT_MS = 120_000;

export interface KafkaFixture {
  container: StartedKafkaContainer;
  config: ResolvedConnectionConfig; // ready to hand to the adapter
  host: string;
  port: number;
  stop(): Promise<void>;
}

// One container per test process, same discipline as support/redis.ts (§11b).
let memoized: Promise<KafkaFixture> | null = null;

export function startKafka(): Promise<KafkaFixture> {
  if (!memoized) memoized = start();
  return memoized;
}

async function start(): Promise<KafkaFixture> {
  const container = await new KafkaContainer(IMAGE)
    .withKraft()
    .withStartupTimeout(STARTUP_TIMEOUT_MS)
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(KAFKA_PORT);

  const kafka = new Kafka({ clientId: 'kira-studio-seed', brokers: [`${host}:${port}`] });
  await seedKafka(kafka);

  const now = new Date().toISOString();
  const config: ResolvedConnectionConfig = {
    id: 'test-kafka',
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    name: 'Test Kafka',
    kind: 'kafka',
    color: 'orange',
    mode: 'fields',
    readOnly: false,
    host,
    port,
    database: null,
    username: null,
    uri: null,
    options: {},
    password: null,
  };

  return {
    container,
    config,
    host,
    port,
    async stop() {
      // Playwright's workers:1 config runs every UI spec file sequentially in the same worker
      // process, sharing this module's state — without resetting `memoized`, a later spec file's
      // startKafka() would return this now-dead container instead of starting a fresh one.
      memoized = null;
      await container.stop();
    },
  };
}
