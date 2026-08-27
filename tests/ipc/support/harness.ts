import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConnectionState } from '@shared/domain/connection';
import { ENGINE_OP, type ResolvedConnectionConfig } from '@shared/protocol/engine-ops';
import type {
  TreeChildrenResult,
  TreeDefinitionResult,
  TreeDescribeResult,
} from '@shared/protocol/ipc';

/**
 * The backend tier's harness (P50 §2.4). It replaces exactly two transports and nothing else —
 * `utilityProcess`/`process.parentPort` (Electron plumbing) — and runs the real `TreeService`,
 * the real `handleFrame`/`dispatch`, the real adapter, against a real temp `KIRA_HOME` and a real
 * data store. `ConnectionsService` is stubbed to the one method `TreeService` reads
 * (`stateOf` — tree-service.ts calls nothing else on it).
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

  const kiraHomeDir = await mkdtemp(join(tmpdir(), 'kira-ipc-'));
  process.env.KIRA_HOME = kiraHomeDir;

  const { openDb } = await import('../../../src/main/storage/db');
  const { migrate } = await import('../../../src/main/storage/migrate');
  const { ensureLayout } = await import('../../../src/main/storage/paths');
  const { createTreeService } = await import('../../../src/main/tree-service');
  const { insertConnection } = await import('../../../src/main/storage/repos/connections');
  const control = await import('../../../src/engine/control');
  const rpc = await import('../../../src/engine/rpc');

  ensureLayout();
  const { db, raw, close: closeDb } = await openDb();
  migrate(raw);

  const states = new Map<string, ConnectionState>();
  function stateOf(id: string): ConnectionState {
    return (
      states.get(id) ?? {
        connectionId: id,
        status: 'disconnected',
        serverVersion: null,
        error: null,
        since: 0,
        caps: null,
      }
    );
  }
  // TreeService reads only `stateOf` (tree-service.ts:73-79) — everything else on
  // ConnectionsService is untyped-away here rather than stubbed, since nothing calls it.
  const connectionsStub = {
    stateOf,
  } as unknown as import('../../../src/main/connections').ConnectionsService;

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

  const tree = createTreeService(
    db,
    { call: engineOp } as unknown as import('../../../src/main/engine-host').EngineHost,
    connectionsStub,
  );

  return {
    engineOp,
    dataOp,
    async connect(config) {
      // metadata_cache.connection_id has an FK against connections.id — a real ConnectionsService
      // always inserts this row before anything can be cached against it, so the harness must
      // too, or TreeService.children's first cache write throws a foreign-key violation.
      await insertConnection(db, {
        id: config.id,
        createdAt: config.createdAt,
        fields: {
          name: config.name,
          kind: config.kind,
          color: config.color,
          mode: config.mode,
          readOnly: config.readOnly,
          host: config.host,
          port: config.port,
          database: config.database,
          username: config.username,
          uri: config.uri,
          options: config.options,
          preconnect: null,
          preconnectSidecar: false,
        },
      });
      const result = await engineOp<{ serverVersion: string; caps: unknown }>(ENGINE_OP.connect, {
        config,
      });
      states.set(config.id, {
        connectionId: config.id,
        status: 'connected',
        serverVersion: result.serverVersion,
        error: null,
        since: Date.now(),
        caps: result.caps as ConnectionState['caps'],
      });
      return result;
    },
    children: (connectionId, path, refresh = false) => tree.children(connectionId, path, refresh),
    describe: (connectionId, path, refresh = false, tabId = null) =>
      tree.describe(connectionId, path, refresh, tabId),
    definition: (connectionId, path, refresh = false, tabId = null) =>
      tree.definition(connectionId, path, refresh, tabId),
    async close() {
      const connectionId = [...states.keys()][0];
      if (connectionId) await engineOp(ENGINE_OP.disconnect, { connectionId }).catch(() => {});
      closeDb();
      await rm(kiraHomeDir, { recursive: true, force: true });
    },
  };
}
