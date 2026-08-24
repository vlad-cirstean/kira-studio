import type { KafkaJS } from '@confluentinc/kafka-javascript';
import type { MutationPlan, MutationResult, MutationRowOp } from '../../../shared/domain/mutations';
import type { OpCtx } from '../adapter';
import { AdapterError } from '../errors';
import { mapKafkaError } from './errors';

// Sentinel keys (mirrors mongo/mutate.ts's `$document` precedent): a new message is expressed
// through the existing relational-shaped MutationRowOp's `values`/`key` rather than widening the
// shared mutation schema. `$` can never start a real Kafka header name worth round-tripping, so
// it can't collide with genuine data.
const KEY_FIELD = '$key';
const BODY_FIELD = '$body';
/** JSON-encoded `Record<string, string>` — the same encoding kafka/read.ts's own `headers`
 *  column already uses (see headersToPlain), so a produced message round-trips through the same
 *  shape a browsed one displays. */
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

function assertInsert(op: MutationRowOp): asserts op is Extract<MutationRowOp, { kind: 'insert' }> {
  if (op.kind !== 'insert') {
    // A topic's log is immutable — no per-message update or delete (kafkaCaps's own comment).
    throw new AdapterError('E_UNSUPPORTED', 'kafka only supports producing new messages (insert)');
  }
}

function renderOpText(op: MutationRowOp, topic: string): string {
  assertInsert(op);
  const key = op.values[KEY_FIELD];
  return `producer.send({ topic: '${topic}', messages: [{ key: ${key ? `'${key}'` : 'null'}, ... }] })`;
}

/** Synchronous (Adapter rule 3): no network, no catalog lookup — mirrors mongo/mutate.ts's preview. */
export function preview(plan: MutationPlan, topic: string): string[] {
  return plan.ops.map((op) => renderOpText(op, topic));
}

export async function produce(
  kafka: KafkaJS.Kafka,
  topic: string,
  readOnly: boolean,
  plan: MutationPlan,
  ctx: OpCtx,
): Promise<MutationResult> {
  // §8.12's standard: enforced here, not only greyed out in the UI (mirrors mongo/mariadb).
  if (readOnly) throw new AdapterError('E_UNSUPPORTED', 'connection is read-only');

  // P32 D11: the library's own recommendation for this await-each-send shape (MIGRATION.md) —
  // without it every staged message pays the default batching delay, which a user watching a
  // one-message produce would read as the app being slow. acks/compression/timeout are
  // per-producer, not per-send, and the adapter sets none of them, so nothing else moves.
  const producer = kafka.producer({ 'linger.ms': 0 } as never);
  ctx.setCommand(preview(plan, topic).join(';\n'));

  let affectedRows = 0;
  try {
    await producer.connect();
    for (const op of plan.ops) {
      assertInsert(op);
      const bodyText = op.values[BODY_FIELD];
      if (typeof bodyText !== 'string') {
        throw new AdapterError('E_QUERY', 'a new message requires a $body');
      }
      const keyText = op.values[KEY_FIELD];
      const headers = parseHeaders(op.values[HEADERS_FIELD]);
      await producer.send({
        topic,
        messages: [{ key: keyText ?? null, value: bodyText, headers }],
      });
      affectedRows++;
    }
  } catch (err) {
    if (err instanceof AdapterError) throw err;
    throw mapKafkaError(err);
  } finally {
    await producer.disconnect().catch(() => {});
  }

  return { affectedRows };
}
