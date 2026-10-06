import { z } from 'zod';

export type PageKind = 'tabular' | 'document' | 'keyvalue' | 'stream';
export const pageKindSchema = /*#__PURE__*/ z.enum(['tabular', 'document', 'keyvalue', 'stream']);

export type PaginationStrategy =
  | 'keyset' // ordered by a unique key; LIMIT/OFFSET fallback when there is no key
  | 'offset' // LIMIT/OFFSET only
  | 'cursor' // driver-side cursor (Redis SCAN, Mongo cursor)
  | 'token' // opaque continuation token (S3)
  | 'offsetWindow' // explicit begin/end offsets per partition (Kafka)
  | 'batch'; // receive-a-batch, no addressable position (SQS)
export const paginationStrategySchema = /*#__PURE__*/ z.enum([
  'keyset',
  'offset',
  'cursor',
  'token',
  'offsetWindow',
  'batch',
]);

export interface Caps {
  // ---- shape: what view the UI reaches for, and what a page looks like
  tabular: boolean;
  documents: boolean;
  keyValue: boolean;
  stream: boolean;
  /** P41: this engine's containers hold an arbitrarily nested, unbounded key space. The project
   *  tree shows the containers only (a redis `database`, an s3 `bucket`); the space itself is
   *  navigated in a Browse tab (§8.18). True for redis and s3, false for the other nine. */
  keyBrowser: boolean;
  /** P63 §4.3: the adapter implements KeyTypes() — a batch of paths answered with each one's
   *  engine-level value type, in one round trip. True only for redis (Browse's per-key type
   *  icon/badge); false for the other nine, s3 included (an object has no per-item "type" the way
   *  a redis key's TYPE command reports one). */
  keyTypes: boolean;
  defaultPageKind: PageKind; // §5.1 "Default view" column — ADDED to §5's list (D4)

  // ---- language surfaces
  sql: boolean; // gates §8.14's query console menu item
  definition: boolean; // gates §8.10's "Open definition" (P19, was "Open DDL")
  // The adapter implements describe(); gates the definition view's second, metadata load
  // (P31 D2). false for kafka/sqs/redis/s3 — a stream or a key has no column/PK/FK metadata to
  // describe, so definition() alone (gated by `definition` above) is the whole story for them.
  describe: boolean;
  /** P22c D1: the adapter implements SchemaColumns() — every relation in one container together
   *  with its columns, in one round trip. true for the five SQL kinds; false for mongo (no
   *  field-level schema at all, its own D8 mechanism instead) and every non-SQL kind. */
  schemaColumns: boolean;

  // ---- read pushdown
  projection: boolean; // can fetch a column subset server-side
  serverFilter: boolean; // can push a predicate server-side
  exactCount: boolean; // can produce a true count, not an estimate
  pagination: PaginationStrategy; // REPLACES §5's `keysetPagination: boolean` (D4)

  // ---- graph + writes
  foreignKeys: boolean;
  // `writable` is the coarse "this connection accepts mutate() at all" gate DataToolbar.vue's
  // isWritable (and its equivalents) already read. The three flags below exist because that one
  // boolean can't express an adapter that supports some mutation kinds but not others — e.g.
  // Kafka can produce a new message (insert) but has no per-message update or delete at all (a
  // topic's log is immutable; only retention/compaction remove messages), while SQS can send and
  // delete a message but never update one in place. A renderer gating a single action (the Add
  // button vs the Delete button) reads the matching flag instead of `writable`; `writable` stays
  // `canInsert || canUpdate || canDelete` for the call sites that only need "is this read-only".
  canInsert: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  writable: boolean;
  transactions: boolean;

  // ---- lifecycle
  cancel: boolean; // a cancel stops the in-flight op, server-side or by ctx — ADDED (D4, D5)

  /** P33: this engine's items are *files* — they can be streamed to and from a local path, and
   *  the UI may offer an OS file dialog for them. Orthogonal to canInsert/canUpdate: S3 is the
   *  only engine where "add an item" means "pick a file", and the only one with a download at
   *  all. Gates the Download action outright; gates Upload together with canInsert. */
  fileTransfer: boolean;

  /** P43 iter3 D46: the largest page this engine can actually serve in one read, when that is
   *  below the picker's own ceiling. Absent means "every size the picker offers works". No
   *  current adapter sets it (rabbitmq did, before it was dropped — see P58 findings), but the
   *  mechanism stays: the stream toolbar's page-size picker (sizes.ts's pageSizeOptions) already
   *  filters against it generically for whichever future engine needs a real ceiling. */
  maxPageSize?: number;
}

// Crosses the engine<->main process boundary on connect (P2's ConnectInfo.caps addition) and
// main<->renderer over kira:connection:state — validated like anything else at a trust boundary.
// Per-engine values live in the Go adapters' `caps.go`, the source of truth.
export const capsSchema = /*#__PURE__*/ z.object({
  tabular: z.boolean(),
  documents: z.boolean(),
  keyValue: z.boolean(),
  stream: z.boolean(),
  keyBrowser: z.boolean(),
  keyTypes: z.boolean(),
  defaultPageKind: pageKindSchema,
  sql: z.boolean(),
  definition: z.boolean(),
  describe: z.boolean(),
  schemaColumns: z.boolean(),
  projection: z.boolean(),
  serverFilter: z.boolean(),
  exactCount: z.boolean(),
  pagination: paginationStrategySchema,
  foreignKeys: z.boolean(),
  canInsert: z.boolean(),
  canUpdate: z.boolean(),
  canDelete: z.boolean(),
  writable: z.boolean(),
  transactions: z.boolean(),
  cancel: z.boolean(),
  fileTransfer: z.boolean(),
  maxPageSize: z.number().int().positive().optional(),
});
