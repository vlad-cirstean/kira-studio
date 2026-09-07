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
      currentHandler?.(JSON.parse(body.toString('utf8')));
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
