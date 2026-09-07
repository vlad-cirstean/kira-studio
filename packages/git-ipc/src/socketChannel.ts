/**
 * The extension-to-Kira-Studio channel (SPEC §3, G1 §5.3) — a `MessageChannelLike` over a Unix
 * socket instead of `webview.postMessage`. This is the whole point of the migration: everything
 * above this file (`rpc.ts`'s correlation/credits/cancellation) is unchanged, so a socket and a
 * webview are just two ~40-line adapters implementing the same seam.
 *
 * `bufferEncoding: "native"` — unlike `transport.ts`'s webview channel, a socket carries bytes by
 * definition, so the base64 detour that exists solely for a `WebviewView`'s clone semantics
 * (`codec.ts`'s own doc comment) is not needed here.
 *
 * Framing is D1/D2's own: a 4-byte big-endian length prefix, then that many bytes of UTF-8 JSON,
 * one `socket.write` per frame (never two writes for one frame — a partial frame on the wire
 * between them is a real interleaving hazard once more than one thing can write). This must stay
 * byte-identical to `internal/gitsock/frame.go`'s Go implementation; `socketChannel.test.ts` is
 * what keeps the two honest.
 *
 * G3 plan D4 adds a second frame *body* shape the read side must recognise: a blob frame, whose
 * first byte is `0x00` (a JSON frame's first byte is always `{`, so the two can never collide) —
 * `0x00 | uint32BE headerLen | headerJSON | blob…to the end of the frame`. `substituteBlob` below
 * finds the single `{"$blob":true}` marker gitrpc's own payload embeds (this file never learns
 * what a graph chunk is) and replaces it with the blob bytes as a fresh `ArrayBuffer`. `post` is
 * unchanged: the client here never sends a blob (D4) — only `internal/bridge/rpcstream` does.
 *
 * `onMessage` has a single current subscriber, not an independent listener per call — the same
 * "one reader, sequential ownership" invariant `gitsock/frame.go`'s `conn` keeps on the Go side
 * (D21): the extension's own connection manager reads the handshake's raw frames directly, then
 * hands this same channel to `createRpcClient` once `ready` arrives (§5.4). Two concurrent
 * `onMessage` subscribers racing to drain one shared byte stream would silently split frames
 * between them; a second `onMessage` call instead atomically replaces the first.
 */
import type { Socket } from 'node:net';
import type { MessageChannelLike } from './rpc.ts';

export const MAX_FRAME_BYTES = 8 * 1024 * 1024; // D1: 8 MiB, matching gitsock's own cap.

const FRAME_HEADER_LEN = 4;

export interface SocketChannel extends MessageChannelLike {
  onClose(handler: (err?: Error) => void): () => void;
}

/** Thrown (and the socket destroyed) when a peer's declared frame length exceeds the cap — the
 *  same hard-error posture `gitsock/frame.go`'s `readFrame` takes, never a silent truncation. */
export class FrameTooLargeError extends Error {
  constructor(declaredLength: number) {
    super(
      `socketChannel: frame of ${declaredLength} bytes exceeds the ${MAX_FRAME_BYTES}-byte cap`,
    );
    this.name = 'FrameTooLargeError';
  }
}

/** Thrown (and the socket destroyed) on a blob frame this file cannot make sense of: a header
 *  length pointing past the frame's end, a header that is not valid JSON, or a header with no
 *  `{"$blob":true}` marker (or more than one) for the frame's own single blob to fill — the same
 *  hard-error posture as `FrameTooLargeError`, never a silent truncation or a guessed substitution. */
export class MalformedBlobFrameError extends Error {
  constructor(reason: string) {
    super(`socketChannel: malformed blob frame: ${reason}`);
    this.name = 'MalformedBlobFrameError';
  }
}

const BLOB_FRAME_DISCRIMINANT = 0x00;
const BLOB_HEADER_LEN_OFFSET = 1;
const BLOB_HEADER_START = 5; // 1 discriminant byte + 4-byte big-endian header length.

function isBlobMarker(value: unknown): value is { readonly $blob: true } {
  return (
    value !== null && typeof value === 'object' && (value as { $blob?: unknown }).$blob === true
  );
}

/** Walks message the same shape `codec.ts`'s three traversals do, replacing the single
 *  `{"$blob":true}` marker with blob. Lives here rather than in `codec.ts` because it is a
 *  property of *this channel's* framing (D4), not of the buffer encodings `codec.ts` owns. */
function substituteBlob(value: unknown, blob: ArrayBuffer, seen: { count: number }): unknown {
  if (isBlobMarker(value)) {
    seen.count++;
    return blob;
  }
  if (Array.isArray(value)) return value.map((item) => substituteBlob(item, blob, seen));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, substituteBlob(item, blob, seen)]),
    );
  }
  return value;
}

function substituteBlobRoot(message: unknown, blob: ArrayBuffer): unknown {
  const seen = { count: 0 };
  const result = substituteBlob(message, blob, seen);
  if (seen.count === 0) {
    throw new MalformedBlobFrameError('header JSON carries no "$blob" marker');
  }
  if (seen.count > 1) {
    throw new MalformedBlobFrameError('header JSON carries more than one "$blob" marker');
  }
  return result;
}

export function createSocketChannel(socket: Socket): SocketChannel {
  let recvBuffer: Buffer = Buffer.alloc(0);
  let currentHandler: ((message: unknown) => void) | null = null;
  const closeHandlers = new Set<(err?: Error) => void>();

  function fireClose(err?: Error): void {
    for (const handler of [...closeHandlers]) handler(err);
  }

  socket.on('data', (chunk: Buffer) => {
    recvBuffer = recvBuffer.byteLength === 0 ? chunk : Buffer.concat([recvBuffer, chunk]);
    // Drain *every* complete frame present after this read — two frames delivered in one
    // TCP/Unix read would otherwise strand the second until more data arrives (this file's own
    // doc comment; the classic bug this loop exists to avoid).
    for (;;) {
      if (recvBuffer.byteLength < FRAME_HEADER_LEN) return;
      const declaredLength = recvBuffer.readUInt32BE(0);
      if (declaredLength > MAX_FRAME_BYTES) {
        socket.destroy(new FrameTooLargeError(declaredLength));
        return;
      }
      const frameEnd = FRAME_HEADER_LEN + declaredLength;
      if (recvBuffer.byteLength < frameEnd) return;
      const body = recvBuffer.subarray(FRAME_HEADER_LEN, frameEnd);
      recvBuffer = recvBuffer.subarray(frameEnd);

      if (body.byteLength > 0 && body[0] === BLOB_FRAME_DISCRIMINANT) {
        if (body.byteLength < BLOB_HEADER_START) {
          socket.destroy(new MalformedBlobFrameError('frame is too short for a header length'));
          return;
        }
        const headerLen = body.readUInt32BE(BLOB_HEADER_LEN_OFFSET);
        const headerEnd = BLOB_HEADER_START + headerLen;
        if (headerEnd > body.byteLength) {
          socket.destroy(new MalformedBlobFrameError('declared header length exceeds the frame'));
          return;
        }
        const headerBytes = body.subarray(BLOB_HEADER_START, headerEnd);
        const blobBytes = body.subarray(headerEnd);
        // A fresh, exactly-sized ArrayBuffer — never a view into recvBuffer, which is mutated/
        // reused as soon as this callback returns.
        const blob = blobBytes.buffer.slice(
          blobBytes.byteOffset,
          blobBytes.byteOffset + blobBytes.byteLength,
        ) as ArrayBuffer;
        try {
          const message: unknown = JSON.parse(headerBytes.toString('utf8'));
          currentHandler?.(substituteBlobRoot(message, blob));
        } catch (err) {
          socket.destroy(err instanceof Error ? err : new MalformedBlobFrameError(String(err)));
          return;
        }
      } else {
        currentHandler?.(JSON.parse(body.toString('utf8')));
      }
    }
  });
  socket.on('close', () => fireClose());
  socket.on('error', (err) => fireClose(err));

  return {
    bufferEncoding: 'native',

    post(message): void {
      const body = Buffer.from(JSON.stringify(message), 'utf8');
      if (body.byteLength > MAX_FRAME_BYTES) throw new FrameTooLargeError(body.byteLength);
      // One concatenated write, header then body — never two separate socket.write calls for
      // one frame (see this file's own doc comment).
      const frame = Buffer.allocUnsafe(FRAME_HEADER_LEN + body.byteLength);
      frame.writeUInt32BE(body.byteLength, 0);
      body.copy(frame, FRAME_HEADER_LEN);
      socket.write(frame);
    },

    onMessage(handler): () => void {
      currentHandler = handler;
      return () => {
        if (currentHandler === handler) currentHandler = null;
      };
    },

    close(): void {
      socket.end();
    },

    onClose(handler): () => void {
      closeHandlers.add(handler);
      return () => closeHandlers.delete(handler);
    },
  };
}
