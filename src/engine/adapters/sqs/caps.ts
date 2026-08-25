import type { Caps } from '@shared/caps';

// §5.1's sqs row: stream-shaped, batch pagination (poll-on-demand, no addressable position),
// approximate count only, no FK navigation, no console (P10's D13).
export const sqsCaps: Caps = {
  tabular: false,
  documents: false,
  keyValue: false,
  stream: true,
  defaultPageKind: 'stream',
  sql: false,
  // P23 D9: a queue's attributes — visibility timeout, retention, redrive policy, FIFO/dedup,
  // KMS key, ARN — reverses P10's original "no definition" call; nothing in the app showed any of
  // this before. One GetQueueAttributes call, no automatic message read (SPEC §5.1's rule is about
  // ReceiveMessage specifically).
  definition: true,
  // describe() throws E_UNSUPPORTED (sqs/index.ts) — a queue has no column/PK/FK metadata.
  describe: false,
  projection: false,
  serverFilter: false,
  exactCount: false, // ApproximateNumberOfMessages only
  pagination: 'batch',
  foreignKeys: false,
  // sqs/mutate.ts's SendMessage/DeleteMessage land both canInsert and canDelete here. Unlike
  // Kafka, SQS's deleteMessage is a real per-item operation (removes it from the queue via its
  // receipt handle, kept adapter-local — see mutate.ts's own comment). There is still no
  // canUpdate — a delivered message can't be edited in place, only replaced by delete+resend.
  canInsert: true,
  canUpdate: false,
  canDelete: true,
  writable: true,
  transactions: false,
  cancel: true, // the SDK's own abortSignal request option is fully effective (P10's D14)
  fileTransfer: false,
};
