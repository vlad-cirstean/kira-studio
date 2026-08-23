import { CreateQueueCommand, SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';

// SQS has no .sql-file seeding path either (mirrors 0005_kafka_seed.ts) — run once against a
// fresh LocalStack instance by support/sqs.ts.
export const ORDERS_QUEUE = 'orders-queue';
export const EMPTY_QUEUE = 'empty-queue'; // exercises a queue with zero messages
export const ORDERS_MESSAGE_COUNT = 5;
// A second, dedicated queue for the "repeated small polls eventually see every message" scenario
// — reusing ORDERS_QUEUE there would race against whichever other test already received (and so,
// by SQS's own VisibilityTimeout, temporarily hid) its messages first.
export const DRAIN_QUEUE = 'drain-queue';
export const DRAIN_MESSAGE_COUNT = 7;

async function seedQueue(client: SQSClient, queueName: string, count: number): Promise<void> {
  const result = await client.send(new CreateQueueCommand({ QueueName: queueName }));
  const queueUrl = result.QueueUrl;
  if (!queueUrl) throw new Error('CreateQueueCommand did not return a QueueUrl');

  for (let i = 0; i < count; i++) {
    await client.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({ seq: i }),
        MessageAttributes: { source: { DataType: 'String', StringValue: 'seed' } },
      }),
    );
  }
}

export async function seedSqs(client: SQSClient): Promise<void> {
  await seedQueue(client, ORDERS_QUEUE, ORDERS_MESSAGE_COUNT);
  await seedQueue(client, DRAIN_QUEUE, DRAIN_MESSAGE_COUNT);
  await client.send(new CreateQueueCommand({ QueueName: EMPTY_QUEUE }));
}
