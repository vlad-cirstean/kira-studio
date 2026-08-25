import type { Caps } from '../../../shared/caps';

// P35 D27: identical to the other SQL adapters except `cancel: false` — the app's first honest
// `false`. node:sqlite exposes no sqlite3_interrupt, and its entire API is synchronous, so a
// running statement blocks the engine's event loop and an AbortSignal cannot even arrive while it
// runs (F10). `exactCount: true` is not a formality: count(*) over a million rows measured at 9ms
// in this sandbox (F11) — cheaper than any other engine in the app. `fileTransfer: false`: SQLite
// being itself a file does not make its *items* (rows) files — that flag is about an S3 object,
// not the database.
export const sqliteCaps: Caps = {
  tabular: true,
  documents: false,
  keyValue: false,
  stream: false,
  defaultPageKind: 'tabular',
  sql: true,
  definition: true,
  describe: true,
  projection: true,
  serverFilter: true,
  exactCount: true,
  pagination: 'keyset',
  foreignKeys: true,
  canInsert: true,
  canUpdate: true,
  canDelete: true,
  writable: true,
  transactions: true,
  cancel: false,
  fileTransfer: false,
};
