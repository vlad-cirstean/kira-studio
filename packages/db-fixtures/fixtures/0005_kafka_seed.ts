import type { StartedTestContainer } from 'testcontainers';

// Kafka has no .sql-file seeding path either (mirrors 0004_redis_seed.ts's own JS/TS seed
// function) — run once against a fresh broker by support/kafka.ts.
export const ORDERS_TOPIC = 'orders';
export const EMPTY_TOPIC = 'empty-topic'; // exercises a topic with zero messages
export const ORDERS_PARTITION_COUNT = 2;
export const ORDERS_MESSAGE_COUNT = 6; // > one partition's worth, so browsing genuinely spans both
export const CONSUMER_GROUP = 'kira-test-group';

// P32 D26: the seed runs the broker's own CLI inside the container instead of a JS Kafka client —
// this is what keeps a JS client out of the Playwright/Node process entirely (F24), so `tests/e2e`
// never needs anything but the Electron-ABI build of the driver under test. It also stops the seed
// from registering CONSUMER_GROUP by *joining* it, which was a standing absurdity in a phase about
// not joining groups.
// KafkaContainer configures two listeners (kafka-container.js): PLAINTEXT (9093), advertised as
// <host>:<mapped-port> for clients connecting from outside the container (Testcontainers' own
// KAFKA_PORT, used by support/kafka.ts's container.getMappedPort(9093) for the app under test),
// and BROKER (9092), advertised as <container-hostname>:9092 for clients already inside the
// container's own network namespace. This seed's exec() calls run *inside* the container, so they
// must bootstrap via 9092: bootstrapping via 9093 connects fine (the socket is local), but the
// AdminClient's very next call reconnects to the address the broker just advertised for that
// listener - the host-mapped port - which is not reachable from inside the container itself, so it
// hangs retrying forever rather than erroring. Confirmed by hand: `docker exec <id> kafka-topics
// --bootstrap-server localhost:9093 --list` never returns; the same command against :9092 returns
// immediately. This was never a Kafka-4.0-vs-3.6 metadata-quorum race - P32 D25's version bump
// didn't change which port was wrong, it just landed on a machine (Colima, no host-side loopback
// hairpin NAT for published ports) where the wrong port actually fails instead of quietly working.
const BOOTSTRAP = 'localhost:9092';
const SEED_FILE = '/tmp/kira-orders-seed.txt';

// Belt-and-suspenders: even via the correct in-container listener, the broker's self-managed KRaft
// metadata quorum can still be a beat behind the port opening, so the very first admin call after
// `.start()` resolves can lose a narrow race. Retrying (rather than padding `withStartupTimeout`,
// which only bounds the port-open wait, not this one) is the same shape as every other adapter's
// own connection-retry loop.
const ADMIN_READY_RETRIES = 4;
const ADMIN_READY_RETRY_DELAY_MS = 1_000;

async function exec(
  container: StartedTestContainer,
  command: string[],
  retries = 0,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const { exitCode, output } = await container.exec(command);
    if (exitCode === 0) return;
    if (attempt >= retries) {
      throw new Error(`kafka seed command failed (${command.join(' ')}): ${output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, ADMIN_READY_RETRY_DELAY_MS));
  }
}

export async function seedKafka(container: StartedTestContainer): Promise<void> {
  // Only the first admin call actually needs the retry budget — once this one succeeds the quorum
  // is provably ready, so every later call in this function keeps its normal single-attempt exec.
  await exec(
    container,
    [
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
    ],
    ADMIN_READY_RETRIES,
  );
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
    `kafka-console-producer --bootstrap-server ${BOOTSTRAP} --topic ${ORDERS_TOPIC} ` +
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
