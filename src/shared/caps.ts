import { z } from 'zod';

export type PageKind = 'tabular' | 'document' | 'keyvalue' | 'stream';
export const pageKindSchema = z.enum(['tabular', 'document', 'keyvalue', 'stream']);

export type PaginationStrategy =
  | 'keyset' // ordered by a unique key; LIMIT/OFFSET fallback when there is no key
  | 'offset' // LIMIT/OFFSET only
  | 'cursor' // driver-side cursor (Redis SCAN, Mongo cursor)
  | 'token' // opaque continuation token (S3)
  | 'offsetWindow' // explicit begin/end offsets per partition (Kafka)
  | 'batch'; // receive-a-batch, no addressable position (SQS)
export const paginationStrategySchema = z.enum([
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
  defaultPageKind: PageKind; // §5.1 "Default view" column — ADDED to §5's list (D4)

  // ---- language surfaces
  sql: boolean; // gates §8.14's query console menu item
  definition: boolean; // gates §8.10's "Open definition" (P19, was "Open DDL")
  // The adapter implements describe(); gates the definition view's second, metadata load
  // (P31 D2). false for kafka/sqs/redis/s3 — a stream or a key has no column/PK/FK metadata to
  // describe, so definition() alone (gated by `definition` above) is the whole story for them.
  describe: boolean;

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
  cancel: boolean; // can forward a cancel to the server — ADDED (D4, D5)

  /** P33: this engine's items are *files* — they can be streamed to and from a local path, and
   *  the UI may offer an OS file dialog for them. Orthogonal to canInsert/canUpdate: S3 is the
   *  only engine where "add an item" means "pick a file", and the only one with a download at
   *  all. Gates the Download action outright; gates Upload together with canInsert. */
  fileTransfer: boolean;
}

// Crosses the engine<->main process boundary on connect (P2's ConnectInfo.caps addition) and
// main<->renderer over kira:connection:state — validated like anything else at a trust boundary.
export const capsSchema = z.object({
  tabular: z.boolean(),
  documents: z.boolean(),
  keyValue: z.boolean(),
  stream: z.boolean(),
  keyBrowser: z.boolean(),
  defaultPageKind: pageKindSchema,
  sql: z.boolean(),
  definition: z.boolean(),
  describe: z.boolean(),
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
});

/**
 * §5.1, filled in — the map every later adapter is written against. Only the postgres row is
 * implemented in P1; the rest is documentation, not code (do not create the other adapters'
 * cap literals here).
 *
 * | kind     | tree levels                                                              | defaultPageKind | pagination    | exactCount     | cancel mechanism                        | sql | definition | foreignKeys |
 * |----------|---------------------------------------------------------------------------|-----------------|---------------|----------------|------------------------------------------|-----|------------|-------------|
 * | postgres | database → schema → table/view/matview/function/sequence                 | tabular         | keyset        | yes            | pg_cancel_backend(pid), side connection | yes | yes        | yes         |
 * | mariadb  | database → table/view/routine                                            | tabular         | keyset        | yes            | KILL QUERY <threadId>, side connection  | yes | yes        | yes         |
 * | mysql    | database → table/view/routine (no sequence — MySQL has no SEQUENCE engine) | tabular       | keyset        | yes            | KILL QUERY <threadId>, side connection  | yes | yes        | yes         |
 * | sqlite   | database (PRAGMA database_list) → table/view (no sequence, no routine)   | tabular         | keyset (+rowid) | yes (~9ms/1M) | none — no sqlite3_interrupt, synchronous API | yes | yes    | yes         |
 * | clickhouse | database (system.databases) → table/view/matview (no sequence, no routine) | tabular    | offset only   | yes (system.tables.total_rows) | KILL QUERY WHERE query_id=…, 2nd HTTP request | yes | yes | no (no FK concept) |
 * | mongodb  | database → collection (+ indexes)                                        | document        | cursor        | estimate only  | cursor AbortSignal, killOp fallback     | yes | yes        | no          |
 * | redis    | db index → key namespace (split on ':')                                  | keyvalue        | cursor (SCAN) | no (DBSIZE)    | abort the SCAN loop; CLIENT KILL        | yes | no         | no          |
 * | kafka    | cluster → topics, consumer groups                                        | stream          | offsetWindow  | yes (end-begin)| stop consumer + AbortSignal             | no  | no         | no          |
 * | sqs      | region → queues                                                           | stream          | batch         | no (approx)    | SDK AbortSignal                          | no  | no         | no          |
 * | s3       | account → bucket → prefix/object (lazy, '/'-delimited)                   | keyvalue        | token         | no             | SDK AbortController                      | no  | no         | no          |
 * | rabbitmq | vhost (database) → queues (ungrouped), exchanges (folder); bindings live in the definition view | stream | batch | no (messages is a snapshot) | AbortSignal on the HTTP request | no | yes | no (no FK concept) |
 */
