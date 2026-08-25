import type { Caps } from '@shared/caps';

// §5.1's mongodb row: document-shaped, cursor pagination, estimate-only count, no FK
// navigation (§8.5), a shell-style console (§8.14). definition: true as of P19 D12 — a
// collection's creation options + validator, via mongo/definition.ts.
export const mongoCaps: Caps = {
  tabular: false,
  documents: true,
  keyValue: false,
  stream: false,
  defaultPageKind: 'document',
  sql: true,
  definition: true,
  describe: true,
  projection: true,
  serverFilter: true,
  exactCount: false,
  pagination: 'cursor',
  foreignKeys: false,
  // mutate.ts implements insert (insertOne), update (replaceOne) and delete (deleteOne).
  canInsert: true,
  canUpdate: true,
  canDelete: true,
  writable: true,
  transactions: false,
  cancel: true,
  fileTransfer: false,
};
