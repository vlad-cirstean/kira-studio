import type { Caps } from '../../../shared/caps';

export const postgresCaps: Caps = {
  tabular: true,
  documents: false,
  keyValue: false,
  stream: false,
  defaultPageKind: 'tabular',
  sql: true,
  definition: true,
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
