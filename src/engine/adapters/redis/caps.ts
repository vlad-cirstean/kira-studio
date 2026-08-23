import type { Caps } from '../../../shared/caps';

// §5.1's redis row: key/value-shaped, cursor (SCAN) pagination, no FK navigation, no DDL, a
// shell-style console (§8.14). Read-only in v1 (P9's D2) — `writable: false`.
export const redisCaps: Caps = {
  tabular: false,
  documents: false,
  keyValue: true,
  stream: false,
  defaultPageKind: 'keyvalue',
  sql: true,
  ddl: false,
  projection: false,
  serverFilter: false,
  // Per-key counts use O(1) exact type-length commands (HLEN/SCARD/ZCARD/LLEN/XLEN, or 1 for a
  // string) — D6. Distinct from §5.1's "DBSIZE only" wording, which describes a tree/db-wide
  // count this adapter never surfaces through count().
  exactCount: true,
  pagination: 'cursor',
  foreignKeys: false,
  // index.ts's preview()/mutate() unconditionally throw E_UNSUPPORTED today — no write path
  // exists at all. Once SET/DEL land, Redis has no real insert/update distinction (SET on a
  // missing key creates it, on an existing key overwrites it), so canInsert and canUpdate should
  // flip together.
  canInsert: false,
  canUpdate: false,
  canDelete: false,
  writable: false,
  transactions: false,
  cancel: true, // ctx.signal between bounded SCAN-family rounds is fully effective (D7/D8)
};
