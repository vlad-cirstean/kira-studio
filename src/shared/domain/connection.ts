import { z } from 'zod';

export const connectionKindSchema = z.enum([
  'postgres',
  'mariadb',
  'mongodb',
  'redis',
  'kafka',
  'sqs',
  's3',
]); // all v1 kinds; only 'postgres' has an adapter in P1
export type ConnectionKind = z.infer<typeof connectionKindSchema>;

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
]); // D18; matches --kira-conn-* in tokens.css
export type ConnectionColor = z.infer<typeof connectionColorSchema>;

export const connectionModeSchema = z.enum(['fields', 'uri']);
export type ConnectionMode = z.infer<typeof connectionModeSchema>;

export const connectionInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    kind: connectionKindSchema,
    color: connectionColorSchema,
    mode: connectionModeSchema,
    readOnly: z.boolean(),
    host: z.string().trim().nullable(),
    port: z.number().int().min(1).max(65535).nullable(),
    database: z.string().nullable(),
    username: z.string().nullable(),
    password: z.string().nullable(), // present on the way IN only; never on the way OUT (D9)
    uri: z.string().nullable(),
    options: z.record(z.string(), z.unknown()),
  })
  .superRefine((input, ctx) => {
    if (input.mode === 'fields') {
      if (!input.host) {
        ctx.addIssue({ code: 'custom', path: ['host'], message: 'Host is required.' });
      }
      if (!input.port) {
        ctx.addIssue({ code: 'custom', path: ['port'], message: 'Port is required.' });
      }
    } else {
      if (!input.uri || input.uri.trim() === '') {
        ctx.addIssue({ code: 'custom', path: ['uri'], message: 'A connection URI is required.' });
      }
    }
  });

export type ConnectionInput = z.infer<typeof connectionInputSchema>;

// What the renderer gets. Note the absence of `password` — this is D9 enforced by the type.
export const connectionSummarySchema = connectionInputSchema.omit({ password: true }).extend({
  id: z.string(),
  sortOrder: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ConnectionSummary = z.infer<typeof connectionSummarySchema>;

export const connectionStatusSchema = z.enum(['disconnected', 'connecting', 'connected', 'error']);
export type ConnectionStatus = z.infer<typeof connectionStatusSchema>;

export const connectionStateSchema = z.object({
  connectionId: z.string(),
  status: connectionStatusSchema,
  serverVersion: z.string().nullable(),
  error: z.string().nullable(),
  since: z.number(), // epoch ms
});
export type ConnectionState = z.infer<typeof connectionStateSchema>;
