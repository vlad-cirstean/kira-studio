import { findStreamTab } from '../../state/tabs';
import { createImmediateMutator } from '../shared/immediateMutation';
import { reload } from './state';

// Item 3/4: mutate immediately, no staging/preview step — documents/mutations.ts's precedent
// (P8's ground rules), extended to streams. Each op uses the `$`-prefixed sentinel fields
// kafka/produce.ts and sqs/mutate.ts's adapters agree on (mirrors mongo/mutate.ts's `$document`).
const mutate = createImmediateMutator({ findTab: findStreamTab, reload });

export async function produceKafkaMessage(
  tabId: string,
  fields: { key: string | null; body: string; headers: string | null },
): Promise<void> {
  const values: Record<string, string | null> = { $key: fields.key, $body: fields.body };
  if (fields.headers !== null) values.$headers = fields.headers;
  await mutate(tabId, [{ kind: 'insert', values }]);
}

export async function sendSqsMessage(
  tabId: string,
  body: string,
  headers: string | null,
): Promise<void> {
  const values: Record<string, string | null> = { $body: body };
  if (headers !== null) values.$headers = headers;
  await mutate(tabId, [{ kind: 'insert', values }]);
}

// `messageId` mirrors sqs/mutate.ts's ID_FIELD — the row's own `key` column, which read.ts
// already sets to the SQS MessageId (P10's row shape), echoed straight back.
export async function deleteSqsMessage(tabId: string, messageId: string): Promise<void> {
  await mutate(tabId, [{ kind: 'delete', key: { messageId } }]);
}
