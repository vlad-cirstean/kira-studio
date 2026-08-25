import {
  createStreamPageBuilder,
  MAX_CELL_BYTES,
  type PagePosition,
  type StreamPage,
} from '@shared/protocol/page';
import type { OpCtx, ReadRequest } from '../adapter';
import { AdapterError } from '../errors';
import type { RabbitHandle } from './client';
import { request } from './query';

// F9's own documented ceiling for a list endpoint's page_size, reused as this adapter's own poll
// ceiling: every message in a `basic.get` batch is held unacked until the whole batch finishes
// (F11), so a much larger batch would make that many messages briefly invisible to real consumers.
const MAX_POLL_MESSAGES = 500;

interface GetMessageRow {
  payload_bytes: number;
  redelivered: boolean;
  exchange: string;
  routing_key: string;
  message_count: number;
  properties?: Record<string, unknown>;
  payload: string;
  payload_encoding: 'string' | 'base64';
}

function position(pageSize: number): PagePosition {
  // D20: a basic.get batch has no offset, no token and no resumable position — every poll is an
  // independent, non-resumable snapshot, SQS's own situation exactly.
  return {
    offset: null,
    pageSize,
    hasMore: false,
    nextToken: null,
    prevToken: null,
    strategy: 'batch',
  };
}

// F24: RabbitMQ records no receive time of its own — `properties.timestamp` (epoch seconds) is an
// optional, publisher-set value. A message with none has no time this adapter can honestly show.
function timestampIso(properties: Record<string, unknown>): string | null {
  const ts = properties.timestamp;
  if (typeof ts !== 'number') return null;
  return new Date(ts * 1000).toISOString();
}

function headersJson(properties: Record<string, unknown>): string {
  return JSON.stringify(properties.headers ?? {});
}

// D14: everything the endpoint returns that isn't the routing key, the headers or the payload
// itself lands here, under the broker's own field spellings (payload_bytes, not payloadBytes) —
// a translation layer would be a second vocabulary to get wrong.
function attrsJson(row: GetMessageRow, properties: Record<string, unknown>): string {
  const { headers: _headers, timestamp: _timestamp, ...restProperties } = properties;
  return JSON.stringify({
    exchange: row.exchange,
    redelivered: row.redelivered,
    payload_bytes: row.payload_bytes,
    payload_encoding: row.payload_encoding,
    message_count: row.message_count,
    ...restProperties,
  });
}

// D24: a stream-type queue's basic.get refusal (F13) is a permanent engine fact with the broker's
// own legible sentence already attached — surfaced as E_UNSUPPORTED rather than the generic
// E_QUERY every other rejected /get call gets.
function reclassifyStreamQueueRefusal(err: unknown): never {
  if (err instanceof AdapterError && /not supported by stream queues/i.test(err.message)) {
    throw new AdapterError('E_UNSUPPORTED', err.message, err);
  }
  throw err;
}

// D10/D21: never called automatically — always an explicit user-initiated poll (isBatch, D32).
// ackmode is always reject_requeue_true: nothing is removed, but the messages are genuinely
// delivered and requeued, marked redelivered on the next poll (F12) — scenario 12 is the proof.
export async function pollQueue(
  h: RabbitHandle,
  vhost: string,
  queue: string,
  req: Omit<ReadRequest, 'path'>,
  ctx: OpCtx,
): Promise<StreamPage> {
  const count = Math.min(req.pageSize, MAX_POLL_MESSAGES);
  let rows: GetMessageRow[];
  try {
    rows = await request<GetMessageRow[]>(h, ctx, {
      method: 'POST',
      segments: ['queues', vhost, queue, 'get'],
      body: {
        count,
        ackmode: 'reject_requeue_true',
        encoding: 'auto',
        // D22: one byte over the cell budget, not exactly at it — a value the *server* truncated
        // to precisely MAX_CELL_BYTES would arrive under this adapter's own truncation threshold
        // and never get marked truncated (the page builder only notices its own truncation).
        // Asking for one byte more means an oversize payload arrives over budget, so the page
        // builder's own appendValue (default maxBytes = MAX_CELL_BYTES) truncates it and marks
        // the row — no new mechanism, just the right request.
        truncate: MAX_CELL_BYTES + 1,
      },
      command: `POST /api/queues/${vhost}/${queue}/get (count=${count})`,
    });
  } catch (err) {
    return reclassifyStreamQueueRefusal(err);
  }

  const builder = createStreamPageBuilder({ visibilityTimeoutSeconds: null });
  for (const row of rows) {
    const properties = row.properties ?? {};
    builder.push({
      key: row.routing_key || null,
      headers: headersJson(properties),
      attrs: attrsJson(row, properties),
      timestamp: timestampIso(properties),
      // F10: the broker itself already returns a string — plain text if the payload was valid
      // UTF-8, base64 text otherwise (payload_encoding says which) — so the body column holds
      // exactly what the broker sent, never re-decoded here.
      body: row.payload,
    });
  }
  return builder.finish(position(req.pageSize));
}

interface QueueDetailRow {
  messages?: number;
}

// D23: `messages` describes a live queue any consumer or publisher can change between this
// request and the next — never claimed exact, the same honesty SQS's own approximate count owes.
export async function countQueue(
  h: RabbitHandle,
  vhost: string,
  queue: string,
  ctx: OpCtx,
): Promise<{ value: number; exact: boolean }> {
  const row = await request<QueueDetailRow>(h, ctx, {
    method: 'GET',
    segments: ['queues', vhost, queue],
  });
  return { value: row.messages ?? 0, exact: false };
}
