import { z } from 'zod';
import type { ConnectionSummary } from '../domain/connection';
import { connectionSummarySchema } from '../domain/connection';
import { nodeKindSchema, objectMetaSchema, treeNodeSchema } from '../domain/tree';

export const ENGINE_OP = {
  connect: 'adapter:connect',
  disconnect: 'adapter:disconnect',
  children: 'adapter:children',
  describe: 'adapter:describe',
  test: 'adapter:test',
  cancel: 'adapter:cancel',
} as const;

export const ENGINE_EVENT = {
  opStart: 'op:start',
  opEnd: 'op:end',
  connectionState: 'connection:state',
} as const;

// main → engine only, never renderer-visible: ConnectionSummary + the resolved password + the
// URI with the password re-injected (D7). Declared here, not in domain/connection.ts, so it is
// obvious that only the engine channel carries a secret.
export type ResolvedConnectionConfig = ConnectionSummary & {
  password: string | null;
};

export const resolvedConnectionConfigSchema: z.ZodType<ResolvedConnectionConfig> =
  connectionSummarySchema.extend({
    password: z.string().nullable(),
  });

const nodePathWireSchema = z.object({
  connectionId: z.string(),
  segments: z.array(z.object({ kind: nodeKindSchema, name: z.string() })),
});

export const engineOpPayloadSchema = {
  [ENGINE_OP.connect]: z.object({ config: resolvedConnectionConfigSchema }),
  [ENGINE_OP.disconnect]: z.object({ connectionId: z.string() }),
  [ENGINE_OP.children]: z.object({ connectionId: z.string(), path: nodePathWireSchema }),
  [ENGINE_OP.describe]: z.object({ connectionId: z.string(), path: nodePathWireSchema }),
  [ENGINE_OP.test]: z.object({ config: resolvedConnectionConfigSchema }),
  [ENGINE_OP.cancel]: z.object({ opId: z.string() }),
} as const;

export const engineOpResultSchema = {
  [ENGINE_OP.connect]: z.object({
    serverVersion: z.string(),
    details: z.record(z.string(), z.string()).optional(),
  }),
  [ENGINE_OP.disconnect]: z.object({}),
  [ENGINE_OP.children]: z.object({ nodes: z.array(treeNodeSchema) }),
  [ENGINE_OP.describe]: z.object({ meta: objectMetaSchema }),
  [ENGINE_OP.test]: z.object({
    ok: z.boolean(),
    serverVersion: z.string().optional(),
    error: z.string().optional(),
  }),
  [ENGINE_OP.cancel]: z.object({ cancelled: z.boolean() }),
} as const;

export const opStartEventSchema = z.object({
  opId: z.string(),
  connectionId: z.string().nullable(),
  kind: z.enum(['connect', 'disconnect', 'children', 'describe', 'test']),
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

export const connectionStateEventSchema = z.object({
  connectionId: z.string(),
  status: z.enum(['connected', 'error']),
  serverVersion: z.string().nullable(),
  error: z.string().nullable(),
});
export type ConnectionStateEvent = z.infer<typeof connectionStateEventSchema>;
