import type { StartedTestContainer } from 'testcontainers';

// Kafka has no .sql-file seeding path either (mirrors 0004_redis_seed.ts's own JS/TS seed
// function) — run once against a fresh broker by support/kafka.ts.
export const ORDERS_TOPIC = 'orders';
export const EMPTY_TOPIC = 'empty-topic'; // exercises a topic with zero messages
export const ORDERS_PARTITION_COUNT = 2;
export const ORDERS_MESSAGE_COUNT = 6; // > one partition's worth, so browsing genuinely spans both
export const CONSUMER_GROUP = 'kira-test-group';

// P32 D26: the seed runs the broker's own CLI inside the container instead of a JS Kafka client —
// this is what keeps a JS client out of the Playwright/Node process entirely (F24), so `tests/ui`
// never needs anything but the Electron-ABI build of the driver under test. It also stops the seed
// from registering CONSUMER_GROUP by *joining* it, which was a standing absurdity in a phase about
// not joining groups.
const BOOTSTRAP = 'localhost:9093'; // the container's own PLAINTEXT listener (kafka-container.js KAFKA_PORT)
const SEED_FILE = '/tmp/kira-orders-seed.txt';

async function exec(container: StartedTestContainer, command: string[]): Promise<void> {
  const { exitCode, output } = await container.exec(command);
  if (exitCode !== 0) {
    throw new Error(`kafka seed command failed (${command.join(' ')}): ${output}`);
  }
}

export async function seedKafka(container: StartedTestContainer): Promise<void> {
  await exec(container, [
    'kafka-topics',
    '--bootstrap-server',
    BOOTSTRAP,
    '--create',
    '--topic',
    ORDERS_TOPIC,
    '--partitions',
    String(ORDERS_PARTITION_COUNT),
    '--replication-factor',
    '1',
  ]);
  await exec(container, [
    'kafka-topics',
    '--bootstrap-server',
    BOOTSTRAP,
    '--create',
    '--topic',
    EMPTY_TOPIC,
    '--partitions',
    '1',
    '--replication-factor',
    '1',
  ]);

  // kafka-console-producer's line format (parse.headers + parse.key, all default delimiters) is
  // "<headers>\t<key>\t<value>", headers themselves "name:value[,name:value...]" — written to a
  // file and piped in, since container.exec() has no stdin option.
  const lines = Array.from(
    { length: ORDERS_MESSAGE_COUNT },
    (_, i) => `source:seed\tkey-${i}\t${JSON.stringify({ seq: i })}`,
  ).join('\n');
  await container.copyContentToContainer([
    { content: `${lines}\n`, target: SEED_FILE, mode: 0o644 },
  ]);
  await exec(container, [
    'sh',
    '-c',
    `kafka-console-producer --broker-list ${BOOTSTRAP} --topic ${ORDERS_TOPIC} ` +
      '--property parse.key=true --property parse.headers=true ' +
      `< ${SEED_FILE}`,
  ]);

  // Registers CONSUMER_GROUP in admin.listGroups() (P10's root-level "topics, consumer groups"
  // tree, kafka/catalog.ts's listGroups()) with committed offsets and no members —
  // --reset-offsets --to-earliest --execute against a group that has never existed creates exactly
  // that state, which is what scenario 6 (tests/db/kafka.spec.ts) asserts.
  await exec(container, [
    'kafka-consumer-groups',
    '--bootstrap-server',
    BOOTSTRAP,
    '--group',
    CONSUMER_GROUP,
    '--topic',
    ORDERS_TOPIC,
    '--reset-offsets',
    '--to-earliest',
    '--execute',
  ]);
}
