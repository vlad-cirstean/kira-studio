import type { ConnectionState } from '../shared/connection';
import type { CountRequest, ReadRequest } from '../shared/data';
import {
  type ConnectInfo,
  cancelPayloadSchema,
  childrenPayloadSchema,
  connectInfoSchema,
  connectPayloadSchema,
  configurePayloadSchema,
  ddlPayloadSchema,
  describePayloadSchema,
  disconnectPayloadSchema,
  ENGINE_EVENT,
  ENGINE_OP,
  type ResolvedConnectionConfig,
  type TestResult,
  testPayloadSchema,
} from '../shared/engine-ops';
import type { Page } from '../shared/page';
import type { PortRequest, PortResponse } from '../shared/port';
import { decodePath } from '../shared/tree';
import type { Adapter } from './adapters/adapter';
import { toWireError } from './adapters/errors';
import { createAdapter } from './adapters/registry';
import { dropConnection as dropCacheConnection, dropPath as dropCachePath } from './cache';
import { abortOp, emitEvent, runOp } from './ops';

// Main↔engine control dispatch. Parses every inbound frame with its Zod schema before use (trust
// boundary), wraps every server-touching call in runOp, and owns the adapter registry. Connection
// state changes are emitted as connection:state events (main relays them to the renderer).

const adapters = new Map<string, Adapter>();
const states = new Map<string, ConnectionState>();

function engineLog(level: 'info' | 'warn' | 'error', message: string): void {
  (level === 'error' ? console.error : console.log)(`[engine] ${message}`);
}

function emitState(state: ConnectionState): void {
  states.set(state.connectionId, state);
  emitEvent(ENGINE_EVENT.connectionState, state);
}

export async function handleFrame(request: PortRequest): Promise<void> {
  let response: PortResponse;
  try {
    response = { kind: 'res', id: request.id, ok: true, payload: await dispatch(request) };
  } catch (err) {
    response = { kind: 'res', id: request.id, ok: false, error: toWireError(err) };
  }
  process.parentPort.postMessage(response);
}

export async function dispatch(request: PortRequest): Promise<unknown> {
  switch (request.op) {
    case ENGINE_OP.connect:
      return connect(connectPayloadSchema.parse(request.payload));
    case ENGINE_OP.disconnect:
      return disconnect(disconnectPayloadSchema.parse(request.payload));
    case ENGINE_OP.children:
      return children(childrenPayloadSchema.parse(request.payload));
    case ENGINE_OP.describe:
      return describe(describePayloadSchema.parse(request.payload));
    case ENGINE_OP.ddl:
      return ddl(ddlPayloadSchema.parse(request.payload));
    case ENGINE_OP.test:
      return test(testPayloadSchema.parse(request.payload));
    case ENGINE_OP.cancel:
      return cancel(cancelPayloadSchema.parse(request.payload));
    case ENGINE_OP.configure:
      return configureEngine(configurePayloadSchema.parse(request.payload));
    default:
      throw new Error(`unknown engine op: ${request.op}`);
  }
}

// Engine-level configuration (settings changes, D25/D26): L2 budget and L3 TTL land in the cache
// module. Called from main on startup and whenever cache settings change.
async function configureEngine(payload: {
  l2BudgetBytes: number;
  l3TtlSeconds: number;
}): Promise<void> {
  configureCache({ l2BudgetBytes: payload.l2BudgetBytes, l3TtlMs: payload.l3TtlSeconds * 1000 });
  return undefined;
}

import { configure as configureCache } from './cache';

// The data path (P2 D1): read/count requests travel over the port and dispatch here. They run inside
// runOp so they land in the op log with a working stop button (D9). `readRaw`/`countRaw` are the
// engine-side implementation the rpc.ts cache layer calls after its own lookup.
export async function readRaw(req: ReadRequest): Promise<Page> {
  const adapter = requireAdapter(req.connectionId);
  const { value } = await runOp(
    { connectionId: req.connectionId, kind: 'read', tabId: req.tabId },
    async (ctx) => {
      const page = await adapter.read(req, ctx);
      if (page.kind === 'tabular') ctx.setRows(page.rowCount);
      return page;
    },
  );
  return value;
}

export async function countRaw(req: CountRequest): Promise<{ value: number; exact: boolean }> {
  const adapter = requireAdapter(req.connectionId);
  const { value } = await runOp(
    { connectionId: req.connectionId, kind: 'count', tabId: req.tabId },
    (ctx) => adapter.count(req, ctx),
  );
  return value;
}

async function connect(cfg: ResolvedConnectionConfig): Promise<ConnectInfo> {
  const existing = adapters.get(cfg.id);
  if (existing) {
    try {
      await existing.disconnect();
    } catch {
      // a stale adapter that fails to disconnect must not block a reconnect
    }
    adapters.delete(cfg.id);
  }

  const adapter = createAdapter(cfg.kind, { log: engineLog });
  const { value } = await runOp({ connectionId: cfg.id, kind: 'connect' }, (ctx) =>
    adapter.connect(cfg, ctx),
  );

  adapters.set(cfg.id, adapter);
  const info = connectInfoSchema.parse(value);
  emitState({
    connectionId: cfg.id,
    status: 'connected',
    serverVersion: info.serverVersion,
    error: null,
    since: Date.now(),
  });
  return info;
}

async function disconnect(payload: { connectionId: string }): Promise<void> {
  const adapter = adapters.get(payload.connectionId);
  adapters.delete(payload.connectionId);
  if (adapter) {
    await runOp({ connectionId: payload.connectionId, kind: 'disconnect' }, () =>
      adapter.disconnect(),
    );
  }
  // D26: disconnect drops everything cached for that connection.
  dropCacheConnection(payload.connectionId);
  emitState({
    connectionId: payload.connectionId,
    status: 'disconnected',
    serverVersion: null,
    error: null,
    since: Date.now(),
  });
}

async function children(payload: {
  connectionId: string;
  path: string;
  refresh?: boolean;
}): Promise<unknown> {
  const adapter = requireAdapter(payload.connectionId);
  // D26: a refreshing enumerate on a path drops that path's L2/L3 entries (the metadata the pages
  // depend on may have changed).
  if (payload.refresh) dropCachePath(payload.connectionId, payload.path);
  const { value } = await runOp(
    { connectionId: payload.connectionId, kind: 'children' },
    async (ctx) => {
      const nodes = await adapter.children(decodePath(payload.connectionId, payload.path), ctx);
      ctx.setRows(nodes.length);
      return nodes;
    },
  );
  return value;
}

async function describe(payload: {
  connectionId: string;
  path: string;
  refresh?: boolean;
}): Promise<unknown> {
  const adapter = requireAdapter(payload.connectionId);
  if (payload.refresh) dropCachePath(payload.connectionId, payload.path);
  const { value } = await runOp(
    { connectionId: payload.connectionId, kind: 'describe' },
    async (ctx) => {
      const meta = await adapter.describe(decodePath(payload.connectionId, payload.path), ctx);
      ctx.setRows(meta.columns.length);
      return meta;
    },
  );
  return value;
}

async function ddl(payload: {
  connectionId: string;
  path: string;
  refresh?: boolean;
}): Promise<unknown> {
  const adapter = requireAdapter(payload.connectionId);
  if (payload.refresh) dropCachePath(payload.connectionId, payload.path);
  const { value } = await runOp({ connectionId: payload.connectionId, kind: 'ddl' }, async (ctx) => {
    const source = await adapter.ddl(decodePath(payload.connectionId, payload.path), ctx);
    ctx.setRows(1); // one object
    return source;
  });
  return value;
}

async function test(cfg: ResolvedConnectionConfig): Promise<TestResult> {
  const adapter = createAdapter(cfg.kind, { log: engineLog });
  try {
    const { value } = await runOp({ connectionId: null, kind: 'test' }, (ctx) =>
      adapter.connect(cfg, ctx),
    );
    const info = connectInfoSchema.parse(value);
    return { ok: true, serverVersion: info.serverVersion };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await adapter.disconnect().catch(() => {});
  }
}

async function cancel(payload: { opId: string }): Promise<boolean> {
  const entry = abortOp(payload.opId);
  if (!entry || entry.connectionId === null) return false;
  const adapter = adapters.get(entry.connectionId);
  if (!adapter?.caps.cancel) return false;
  return adapter.cancel(payload.opId);
}

function requireAdapter(connectionId: string): Adapter {
  const adapter = adapters.get(connectionId);
  if (!adapter) throw new Error('connection is not open');
  return adapter;
}
