import { data } from '../../bridge/data';
import { findStreamTab } from '../../state/tabs';
import { reload } from './state';

// Item 3/4: mutate immediately, no staging/preview step — documentMutations.ts's precedent
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

export async function sendSqsMessage(tabId: string, body: string): Promise<void> {
  const tab = findStreamTab(tabId);
  if (!tab?.connectionId) return;
  await data.mutate({
    opId: crypto.randomUUID(),
    tabId,
    connectionId: tab.connectionId,
    path: tab.path,
    ops: [{ kind: 'insert', values: { $body: body } }],
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
