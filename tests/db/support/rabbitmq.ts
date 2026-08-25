import type { ResolvedConnectionConfig } from '@shared/protocol/engine-ops';
import { RabbitMQContainer, type StartedRabbitMQContainer } from '@testcontainers/rabbitmq';
import { Wait } from 'testcontainers';
import { KIRA_VHOST, seedRabbitMq } from '../fixtures/0011_rabbitmq_seed';
import { resolveDockerHost } from './docker';

resolveDockerHost();

// F20: the current -management line at time of writing. The plain (non -management) tag has no
// management plugin at all (F20) — this adapter cannot reach a broker without it.
const IMAGE = 'rabbitmq:4.3.5-management-alpine';
const MANAGEMENT_PORT = 15672;
const USERNAME = 'guest';
const PASSWORD = 'guest';
const STARTUP_TIMEOUT_MS = 120_000;

export interface RabbitMqFixture {
  container: StartedRabbitMQContainer;
  /** Scoped to the seeded 'kira' vhost — ready to hand to the adapter. */
  config: ResolvedConnectionConfig;
  baseUrl: string;
  stop(): Promise<void>;
}

// One container per test process, same discipline as every other support/*.ts fixture (§11b).
let memoized: Promise<RabbitMqFixture> | null = null;

export function startRabbitMq(): Promise<RabbitMqFixture> {
  if (!memoized) memoized = start();
  return memoized;
}

async function start(): Promise<RabbitMqFixture> {
  // D36: the preset's own wait strategy watches for the AMQP-era "Server startup complete" log
  // line and exposes no HTTP helper at all — this adapter needs the management listener, which is
  // a plugin that finishes starting on its own schedule. Waiting on the endpoint the tests
  // actually call is the difference between a deterministic suite and a first-scenario flake.
  const container = await new RabbitMQContainer(IMAGE)
    .withWaitStrategy(
      Wait.forHttp('/api/overview', MANAGEMENT_PORT)
        .withBasicCredentials(USERNAME, PASSWORD)
        .forStatusCode(200),
    )
    .withStartupTimeout(STARTUP_TIMEOUT_MS)
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(MANAGEMENT_PORT);
  const baseUrl = `http://${host}:${port}`;

  await seedRabbitMq(baseUrl);

  const now = new Date().toISOString();
  const config: ResolvedConnectionConfig = {
    id: 'test-rabbitmq',
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    name: 'Test RabbitMQ',
    kind: 'rabbitmq',
    color: 'indigo',
    mode: 'fields',
    readOnly: false,
    host,
    port,
    database: KIRA_VHOST,
    username: USERNAME,
    uri: null,
    options: {},
    password: PASSWORD,
  };

  return {
    container,
    config,
    baseUrl,
    async stop() {
      // Playwright's workers:1 config runs every UI spec file sequentially in the same worker
      // process, sharing this module's state — without resetting `memoized`, a later spec file's
      // startRabbitMq() would return this now-dead container instead of starting a fresh one.
      memoized = null;
      await container.stop();
    },
  };
}
