import type { LibrdKafkaError, MessageHeader } from '@confluentinc/kafka-javascript';
import { Producer } from '@confluentinc/kafka-javascript';
import type { MutationPlan, MutationResult, MutationRowOp } from '@shared/domain/mutations';
import type { OpCtx } from '../adapter';
import { AdapterError, assertWritable } from '../errors';
import type { RdConfig } from './client';
import { mapError } from './errors';

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
  return `producer.produce('${topic}', null, Buffer.from(...), ${key ? `'${key}'` : 'null'})`;
}

/** Synchronous (Adapter rule 3): no network, no catalog lookup — mirrors mongo/mutate.ts's preview. */
export function preview(plan: MutationPlan, topic: string): string[] {
  return plan.ops.map((op) => renderOpText(op, topic));
}

// The classic node-rdkafka API's own header shape: an array of single-key objects, not a plain
// Record (mirrors read.ts's headersToPlain, the same conversion in reverse).
function toRdHeaders(headers: Record<string, string> | undefined): MessageHeader[] | undefined {
  if (!headers) return undefined;
  return Object.entries(headers).map(([key, value]) => ({ [key]: value }));
}

function connectProducer(producer: Producer): Promise<void> {
  return new Promise((resolve, reject) => {
    producer.connect(undefined, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function flushProducer(producer: Producer, timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    producer.flush(timeout, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function disconnectProducer(producer: Producer): Promise<void> {
  return new Promise((resolve) => {
    producer.disconnect(() => resolve());
  });
}

export async function produce(
  rdConfig: RdConfig,
  topic: string,
  readOnly: boolean,
  plan: MutationPlan,
  ctx: OpCtx,
): Promise<MutationResult> {
  // §8.12's standard: enforced here, not only greyed out in the UI (mirrors mongo/mariadb).
  assertWritable(readOnly);

  // The classic node-rdkafka Producer, not the KafkaJS-compat kafka.producer() — the compat
  // wrapper unconditionally sets `dr_cb: true` (its own _producer.js), and node-rdkafka's delivery
  // -report path adopts a raw malloc'd buffer into a V8 ArrayBuffer via Nan::NewBuffer(...)
  // .ToLocalChecked() (callbacks.cc) without checking the result — under Electron's V8 sandbox
  // (enabled at compile time, unlike standalone Node) that adoption always fails, and the
  // unchecked ToLocalChecked() aborts the whole process. A non-null key plus dr_cb is exactly
  // what reproduces it; never setting dr_cb sidesteps the crash rather than papering over it. The
  // cost: produce() below reports "queued into librdkafka", not "the broker acknowledged this
  // specific message" — flush() still proves the whole batch drained, just not which messages
  // succeeded individually.
  const producer = new Producer({ ...rdConfig, 'linger.ms': 0 } as never);
  ctx.setCommand(preview(plan, topic).join(';\n'));

  let affectedRows = 0;
  try {
    await connectProducer(producer);
    for (const op of plan.ops) {
      assertInsert(op);
      const bodyText = op.values[BODY_FIELD];
      if (typeof bodyText !== 'string') {
        throw new AdapterError('E_QUERY', 'a new message requires a $body');
      }
      const keyText = op.values[KEY_FIELD];
      const headers = toRdHeaders(parseHeaders(op.values[HEADERS_FIELD]));
      producer.produce(
        topic,
        null,
        Buffer.from(bodyText, 'utf8'),
        keyText ?? null,
        undefined,
        undefined,
        headers,
      );
      affectedRows++;
    }
    // produce() above only queues into librdkafka's internal buffer — flush() is what actually
    // hands everything to the broker and blocks until it's drained (or the timeout elapses).
    await flushProducer(producer, 5000);
  } catch (err) {
    if (err instanceof AdapterError) throw err;
    throw mapError(err as LibrdKafkaError);
  } finally {
    await disconnectProducer(producer);
  }

  return { affectedRows };
}
