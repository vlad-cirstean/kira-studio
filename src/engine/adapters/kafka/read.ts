import type { Admin, IHeaders, Kafka } from 'kafkajs';
import { parseKafkaStreamFilter } from '../../../shared/domain/streamFilter';
import {
  createStreamPageBuilder,
  type PagePosition,
  type StreamPage,
} from '../../../shared/protocol/page';
import type { OpCtx, ReadRequest } from '../adapter';
import { AdapterError } from '../errors';
import { decodePageToken, encodePageToken, requestFingerprint } from '../sql-text';
import { mapKafkaError } from './errors';

interface PartitionWindow {
  partition: number;
  next: string; // offset to seek to / resume from
  end: string; // frozen high watermark for this browse (never re-fetched mid-browse, D7)
}

function headersToPlain(headers: IHeaders | undefined): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  if (!headers) return out;
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    out[key] = Array.isArray(value)
      ? value.map((v) => (Buffer.isBuffer(v) ? v.toString('utf8') : v))
      : Buffer.isBuffer(value)
        ? value.toString('utf8')
        : value;
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

// D-filter: `rawFilter` is StreamView.vue's JSON-encoded KafkaStreamFilter (offset/partition/
// timestamp), carried through the generic `filter` field — only ever consulted for a *fresh*
// browse (a token-continued page's windows were already resolved once, per the D7 comment on
// PartitionWindow, and re-applying the filter there would just be wrong once the user has paged
// partway through). `partitions` narrows which partitions this browse even considers; `timestampMs`
// (if set) wins over `offset` and reseeds via kafkajs's own `fetchTopicOffsetsByTimestamp` — the
// exact API this adapter would otherwise have needed a consumer-side `seek`/`offsetsForTimes`
// dance for.
async function freshWindows(
  admin: Admin,
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

// D6/D7: a new short-lived, unique-groupId consumer per read() call. It never commits offsets,
// seeks each assigned partition to the requested (or freshly-watermarked) offset, and stops once
// it has collected one page's worth of messages or drained every remaining partition up to the
// watermark frozen at browse-start — forward-only, low-watermark-first (no tail/bidirectional
// browsing, per the ground rules). `partitionsConsumedConcurrently` is left at kafkajs's default
// of 1 (one partition processed at a time) so the shared `cursor` map below needs no locking.
export async function readTopic(
  kafka: Kafka,
  admin: Admin,
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
      : await freshWindows(admin, topic, req.filter, ctx);

  const remaining = windows.filter((w) => BigInt(w.next) < BigInt(w.end));
  if (remaining.length === 0) {
    const builder = createStreamPageBuilder({ visibilityTimeoutSeconds: null });
    return builder.finish(finishPosition(windows, false, fingerprint, req.pageSize));
  }
  if (ctx.signal.aborted) throw new AdapterError('E_CANCELLED', 'operation was cancelled');

  const groupId = `kira-studio-browse-${crypto.randomUUID()}`;
  const consumer = kafka.consumer({ groupId, sessionTimeout: 15_000 });
  const onAbort = (): void => {
    void consumer.stop().catch(() => {});
  };
  ctx.signal.addEventListener('abort', onAbort, { once: true });

  try {
    ctx.setCommand(`browse ${topic} (${remaining.length} partition(s) of ${windows.length})`);
    await consumer.connect();
    await consumer.subscribe({ topic, fromBeginning: false });

    const builder = createStreamPageBuilder({ visibilityTimeoutSeconds: null });
    const cursor = new Map(windows.map((w): [number, PartitionWindow] => [w.partition, { ...w }]));
    let collected = 0;
    let seeked = false;

    await new Promise<void>((resolve, reject) => {
      const allDone = (): boolean =>
        [...cursor.values()].every((w) => BigInt(w.next) >= BigInt(w.end));

      consumer
        .run({
          eachMessage: async ({ partition, message }) => {
            if (!seeked || collected >= req.pageSize) return;
            const w = cursor.get(partition);
            if (!w) return;
            const offset = BigInt(message.offset);
            if (offset < BigInt(w.next) || offset >= BigInt(w.end)) return;
            builder.push({
              key: message.key ? message.key.toString('utf8') : null,
              headers: JSON.stringify(headersToPlain(message.headers)),
              attrs: JSON.stringify({ partition, offset: message.offset }),
              timestamp: message.timestamp
                ? new Date(Number(message.timestamp)).toISOString()
                : null,
              body: message.value ? message.value.toString('utf8') : '',
            });
            collected++;
            w.next = String(offset + 1n);
            if (collected >= req.pageSize || allDone()) resolve();
          },
        })
        .catch(reject);

      // seek() is documented to run after run() — kafkajs applies it once this consumer (the
      // sole member of a fresh, unique group subscribed to only this topic) joins and is
      // assigned every partition, which happens for all of them at once.
      for (const w of remaining) consumer.seek({ topic, partition: w.partition, offset: w.next });
      seeked = true;
    });

    if (ctx.signal.aborted) throw new AdapterError('E_CANCELLED', 'operation was cancelled');

    const nextWindows = [...cursor.values()];
    const hasMore = nextWindows.some((w) => BigInt(w.next) < BigInt(w.end));
    return builder.finish(finishPosition(nextWindows, hasMore, fingerprint, req.pageSize));
  } catch (err) {
    throw mapKafkaError(err);
  } finally {
    ctx.signal.removeEventListener('abort', onAbort);
    await consumer.stop().catch(() => {});
    await consumer.disconnect().catch(() => {});
  }
}

// D6: exact via fetchTopicOffsets's high/low watermarks, summed across every partition.
export async function countTopic(
  admin: Admin,
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
