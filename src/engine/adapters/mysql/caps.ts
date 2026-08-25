import type { Caps } from '@shared/caps';

// P34 D10: identical values to mariadbCaps, stated per engine rather than shared — if MySQL's
// capabilities ever diverge (a transactions nuance, say) this literal is where that gets said.
export const mysqlCaps: Caps = {
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
  pagination: 'keyset',
  foreignKeys: true,
  canInsert: true,
  canUpdate: true,
  canDelete: true,
  writable: true,
  transactions: true,
  cancel: true,
  fileTransfer: false,
};
