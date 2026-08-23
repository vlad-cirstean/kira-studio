import { DeleteMessageCommand, SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import type { MutationPlan, MutationResult, MutationRowOp } from '../../../shared/domain/mutations';
import type { OpCtx } from '../adapter';
import { AdapterError } from '../errors';
import { mapSqsError } from './errors';

// Sentinel key (mirrors mongo/mutate.ts's `$document`, kafka/produce.ts's `$body`): a new
// message is expressed through the existing relational-shaped MutationRowOp's `values` rather
// than widening the shared mutation schema.
const BODY_FIELD = '$body';

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
  if (readOnly) throw new AdapterError('E_UNSUPPORTED', 'connection is read-only');

  ctx.setCommand(preview(plan, queueName).join(';\n'));
  let affectedRows = 0;
  try {
    for (const op of plan.ops) {
      if (op.kind === 'insert') {
        const body = op.values[BODY_FIELD];
        if (typeof body !== 'string') {
          throw new AdapterError('E_QUERY', 'a new message requires a $body');
        }
        await client.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: body }), {
          abortSignal: ctx.signal,
        });
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
    throw mapSqsError(err);
  }

  return { affectedRows };
}
