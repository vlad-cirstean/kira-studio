import type { CountRequest, CountResult, ReadRequest, ReadResult } from '../shared/data';
import type { PingPayload, PortRequest, PortResponse } from '../shared/port';
import { PORT_EVENT, PORT_OP } from '../shared/port';
import { configure, dropConnection, dropPath, l2Get, l2Key, l2Put, l3Get, l3Key, l3Put, clearAll, stats } from './cache';
import { countRaw, dispatch as controlDispatch, readRaw } from './control';

type Handler = (payload: unknown) => Promise<unknown>;

// The renderer↔engine MessagePort carries both request/response frames (`kind: 'req'`/`'res'`) and
// push events (`kind: 'evt'`, see PortEvent). Event emission needs the attached port, which lives
// in engine/index.ts; rpc.ts exposes a setter so it stays importable from plain Bun (tests/db)
// where there is no port at all.
let postEvent: ((topic: string, payload: unknown) => void) | null = null;

export function setPortEmitter(emitter: ((topic: string, payload: unknown) => void) | null): void {
  postEvent = emitter;
}

// Same guard shape as ops.ts's emitEvent: a missing port is fine (unit-driver mode) — nothing to do.
export function emitPortEvent(topic: string, payload: unknown): void {
  postEvent?.(topic, payload);
}

// Cache-stats events are throttled (≤2/s, D25): the status bar needs a fresh-enough number, not a
// real-time one, and unthrottled pushes would be noise across every page read.
let lastStatsEmit = 0;
function emitStatsThrottled(): void {
  const now = Date.now();
  if (now - lastStatsEmit < 500) return;
  lastStatsEmit = now;
  emitPortEvent(PORT_EVENT.cacheStats, stats());
}

const handlers: Record<string, Handler> = {
  [PORT_OP.ping]: async () => {
    const payload: PingPayload = { pong: true, enginePid: process.pid, at: Date.now() };
    return payload;
  },
  [PORT_OP.read]: (payload) => read(payload as ReadRequest),
  [PORT_OP.count]: (payload) => count(payload as CountRequest),
  [PORT_OP.cacheStats]: async () => stats(),
  [PORT_OP.cacheClear]: async () => {
    clearAll();
    return true;
  },
};

async function read(req: ReadRequest): Promise<ReadResult> {
  const key = l2Key(req);
  if (req.refresh) {
    // D26: Refresh bypasses the lookup entirely and overwrites the entry.
    const result = await readRaw(req);
    const page = result;
    if (page.kind === 'tabular') {
      page.fromCache = false;
      l2Put(key, page);
    }
    emitStatsThrottled();
    return req.prefetch
      ? { delivered: false, rowCount: page.rowCount, bytes: page.bytes }
      : { delivered: true, page };
  }

  const cached = l2Get(key);
  if (cached) {
    if (req.prefetch) {
      emitStatsThrottled();
      return { delivered: false, rowCount: cached.rowCount, bytes: cached.bytes };
    }
    emitStatsThrottled();
    return { delivered: true, page: cached };
  }

  // Prefetch fills L2 and returns no payload (D21). The cache write happens for prefetch too — the
  // whole point is the next real read is a hit.
  const page = await readRaw(req);
  if (page.kind === 'tabular') {
    page.fromCache = false;
    l2Put(key, page);
  }
  emitStatsThrottled();
  return req.prefetch
    ? { delivered: false, rowCount: page.rowCount, bytes: page.bytes }
    : { delivered: true, page };
}

async function count(req: CountRequest): Promise<CountResult> {
  const key = l3Key(req);
  if (req.refresh) {
    const { value, exact } = await countRaw(req);
    l3Put(key, { value, exact });
    const at = new Date().toISOString();
    emitStatsThrottled();
    return { value, exact, fromCache: false, at };
  }
  const cached = l3Get(key);
  if (cached) {
    emitStatsThrottled();
    return { value: cached.value, exact: cached.exact, fromCache: true, at: new Date(cached.at).toISOString() };
  }
  const { value, exact } = await countRaw(req);
  l3Put(key, { value, exact });
  emitStatsThrottled();
  return { value, exact, fromCache: false, at: new Date().toISOString() };
}

export async function dispatch(request: PortRequest): Promise<PortResponse> {
  // Control ops (connect/disconnect/children/describe/test/cancel) come through here from the port
  // as well; everything else is a data/cache op handled locally.
  if (request.op in handlers) {
    const handler = handlers[request.op];
    try {
      const payload = await handler(request.payload);
      return { kind: 'res', id: request.id, ok: true, payload };
    } catch (err) {
      return {
        kind: 'res',
        id: request.id,
        ok: false,
        error: { message: err instanceof Error ? err.message : String(err) },
      };
    }
  }
  try {
    const payload = await controlDispatch(request);
    return { kind: 'res', id: request.id, ok: true, payload };
  } catch (err) {
    return {
      kind: 'res',
      id: request.id,
      ok: false,
      error: { message: err instanceof Error ? err.message : String(err) },
    };
  }
}

// Cache invalidation hooks wired from control.ts (D26): disconnect drops the whole connection;
// a refreshing describe/children on a path drops that path.
export { configure as configureCache, dropConnection as dropCacheConnection, dropPath as dropCachePath };
