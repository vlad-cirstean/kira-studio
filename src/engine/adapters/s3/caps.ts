import type { Caps } from '../../../shared/caps';

// §5.1's s3 row: reuses the keyvalue shape (page.ts's own doc comment on KeyValuePage explains
// why — a single object's metadata+body is exactly a flat field/value listing, same as a redis
// hash). Read-only browsing only in this phase (P17): no insert/update/delete, no DDL, no console.
export const s3Caps: Caps = {
  tabular: false,
  documents: false,
  keyValue: true,
  stream: false,
  defaultPageKind: 'keyvalue',
  sql: false,
  ddl: false,
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
};
