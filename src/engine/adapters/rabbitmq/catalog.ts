import { encodePath, type TreeNode } from '@shared/domain/tree';
import { abbreviateCount } from '@shared/format';
import type { OpCtx } from '../adapter';
import type { RabbitHandle } from './client';
import { request, requestAll } from './query';

interface VhostRow {
  name: string;
}

export interface QueueRow {
  name: string;
  vhost: string;
  type?: string;
  messages?: number;
  durable?: boolean;
  [key: string]: unknown;
}

export interface ExchangeRow {
  name: string;
  vhost: string;
  type: string;
  durable?: boolean;
  internal?: boolean;
  arguments?: Record<string, unknown>;
  [key: string]: unknown;
}

// D15: root level — one node per vhost the user can see, or the single scoped vhost (D11). Either
// way the tree's shape is identical, so paths, tabs and caches never branch on whether a
// connection is scoped.
export async function listVhosts(h: RabbitHandle, ctx: OpCtx): Promise<TreeNode[]> {
  if (h.vhostScope !== null) {
    return [
      {
        kind: 'database',
        name: h.vhostScope,
        path: encodePath([{ kind: 'database', name: h.vhostScope }]),
        hasChildren: true,
      },
    ];
  }
  const rows = await request<VhostRow[]>(h, ctx, { method: 'GET', segments: ['vhosts'] });
  return rows
    .map((row) => ({
      kind: 'database' as const,
      name: row.name,
      path: encodePath([{ kind: 'database', name: row.name }]),
      hasChildren: true,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function queueDetail(row: QueueRow): string {
  const type = row.type ?? 'classic';
  // Item 7 (regression pass, task batch P46-2): same K/M/B/T abbreviation every other connection
  // kind's tree count now uses — a busy queue's message count is exactly the "very long number"
  // the user flagged, same as a redis DB's key count or a SQL table's row estimate.
  const messages = typeof row.messages === 'number' ? abbreviateCount(row.messages) : '~';
  return `${messages} messages · ${type}`;
}

// D16: the nameless default exchange (name === '') is never listed — it has no bindings,
// arguments or policy to show, and its blank name cannot survive this app's own path/tab-title
// plumbing honestly (an empty path segment, a blank tab title). Every other amq.* built-in
// exchange is a real, named exchange users bind to on purpose, and stays.
function isDefaultExchange(row: ExchangeRow): boolean {
  return row.name === '';
}

async function listQueueNodes(h: RabbitHandle, ctx: OpCtx, vhost: string): Promise<TreeNode[]> {
  // D18: trimmed and paged — the untrimmed endpoint can return 50+ fields per queue, and this
  // level is fetched on every tree expand and every Refresh (F9's own reference warns about it).
  // enable_queue_totals keeps the message count in the trimmed response.
  const rows = await requestAll<QueueRow>(h, ctx, {
    method: 'GET',
    segments: ['queues', vhost],
    query: { disable_stats: 'true', enable_queue_totals: 'true' },
  });
  return rows
    .map((row) => ({
      kind: 'queue' as const,
      name: row.name,
      path: encodePath([
        { kind: 'database', name: vhost },
        { kind: 'queue', name: row.name },
      ]),
      hasChildren: false,
      detail: queueDetail(row),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function listExchangeNodes(h: RabbitHandle, ctx: OpCtx, vhost: string): Promise<TreeNode[]> {
  const rows = await requestAll<ExchangeRow>(h, ctx, {
    method: 'GET',
    segments: ['exchanges', vhost],
    query: { disable_stats: 'true' },
  });
  return rows
    .filter((row) => !isDefaultExchange(row))
    .map((row) => ({
      kind: 'exchange' as const,
      name: row.name,
      path: encodePath([
        { kind: 'database', name: vhost },
        { kind: 'exchange', name: row.name },
      ]),
      hasChildren: false,
      detail: row.type,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// D15/D33: one vhost's children — queues (the primary kind, what a user browses) then exchanges
// (auxiliary; the renderer's own GROUPED_KINDS folders them under "Exchanges", P19's rule for a
// primary/auxiliary kind pair). Sequential, not Promise.all — this op's ctx.setCommand() text
// should read as one queue request followed by one exchange request, not whichever settles last.
export async function listVhostChildren(
  h: RabbitHandle,
  ctx: OpCtx,
  vhost: string,
): Promise<TreeNode[]> {
  const queueNodes = await listQueueNodes(h, ctx, vhost);
  const exchangeNodes = await listExchangeNodes(h, ctx, vhost);
  return [...queueNodes, ...exchangeNodes];
}
