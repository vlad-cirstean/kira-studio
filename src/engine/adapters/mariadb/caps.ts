import type { Caps } from '../../../shared/caps';

// Identical to Postgres's, which is the point (§5.1: the two SQL rows differ only in
// mechanism). `caps.ddl: true` is a statement about what MariaDB *can* do — `ddl()` itself is P4's.
export const mariadbCaps: Caps = {
  tabular: true,
  documents: false,
  keyValue: false,
  stream: false,
  defaultPageKind: 'tabular',
  sql: true,
  ddl: true,
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
  cancel: true,
};
