import type { Caps } from '../../../shared/caps';

// §5.1's sqs row: stream-shaped, batch pagination (poll-on-demand, no addressable position),
// approximate count only, no FK navigation, no DDL, no console (P10's D13). Read-only in v1.
export const sqsCaps: Caps = {
  tabular: false,
  documents: false,
  keyValue: false,
  stream: true,
  defaultPageKind: 'stream',
  sql: false,
  ddl: false,
  projection: false,
  serverFilter: false,
  exactCount: false, // ApproximateNumberOfMessages only
  pagination: 'batch',
  foreignKeys: false,
  writable: false,
  transactions: false,
  cancel: true, // the SDK's own abortSignal request option is fully effective (P10's D14)
};
