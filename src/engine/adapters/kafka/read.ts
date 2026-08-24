import type { Assignment, EofEvent, KafkaJS, Message } from '@confluentinc/kafka-javascript';
import { KafkaConsumer } from '@confluentinc/kafka-javascript';
import { parseKafkaStreamFilter } from '../../../shared/domain/streamFilter';
import {
  createStreamPageBuilder,
  type PagePosition,
  type StreamPage,
} from '../../../shared/protocol/page';
import type { OpCtx, ReadRequest } from '../adapter';
import { AdapterError } from '../errors';
import { decodePageToken, encodePageToken, requestFingerprint } from '../sql-text';
import type { KafkaClientHandle } from './client';
import { mapKafkaError } from './errors';

interface PartitionWindow {
  partition: number;
  next: string; // offset to seek to / resume from
  end: string; // frozen high watermark for this browse (never re-fetched mid-browse, D7)
}

// P32 D19: required by librdkafka for any consumer (INTRODUCTION.md — "the group.id and
// bootstrap.servers properties are required for a consumer") and never joined: a group is joined
// by subscribe()/run(), which this browse never calls (F13/F13a, verified against the vendored
// librdkafka C source, not just the JS docs). Can be a constant again (the pre-P32 code minted a
// fresh UUID per browse) precisely because no group is ever created on the broker — the random
// suffix existed only to keep concurrent browses out of each other's rebalances, which cannot
// happen once nothing here ever rebalances.
const BROWSE_GROUP_ID = 'kira-studio-browse';
// One poll's fetch window — also the worst-case latency between an abort and the loop noticing
// (D22) and between a window that can never fill and the empty-poll counter noticing it (D21).
const POLL_TIMEOUT_MS = 1_000;
// Consecutive empty polls that end a browse whose windows can never be filled — a compacted or
// retention-deleted range inside [next, end) (D21).
const MAX_EMPTY_POLLS = 2;

// P32 D24/F15.3: the native consumer's Message.headers is an array of single-pair objects
// ([{k1:v1}, {k2:v2}]), not kafkajs's Record — folded back into the wire shape's own
// Record<string, string | string[]> (promoting a repeated key to an array, the existing
// string[] case) so the `headers` column's contract is unchanged for the stream view and
// produce.ts's own $headers round trip.
function headersToPlain(headers: Message['headers']): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  if (!headers) return out;
  for (const pair of headers) {
    for (const [key, raw] of Object.entries(pair)) {
      const value = Buffer.isBuffer(raw) ? raw.toString('utf8') : raw;
      const existing = out[key];
      if (existing === undefined) out[key] = value;
      else if (Array.isArray(existing)) existing.push(value);
      else out[key] = [existing, value];
    }
  }
  return out;
}

function finishPosition(
  windows: PartitionWindow[],
  hasMore: boolean,
  fingerprint: string,
  pageSize: number,
): PagePosition {
  return {
    offset: null,
    pageSize,
    hasMore,
    nextToken: hasMore ? encodePageToken([JSON.stringify(windows)], fingerprint) : null,
    prevToken: null,
    strategy: 'offsetWindow',
  };
}

// P32 D20: unchanged — this was always admin-side, and the compat admin keeps
// fetchTopicOffsets/fetchTopicOffsetsByTimestamp with the same signature and return shape (F11).
// D-filter: `rawFilter` is StreamView.vue's JSON-encoded KafkaStreamFilter (offset/partition/
// timestamp), carried through the generic `filter` field — only ever consulted for a *fresh*
// browse (a token-continued page's windows were already resolved once, per the D7 comment on
// PartitionWindow, and re-applying the filter there would just be wrong once the user has paged
// partway through). `partitions` narrows which partitions this browse even considers; `timestampMs`
// (if set) wins over `offset` and reseeds via the admin's own `fetchTopicOffsetsByTimestamp`.
async function freshWindows(
  admin: KafkaJS.Admin,
  topic: string,
  rawFilter: string | null,
  ctx: OpCtx,
): Promise<PartitionWindow[]> {
  let offsets: { partition: number; high: string; low: string }[];
  try {
    offsets = await admin.fetchTopicOffsets(topic);
  } catch (err) {
    throw mapKafkaError(err);
  }
  if (ctx.signal.aborted) throw new AdapterError('E_CANCELLED', 'operation was cancelled');

  let filter: ReturnType<typeof parseKafkaStreamFilter>;
  try {
    filter = parseKafkaStreamFilter(rawFilter);
  } catch {
    throw new AdapterError('E_QUERY', 'malformed stream filter');
  }

  let selected = offsets;
  if (filter.partitions.length > 0) {
    // "any of these partitions" — a single entry narrows to exactly one, same as the old
    // single-partition filter; more than one is a union, not an intersection.
    const wanted = new Set(filter.partitions);
    selected = selected.filter((o) => wanted.has(o.partition));
    if (selected.length === 0) {
      throw new AdapterError(
        'E_QUERY',
        `topic ${topic} has no partition(s) ${filter.partitions.join(', ')}`,
      );
    }
  }

  const start = new Map(selected.map((o): [number, string] => [o.partition, o.low]));
  if (filter.timestampMs !== null) {
    let byTimestamp: { partition: number; offset: string }[];
    try {
      byTimestamp = await admin.fetchTopicOffsetsByTimestamp(topic, filter.timestampMs);
    } catch (err) {
      throw mapKafkaError(err);
    }
    if (ctx.signal.aborted) throw new AdapterError('E_CANCELLED', 'operation was cancelled');
    for (const entry of byTimestamp) {
      if (start.has(entry.partition)) start.set(entry.partition, entry.offset);
    }
  } else if (filter.offset !== null) {
    let requested: bigint;
    try {
      requested = BigInt(filter.offset);
    } catch {
      throw new AdapterError('E_QUERY', `malformed offset filter: "${filter.offset}"`);
    }
    for (const o of selected) {
      const lo = BigInt(o.low);
      const hi = BigInt(o.high);
      const clamped = requested < lo ? o.low : requested > hi ? o.high : requested.toString();
      start.set(o.partition, clamped);
    }
  }

  return selected.map((o) => ({
    partition: o.partition,
    next: start.get(o.partition) ?? o.low,
    end: o.high,
  }));
}

// P32 D23: the native API types offsets as `number` while the app's own contract is int64-as-
// decimal-string (shared/domain/streamFilter.ts) — converting at exactly this one boundary keeps
// the rest of the pipeline (token, filter, attrs column) unchanged. Not theoretical hygiene:
// silently truncating an offset would produce a page of plausible-but-wrong messages, the worst
// failure mode a DB client can have. Nine quadrillion messages in one partition is not reachable
// in practice, which is why an explicit error is the right response rather than a fallback path.
function toNativeOffset(decimalOffset: string): number {
  const value = Number(decimalOffset);
  if (!Number.isSafeInteger(value)) {
    throw new AdapterError(
      'E_UNSUPPORTED',
      `offset ${decimalOffset} exceeds what this adapter can address as a JS number`,
    );
  }
  return value;
}

function connectConsumer(consumer: KafkaConsumer): Promise<void> {
  return new Promise((resolve, reject) => {
    consumer.connect(undefined, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function disconnectConsumer(consumer: KafkaConsumer): Promise<void> {
  return new Promise((resolve) => {
    consumer.disconnect(() => resolve());
  });
}

function consumeBatch(consumer: KafkaConsumer, n: number): Promise<Message[]> {
  return new Promise((resolve, reject) => {
    consumer.consume(n, (err, messages) => {
      if (err) reject(err);
      else resolve(messages ?? []);
    });
  });
}

// P32 D19-D22 — the core commit: the browse consumer never subscribes. It is constructed with a
// constant group.id, enable.auto.commit/enable.auto.offset.store off, enable.partition.eof on,
// auto.offset.reset: 'error', then assign()s exactly the partitions in `remaining` at their start
// offsets and consume(n, cb)s until the page is full, every window drained, every remaining
// partition EOF, MAX_EMPTY_POLLS consecutive empty polls, or abort. No JoinGroup, no SyncGroup, no
// Heartbeat, no LeaveGroup, no OffsetCommit, no OffsetFetch — the broker never creates group state
// and `kira-studio-browse` never appears in listGroups() (P10's D6 promise, now structural).
export async function readTopic(
  handle: KafkaClientHandle,
  topic: string,
  req: Omit<ReadRequest, 'path'>,
  ctx: OpCtx,
): Promise<StreamPage> {
  if (req.cursor.mode === 'before') {
    throw new AdapterError(
      'E_UNSUPPORTED',
      'kafka offset-window pagination is forward-only; there is no previous page',
    );
  }
  const fingerprint = requestFingerprint({ topic, pageSize: req.pageSize, filter: req.filter });
  const windows =
    req.cursor.mode === 'after'
      ? (JSON.parse(decodePageToken(req.cursor.token, fingerprint)[0]) as PartitionWindow[])
      : await freshWindows(handle.admin, topic, req.filter, ctx);

  const remaining = windows.filter((w) => BigInt(w.next) < BigInt(w.end));
  if (remaining.length === 0) {
    const builder = createStreamPageBuilder({ visibilityTimeoutSeconds: null });
    return builder.finish(finishPosition(windows, false, fingerprint, req.pageSize));
  }
  if (ctx.signal.aborted) throw new AdapterError('E_CANCELLED', 'operation was cancelled');

  const consumer = new KafkaConsumer(
    {
      ...handle.rdConfig,
      'group.id': BROWSE_GROUP_ID,
      'enable.auto.commit': false,
      'enable.auto.offset.store': false,
      'enable.partition.eof': true,
    } as never,
    { 'auto.offset.reset': 'error' } as never,
  );
  consumer.setDefaultConsumeTimeout(POLL_TIMEOUT_MS);

  const eofPartitions = new Set<number>();
  consumer.on('partition.eof', (ev: EofEvent) => {
    eofPartitions.add(ev.partition);
  });

  // P32 D22: consumer.disconnect() is the whole cancel mechanism now — stop() no longer exists on
  // this client, "the user must disconnect the consumer" (F14/MIGRATION.md). Disconnect is
  // strictly stronger than the old stop-then-disconnect pair since it tears the client down
  // rather than parking it. Adapter.cancel() stays a permanent no-op (P10's D6/D14) — this signal
  // bridge is the mechanism.
  const onAbort = (): void => {
    void disconnectConsumer(consumer);
  };
  ctx.signal.addEventListener('abort', onAbort, { once: true });

  try {
    ctx.setCommand(`browse ${topic} (${remaining.length} partition(s) of ${windows.length})`);
    await connectConsumer(consumer);

    const assignments: Assignment[] = remaining.map((w) => ({
      topic,
      partition: w.partition,
      offset: toNativeOffset(w.next),
    }));
    consumer.assign(assignments);

    const builder = createStreamPageBuilder({ visibilityTimeoutSeconds: null });
    const cursor = new Map(windows.map((w): [number, PartitionWindow] => [w.partition, { ...w }]));
    const remainingPartitions = new Set(remaining.map((w) => w.partition));
    let collected = 0;
    let emptyPolls = 0;

    const allDone = (): boolean =>
      [...cursor.values()].every((w) => BigInt(w.next) >= BigInt(w.end));
    const allEof = (): boolean => [...remainingPartitions].every((p) => eofPartitions.has(p));

    while (collected < req.pageSize && !allDone() && !allEof()) {
      if (ctx.signal.aborted) throw new AdapterError('E_CANCELLED', 'operation was cancelled');
      const messages = await consumeBatch(consumer, req.pageSize - collected);
      if (messages.length === 0) {
        emptyPolls++;
        if (emptyPolls >= MAX_EMPTY_POLLS) break;
        continue;
      }
      emptyPolls = 0;
      for (const message of messages) {
        if (collected >= req.pageSize) break;
        const w = cursor.get(message.partition);
        if (!w) continue;
        const offset = BigInt(message.offset);
        if (offset < BigInt(w.next) || offset >= BigInt(w.end)) continue;
        builder.push({
          key: message.key
            ? Buffer.isBuffer(message.key)
              ? message.key.toString('utf8')
              : message.key
            : null,
          headers: JSON.stringify(headersToPlain(message.headers)),
          attrs: JSON.stringify({ partition: message.partition, offset: String(message.offset) }),
          timestamp: message.timestamp ? new Date(message.timestamp).toISOString() : null,
          body: message.value ? message.value.toString('utf8') : '',
        });
        collected++;
        w.next = String(offset + 1n);
      }
    }

    if (ctx.signal.aborted) throw new AdapterError('E_CANCELLED', 'operation was cancelled');

    const nextWindows = [...cursor.values()];
    const hasMore = nextWindows.some((w) => BigInt(w.next) < BigInt(w.end));
    return builder.finish(finishPosition(nextWindows, hasMore, fingerprint, req.pageSize));
  } catch (err) {
    throw mapKafkaError(err);
  } finally {
    ctx.signal.removeEventListener('abort', onAbort);
    await disconnectConsumer(consumer);
  }
}

// P32 D20: unchanged — exact via fetchTopicOffsets's high/low watermarks, summed across every
// partition.
export async function countTopic(
  admin: KafkaJS.Admin,
  topic: string,
  ctx: OpCtx,
): Promise<{ value: number; exact: boolean }> {
  let offsets: { high: string; low: string }[];
  try {
    offsets = await admin.fetchTopicOffsets(topic);
  } catch (err) {
    throw mapKafkaError(err);
  }
  if (ctx.signal.aborted) throw new AdapterError('E_CANCELLED', 'operation was cancelled');
  const value = offsets.reduce((sum, o) => sum + Number(BigInt(o.high) - BigInt(o.low)), 0);
  return { value, exact: true };
}
