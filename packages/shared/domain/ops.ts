import { z } from 'zod';

export const opKindSchema = /*#__PURE__*/ z.enum([
  'connect',
  'disconnect',
  'children',
  'describe',
  'definition',
  'test',
  'read',
  'count',
  'mutate',
  'execute',
  // P33: a bulk-bytes file transfer (an S3 download) — distinct from 'read' so a multi-hundred-MB
  // transfer's op-log row is legible as a file transfer, not a mysteriously slow read.
  'transfer',
  // P2: an outbound HTTP request/response exchange (internal/httpclient), the op log's first
  // connectionless op kind — RunOp already tolerates a nil connection id end to end (F10), so
  // this joins the same op log rather than getting one of its own (D3).
  'http',
]);
export type OpKind = z.infer<typeof opKindSchema>;

export const opStatusSchema = /*#__PURE__*/ z.enum(['running', 'ok', 'error', 'cancelled']);
export type OpStatus = z.infer<typeof opStatusSchema>;

export const opRecordSchema = /*#__PURE__*/ z.object({
  id: z.string(),
  connectionId: z.string().nullable(),
  tabId: z.string().nullable(),
  startedAt: z.string(),
  durationMs: z.number().nullable(),
  kind: opKindSchema,
  status: opStatusSchema,
  rows: z.number().nullable(),
  command: z.string().nullable(),
  error: z.string().nullable(),
});
export type OpRecord = z.infer<typeof opRecordSchema>;
