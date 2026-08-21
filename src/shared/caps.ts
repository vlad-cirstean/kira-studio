// Capability flags: a *data* type the UI branches on, decided in full up front (D4 in the P1
// plan) so that later adapters do not force a change to every view. Only the `postgres` row is
// implemented in P1; the table below is the map the remaining adapters are written against.
//
// Three deviations from SPEC.md §5, all recorded in D4:
//   - `keysetPagination: boolean` → `pagination: PaginationStrategy` (a boolean cannot express
//     S3's continuation token, Kafka's offset window or SQS's non-addressable batches).
//   - `+ defaultPageKind`: the tree must know what "Open data" will produce *before* issuing the
//     read, to pick an icon and a tab kind.
//   - `+ cancel`: §5.1's closing paragraph requires the stop button to know whether a cancel can
//     actually be forwarded to the server, rather than lying about it.

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
  defaultPageKind: PageKind;

  // ---- language surfaces
  sql: boolean; // gates §8.14's query console menu item
  ddl: boolean; // gates §8.10's "Open DDL"

  // ---- read pushdown
  projection: boolean;
  serverFilter: boolean;
  exactCount: boolean;
  pagination: PaginationStrategy;

  // ---- graph + writes
  foreignKeys: boolean;
  writable: boolean;
  transactions: boolean;

  // ---- lifecycle
  cancel: boolean;
}

// The whole of SPEC.md §5.1, filled in. Every later adapter is written against this.
//
// | kind     | tree levels                                  | defaultPageKind | pagination   | exactCount | cancel mechanism                        | sql | ddl | foreignKeys |
// |----------|----------------------------------------------|-----------------|--------------|------------|-----------------------------------------|-----|-----|-------------|
// | postgres | database → schema → table/view/matview/function/sequence → column | tabular | keyset | yes | pg_cancel_backend(pid), side connection | yes | yes | yes |
// | mariadb  | database → table/view/routine → column        | tabular         | keyset       | yes        | KILL QUERY <threadId>, side connection  | yes | yes | yes |
// | mongodb  | database → collection (+ indexes)             | document        | cursor       | estimate only | cursor AbortSignal, killOp fallback  | yes (shell) | no | no |
// | redis    | db index → key namespace (split on `:`)       | keyvalue        | cursor (SCAN)| no (DBSIZE approx) | abort SCAN; CLIENT KILL          | yes (commands) | no | no |
// | kafka    | cluster → topics, consumer groups             | stream          | offsetWindow | yes (end − begin) | stop consumer + AbortSignal      | no | no | no |
// | sqs      | region → queues                               | stream          | batch        | no (Approximate) | SDK AbortSignal                 | no | no | no |
// | s3       | account → bucket → prefix/object (lazy)       | keyvalue        | token        | no        | SDK AbortController                     | no | no | no |
