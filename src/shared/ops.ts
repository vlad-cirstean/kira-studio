import { z } from 'zod';

// `opKind` grows in P5 (`mutate`) — do not add those members now.
export const opKindSchema = z.enum([
  'connect',
  'disconnect',
  'children',
  'describe',
  'test',
  'read',
  'count',
  'ddl',
]);
export type OpKind = z.infer<typeof opKindSchema>;

export const opStatusSchema = z.enum(['running', 'ok', 'error', 'cancelled']);
export type OpStatus = z.infer<typeof opStatusSchema>;

export const opRecordSchema = z.object({
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
