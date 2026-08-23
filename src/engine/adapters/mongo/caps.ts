import type { Caps } from '../../../shared/caps';

// §5.1's mongodb row: document-shaped, cursor pagination, estimate-only count, no FK
// navigation (§8.5), no definition, a shell-style console (§8.14).
export const mongoCaps: Caps = {
  tabular: false,
  documents: true,
  keyValue: false,
  stream: false,
  defaultPageKind: 'document',
  sql: true,
  definition: false,
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
};
