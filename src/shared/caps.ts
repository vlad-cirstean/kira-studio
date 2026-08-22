export type PageKind = 'tabular' | 'document' | 'keyvalue' | 'stream';

export type PaginationStrategy =
  | 'keyset' // ordered by a unique key; LIMIT/OFFSET fallback when there is no key
  | 'offset' // LIMIT/OFFSET only
  | 'cursor' // driver-side cursor (Redis SCAN, Mongo cursor)
  | 'token' // opaque continuation token (S3)
  | 'offsetWindow' // explicit begin/end offsets per partition (Kafka)
  | 'batch'; // receive-a-batch, no addressable position (SQS)

export interface Caps {
  // ---- shape: what view the UI reaches for, and what a page looks like
  tabular: boolean;
  documents: boolean;
  keyValue: boolean;
  stream: boolean;
  defaultPageKind: PageKind; // §5.1 "Default view" column — ADDED to §5's list (D4)

  // ---- language surfaces
  sql: boolean; // gates §8.14's query console menu item
  ddl: boolean; // gates §8.10's "Open DDL"

  // ---- read pushdown
  projection: boolean; // can fetch a column subset server-side
  serverFilter: boolean; // can push a predicate server-side
  exactCount: boolean; // can produce a true count, not an estimate
  pagination: PaginationStrategy; // REPLACES §5's `keysetPagination: boolean` (D4)

  // ---- graph + writes
  foreignKeys: boolean;
  writable: boolean;
  transactions: boolean;

  // ---- lifecycle
  cancel: boolean; // can forward a cancel to the server — ADDED (D4, D5)
}

/**
 * §5.1, filled in — the map every later adapter is written against. Only the postgres row is
 * implemented in P1; the rest is documentation, not code (do not create the other adapters'
 * cap literals here).
 *
 * | kind     | tree levels                                                              | defaultPageKind | pagination    | exactCount     | cancel mechanism                        | sql | ddl | foreignKeys |
 * |----------|---------------------------------------------------------------------------|-----------------|---------------|----------------|------------------------------------------|-----|-----|-------------|
 * | postgres | database → schema → table/view/matview/function/sequence → column        | tabular         | keyset        | yes            | pg_cancel_backend(pid), side connection | yes | yes | yes         |
 * | mariadb  | database → table/view/routine → column                                   | tabular         | keyset        | yes            | KILL QUERY <threadId>, side connection  | yes | yes | yes         |
 * | mongodb  | database → collection (+ indexes)                                        | document        | cursor        | estimate only  | cursor AbortSignal, killOp fallback     | yes | no  | no          |
 * | redis    | db index → key namespace (split on ':')                                  | keyvalue        | cursor (SCAN) | no (DBSIZE)    | abort the SCAN loop; CLIENT KILL        | yes | no  | no          |
 * | kafka    | cluster → topics, consumer groups                                        | stream          | offsetWindow  | yes (end-begin)| stop consumer + AbortSignal             | no  | no  | no          |
 * | sqs      | region → queues                                                           | stream          | batch         | no (approx)    | SDK AbortSignal                          | no  | no  | no          |
 * | s3       | account → bucket → prefix/object (lazy, '/'-delimited)                   | keyvalue        | token         | no             | SDK AbortController                      | no  | no  | no          |
 */
