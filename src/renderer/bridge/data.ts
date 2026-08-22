import {
  type CacheStats,
  type CountRequestWire,
  type CountResponse,
  DATA_OP,
  PORT_EVENT,
  type PrefetchResponse,
  type ReadRequestWire,
  type ReadResponse,
} from '@shared/protocol/data-ops';
import { assertPageStructure } from '@shared/protocol/page';
import { onPortEvent, request } from './port';

// Data ops have no client-side timeout (D25) — cancellation via `control.opsCancel` is the only
// escape hatch, never an abandoned-but-still-running server query.
const NO_TIMEOUT = { timeoutMs: null as null };

// Built from Vue `reactive()` tab state (projection, filter, sort, ...) — their Proxy wrappers
// fail `MessagePort.postMessage`'s structured clone, so every request is round-tripped through
// JSON here before crossing the port, mirroring control.ts's `plain()` for the contextBridge.
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function readResponse(req: ReadRequestWire): Promise<ReadResponse> {
  const response = (await request(DATA_OP.read, plain(req), NO_TIMEOUT)) as ReadResponse;
  assertPageStructure(response.page);
  return response;
}

async function prefetchResponse(req: ReadRequestWire): Promise<PrefetchResponse> {
  return (await request(DATA_OP.prefetch, plain(req), NO_TIMEOUT)) as PrefetchResponse;
}

export const data = {
  read: readResponse,
  count: (req: CountRequestWire): Promise<CountResponse> =>
    request(DATA_OP.count, plain(req), NO_TIMEOUT) as Promise<CountResponse>,
  prefetch: prefetchResponse,
  invalidate: async (connectionId: string, path: string): Promise<void> => {
    await request(DATA_OP.invalidate, { connectionId, path });
  },
  clearCaches: async (): Promise<void> => {
    await request(DATA_OP.cacheClear);
  },
  cacheStats: (): Promise<CacheStats> => request(DATA_OP.cacheStats) as Promise<CacheStats>,
  onCacheStats: (cb: (stats: CacheStats) => void): (() => void) =>
    onPortEvent(PORT_EVENT.cacheStats, (payload) => cb(payload as CacheStats)),
};
