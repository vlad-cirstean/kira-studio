import { z } from 'zod';
import { capsSchema } from '../caps';
import type { ConnectionSummary } from '../domain/connection';
import { connectionSummarySchema } from '../domain/connection';
import { sourceTextSchema } from '../domain/ddl';
import { opKindSchema } from '../domain/ops';
import { nodeKindSchema, objectMetaSchema, treeNodeSchema } from '../domain/tree';

export const ENGINE_OP = {
  connect: 'adapter:connect',
  disconnect: 'adapter:disconnect',
  children: 'adapter:children',
  describe: 'adapter:describe',
  ddl: 'adapter:ddl',
  test: 'adapter:test',
  cancel: 'adapter:cancel',
  /** Not a database operation — runs outside runOp and never reaches the op log (Step 3). */
  configureCache: 'cache:configure',
} as const;

export const ENGINE_EVENT = {
  opStart: 'op:start',
  opEnd: 'op:end',
  connectionState: 'connection:state',
} as const;

// main → engine only, never renderer-visible: ConnectionSummary + the resolved password + the
// URI with the password re-injected (D7). Declared here, not in domain/connection.ts, so it is
// obvious that only the engine channel carries a secret.
// `preconnect` is stripped (P11/D13): it is a shell command with no meaning to the engine, and
// the engine is the one process boundary in this architecture treated as expendable/untrusted-ish
// (§4) — it has no business holding a string whose only purpose is to be executed.
// `preconnectSidecar` is stripped for the same reason — it only governs main's own arm()/monitor
// decision (src/main/connections.ts's doConnect) and has no meaning once the engine has the config.
export type ResolvedConnectionConfig = Omit<
  ConnectionSummary,
  'preconnect' | 'preconnectSidecar'
> & {
  password: string | null;
};

export const resolvedConnectionConfigSchema: z.ZodType<ResolvedConnectionConfig> =
  connectionSummarySchema.omit({ preconnect: true, preconnectSidecar: true }).extend({
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
  [ENGINE_OP.ddl]: z.object({ connectionId: z.string(), path: nodePathWireSchema }),
  [ENGINE_OP.test]: z.object({ config: resolvedConnectionConfigSchema }),
  [ENGINE_OP.cancel]: z.object({ opId: z.string() }),
  [ENGINE_OP.configureCache]: z.object({ l2BudgetBytes: z.number().int().min(1) }),
} as const;

export const engineOpResultSchema = {
  [ENGINE_OP.connect]: z.object({
    serverVersion: z.string(),
    details: z.record(z.string(), z.string()).optional(),
    // The renderer's projection menu (Step 9) branches on this — known immediately from the
    // adapter instance, before the connect probe even runs.
    caps: capsSchema,
  }),
  [ENGINE_OP.disconnect]: z.object({}),
  [ENGINE_OP.children]: z.object({ nodes: z.array(treeNodeSchema) }),
  [ENGINE_OP.describe]: z.object({ meta: objectMetaSchema }),
  [ENGINE_OP.ddl]: z.object({ ddl: sourceTextSchema }),
  [ENGINE_OP.test]: z.object({
    ok: z.boolean(),
    serverVersion: z.string().optional(),
    error: z.string().optional(),
  }),
  [ENGINE_OP.cancel]: z.object({ cancelled: z.boolean() }),
  [ENGINE_OP.configureCache]: z.object({}),
} as const;

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

export const connectionStateEventSchema = z.object({
  connectionId: z.string(),
  status: z.enum(['connected', 'error']),
  serverVersion: z.string().nullable(),
  error: z.string().nullable(),
});
export type ConnectionStateEvent = z.infer<typeof connectionStateEventSchema>;
