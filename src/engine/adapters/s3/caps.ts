import type { Caps } from '../../../shared/caps';

// §5.1's s3 row: reuses the keyvalue shape (page.ts's own doc comment on KeyValuePage explains
// why — a single object's metadata+body is exactly a flat field/value listing, same as a redis
// hash). Read-only browsing only in this phase (P17): no insert/update/delete, no console.
export const s3Caps: Caps = {
  tabular: false,
  documents: false,
  keyValue: true,
  stream: false,
  defaultPageKind: 'keyvalue',
  sql: false,
  // P23 D11: stays false for now, as a named follow-up rather than a permanent no — an *object*
  // already shows its full metadata in the keyvalue view it opens into (P17), so only a *bucket*
  // has anything new, and a bucket's properties are five separate SDK calls each of which a
  // single-bucket IAM policy routinely denies (catalog.ts's own comment on that policy shape).
  // Doing it properly means per-call degradation to a `notes` line per denial — its own piece of
  // work, not something this phase's Kafka/SQS pattern can just extend.
  definition: false,
  // describe() throws E_UNSUPPORTED (s3/index.ts). definition is already false above, so this is
  // a coincidence of two unrelated flags (P31 F5), not something describe: false relies on.
  describe: false,
  projection: false,
  serverFilter: false,
  // count() (s3/read.ts's countObject) answers a single object's own field count via HeadObject,
  // which is always exact — the same per-item-exact resolution redis/caps.ts makes for its own
  // per-key counts, not the db-wide "how many keys total" question ListObjectsV2 would need to
  // answer approximately (and which this phase's read-only object browsing never asks).
  exactCount: true,
  pagination: 'token', // ListObjectsV2's own ContinuationToken
  foreignKeys: false,
  canInsert: false,
  canUpdate: false,
  canDelete: false,
  writable: false,
  transactions: false,
  cancel: true, // the SDK's own abortSignal request option is fully effective, same as sqs/kafka
  // P33 commit 2 flips this to true alongside canInsert/canUpdate/canDelete/writable — false here
  // only for the brief window between this commit (the contract) and that one (the behaviour).
  fileTransfer: false,
};
