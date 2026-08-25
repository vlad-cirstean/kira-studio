import type { DefinitionSection, ObjectDefinition } from '@shared/domain/definition';
import { encodePath } from '@shared/domain/tree';
import type { OpCtx } from '../adapter';
import type { RabbitHandle } from './client';
import { exchangeUrlName } from './mutate';
import { request } from './query';

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '(none)';
  if (typeof value === 'string') return value || '(none)';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function argumentsRows(args: Record<string, unknown> | undefined): DefinitionSection['rows'] {
  const entries = Object.entries(args ?? {});
  if (entries.length === 0) return [{ name: '(none set)', value: '', detail: null }];
  return entries.map(([name, value]) => ({ name, value: formatValue(value), detail: null }));
}

interface ConsumerDetailRow {
  consumer_tag?: string;
  channel_details?: { name?: string };
  ack_required?: boolean;
  prefetch_count?: number;
}

interface QueueDetail {
  name: string;
  vhost: string;
  type?: string;
  durable?: boolean;
  auto_delete?: boolean;
  exclusive?: boolean;
  state?: string;
  node?: string;
  leader?: string;
  consumers?: number;
  consumer_details?: ConsumerDetailRow[];
  messages?: number;
  messages_ready?: number;
  messages_unacknowledged?: number;
  message_bytes?: number;
  policy?: string | null;
  effective_policy_definition?: Record<string, unknown>;
  arguments?: Record<string, unknown>;
  [key: string]: unknown;
}

interface BindingRow {
  source: string;
  destination: string;
  destination_type: 'queue' | 'exchange';
  routing_key: string;
  arguments?: Record<string, unknown>;
  properties_key?: string;
}

interface ExchangeDetail {
  name: string;
  vhost: string;
  type: string;
  durable?: boolean;
  auto_delete?: boolean;
  internal?: boolean;
  policy?: string | null;
  arguments?: Record<string, unknown>;
  [key: string]: unknown;
}

function bindingRows(
  bindings: BindingRow[],
  side: 'queue' | 'exchange',
): DefinitionSection['rows'] {
  if (bindings.length === 0) return [{ name: '(none)', value: '', detail: null }];
  return bindings.map((b) => ({
    name: side === 'queue' ? b.source || '(default exchange)' : b.destination,
    value: b.routing_key || '(none)',
    detail: Object.keys(b.arguments ?? {}).length > 0 ? JSON.stringify(b.arguments) : null,
  }));
}

// D31: three sentences, each stating a fact the view would otherwise imply wrongly.
const MESSAGE_COUNT_NOTE =
  'Message counts are a live snapshot, not a transactional count — they can change between one request and the next.';
const REQUEUE_NOTE =
  'Reading messages through the management API requeues them and marks them redelivered — nothing is removed.';
const BINDING_NAME_NOTE =
  "A binding has no name of its own — the key shown here is one the management API synthesises from the binding's own properties.";

// D29: a queue's definition — Queue / Arguments / Bindings / Consumers, two requests total
// (consumer_details and effective_policy_definition arrive on the single-queue GET for free).
export async function buildQueueDefinition(
  h: RabbitHandle,
  ctx: OpCtx,
  vhost: string,
  name: string,
): Promise<ObjectDefinition> {
  const detail = await request<QueueDetail>(h, ctx, {
    method: 'GET',
    segments: ['queues', vhost, name],
  });
  const bindings = await request<BindingRow[]>(h, ctx, {
    method: 'GET',
    segments: ['queues', vhost, name, 'bindings'],
  });

  const queueSection: DefinitionSection = {
    title: 'Queue',
    rows: [
      { name: 'Type', value: detail.type ?? 'classic', detail: null },
      { name: 'Durable', value: String(!!detail.durable), detail: null },
      { name: 'Auto-delete', value: String(!!detail.auto_delete), detail: null },
      { name: 'Exclusive', value: String(!!detail.exclusive), detail: null },
      { name: 'State', value: detail.state ?? '(unknown)', detail: null },
      { name: 'Node', value: detail.node ?? '(unknown)', detail: null },
      ...(detail.leader ? [{ name: 'Leader', value: detail.leader, detail: null }] : []),
      { name: 'Consumers', value: String(detail.consumers ?? 0), detail: null },
      { name: 'Messages ready', value: String(detail.messages_ready ?? 0), detail: null },
      {
        name: 'Messages unacknowledged',
        value: String(detail.messages_unacknowledged ?? 0),
        detail: null,
      },
      { name: 'Messages total', value: String(detail.messages ?? 0), detail: null },
      { name: 'Message bytes', value: String(detail.message_bytes ?? 0), detail: null },
      { name: 'Policy', value: detail.policy || '(none)', detail: null },
      {
        name: 'Effective policy definition',
        value:
          detail.effective_policy_definition &&
          Object.keys(detail.effective_policy_definition).length > 0
            ? JSON.stringify(detail.effective_policy_definition)
            : '(none)',
        detail: null,
      },
    ],
  };

  const argumentsSection: DefinitionSection = {
    title: 'Arguments',
    rows: argumentsRows(detail.arguments),
  };

  const bindingsSection: DefinitionSection = {
    title: 'Bindings',
    rows: bindingRows(bindings, 'queue'),
  };

  const consumersSection: DefinitionSection = {
    title: 'Consumers',
    rows:
      (detail.consumer_details ?? []).length === 0
        ? [{ name: '(none)', value: '', detail: null }]
        : (detail.consumer_details ?? []).map((c) => ({
            name: c.consumer_tag ?? '(unknown)',
            value: c.channel_details?.name ?? '(unknown channel)',
            detail: `ack ${c.ack_required ? 'required' : 'none'} · prefetch ${c.prefetch_count ?? 0}`,
          })),
  };

  return {
    path: encodePath([
      { kind: 'database', name: vhost },
      { kind: 'queue', name },
    ]),
    kind: 'queue',
    qualifiedName: name,
    language: 'json',
    statements: [JSON.stringify(detail, null, 2)],
    origin: 'server',
    notes: [MESSAGE_COUNT_NOTE, REQUEUE_NOTE, BINDING_NAME_NOTE],
    constraints: [],
    documentSchema: null,
    sections: [queueSection, argumentsSection, bindingsSection, consumersSection],
    generatedAt: new Date().toISOString(),
  };
}

// D30: an exchange's definition — Exchange / Arguments / Bindings from this exchange / Bindings to
// this exchange (both ends, D17) — three requests.
export async function buildExchangeDefinition(
  h: RabbitHandle,
  ctx: OpCtx,
  vhost: string,
  name: string,
): Promise<ObjectDefinition> {
  const urlName = exchangeUrlName(name);
  const detail = await request<ExchangeDetail>(h, ctx, {
    method: 'GET',
    segments: ['exchanges', vhost, urlName],
  });
  const bindingsFrom = await request<BindingRow[]>(h, ctx, {
    method: 'GET',
    segments: ['exchanges', vhost, urlName, 'bindings', 'source'],
  });
  const bindingsTo = await request<BindingRow[]>(h, ctx, {
    method: 'GET',
    segments: ['exchanges', vhost, urlName, 'bindings', 'destination'],
  });

  const exchangeSection: DefinitionSection = {
    title: 'Exchange',
    rows: [
      { name: 'Type', value: detail.type, detail: null },
      { name: 'Durable', value: String(!!detail.durable), detail: null },
      { name: 'Auto-delete', value: String(!!detail.auto_delete), detail: null },
      { name: 'Internal', value: String(!!detail.internal), detail: null },
      { name: 'Policy', value: detail.policy || '(none)', detail: null },
    ],
  };

  const argumentsSection: DefinitionSection = {
    title: 'Arguments',
    rows: argumentsRows(detail.arguments),
  };

  const bindingsFromSection: DefinitionSection = {
    title: 'Bindings from this exchange',
    rows: bindingRows(bindingsFrom, 'exchange'),
  };

  const bindingsToSection: DefinitionSection = {
    title: 'Bindings to this exchange',
    rows: bindingsTo.map((b) => ({
      name: b.source || '(default exchange)',
      value: b.routing_key || '(none)',
      detail: null,
    })),
  };

  return {
    path: encodePath([
      { kind: 'database', name: vhost },
      { kind: 'exchange', name },
    ]),
    kind: 'exchange',
    qualifiedName: name,
    language: 'json',
    statements: [JSON.stringify(detail, null, 2)],
    origin: 'server',
    notes: [BINDING_NAME_NOTE],
    constraints: [],
    documentSchema: null,
    sections: [exchangeSection, argumentsSection, bindingsFromSection, bindingsToSection],
    generatedAt: new Date().toISOString(),
  };
}
