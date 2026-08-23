import type { Kafka } from 'kafkajs';

// Kafka has no .sql-file seeding path either (mirrors 0004_redis_seed.ts's own JS/TS seed
// function) — run once against a fresh broker by support/kafka.ts.
export const ORDERS_TOPIC = 'orders';
export const EMPTY_TOPIC = 'empty-topic'; // exercises a topic with zero messages
export const ORDERS_PARTITION_COUNT = 2;
export const ORDERS_MESSAGE_COUNT = 6; // > one partition's worth, so browsing genuinely spans both
export const CONSUMER_GROUP = 'kira-test-group';

export async function seedKafka(kafka: Kafka): Promise<void> {
  const admin = kafka.admin();
  await admin.connect();
  try {
    await admin.createTopics({
      waitForLeaders: true,
      topics: [
        { topic: ORDERS_TOPIC, numPartitions: ORDERS_PARTITION_COUNT },
        { topic: EMPTY_TOPIC, numPartitions: 1 },
      ],
    });

    const producer = kafka.producer();
    await producer.connect();
    try {
      const messages = Array.from({ length: ORDERS_MESSAGE_COUNT }, (_, i) => ({
        key: `key-${i}`,
        value: JSON.stringify({ seq: i }),
        headers: { source: 'seed' },
      }));
      await producer.send({ topic: ORDERS_TOPIC, messages });
    } finally {
      await producer.disconnect();
    }

    // Registers CONSUMER_GROUP in admin.listGroups() (P10's root-level "topics, consumer groups"
    // tree, kafka/catalog.ts's listGroups()) — a group only appears there once some consumer has
    // actually joined it, so this drains ORDERS_TOPIC under CONSUMER_GROUP once before tearing
    // the consumer down.
    const consumer = kafka.consumer({ groupId: CONSUMER_GROUP });
    await consumer.connect();
    try {
      await consumer.subscribe({ topic: ORDERS_TOPIC, fromBeginning: true });
      await new Promise<void>((resolve, reject) => {
        let seen = 0;
        consumer
          .run({
            eachMessage: async () => {
              seen++;
              if (seen >= ORDERS_MESSAGE_COUNT) resolve();
            },
          })
          .catch(reject);
      });
    } finally {
      await consumer.stop().catch(() => {});
      await consumer.disconnect();
    }
  } finally {
    await admin.disconnect();
  }
}
