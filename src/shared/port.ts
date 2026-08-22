export interface PortRequest {
  kind: 'req';
  id: number;
  op: string;
  payload: unknown;
}

export type PortResponse =
  | { kind: 'res'; id: number; ok: true; payload: unknown }
  | { kind: 'res'; id: number; ok: false; error: { message: string; code?: string } };

export interface PortEvent {
  kind: 'evt';
  topic: string;
  payload: unknown;
}

export interface PingPayload {
  pong: true;
  enginePid: number;
  at: number;
}

// The renderer↔engine port op and topic vocabularies, so neither side spells a string literal.
export const PORT_OP = {
  ping: 'ping',
  read: 'data:read',
  count: 'data:count',
  cacheStats: 'cache:stats',
  cacheClear: 'cache:clear',
} as const;

export const PORT_EVENT = { cacheStats: 'cache:stats' } as const;

export interface CacheStats {
  l2Bytes: number;
  l2Entries: number;
  l2Budget: number;
  l2Hits: number;
  l2Misses: number;
  l3Entries: number;
  l3Hits: number;
  l3Misses: number;
}

// NOTE (D3): a `data:read` response is the one frame where `payload` is not JSON-shaped — it
// carries typed arrays, cloned by Electron's structured-clone serializer (the transfer list accepts
// only MessagePortMain, never ArrayBuffer, so the buffers are copied, not transferred).
