import { z } from 'zod';
import { parseConnectionUri } from './uri';

export const connectionKindSchema = z.enum([
  'postgres',
  'mariadb',
  'mongodb',
  'redis',
  'kafka',
  'sqs',
  's3',
]);
export type ConnectionKind = z.infer<typeof connectionKindSchema>;

// D18: stored as a palette *name*, resolved to var(--kira-conn-<name>) in CSS.
export const connectionColorSchema = z.enum([
  'red',
  'orange',
  'amber',
  'olive',
  'green',
  'teal',
  'cyan',
  'blue',
  'indigo',
  'violet',
  'magenta',
  'grey',
]);
export type ConnectionColor = z.infer<typeof connectionColorSchema>;

export const connectionModeSchema = z.enum(['fields', 'uri']);
export type ConnectionMode = z.infer<typeof connectionModeSchema>;

// Password three-state convention (D9 / Step 6a): on update, `null` means "unchanged", an empty
// string means "clear", a non-empty string means "set to this". This field is present on the way
// IN only — `ConnectionSummary` (what the renderer receives) omits it entirely.
//
// `connectionSummarySchema` is derived from the un-refined base schema, not from
// `connectionInputSchema`: zod v4's `.omit()` cannot be applied to a schema carrying a
// `.superRefine()`.
const connectionFieldsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: connectionKindSchema,
  color: connectionColorSchema,
  mode: connectionModeSchema,
  readOnly: z.boolean(),
  host: z.string().trim().nullable(),
  port: z.number().int().min(1).max(65535).nullable(),
  database: z.string().nullable(),
  username: z.string().nullable(),
  password: z.string().nullable(),
  uri: z.string().nullable(),
  options: z.record(z.string(), z.unknown()),
});

export const connectionInputSchema = connectionFieldsSchema.superRefine((input, ctx) => {
  if (input.mode === 'fields') {
    if (!input.host || input.host.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['host'], message: 'Host is required' });
    }
    if (input.port == null) {
      ctx.addIssue({ code: 'custom', path: ['port'], message: 'Port is required' });
    }
  } else if (!input.uri || parseConnectionUri(input.uri) === null) {
    ctx.addIssue({ code: 'custom', path: ['uri'], message: 'URI cannot be parsed' });
  }
});
export type ConnectionInput = z.infer<typeof connectionInputSchema>;

export const connectionSummarySchema = connectionFieldsSchema.omit({ password: true }).extend({
  id: z.string(),
  sortOrder: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ConnectionSummary = z.infer<typeof connectionSummarySchema>;

export const connectionStateSchema = z.object({
  connectionId: z.string(),
  status: z.enum(['disconnected', 'connecting', 'connected', 'error']),
  serverVersion: z.string().nullable(),
  error: z.string().nullable(),
  since: z.number(),
});
export type ConnectionState = z.infer<typeof connectionStateSchema>;

// §8.3 filters: hide/show rules per connection, applied to databases/schemas/tables.
export const connectionFilterNodeKindSchema = z.enum(['database', 'schema', 'table']);
export const connectionFilterSchema = z.object({
  id: z.string(),
  connectionId: z.string(),
  nodeKind: connectionFilterNodeKindSchema,
  pattern: z.string(),
  isRegex: z.boolean(),
  action: z.enum(['hide', 'show']),
});
export type ConnectionFilter = z.infer<typeof connectionFilterSchema>;

export const connectionFilterInputSchema = connectionFilterSchema.omit({
  id: true,
  connectionId: true,
});
export type ConnectionFilterInput = z.infer<typeof connectionFilterInputSchema>;
