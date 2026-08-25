import { data } from '../../bridge/data';
import { findStreamTab } from '../../state/tabs';
import { reload } from './state';

// Item 3/4: mutate immediately, no staging/preview step — documents/mutations.ts's precedent
// (P8's ground rules), extended to streams. Each op uses the `$`-prefixed sentinel fields
// kafka/produce.ts and sqs/mutate.ts's adapters agree on (mirrors mongo/mutate.ts's `$document`).

export async function produceKafkaMessage(
  tabId: string,
  fields: { key: string | null; body: string; headers: string | null },
): Promise<void> {
  const tab = findStreamTab(tabId);
  if (!tab?.connectionId) return;
  const values: Record<string, string | null> = { $key: fields.key, $body: fields.body };
  if (fields.headers !== null) values.$headers = fields.headers;
  await data.mutate({
    opId: crypto.randomUUID(),
    tabId,
    connectionId: tab.connectionId,
    path: tab.path,
    ops: [{ kind: 'insert', values }],
  });
  await reload(tabId);
}

export async function sendSqsMessage(
  tabId: string,
  body: string,
  headers: string | null,
): Promise<void> {
  const tab = findStreamTab(tabId);
  if (!tab?.connectionId) return;
  const values: Record<string, string | null> = { $body: body };
  if (headers !== null) values.$headers = headers;
  await data.mutate({
    opId: crypto.randomUUID(),
    tabId,
    connectionId: tab.connectionId,
    path: tab.path,
    ops: [{ kind: 'insert', values }],
  });
  await reload(tabId);
}

// P37 D25/D32: publish-only — rabbitmq/mutate.ts's $routingKey/$exchange/$properties join the
// shared $body/$headers sentinels. $routingKey defaults to the queue's own name and $exchange to
// '' (the default exchange) when omitted, so both are sent only when the user actually typed
// something. Persistent maps to AMQP's delivery_mode: 2 inside $properties (F24) — the one
// property this phase gives its own control, rather than a general properties editor (§6).
export async function publishRabbitMessage(
  tabId: string,
  fields: {
    body: string;
    headers: string | null;
    routingKey: string | null;
    exchange: string | null;
    persistent: boolean;
  },
): Promise<void> {
  const tab = findStreamTab(tabId);
  if (!tab?.connectionId) return;
  const values: Record<string, string | null> = { $body: fields.body };
  if (fields.headers !== null) values.$headers = fields.headers;
  if (fields.routingKey !== null) values.$routingKey = fields.routingKey;
  if (fields.exchange !== null) values.$exchange = fields.exchange;
  if (fields.persistent) values.$properties = JSON.stringify({ delivery_mode: 2 });
  await data.mutate({
    opId: crypto.randomUUID(),
    tabId,
    connectionId: tab.connectionId,
    path: tab.path,
    ops: [{ kind: 'insert', values }],
  });
  await reload(tabId);
}

// `messageId` mirrors sqs/mutate.ts's ID_FIELD — the row's own `key` column, which read.ts
// already sets to the SQS MessageId (P10's row shape), echoed straight back.
export async function deleteSqsMessage(tabId: string, messageId: string): Promise<void> {
  const tab = findStreamTab(tabId);
  if (!tab?.connectionId) return;
  await data.mutate({
    opId: crypto.randomUUID(),
    tabId,
    connectionId: tab.connectionId,
    path: tab.path,
    ops: [{ kind: 'delete', key: { messageId } }],
  });
  await reload(tabId);
}
