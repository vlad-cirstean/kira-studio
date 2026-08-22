import { z } from 'zod';
import {
  type ConnectionState,
  connectionColorSchema,
  connectionKindSchema,
  connectionModeSchema,
  connectionStateSchema,
} from './connection';
import { opKindSchema } from './ops';

// Main↔engine wire (D2). The engine parses every inbound frame and main parses every inbound
// event — both are trust boundaries (§3). `ResolvedConnectionConfig` lives here (not in
// connection.ts) so it is obvious that only the engine channel ever carries a password.
//
// ENGINE_OP names are the `op` values on a `{ kind: 'req', id, op, payload }` frame; ENGINE_EVENT
// names are the `topic` values on a `{ kind: 'evt', topic, payload }` frame.

export const ENGINE_OP = {
  connect: 'adapter:connect',
  disconnect: 'adapter:disconnect',
  children: 'adapter:children',
  describe: 'adapter:describe',
  ddl: 'adapter:ddl',
  test: 'adapter:test',
  cancel: 'adapter:cancel',
  configure: 'engine:configure',
} as const;

export const configurePayloadSchema = z.object({
  l2BudgetBytes: z.number(),
  l3TtlSeconds: z.number(),
});
export type ConfigurePayload = z.infer<typeof configurePayloadSchema>;

export const ENGINE_EVENT = {
  opStart: 'op:start',
  opEnd: 'op:end',
  connectionState: 'connection:state',
} as const;

export const resolvedConnectionConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: connectionKindSchema,
  color: connectionColorSchema,
  mode: connectionModeSchema,
  readOnly: z.boolean(),
  host: z.string().nullable(),
  port: z.number().int().min(1).max(65535).nullable(),
  database: z.string().nullable(),
  username: z.string().nullable(),
  password: z.string().nullable(),
  uri: z.string().nullable(),
  options: z.record(z.string(), z.unknown()),
});
export type ResolvedConnectionConfig = z.infer<typeof resolvedConnectionConfigSchema>;

export const connectInfoSchema = z.object({
  serverVersion: z.string(),
  details: z.record(z.string(), z.string()).optional(),
});
export type ConnectInfo = z.infer<typeof connectInfoSchema>;

export const testResultSchema = z.object({
  ok: z.boolean(),
  serverVersion: z.string().optional(),
  error: z.string().optional(),
});
export type TestResult = z.infer<typeof testResultSchema>;

// ---- request payload schemas (engine parses these before use) ----
export const connectPayloadSchema = resolvedConnectionConfigSchema;
export const disconnectPayloadSchema = z.object({ connectionId: z.string() });
export const childrenPayloadSchema = z.object({
  connectionId: z.string(),
  path: z.string(),
  refresh: z.boolean().default(false),
});
export const describePayloadSchema = z.object({
  connectionId: z.string(),
  path: z.string(),
  refresh: z.boolean().default(false),
});
export const ddlPayloadSchema = z.object({
  connectionId: z.string(),
  path: z.string(),
  refresh: z.boolean().default(false),
});
export type DdlPayload = z.infer<typeof ddlPayloadSchema>;
export const testPayloadSchema = resolvedConnectionConfigSchema;
export const cancelPayloadSchema = z.object({ opId: z.string() });

// ---- event payload schemas (main parses these before use) ----
export const opStartEventSchema = z.object({
  opId: z.string(),
  connectionId: z.string().nullable(),
  tabId: z.string().nullable(),
  kind: opKindSchema,
  startedAt: z.string(),
});
export type OpStartEvent = z.infer<typeof opStartEventSchema>;

export const opEndEventSchema = z.object({
  opId: z.string(),
  status: z.enum(['ok', 'error', 'cancelled']),
  durationMs: z.number(),
  rows: z.number().nullable(),
  command: z.string().nullable(),
  error: z.string().nullable(),
});
export type OpEndEvent = z.infer<typeof opEndEventSchema>;

export const connectionStateEventSchema = connectionStateSchema;
export type ConnectionStateEvent = ConnectionState;
