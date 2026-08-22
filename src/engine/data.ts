import { decodePath } from '../shared/domain/tree';
import {
  type CountRequestWire,
  type CountResponse,
  countRequestWireSchema,
  type PrefetchResponse,
  type ReadRequestWire,
  type ReadResponse,
  readRequestWireSchema,
} from '../shared/protocol/data-ops';
import type { TabularPage } from '../shared/protocol/page';
import { AdapterError } from './adapters/errors';
import { getLiveAdapter } from './adapters/live';
import { cache, pageCacheKey } from './cache';
import { runOp } from './scheduler/ops';

// The phase's hot path (§4c). A cache hit is not a database operation and must not appear in
// the op log — P1's tree spec established exactly that contract for L1, and P2's specs assert
// it again for L2.
export async function handleRead(
  payload: unknown,
): Promise<{ response: ReadResponse; page: TabularPage }> {
  const req: ReadRequestWire = readRequestWireSchema.parse(payload);
  const { key, label } = pageCacheKey(req);

  const cached = cache.readPage(key);
  if (cached) {
    return { response: { page: cached, source: 'cache' }, page: cached };
  }

  const adapter = getLiveAdapter(req.connectionId);
  if (!adapter) {
    // The renderer turns this into the tab's Reconnect & load affordance.
    throw new AdapterError('E_NOT_FOUND', `connection ${req.connectionId} has no active adapter`);
  }

  const path = decodePath(req.connectionId, req.path);
  const { value: page } = await runOp(
    { connectionId: req.connectionId, kind: 'read', opId: req.opId, tabId: req.tabId },
    async (ctx) => {
      const page = await adapter.read(
        {
          path,
          projection: req.projection,
          filter: req.filter,
          sort: req.sort,
          pageSize: req.pageSize,
          cursor: req.cursor,
        },
        ctx,
      );
      ctx.setRows(page.rowCount);
      return page;
    },
  );

  cache.storePage(key, label, req, page);
  return { response: { page, source: 'server' }, page };
}

export async function handleCount(payload: unknown): Promise<CountResponse> {
  const req: CountRequestWire = countRequestWireSchema.parse(payload);

  const cached = cache.count(req.connectionId, req.path, req.filter);
  if (cached) {
    return {
      value: cached.value,
      exact: cached.exact,
      at: cached.at,
      stale: cached.stale,
      source: 'cache',
    };
  }

  const adapter = getLiveAdapter(req.connectionId);
  if (!adapter) {
    throw new AdapterError('E_NOT_FOUND', `connection ${req.connectionId} has no active adapter`);
  }

  const path = decodePath(req.connectionId, req.path);
  const { value } = await runOp(
    { connectionId: req.connectionId, kind: 'count', opId: req.opId, tabId: req.tabId },
    async (ctx) => {
      const result = await adapter.count({ path, filter: req.filter }, ctx);
      ctx.setRows(result.value);
      return result;
    },
  );

  cache.storeCount(req.connectionId, req.path, req.filter, value.value, value.exact);
  return { value: value.value, exact: value.exact, at: Date.now(), stale: false, source: 'server' };
}

// D14: never ships bytes. Reuses handleRead's cache-aside logic entirely (a separate cache
// probe here would double-count the miss in L2's hit/miss stats) and derives `warmed`/`bytes`
// from whether the read actually hit the server.
export async function handlePrefetch(payload: unknown): Promise<PrefetchResponse> {
  const { response, page } = await handleRead(payload);
  return {
    warmed: response.source === 'server',
    bytes: response.source === 'server' ? page.byteSize : 0,
  };
}
