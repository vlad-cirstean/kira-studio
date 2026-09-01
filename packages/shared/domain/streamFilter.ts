import { z } from 'zod';

// P16's stream-view filter row (StreamView.vue): Kafka-only structured positioning knobs, carried
// through ReadRequestWire's existing generic `filter: string | null` field (data-ops.ts) as a
// JSON-encoded string — deliberately not a wire schema change, since that field already exists
// for every engine and Kafka has no WHERE-style predicate language to justify widening it.
// SQS never produces or parses one of these: it has no topic/partition/offset concept at all
// (queue-based, `batch` pagination — kafkaCaps.pagination === 'offsetWindow' is what gates the
// filter row's visibility in StreamView.vue), so sqs/read.ts never looks at `filter`.
export interface KafkaStreamFilter {
  /** Decimal string — Kafka offsets are int64, too large for a JS `number`. Starting offset for
   *  a *fresh* browse (a token-continued page ignores this — the windows it resumes were already
   *  computed once, per kafka/read.ts's D7), applied to every included partition and clamped into
   *  that partition's own [low, high] watermark range. Ignored once `timestampMs` is also set. */
  offset: string | null;
  /** Restrict a fresh browse to any of these partitions (this topic's other partitions are
   *  excluded from the browse entirely, not merely hidden after the fact). Empty means "every
   *  partition" — task #61 widened this from a single optional partition to a multiselect. */
  partitions: number[];
  /** Epoch ms — seeks every included partition's starting offset via the client's
   *  `admin.fetchTopicOffsetsByTimestamp` instead of the low watermark or `offset` above. */
  timestampMs: number | null;
}

export function isEmptyKafkaStreamFilter(filter: KafkaStreamFilter): boolean {
  return filter.offset === null && filter.partitions.length === 0 && filter.timestampMs === null;
}

/** `null` when every field is `null`/empty — mirrors P2's "a no-op filter is dropped" discipline. */
export function encodeKafkaStreamFilter(filter: KafkaStreamFilter): string | null {
  return isEmptyKafkaStreamFilter(filter) ? null : JSON.stringify(filter);
}

const kafkaStreamFilterSchema = /*#__PURE__*/ z.object({
  offset: z.string().nullable(),
  partitions: /*#__PURE__*/ z.array(z.number().int()).default([]),
  timestampMs: z.number().nullable(),
});

/** Throws (a plain `Error`, from `JSON.parse` or Zod) on malformed input — callers map that to
 *  `E_QUERY` rather than letting a malformed stream filter surface as an unhandled rejection. */
export function parseKafkaStreamFilter(raw: string | null): KafkaStreamFilter {
  if (raw === null) return { offset: null, partitions: [], timestampMs: null };
  return kafkaStreamFilterSchema.parse(JSON.parse(raw));
}
