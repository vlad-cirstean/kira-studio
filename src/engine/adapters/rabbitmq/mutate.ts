import type { MutationPlan, MutationResult, MutationRowOp } from '../../../shared/domain/mutations';
import type { OpCtx } from '../adapter';
import { AdapterError, assertWritable } from '../errors';
import type { RabbitHandle } from './client';
import { encodeSegment, request } from './query';

// Sentinel keys (mirrors kafka/produce.ts's $key/$body/$headers, sqs/mutate.ts's own precedent):
// a new message is expressed through the existing relational-shaped MutationRowOp's `values`
// rather than widening the shared mutation schema.
const BODY_FIELD = '$body';
const HEADERS_FIELD = '$headers';
/** D25: defaults to the queue's own name when absent — the same default the management UI's own
 *  "publish to this queue" form uses (F15). */
const ROUTING_KEY_FIELD = '$routingKey';
/** D25: defaults to '' (the default exchange) when absent. */
const EXCHANGE_FIELD = '$exchange';
/** D32: a JSON object of extra AMQP basic properties (e.g. `{"delivery_mode":2}` for Persistent),
 *  merged with `$headers` under the wire body's own `properties` key (F24). */
const PROPERTIES_FIELD = '$properties';

// F15: the management surface's own invented spelling for the empty-named default exchange —
// there is no other way to address '' through this app's own path plumbing.
const DEFAULT_EXCHANGE_URL_NAME = 'amq.default';

export function exchangeUrlName(name: string): string {
  return name === '' ? DEFAULT_EXCHANGE_URL_NAME : name;
}

function parseJsonObject(
  raw: string | null | undefined,
  field: string,
): Record<string, unknown> | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AdapterError('E_QUERY', `malformed ${field} JSON`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new AdapterError('E_QUERY', `${field} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

interface PublishRequest {
  exchange: string;
  routingKey: string;
  body: {
    properties: Record<string, unknown>;
    routing_key: string;
    payload: string;
    payload_encoding: 'string';
  };
}

type InsertOp = Extract<MutationRowOp, { kind: 'insert' }>;

function buildPublish(op: InsertOp, queueName: string): PublishRequest {
  const bodyValue = op.values[BODY_FIELD];
  if (typeof bodyValue !== 'string') {
    throw new AdapterError('E_QUERY', `a new message requires a ${BODY_FIELD}`);
  }
  const headers = parseJsonObject(op.values[HEADERS_FIELD], HEADERS_FIELD);
  const extraProperties = parseJsonObject(op.values[PROPERTIES_FIELD], PROPERTIES_FIELD);
  const exchangeRaw = op.values[EXCHANGE_FIELD];
  const exchange = typeof exchangeRaw === 'string' ? exchangeRaw : '';
  const routingKeyRaw = op.values[ROUTING_KEY_FIELD];
  const routingKey =
    typeof routingKeyRaw === 'string' && routingKeyRaw !== '' ? routingKeyRaw : queueName;
  const properties: Record<string, unknown> = { ...extraProperties };
  if (headers) properties.headers = headers;

  return {
    exchange,
    routingKey,
    body: {
      properties,
      routing_key: routingKey,
      payload: bodyValue,
      payload_encoding: 'string',
    },
  };
}

function publishCommandText(vhost: string, publish: PublishRequest): string {
  const path = `/api/exchanges/${encodeSegment(vhost)}/${encodeSegment(exchangeUrlName(publish.exchange))}/publish`;
  return `POST ${path} ${JSON.stringify(publish.body)}`;
}

// D26: a plan mixing an insert with an update/delete is refused whole, before any request leaves
// the process — the same reason D27 checks read-only before any request too. A RabbitMQ message
// has no broker-assigned identity (F22) and AMQP has no per-message update or delete at any
// version (F25); this is not "not yet implemented".
const NO_IDENTITY_MESSAGE =
  'rabbitmq has no per-message update or delete — a message has no broker-assigned identity';

function assertPublishOnly(plan: MutationPlan): InsertOp[] {
  const inserts: InsertOp[] = [];
  for (const op of plan.ops) {
    if (op.kind !== 'insert') throw new AdapterError('E_UNSUPPORTED', NO_IDENTITY_MESSAGE);
    inserts.push(op);
  }
  return inserts;
}

/** Synchronous (Adapter rule 3): no network, no vhost/queue resolution beyond what the caller
 *  already has. D25: byte-identical to what mutate() actually sends for the same plan. */
export function preview(plan: MutationPlan, vhost: string, queueName: string): string[] {
  const inserts = assertPublishOnly(plan);
  return inserts.map((op) => publishCommandText(vhost, buildPublish(op, queueName)));
}

interface PublishResponse {
  routed: boolean;
}

export async function mutateQueue(
  h: RabbitHandle,
  vhost: string,
  queueName: string,
  readOnly: boolean,
  plan: MutationPlan,
  ctx: OpCtx,
): Promise<MutationResult> {
  assertWritable(readOnly);
  const inserts = assertPublishOnly(plan);

  let affectedRows = 0;
  for (const op of inserts) {
    const publish = buildPublish(op, queueName);
    const result = await request<PublishResponse>(h, ctx, {
      method: 'POST',
      segments: ['exchanges', vhost, exchangeUrlName(publish.exchange), 'publish'],
      body: publish.body,
      command: publishCommandText(vhost, publish),
    });
    // D25: a publish the broker accepted and routed nowhere has silently discarded the message
    // (or dead-lettered it) — reporting "sent" for that would violate "nothing silently dropped"
    // at the worst moment. The two real causes: the routing key matches no binding, or the
    // exchange has none.
    if (!result.routed) {
      throw new AdapterError(
        'E_QUERY',
        `message was not routed to any queue (exchange=${JSON.stringify(publish.exchange || '(default)')}, ` +
          `routing_key=${JSON.stringify(publish.routingKey)}) — the routing key matches no ` +
          `binding, or the exchange has none`,
      );
    }
    affectedRows++;
  }

  return { affectedRows };
}
