import type { PortEvent, PortRequest, PortResponse } from '@shared/protocol/port';
// tsconfig.web.json maps this specifier onto @wailsio/runtime's real types (D8) and resolves it
// cleanly; tests/unit/tsconfig.json has no such mapping (a "paths" entry there breaks Bun's own
// mock.module interception for every file that transitively imports this one, not just the
// declaring project — see tests/unit/support/wailsRuntime.ts), so this import is unresolvable
// under that project, and TypeScript forbids an ambient `declare module` for a path-like
// specifier, leaving no clean per-project fix. The directive below deliberately stays the
// suppress-if-present kind rather than the require-an-error kind, which would itself fail as
// "unused" under the project where this import already resolves fine.
// biome-ignore lint/suspicious/noTsIgnore: an "unused directive" kind fails where this resolves fine (see comment above)
// @ts-ignore
import { JSONStream } from '/wails/runtime.js';

const DEFAULT_TIMEOUT_MS = 30_000;

interface PendingRequest {
  resolve: (payload: unknown) => void;
  reject: (err: Error & { code?: string }) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

let nextId = 1;
const pending = new Map<number, PendingRequest>();
const eventListeners = new Map<string, Set<(payload: unknown) => void>>();

// P52 §7.2 / P56: one named stream, matching bridge/stream.go's StreamName. Wails supersedes an
// older page generation's session itself (stream.ts's WailsSocket._closed + the poll loop it
// aborts), which is what retires src/main/index.ts's own `generation` counter — nothing here
// re-implements it.
const socket = JSONStream('engine');

let closed = false;

function rejectAllPending(message: string): void {
  for (const [id, req] of pending) {
    if (req.timer) clearTimeout(req.timer);
    req.reject(new Error(message));
    pending.delete(id);
  }
}

let resolveReady!: () => void;
let rejectReady!: (err: Error) => void;
export const ready = new Promise<void>((resolve, reject) => {
  resolveReady = resolve;
  rejectReady = reject;
});
// The stream is opened at module scope and `ready` may reject before any caller attaches a
// handler; without this, a failed open is an unhandled rejection in the console rather than the
// error `initEngineState`'s own catch is about to report.
void ready.catch(() => {});

// P57 finding, discovered by C1's own boot proof (§5.7): `TextColumnChunk` (protocol/page.ts) is
// four exactly-sized TypedArrays, a shape the old `MessagePort`'s structured clone carried across
// verbatim. JSONStream's transport does not — `src/engine/stdio-main.ts` (untouched by P57, §0.2)
// JSON.stringifies every frame, including data ones, and `JSON.stringify` on a Uint8Array/
// Uint32Array serializes it as a plain object keyed "0","1","2",... (TypedArrays are not
// `Array.isArray`), so `JSON.parse` hands back `{0:1,1:2,...}`, not a real typed array — every
// data-view read failed downstream with "chunk.data is not a Uint8Array" (protocol/page.ts's own
// assertChunkStructure) until this revived it. Recognised by the four field names together, since
// every page kind (tabular/document/key-value/object-store) reuses the exact same chunk shape
// under different key names (`data`, `ids`/`bodies`, `fields`/`values`, `keys`/`headers`/...).
function isChunkLike(
  v: unknown,
): v is { data: unknown; offsets: unknown; nulls: unknown; truncated: unknown } {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    'data' in v &&
    'offsets' in v &&
    'nulls' in v &&
    'truncated' in v
  );
}

// A9: every chunk's four buffers cross the wire as base64 of their exact little-endian bytes
// (P58 D5, P58f D8) rather than JSON.stringify's index-keyed object — decoded straight into the
// typed array's backing buffer, no per-element round trip.
function toTypedArray<T>(v: unknown, ctor: { new (buffer: ArrayBuffer): T }): T {
  const binary = atob(v as string);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new ctor(bytes.buffer);
}

export function reviveChunks(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reviveChunks);
  if (value && typeof value === 'object') {
    if (isChunkLike(value)) {
      return {
        data: toTypedArray(value.data, Uint8Array),
        offsets: toTypedArray(value.offsets, Uint32Array),
        nulls: toTypedArray(value.nulls, Uint8Array),
        truncated: toTypedArray(value.truncated, Uint32Array),
      };
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = reviveChunks(v);
    return out;
  }
  return value;
}

function handleMessage(message: PortResponse | PortEvent): void {
  if (message.kind === 'evt') {
    const payload = reviveChunks(message.payload);
    for (const cb of eventListeners.get(message.topic) ?? []) cb(payload);
    return;
  }
  const req = pending.get(message.id);
  if (!req) return;
  pending.delete(message.id);
  if (req.timer) clearTimeout(req.timer);
  if (message.ok) {
    req.resolve(reviveChunks(message.payload));
  } else {
    const err: Error & { code?: string } = new Error(message.error.message);
    err.code = message.error.code;
    req.reject(err);
  }
}

socket.onopen = () => resolveReady();

socket.onmessage = (ev: MessageEvent<unknown>) => {
  // JSONStream decodes for us — ev.data is the parsed frame, and a frame that is not valid JSON
  // raised `error` and never reached here (P57 D2).
  handleMessage(ev.data as PortResponse | PortEvent);
};

socket.onclose = () => {
  closed = true;
  rejectReady(new Error('engine stream closed'));
  rejectAllPending('engine stream closed before this request answered');
};
socket.onerror = () => {
  // `error` is always followed by `close`, so the teardown lives in onclose alone rather than
  // being duplicated and having to be made idempotent.
};

export function onPortEvent(topic: string, cb: (payload: unknown) => void): () => void {
  let set = eventListeners.get(topic);
  if (!set) {
    set = new Set();
    eventListeners.set(topic, set);
  }
  set.add(cb);
  return () => set?.delete(cb);
}

/**
 * `timeoutMs: null` means no client-side timeout (D25) — cancellation is the only escape hatch
 * for a data op, matching §5.1's rule that a stop button, never a timeout, is what ends a
 * still-running server query.
 */
export function request(
  op: string,
  payload: unknown = null,
  opts?: { timeoutMs?: number | null },
): Promise<unknown> {
  if (closed) return Promise.reject(new Error('engine stream is closed'));
  const id = nextId++;
  const timeoutMs = opts?.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : opts.timeoutMs;
  return new Promise((resolve, reject) => {
    const timer =
      timeoutMs === null
        ? null
        : setTimeout(() => {
            pending.delete(id);
            reject(new Error(`engine request "${op}" timed out`));
          }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    const req: PortRequest = { kind: 'req', id, op, payload };
    // P57 D3: send() throws on a CONNECTING socket and silently drops on a closed one, so the
    // send is gated on the open ack rather than fired synchronously. The timer starts now, not
    // after the ack — a request issued during a slow open must still time out on the caller's
    // schedule, which is the behaviour today's null-port rejection approximates.
    ready.then(
      () => {
        if (!closed) socket.send(req);
      },
      (err) => {
        pending.delete(id);
        if (timer) clearTimeout(timer);
        reject(err as Error);
      },
    );
  });
}
