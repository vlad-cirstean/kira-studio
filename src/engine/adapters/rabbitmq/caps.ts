import type { Caps } from '../../../shared/caps';

// §5.1's rabbitmq row: stream-shaped, batch pagination (poll-on-demand, no addressable position —
// a basic.get batch has no offset or resumable cursor, D20), no exact count (a queue's message
// count is a live snapshot, D23), no FK navigation, no console (the management API has no ad-hoc
// command language worth one, D28).
export const rabbitmqCaps: Caps = {
  tabular: false,
  documents: false,
  keyValue: false,
  stream: true,
  defaultPageKind: 'stream',
  sql: false,
  // D29/D30: a queue or exchange genuinely *is* its attributes plus its bindings — two or three
  // HTTP GETs, no automatic message read.
  definition: true,
  // describe() throws E_UNSUPPORTED (index.ts) — a queue/exchange has no column/PK/FK metadata.
  describe: false,
  projection: false,
  serverFilter: false,
  exactCount: false, // D23: `messages` is a live snapshot, never a transactional count
  pagination: 'batch',
  foreignKeys: false, // D28: RabbitMQ has no FK concept at all
  // D25/D26: a publish (insert) is the only mutation this protocol has. canUpdate/canDelete are
  // permanently false — not "not yet implemented" — because a RabbitMQ message has no
  // broker-assigned identity (F22) and there is no per-message delete or update in AMQP at any
  // version (F25); the only removals the protocol offers are consuming (refused behind a browse,
  // D21) and a queue-wide purge (out of scope, §6).
  canInsert: true,
  canUpdate: false,
  canDelete: false,
  writable: true,
  transactions: false, // D28: the management API exposes none of AMQP's transaction features
  // D7: delivered via ctx.signal on the HTTP request — the management plugin has no long-running
  // query to keep executing after the socket dies (unlike ClickHouse's KILL QUERY), so an abort
  // really does stop the work. Note: aborting a poll mid-flight does not un-deliver messages the
  // broker has already handed back — those are still requeued by the endpoint's own reject step.
  cancel: true,
  fileTransfer: false,
};
