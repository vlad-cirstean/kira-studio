import {
  DeleteMessageCommand,
  type MessageAttributeValue,
  SendMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import type { MutationPlan, MutationResult, MutationRowOp } from '../../../shared/domain/mutations';
import type { OpCtx } from '../adapter';
import { AdapterError, assertWritable } from '../errors';
import { mapError } from './errors';

// Sentinel key (mirrors mongo/mutate.ts's `$document`, kafka/produce.ts's `$body`): a new
// message is expressed through the existing relational-shaped MutationRowOp's `values` rather
// than widening the shared mutation schema.
const BODY_FIELD = '$body';
/** Task #61: mirrors kafka/produce.ts's own `$headers` sentinel exactly — JSON-encoded
 *  `Record<string, string>`, mapped onto SendMessage's `MessageAttributes` shape below. Sent
 *  attributes round-trip back through sqs/read.ts's `pushMessage`, which already reads
 *  `message.MessageAttributes` into the row's `headers` column unchanged. */
const HEADERS_FIELD = '$headers';

function parseHeaders(raw: string | null | undefined): Record<string, string> | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AdapterError('E_QUERY', 'malformed $headers JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new AdapterError('E_QUERY', '$headers must be a JSON object of string values');
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v !== 'string') throw new AdapterError('E_QUERY', `$headers.${k} must be a string`);
    out[k] = v;
  }
  return out;
}

function toMessageAttributes(
  headers: Record<string, string> | undefined,
): Record<string, MessageAttributeValue> | undefined {
  if (!headers) return undefined;
  const out: Record<string, MessageAttributeValue> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] = { DataType: 'String', StringValue: value };
  }
  return out;
}

/** The delete key's field name — the row's `key` column is already the MessageId (read.ts's
 *  `pushMessage`), so the renderer echoes it back unchanged, mirroring mongo/mutate.ts's `_id`. */
const ID_FIELD = 'messageId';

function renderOpText(op: MutationRowOp, queueName: string): string {
  if (op.kind === 'insert') return `SendMessage(${queueName})`;
  if (op.kind === 'delete') return `DeleteMessage(${queueName})`;
  // A delivered message can't be edited in place, only replaced by delete+resend (sqsCaps's own
  // comment) — there is no per-message update in the SQS API.
  throw new AdapterError(
    'E_UNSUPPORTED',
    'sqs has no update operation — delete and resend instead',
  );
}

/** Synchronous (Adapter rule 3): no network, no queue-URL resolution — mirrors mongo/mutate.ts. */
export function preview(plan: MutationPlan, queueName: string): string[] {
  return plan.ops.map((op) => renderOpText(op, queueName));
}

/**
 * `receiptHandles` is the adapter-local, in-memory map SqsAdapter threads through from read.ts's
 * pollQueue (keyed by MessageId) — a receipt handle is an AWS-internal token with no reason to
 * round-trip through the wire protocol (StreamPage carries no such field), and it is only ever
 * valid for the message that was actually received, not a stable identifier of the message itself.
 * Deleting a message the current session never polled (its handle isn't in the map, or the queue
 * was reconnected since) is reported as E_QUERY rather than silently doing nothing.
 */
export async function mutateQueue(
  client: SQSClient,
  queueUrl: string,
  queueName: string,
  readOnly: boolean,
  plan: MutationPlan,
  receiptHandles: Map<string, string>,
  ctx: OpCtx,
): Promise<MutationResult> {
  assertWritable(readOnly);

  ctx.setCommand(preview(plan, queueName).join(';\n'));
  let affectedRows = 0;
  try {
    for (const op of plan.ops) {
      if (op.kind === 'insert') {
        const body = op.values[BODY_FIELD];
        if (typeof body !== 'string') {
          throw new AdapterError('E_QUERY', 'a new message requires a $body');
        }
        const headers = parseHeaders(op.values[HEADERS_FIELD]);
        await client.send(
          new SendMessageCommand({
            QueueUrl: queueUrl,
            MessageBody: body,
            MessageAttributes: toMessageAttributes(headers),
          }),
          { abortSignal: ctx.signal },
        );
        affectedRows++;
      } else if (op.kind === 'delete') {
        const messageId = op.key[ID_FIELD];
        if (typeof messageId !== 'string') {
          throw new AdapterError('E_QUERY', `a delete requires the message's ${ID_FIELD}`);
        }
        const receiptHandle = receiptHandles.get(messageId);
        if (!receiptHandle) {
          throw new AdapterError(
            'E_QUERY',
            'this message was not received in the current session (its receipt handle is gone) — poll again before deleting',
          );
        }
        await client.send(
          new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle }),
          { abortSignal: ctx.signal },
        );
        receiptHandles.delete(messageId);
        affectedRows++;
      } else {
        throw new AdapterError(
          'E_UNSUPPORTED',
          'sqs has no update operation — delete and resend instead',
        );
      }
    }
  } catch (err) {
    if (err instanceof AdapterError) throw err;
    throw mapError(err);
  }

  return { affectedRows };
}
