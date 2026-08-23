import type { Caps } from '../../../shared/caps';

// §5.1's mongodb row: document-shaped, cursor pagination, estimate-only count, no FK
// navigation (§8.5), no DDL, a shell-style console (§8.14).
export const mongoCaps: Caps = {
  tabular: false,
  documents: true,
  keyValue: false,
  stream: false,
  defaultPageKind: 'document',
  sql: true,
  ddl: false,
  projection: false,
  serverFilter: true,
  exactCount: false,
  pagination: 'cursor',
  foreignKeys: false,
  writable: true,
  transactions: false,
  cancel: true,
};
