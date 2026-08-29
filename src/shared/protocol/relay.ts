// The Neutralino relay wire codec and frame shapes (P52 D4/D6/D7).
//
// `extensions.dispatch`/`app.broadcast` only carry JSON (P52 §0.2) — a `Uint8Array` or
// `Uint32Array` cannot cross it directly, and result pages (`TabularPage` and friends,
// `src/shared/protocol/page.ts`) are built almost entirely out of them. Every value this app
// sends over the relay is therefore run through `encodeFrame`/`decodeFrame` first: a JSON
// envelope with typed-array fields replaced by `{ __b, t, byteOffset, byteLength }` placeholders,
// plus one concatenated binary blob carrying the actual bytes, 4-byte-aligned before every
// `Uint32Array` view (required — `new Uint32Array(buf, off, len)` throws unless `off % 4 === 0`,
// and `assertPageStructure` (page.ts) requires the decoded copy to be a genuine `Uint32Array`).
//
// The blob is base64'd by the caller (Node's `Buffer` on the app-process side, `atob`/`btoa` in
// the renderer — kept out of this file so it stays usable from either) and, above `CHUNK_BYTES`,
// split across `kira:relay:chunk` frames rather than sent whole: §0.3 measured a single frame at
// or over ~32 MB silently killing the Neutralino WebSocket (websocketpp's default
// `max_message_size`), and §0.4 measured 256 KB as the best or joint-best chunk size on total
// time, time-to-first-byte, control latency and page-stall at both 4 MB and 22 MB payloads.

export const CHUNK_BYTES = 256 * 1024;
// §0.3: the socket dies silently, no error frame, somewhere between 31.88 MB and 32.16 MB of a
// single frame. 1 MB leaves a wide margin while still being far above CHUNK_BYTES, so this cap is
// a hard backstop against a bug that skips chunking, not a tuning knob.
export const MAX_FRAME_BYTES = 1024 * 1024;

type TypedArrayKind = 'u8' | 'u32';

interface BlobRef {
  __b: number;
  t: TypedArrayKind;
  byteOffset: number;
  byteLength: number;
}

function isBlobRef(value: unknown): value is BlobRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { __b?: unknown }).__b === 'number' &&
    typeof (value as { t?: unknown }).t === 'string'
  );
}

export interface EncodedFrame {
  envelope: unknown;
  blob: Uint8Array;
}

function align4(n: number): number {
  return (n + 3) & ~3;
}

/**
 * Walks `value`, replacing every `Uint8Array`/`Uint32Array` with a `BlobRef` placeholder and
 * appending its bytes to one concatenated blob (D7). A `Uint32Array` view is padded to a 4-byte
 * boundary before being appended so `decodeFrame` can hand back a genuine `Uint32Array` — the
 * typed-array constructor throws otherwise.
 */
export function encodeFrame(value: unknown): EncodedFrame {
  const parts: Uint8Array[] = [];
  let cursor = 0;
  let nextRef = 0;

  function put(bytes: Uint8Array, kind: TypedArrayKind): BlobRef {
    if (kind === 'u32') {
      const padded = align4(cursor);
      if (padded !== cursor) {
        parts.push(new Uint8Array(padded - cursor));
        cursor = padded;
      }
    }
    const byteOffset = cursor;
    parts.push(bytes);
    cursor += bytes.length;
    return { __b: nextRef++, t: kind, byteOffset, byteLength: bytes.length };
  }

  function walk(node: unknown): unknown {
    if (node instanceof Uint32Array) {
      return put(new Uint8Array(node.buffer, node.byteOffset, node.byteLength), 'u32');
    }
    if (node instanceof Uint8Array) {
      return put(node, 'u8');
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) out[k] = walk(v);
      return out;
    }
    return node;
  }

  const envelope = walk(value);
  const blob = new Uint8Array(cursor);
  let offset = 0;
  for (const part of parts) {
    blob.set(part, offset);
    offset += part.length;
  }
  return { envelope, blob };
}

/**
 * Inverse of `encodeFrame`. `blob` is copied into a fresh `ArrayBuffer` before views are cut from
 * it — the reassembled blob is routinely a `subarray`/`slice` with a nonzero `byteOffset`, and a
 * `Uint32Array`'s alignment requirement is relative to the underlying buffer, not the slice.
 */
export function decodeFrame(envelope: unknown, blob: Uint8Array): unknown {
  const copy = new Uint8Array(blob.byteLength);
  copy.set(blob);
  const buffer = copy.buffer;

  function walk(node: unknown): unknown {
    if (isBlobRef(node)) {
      if (node.t === 'u32') return new Uint32Array(buffer, node.byteOffset, node.byteLength / 4);
      return new Uint8Array(buffer, node.byteOffset, node.byteLength);
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) out[k] = walk(v);
      return out;
    }
    return node;
  }

  return walk(envelope);
}

/** Splits an already-base64'd string into `size`-character chunks, in order. Never returns an
 *  empty array — a zero-length body is one chunk containing `''`, so a receiver counting chunks
 *  against a known total never has to special-case "no blob". */
export function chunkBase64(b64: string, size: number = CHUNK_BYTES): string[] {
  if (b64.length === 0) return [''];
  const chunks: string[] = [];
  for (let i = 0; i < b64.length; i += size) chunks.push(b64.slice(i, i + size));
  return chunks;
}

/** Inverse of `chunkBase64` — reassembly is a plain join, named so call sites document intent
 *  rather than reaching for `.join('')` inline. */
export function joinBase64Chunks(chunks: readonly string[]): string {
  return chunks.join('');
}

// --- Wire frame shapes (D4's six event names) ------------------------------------------------

/** Which client-side "door" (P52 Stage 4) a request/response/event belongs to: `'ipc'` for the
 *  61-channel `window.kira` control surface (`src/shared/protocol/ipc.ts`'s `IPC` channels),
 *  `'engine'` for the bulk data-op transport `bridge/port.ts` exposes to `bridge/data.ts`
 *  (`DATA_OP` from `data-ops.ts`). Both ride the same six wire event names; `door` plus `name`
 *  is how the app process's one dispatcher (and each door's own renderer-side listener) tells
 *  them apart. */
export type RelayDoor = 'ipc' | 'engine';

export interface RelayOpenPayload {
  generation: number;
}

/** `kira:relay:req` (page -> app process). */
export interface RelayRequestPayload {
  id: number;
  door: RelayDoor;
  name: string;
  payload: unknown;
}

/** A response or event body: `encodeFrame`'s envelope plus its base64 blob, sent whole when it
 *  fits in `CHUNK_BYTES`, split across `kira:relay:chunk` frames (keyed by the owning frame's
 *  `id`) otherwise. */
export interface RelayBody {
  envelope: unknown;
  /** `''` when `chunked` is set — the base64 body is arriving as separate chunk frames instead. */
  b64: string;
  /** Present only when the body did not fit in one frame: the number of `kira:relay:chunk`
   *  frames that follow for this `id`. */
  chunked?: number;
}

/** `kira:relay:res` (app process -> page), answering one `RelayRequestPayload` by `id`. */
export type RelayResponsePayload =
  | { id: number; door: RelayDoor; ok: true; body: RelayBody }
  | { id: number; door: RelayDoor; ok: false; error: { message: string; code?: string } };

/** `kira:relay:evt` (app process -> page), unprompted. `id` is a stream id the app process
 *  assigns (its own counter, distinct from request ids) so a chunked event's frames can be
 *  matched the same way a chunked response's can. */
export interface RelayEventPayload {
  id: number;
  door: RelayDoor;
  topic: string;
  body: RelayBody;
}

/** `kira:relay:chunk` (app process -> page). `owner` says whether `id` indexes into the
 *  response-pending table or the event-stream table — the two counters are independent and can
 *  collide numerically. */
export interface RelayChunkPayload {
  id: number;
  owner: 'res' | 'evt';
  door: RelayDoor;
  seq: number;
  body: string;
  /** Set instead of continuing the sequence when a cancel drops this stream mid-flight (D10) —
   *  the receiver discards whatever it had buffered for `id` rather than waiting for `chunked`
   *  frames that will never arrive. */
  aborted?: true;
}

/** `kira:ctl` (either direction) — small, fire-and-forget, never chunked: the page's
 *  `kira:app:flushed` ack and its window-resize/move reporter (P52 reality #9 — Neutralino has
 *  no resize/move event of its own to subscribe to from the app process side). */
export type RelayCtlPayload =
  | { kind: 'flushed' }
  | { kind: 'resize'; bounds: { x: number; y: number; width: number; height: number } };

export const RELAY_EVENT = {
  open: 'kira:relay:open',
  req: 'kira:relay:req',
  res: 'kira:relay:res',
  chunk: 'kira:relay:chunk',
  evt: 'kira:relay:evt',
  ctl: 'kira:ctl',
} as const;
