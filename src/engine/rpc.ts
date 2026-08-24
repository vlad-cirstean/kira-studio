import type { PingPayload, PortRequest, PortResponse } from '../shared/port';
import { DATA_OP, invalidateRequestWireSchema } from '../shared/protocol/data-ops';
import { cache } from './cache';
import {
  handleCount,
  handleExecute,
  handleMutate,
  handleObjectDownload,
  handlePreview,
  handleRead,
} from './data';

type Handler = (payload: unknown) => Promise<unknown>;

const handlers: Record<string, Handler> = {
  ping: async () => {
    const payload: PingPayload = { pong: true, enginePid: process.pid, at: Date.now() };
    return payload;
  },
  [DATA_OP.read]: async (payload) => {
    const { response } = await handleRead(payload);
    return response;
  },
  [DATA_OP.count]: handleCount,
  [DATA_OP.preview]: handlePreview,
  [DATA_OP.mutate]: handleMutate,
  [DATA_OP.execute]: handleExecute,
  [DATA_OP.objectDownload]: handleObjectDownload,
  [DATA_OP.invalidate]: async (payload) => {
    const { connectionId, path, scope } = invalidateRequestWireSchema.parse(payload);
    // P13 D18: 'pages' is the post-mutation reload — the count's stale mark was already set by
    // DATA_OP.mutate and must survive this call, or the stale-count UI never has a chance to
    // render before it is erased.
    if (scope === 'pages') {
      cache.dropPagesOnly(connectionId, path);
    } else {
      cache.dropTarget(connectionId, path);
    }
    return {};
  },
  [DATA_OP.cacheStats]: async () => cache.stats(),
  [DATA_OP.cacheClear]: async () => {
    cache.clear();
    return {};
  },
};

/**
 * `transfer` is plumbing for a future platform that lets `MessagePortMain.postMessage` transfer
 * raw bytes — Electron's typings currently only accept `MessagePortMain[]` in that list (checked
 * 2026-08-22 against `node_modules/electron/electron.d.ts`), so no handler here ever populates
 * it. A `TabularPage`'s buffers still travel safely via structured clone, which — unlike a
 * transfer — never detaches the L2-cached original (D4): the fields below always come back
 * `undefined` today, and that is correct, not a bug.
 */
export async function dispatch(
  request: PortRequest,
): Promise<{ response: PortResponse; transfer?: unknown[] }> {
  const handler = handlers[request.op];
  if (!handler) {
    return {
      response: {
        kind: 'res',
        id: request.id,
        ok: false,
        error: { message: `unknown op: ${request.op}`, code: 'E_UNSUPPORTED' },
      },
    };
  }
  try {
    const payload = await handler(request.payload);
    return { response: { kind: 'res', id: request.id, ok: true, payload } };
  } catch (err) {
    const code = (err as { code?: unknown } | undefined)?.code;
    return {
      response: {
        kind: 'res',
        id: request.id,
        ok: false,
        error: {
          message: err instanceof Error ? err.message : String(err),
          code: typeof code === 'string' ? code : undefined,
        },
      },
    };
  }
}
