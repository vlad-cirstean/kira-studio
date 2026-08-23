import type { PortRequest, PortResponse } from '../shared/port';
import { ENGINE_EVENT, ENGINE_OP, engineOpPayloadSchema } from '../shared/protocol/engine-ops';
import type { AdapterDeps } from './adapters/adapter';
import { AdapterError, toWireError } from './adapters/errors';
import { deleteLiveAdapter, getLiveAdapter, setLiveAdapter } from './adapters/live';
import { createAdapter } from './adapters/registry';
import { cache } from './cache';
import { cancelOp, runOp, wireScheduler } from './scheduler/ops';

function emit(topic: string, payload: unknown): void {
  process.parentPort.postMessage({ kind: 'evt', topic, payload });
}

wireScheduler({
  emit,
  getAdapter: getLiveAdapter,
});

const deps: AdapterDeps = {
  log(level, message) {
    const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    sink(`[engine] ${message}`);
  },
};

function requireAdapter(connectionId: string) {
  const adapter = getLiveAdapter(connectionId);
  if (!adapter) {
    throw new AdapterError('E_NOT_FOUND', `connection ${connectionId} has no active adapter`);
  }
  return adapter;
}

async function handleConnect(payload: unknown) {
  const { config } = engineOpPayloadSchema[ENGINE_OP.connect].parse(payload);

  // A reconnect is a disconnect + connect, never two live clients for the same connection.
  const existing = getLiveAdapter(config.id);
  if (existing) {
    await existing.disconnect().catch(() => {});
    deleteLiveAdapter(config.id);
  }

  const adapter = await createAdapter(config.kind, deps);
  // P13 D2: the engine created this adapter, so the engine disconnects it on every path,
  // including a failed probe or an aborted connect — an adapter left un-disconnected here can
  // leak whatever its driver already opened (D1).
  let value: Awaited<ReturnType<typeof adapter.connect>>;
  try {
    ({ value } = await runOp({ connectionId: config.id, kind: 'connect' }, (ctx) =>
      adapter.connect(config, ctx),
    ));
  } catch (err) {
    await adapter.disconnect().catch(() => {});
    throw err;
  }
  setLiveAdapter(config.id, adapter);
  emit(ENGINE_EVENT.connectionState, {
    connectionId: config.id,
    status: 'connected',
    serverVersion: value.serverVersion,
    error: null,
  });
  return { ...value, caps: adapter.caps };
}

async function handleDisconnect(payload: unknown) {
  const { connectionId } = engineOpPayloadSchema[ENGINE_OP.disconnect].parse(payload);
  const adapter = getLiveAdapter(connectionId);
  if (adapter) {
    await runOp({ connectionId, kind: 'disconnect' }, () => adapter.disconnect());
    deleteLiveAdapter(connectionId);
    // §2.2: disconnecting releases the connection's driver state and all its cached pages.
    cache.dropConnection(connectionId);
  }
  return {};
}

async function handleChildren(payload: unknown) {
  const { connectionId, path } = engineOpPayloadSchema[ENGINE_OP.children].parse(payload);
  const adapter = requireAdapter(connectionId);
  const { value } = await runOp({ connectionId, kind: 'children' }, async (ctx) => {
    const nodes = await adapter.children(path, ctx);
    ctx.setRows(nodes.length);
    return nodes;
  });
  return { nodes: value };
}

async function handleDescribe(payload: unknown) {
  const { connectionId, path } = engineOpPayloadSchema[ENGINE_OP.describe].parse(payload);
  const adapter = requireAdapter(connectionId);
  const { value } = await runOp({ connectionId, kind: 'describe' }, async (ctx) => {
    const meta = await adapter.describe(path, ctx);
    ctx.setRows(meta.columns.length);
    return meta;
  });
  return { meta: value };
}

async function handleDdl(payload: unknown) {
  const { connectionId, path } = engineOpPayloadSchema[ENGINE_OP.ddl].parse(payload);
  const adapter = requireAdapter(connectionId);
  const { value } = await runOp({ connectionId, kind: 'ddl' }, async (ctx) => {
    const ddl = await adapter.ddl(path, ctx);
    ctx.setRows(ddl.statements.length);
    return ddl;
  });
  return { ddl: value };
}

async function handleTest(payload: unknown) {
  const { config } = engineOpPayloadSchema[ENGINE_OP.test].parse(payload);
  const adapter = await createAdapter(config.kind, deps);
  try {
    const { value } = await runOp({ connectionId: null, kind: 'test' }, (ctx) =>
      adapter.connect(config, ctx),
    );
    return { ok: true, serverVersion: value.serverVersion };
  } catch (err) {
    return { ok: false, error: toWireError(err).message };
  } finally {
    // P13 D2: unconditional, so a failed probe (F1) is cleaned up the same as a successful one.
    await adapter.disconnect().catch(() => {});
  }
}

async function handleCancel(payload: unknown) {
  const { opId } = engineOpPayloadSchema[ENGINE_OP.cancel].parse(payload);
  const cancelled = await cancelOp(opId);
  return { cancelled };
}

// Not a database operation — runs outside runOp and never reaches the op log (Step 3).
async function handleConfigureCache(payload: unknown) {
  const { l2BudgetBytes } = engineOpPayloadSchema[ENGINE_OP.configureCache].parse(payload);
  cache.configure(l2BudgetBytes);
  return {};
}

type OpHandler = (payload: unknown) => Promise<unknown>;

const handlers: Record<string, OpHandler> = {
  [ENGINE_OP.connect]: handleConnect,
  [ENGINE_OP.disconnect]: handleDisconnect,
  [ENGINE_OP.children]: handleChildren,
  [ENGINE_OP.describe]: handleDescribe,
  [ENGINE_OP.ddl]: handleDdl,
  [ENGINE_OP.test]: handleTest,
  [ENGINE_OP.cancel]: handleCancel,
  [ENGINE_OP.configureCache]: handleConfigureCache,
};

export async function handleFrame(request: PortRequest): Promise<PortResponse> {
  const handler = handlers[request.op];
  if (!handler) {
    return {
      kind: 'res',
      id: request.id,
      ok: false,
      error: { message: `unknown engine op: ${request.op}`, code: 'E_UNSUPPORTED' },
    };
  }
  try {
    const payload = await handler(request.payload);
    return { kind: 'res', id: request.id, ok: true, payload };
  } catch (err) {
    return { kind: 'res', id: request.id, ok: false, error: toWireError(err) };
  }
}
