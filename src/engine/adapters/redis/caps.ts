import type { Caps } from '../../../shared/caps';

// §5.1's redis row: key/value-shaped, cursor (SCAN) pagination, no FK navigation, a shell-style
// console (§8.14). Writable as of this phase — string-only edit/insert plus type-agnostic delete
// (see the canInsert/canUpdate/canDelete comment below).
export const redisCaps: Caps = {
  tabular: false,
  documents: false,
  keyValue: true,
  stream: false,
  defaultPageKind: 'keyvalue',
  sql: true,
  // P23 D10: stays false permanently, not deferred — a key's type/TTL/memory usage are already on
  // every KeyValuePage and already rendered by KeyValueView.vue (redis/read.ts). A definition tab
  // would be a second, staler view of the same three facts for a node whose only other property is
  // its name.
  definition: false,
  projection: false,
  serverFilter: false,
  // Per-key counts use O(1) exact type-length commands (HLEN/SCARD/ZCARD/LLEN/XLEN, or 1 for a
  // string) — D6. Distinct from §5.1's "DBSIZE only" wording, which describes a tree/db-wide
  // count this adapter never surfaces through count().
  exactCount: true,
  pagination: 'cursor',
  foreignKeys: false,
  // index.ts's mutate() now backs all three: `insert` (SET ... NX, a brand-new key, string-typed
  // only), `update` (a plain SET, also string-typed only — mutate.ts's assertEditableType), and
  // `delete` (DEL, type-agnostic). Editing/creating a hash/list/set/zset/stream element needs its
  // own per-type semantics (HSET a field, LSET an index, SADD/SREM, ZADD, XADD) — a materially
  // bigger job, out of scope for this version; the UI disables Edit/Add for those cases.
  canInsert: true,
  canUpdate: true,
  canDelete: true,
  writable: true,
  transactions: false,
  cancel: true, // ctx.signal between bounded SCAN-family rounds is fully effective (D7/D8)
};
