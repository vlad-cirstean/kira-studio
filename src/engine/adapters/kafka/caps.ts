import type { Caps } from '../../../shared/caps';

// §5.1's kafka row: stream-shaped, offsetWindow pagination, exact count (end-begin watermark
// subtraction), no FK navigation, no definition, no console (P10's D13 — neither engine has an ad-hoc
// command surface named in scope). Read-only in v1 — `writable: false`.
export const kafkaCaps: Caps = {
  tabular: false,
  documents: false,
  keyValue: false,
  stream: true,
  defaultPageKind: 'stream',
  sql: false,
  definition: false,
  projection: false,
  serverFilter: false,
  exactCount: true, // fetchTopicOffsets: high - low, summed across partitions
  pagination: 'offsetWindow',
  foreignKeys: false,
  // kafka/produce.ts's producer().send() lands `canInsert` here. A topic's log is immutable, so
  // Kafka never gets canUpdate or canDelete — there is no per-message update or delete in the
  // Kafka API, only retention/compaction at the topic level (unlike SQS, whose deleteMessage
  // really does remove one item) — these two stay `false` permanently, not "not yet implemented".
  canInsert: true,
  canUpdate: false,
  canDelete: false,
  writable: true,
  transactions: false,
  cancel: true, // ctx.signal -> consumer.stop() inside read() is fully effective (P10's D6/D14)
};
