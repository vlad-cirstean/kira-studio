import type { ObjectDefinition } from '@shared/domain/definition';
import { decodePath, type ObjectMeta, type TreeNode } from '@shared/domain/tree';
import { ENGINE_OP, type ResolvedConnectionConfig } from '@shared/protocol/engine-ops';

export interface TreeChildrenResult {
  nodes: TreeNode[];
  source: 'cache' | 'server';
  truncated: boolean;
}
export interface TreeDescribeResult {
  meta: ObjectMeta;
  source: 'cache' | 'server';
}
export interface TreeDefinitionResult {
  definition: ObjectDefinition;
  source: 'cache' | 'server';
}

/**
 * The backend tier's harness (P50 §2.4). It replaces exactly two transports and nothing else —
 * `utilityProcess`/`process.parentPort` (Electron plumbing) — and runs the real
 * `engine/control.ts::handleFrame`/`engine/rpc.ts::dispatch` and the real adapter. No database and
 * no `KIRA_HOME` are set up any more (P57 D15) — nothing left in this file needs either; grepped,
 * the engine itself reads no `KIRA_HOME` anywhere.
 *
 * P57 D15: `children`/`describe`/`definition` used to go through `src/main/tree-service.ts`'s
 * real cache-aside, backed by this same now-removed database. That file is Electron-only (P57
 * deletes it outright), so this is a ~20-line test-local stand-in, not a port of it. It exists
 * only so this tier's fixture
 * generation stays reproducible: the fixtures record `source`/`truncated`, which are
 * TreeService's own contribution rather than the engine's, and regenerating all seven fixture
 * files needs Docker and a real adapter container, so the old behaviour has to be reproduced
 * exactly rather than dropped. The real cache semantics — persistence, the schema-mismatch drop,
 * a truncated-refresh rule — are asserted for real in `shell/internal/tree/service_test.go`; this
 * object deliberately implements none of them beyond hit/miss.
 */
export interface Harness {
  /** A control-channel op (`ENGINE_OP.*`), run through the real `engine/control.ts::handleFrame`. */
  engineOp<T = unknown>(op: string, payload: unknown): Promise<T>;
  /** A bulk-data op (`DATA_OP.*`), run through the real `engine/rpc.ts::dispatch`. */
  dataOp<T = unknown>(op: string, payload: unknown): Promise<T>;
  /** Connects, and — mirroring what `main/connections.ts` does in production on the engine's
   *  `connection:state` event — marks the connection connected so `TreeService.requireConnected`
   *  passes for every call made through this harness afterward. */
  connect(config: ResolvedConnectionConfig): Promise<{ serverVersion: string; caps: unknown }>;
  children(connectionId: string, path: string, refresh?: boolean): Promise<TreeChildrenResult>;
  describe(
    connectionId: string,
    path: string,
    refresh?: boolean,
    tabId?: string | null,
  ): Promise<TreeDescribeResult>;
  definition(
    connectionId: string,
    path: string,
    refresh?: boolean,
    tabId?: string | null,
  ): Promise<TreeDefinitionResult>;
  close(): Promise<void>;
}

interface EngineErrorLike extends Error {
  code?: string;
}

function toThrown(error: { message: string; code?: string }): EngineErrorLike {
  const err: EngineErrorLike = new Error(error.message);
  err.code = error.code;
  return err;
}

export async function openHarness(): Promise<Harness> {
  // F8: engine/control.ts's emit() calls process.parentPort.postMessage at module scope
  // (wireScheduler binds it eagerly), so the stub must exist *before* that module is imported —
  // hence the dynamic imports below rather than static ones.
  if (!('parentPort' in process) || !process.parentPort) {
    Object.defineProperty(process, 'parentPort', {
      configurable: true,
      value: { postMessage() {}, on() {} },
    });
  }

  const control = await import('../../../src/engine/control');
  const rpc = await import('../../../src/engine/rpc');

  let nextFrameId = 1;

  async function engineOp<T>(op: string, payload: unknown): Promise<T> {
    const res = await control.handleFrame({ kind: 'req', id: nextFrameId++, op, payload });
    if (!res.ok) throw toThrown(res.error);
    return res.payload as T;
  }

  async function dataOp<T>(op: string, payload: unknown): Promise<T> {
    const { response } = await rpc.dispatch({ kind: 'req', id: nextFrameId++, op, payload });
    if (!response.ok) throw toThrown(response.error);
    return response.payload as T;
  }

  // P57 D15: a test-local stand-in for shell/internal/tree.Service's cache-aside — see the
  // Harness doc comment above. Mirrors engine/control.ts:handleChildren's own contract: `nodes`
  // comes straight from the adapter, `truncated` is only ever present when the adapter actually
  // said so, and a truncated listing is never cached (P43 iter3 D38).
  const childrenCache = new Map<string, TreeNode[]>();
  async function children(
    connectionId: string,
    path: string,
    refresh = false,
  ): Promise<TreeChildrenResult> {
    const key = `${connectionId} ${path}`;
    if (!refresh && childrenCache.has(key)) {
      return { nodes: childrenCache.get(key) as TreeNode[], source: 'cache', truncated: false };
    }
    const res = await engineOp<{ nodes: TreeNode[]; truncated?: boolean }>(ENGINE_OP.children, {
      connectionId,
      path: decodePath(connectionId, path),
    });
    // The real cache-aside persists through a JSON-backed repo (storage/repos/metadata-cache.ts),
    // which drops any key whose value is `undefined` (e.g. a table node's optional `detail`) —
    // mirrored here so a cache hit and a fresh read return the same shape, not just equal values.
    const nodes = JSON.parse(JSON.stringify(res.nodes)) as TreeNode[];
    if (!res.truncated) childrenCache.set(key, nodes);
    return { nodes, source: 'server', truncated: !!res.truncated };
  }

  const describeCache = new Map<string, ObjectMeta>();
  async function describe(
    connectionId: string,
    path: string,
    refresh = false,
    tabId: string | null = null,
  ): Promise<TreeDescribeResult> {
    const key = `${connectionId} ${path}`;
    if (!refresh && describeCache.has(key)) {
      return { meta: describeCache.get(key) as ObjectMeta, source: 'cache' };
    }
    const { meta } = await engineOp<{ meta: ObjectMeta }>(ENGINE_OP.describe, {
      connectionId,
      path: decodePath(connectionId, path),
      tabId,
    });
    describeCache.set(key, meta);
    return { meta, source: 'server' };
  }

  const definitionCache = new Map<string, ObjectDefinition>();
  async function definition(
    connectionId: string,
    path: string,
    refresh = false,
    tabId: string | null = null,
  ): Promise<TreeDefinitionResult> {
    const key = `${connectionId} ${path}`;
    if (!refresh && definitionCache.has(key)) {
      return { definition: definitionCache.get(key) as ObjectDefinition, source: 'cache' };
    }
    const { definition: def } = await engineOp<{ definition: ObjectDefinition }>(
      ENGINE_OP.definition,
      { connectionId, path: decodePath(connectionId, path), tabId },
    );
    definitionCache.set(key, def);
    return { definition: def, source: 'server' };
  }

  const connectedIds = new Set<string>();

  return {
    engineOp,
    dataOp,
    async connect(config) {
      const result = await engineOp<{ serverVersion: string; caps: unknown }>(ENGINE_OP.connect, {
        config,
      });
      connectedIds.add(config.id);
      return result;
    },
    children,
    describe,
    definition,
    async close() {
      const connectionId = [...connectedIds][0];
      if (connectionId) await engineOp(ENGINE_OP.disconnect, { connectionId }).catch(() => {});
    },
  };
}
