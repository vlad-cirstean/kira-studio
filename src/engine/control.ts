import type { ConnectionState } from '../shared/connection';
import {
  type ConnectInfo,
  cancelPayloadSchema,
  childrenPayloadSchema,
  connectInfoSchema,
  connectPayloadSchema,
  describePayloadSchema,
  disconnectPayloadSchema,
  ENGINE_EVENT,
  ENGINE_OP,
  type ResolvedConnectionConfig,
  type TestResult,
  testPayloadSchema,
} from '../shared/engine-ops';
import type { PortRequest, PortResponse } from '../shared/port';
import { decodePath } from '../shared/tree';
import type { Adapter } from './adapters/adapter';
import { toWireError } from './adapters/errors';
import { createAdapter } from './adapters/registry';
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

async function dispatch(request: PortRequest): Promise<unknown> {
  switch (request.op) {
    case ENGINE_OP.connect:
      return connect(connectPayloadSchema.parse(request.payload));
    case ENGINE_OP.disconnect:
      return disconnect(disconnectPayloadSchema.parse(request.payload));
    case ENGINE_OP.children:
      return children(childrenPayloadSchema.parse(request.payload));
    case ENGINE_OP.describe:
      return describe(describePayloadSchema.parse(request.payload));
    case ENGINE_OP.test:
      return test(testPayloadSchema.parse(request.payload));
    case ENGINE_OP.cancel:
      return cancel(cancelPayloadSchema.parse(request.payload));
    default:
      throw new Error(`unknown engine op: ${request.op}`);
  }
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
  emitState({
    connectionId: payload.connectionId,
    status: 'disconnected',
    serverVersion: null,
    error: null,
    since: Date.now(),
  });
}

async function children(payload: { connectionId: string; path: string }): Promise<unknown> {
  const adapter = requireAdapter(payload.connectionId);
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

async function describe(payload: { connectionId: string; path: string }): Promise<unknown> {
  const adapter = requireAdapter(payload.connectionId);
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
