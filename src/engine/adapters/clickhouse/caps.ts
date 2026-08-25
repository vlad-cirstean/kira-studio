import type { Caps } from '@shared/caps';

// P36 D23/D25/D26/D8: the app's first tabular SQL adapter with canUpdate/canDelete both false —
// a MergeTree PRIMARY KEY is a sparse index, not a uniqueness constraint (F16), so a row cannot
// be addressed unambiguously and there is no matched-row count to verify one was (F22). Not "not
// yet implemented": the same honest, permanent false Kafka's own caps.ts already carries for the
// same reason (an immutable log has no per-message update/delete either). `pagination: 'offset'`
// for the identical structural reason — no unique total order to build a keyset cursor on (F16,
// F20). `foreignKeys: false` because ClickHouse has no such concept at all, not merely no catalog
// for one (F17) — unlike SQLite's CHECK-constraint gap, which is a missing catalog, not a missing
// concept. `cancel: true` is the app's first genuinely-forwarded cancel alongside SQLite's first
// honest `false` — KILL QUERY WHERE query_id = ... on a second HTTP request the client's own
// connection pool already has free (F7, F9).
export const clickhouseCaps: Caps = {
  tabular: true,
  documents: false,
  keyValue: false,
  stream: false,
  keyBrowser: false,
  defaultPageKind: 'tabular',
  sql: true,
  definition: true,
  describe: true,
  projection: true,
  serverFilter: true,
  exactCount: true,
  pagination: 'offset',
  foreignKeys: false,
  canInsert: true,
  canUpdate: false,
  canDelete: false,
  writable: true,
  transactions: false,
  cancel: true,
  fileTransfer: false,
};
