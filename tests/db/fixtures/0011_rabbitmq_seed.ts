// P37 D37/D38: seeded over the management HTTP API with `fetch`, from the test process — no
// client, no `docker exec`, no CLI. There is no client to keep out of this process the way P32's
// Kafka seed kept a native driver out of it (F5) — `fetch` is a global in both runtimes this repo
// runs tests under — and seeding over HTTP exercises the same surface the adapter itself reads.

export const DEFAULT_VHOST = '/';
export const KIRA_VHOST = 'kira';

export const ORDERS_QUEUE = 'orders';
export const ORDERS_MESSAGE_COUNT = 6;
export const EMPTY_QUEUE = 'empty-queue';
export const BIG_QUEUE = 'big-queue';
export const BIG_QUEUE_MESSAGE_COUNT = 2000; // for the 500-message poll clamp, D20
export const BINARY_QUEUE = 'binary-queue';
export const QUORUM_QUEUE = 'quorum-queue';
export const STREAM_QUEUE = 'stream-queue'; // basic.get refusal, D24
export const DLX_QUEUE = 'dlx-queue';
export const WEIRD_NAME_QUEUE = 'weird/name ✓'; // percent-encoding through the tree, D8

export const ORDERS_DIRECT_EXCHANGE = 'orders.direct';
export const EVENTS_FANOUT_EXCHANGE = 'events.fanout';
export const EVENTS_TOPIC_EXCHANGE = 'events.topic';
export const PROPS_HEADERS_EXCHANGE = 'props.headers';
export const ALT_EXCHANGE = 'alt.exchange';

export const ORDERS_POLICY = 'orders-ttl';

const ADMIN_USER = 'guest';
const ADMIN_PASS = 'guest';

interface MgmtOptions {
  method?: 'GET' | 'PUT' | 'POST' | 'DELETE';
  body?: unknown;
}

async function mgmt(baseUrl: string, segments: string[], opts: MgmtOptions = {}): Promise<void> {
  const path = segments.map(encodeURIComponent).join('/');
  const auth = Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`, 'utf8').toString('base64');
  const res = await fetch(`${baseUrl}/api/${path}`, {
    method: opts.method ?? 'PUT',
    headers: {
      Authorization: `Basic ${auth}`,
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `management API ${opts.method ?? 'PUT'} /api/${path} -> ${res.status}: ${text}`,
    );
  }
}

async function ensureVhost(baseUrl: string, vhost: string): Promise<void> {
  if (vhost === DEFAULT_VHOST) return; // always exists
  await mgmt(baseUrl, ['vhosts', vhost]);
  // A freshly created vhost grants no permissions to any user — guest needs an explicit grant to
  // declare queues/exchanges and publish into it.
  await mgmt(baseUrl, ['permissions', vhost, ADMIN_USER], {
    body: { configure: '.*', write: '.*', read: '.*' },
  });
}

async function declareQueue(
  baseUrl: string,
  vhost: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<void> {
  await mgmt(baseUrl, ['queues', vhost, name], {
    body: { durable: true, arguments: args },
  });
}

async function declareExchange(
  baseUrl: string,
  vhost: string,
  name: string,
  type: string,
): Promise<void> {
  await mgmt(baseUrl, ['exchanges', vhost, name], {
    body: { type, durable: true },
  });
}

async function bindQueue(
  baseUrl: string,
  vhost: string,
  exchange: string,
  queue: string,
  routingKey: string,
): Promise<void> {
  await mgmt(baseUrl, ['bindings', vhost, 'e', exchange, 'q', queue], {
    method: 'POST',
    body: { routing_key: routingKey },
  });
}

async function bindExchange(
  baseUrl: string,
  vhost: string,
  source: string,
  destination: string,
  routingKey: string,
): Promise<void> {
  await mgmt(baseUrl, ['bindings', vhost, 'e', source, 'e', destination], {
    method: 'POST',
    body: { routing_key: routingKey },
  });
}

async function publish(
  baseUrl: string,
  vhost: string,
  exchange: string,
  routingKey: string,
  payload: string,
  properties: Record<string, unknown> = {},
  payloadEncoding: 'string' | 'base64' = 'string',
): Promise<void> {
  await mgmt(baseUrl, ['exchanges', vhost, exchange === '' ? 'amq.default' : exchange, 'publish'], {
    method: 'POST',
    body: {
      properties,
      routing_key: routingKey,
      payload,
      payload_encoding: payloadEncoding,
    },
  });
}

async function seedOrdersQueue(baseUrl: string): Promise<void> {
  await declareQueue(baseUrl, KIRA_VHOST, ORDERS_QUEUE);
  await declareExchange(baseUrl, KIRA_VHOST, ORDERS_DIRECT_EXCHANGE, 'direct');
  await bindQueue(baseUrl, KIRA_VHOST, ORDERS_DIRECT_EXCHANGE, ORDERS_QUEUE, ORDERS_QUEUE);
  for (let i = 0; i < ORDERS_MESSAGE_COUNT; i++) {
    await publish(
      baseUrl,
      KIRA_VHOST,
      ORDERS_DIRECT_EXCHANGE,
      ORDERS_QUEUE,
      JSON.stringify({ seq: i }),
      {
        headers: { source: 'seed', seq: i },
        correlation_id: `order-${i}`,
        timestamp: Math.floor(Date.now() / 1000),
      },
    );
  }
}

async function seedBigQueue(baseUrl: string): Promise<void> {
  await declareQueue(baseUrl, KIRA_VHOST, BIG_QUEUE);
  for (let i = 0; i < BIG_QUEUE_MESSAGE_COUNT; i++) {
    await publish(baseUrl, KIRA_VHOST, '', BIG_QUEUE, JSON.stringify({ seq: i }));
  }
}

async function seedBinaryQueue(baseUrl: string): Promise<void> {
  await declareQueue(baseUrl, KIRA_VHOST, BINARY_QUEUE);
  // Non-UTF-8 bytes (an invalid continuation sequence) — the management API returns this message
  // base64-encoded (F10), which is the case D22/scenario-17 exercises.
  const invalidUtf8 = Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x02]);
  await publish(
    baseUrl,
    KIRA_VHOST,
    '',
    BINARY_QUEUE,
    invalidUtf8.toString('base64'),
    {},
    'base64',
  );
  // 100 KB, over MAX_CELL_BYTES (64 KB) — proves truncation is marked, not silently clipped.
  const bigPayload = 'x'.repeat(100 * 1024);
  await publish(baseUrl, KIRA_VHOST, '', BINARY_QUEUE, bigPayload);
}

async function seedQuorumQueue(baseUrl: string): Promise<void> {
  await declareQueue(baseUrl, KIRA_VHOST, QUORUM_QUEUE, { 'x-queue-type': 'quorum' });
  await publish(baseUrl, KIRA_VHOST, '', QUORUM_QUEUE, 'hello from a quorum queue');
}

async function seedStreamQueue(baseUrl: string): Promise<void> {
  await declareQueue(baseUrl, KIRA_VHOST, STREAM_QUEUE, {
    'x-queue-type': 'stream',
    'x-max-length-bytes': 20_000_000,
  });
  await publish(baseUrl, KIRA_VHOST, '', STREAM_QUEUE, 'hello from a stream queue');
}

async function seedDlxQueue(baseUrl: string): Promise<void> {
  await declareQueue(baseUrl, KIRA_VHOST, DLX_QUEUE, {
    'x-message-ttl': 60_000,
    'x-dead-letter-exchange': ALT_EXCHANGE,
  });
  await declareExchange(baseUrl, KIRA_VHOST, ALT_EXCHANGE, 'fanout');
}

async function seedWeirdNameQueue(baseUrl: string): Promise<void> {
  await declareQueue(baseUrl, KIRA_VHOST, WEIRD_NAME_QUEUE);
  await publish(baseUrl, KIRA_VHOST, '', WEIRD_NAME_QUEUE, 'hello from a weirdly-named queue');
}

async function seedDefaultVhostQueue(baseUrl: string): Promise<void> {
  // Proves the %2F encoding end to end (D8/D11) — a queue that lives under the default vhost
  // itself, not under the seeded 'kira' vhost.
  await declareQueue(baseUrl, DEFAULT_VHOST, ORDERS_QUEUE);
  await publish(baseUrl, DEFAULT_VHOST, '', ORDERS_QUEUE, 'hello from the default vhost');
}

async function seedEventsTopology(baseUrl: string): Promise<void> {
  await declareExchange(baseUrl, KIRA_VHOST, EVENTS_FANOUT_EXCHANGE, 'fanout');
  await declareExchange(baseUrl, KIRA_VHOST, EVENTS_TOPIC_EXCHANGE, 'topic');
  await declareExchange(baseUrl, KIRA_VHOST, PROPS_HEADERS_EXCHANGE, 'headers');
  // Exchange-to-exchange, the binding shape D30's "Bindings to this exchange" section exists to
  // surface (invisible from events.fanout's own "Bindings from" side otherwise).
  await bindExchange(baseUrl, KIRA_VHOST, EVENTS_FANOUT_EXCHANGE, EVENTS_TOPIC_EXCHANGE, '');
}

async function seedOrdersPolicy(baseUrl: string): Promise<void> {
  await mgmt(baseUrl, ['policies', KIRA_VHOST, ORDERS_POLICY], {
    body: {
      pattern: `^${ORDERS_QUEUE}$`,
      definition: { 'message-ttl': 3_600_000 },
      'apply-to': 'queues',
      priority: 0,
    },
  });
}

// D38: builds the full topology every scenario in §5 earns — two vhosts, eight queues (one under
// the default vhost, seven under 'kira'), five exchanges, an exchange-to-exchange binding and one
// policy. `baseUrl` is the management API's own base (e.g. http://localhost:15672).
export async function seedRabbitMq(baseUrl: string): Promise<void> {
  await ensureVhost(baseUrl, KIRA_VHOST);
  await declareQueue(baseUrl, KIRA_VHOST, EMPTY_QUEUE);
  await seedDefaultVhostQueue(baseUrl);
  await seedOrdersQueue(baseUrl);
  await seedEventsTopology(baseUrl);
  await seedOrdersPolicy(baseUrl);
  await seedBigQueue(baseUrl);
  await seedBinaryQueue(baseUrl);
  await seedQuorumQueue(baseUrl);
  await seedStreamQueue(baseUrl);
  await seedDlxQueue(baseUrl);
  await seedWeirdNameQueue(baseUrl);
}
