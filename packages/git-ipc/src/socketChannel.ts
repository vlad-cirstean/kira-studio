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
 * `0x00 | uint32BE headerLen | headerJSON | blob…to the end of the frame`. `parseBlobFrameBody`
 * (`blobFrame.ts`, shared with `streamChannel.ts` — C10 S1) finds the single `{"$blob":true}`
 * marker gitrpc's own payload embeds (this file never learns what a graph chunk is) and replaces
 * it with the blob bytes as a fresh `ArrayBuffer`. `post` is unchanged: the client here never
 * sends a blob (D4) — only `internal/bridge/rpcstream` does.
 *
 * `onMessage` has a single current subscriber, not an independent listener per call — the same
 * "one reader, sequential ownership" invariant `gitsock/frame.go`'s `conn` keeps on the Go side
 * (D21): the extension's own connection manager reads the handshake's raw frames directly, then
 * hands this same channel to `createRpcClient` once `ready` arrives (§5.4). Two concurrent
 * `onMessage` subscribers racing to drain one shared byte stream would silently split frames
 * between them; a second `onMessage` call instead atomically replaces the first. A frame that
 * arrives in the gap between one subscriber unsubscribing and the next subscribing — which
 * happens whenever a handler does anything asynchronous before resubscribing — is queued rather
 * than dropped (G12 D5a); see `MAX_PENDING_FRAMES` below.
 */
import type { Socket } from 'node:net';
import {
  BLOB_FRAME_DISCRIMINANT,
  MalformedBlobFrameError,
  parseBlobFrameBody,
} from './blobFrame.ts';
import type { MessageChannelLike } from './rpc.ts';

// Re-exported for existing callers (socketChannel.test.ts) — the type now lives in blobFrame.ts
// (C10 S1), shared with streamChannel.ts, but this stays the socket channel's own public surface.
export { MalformedBlobFrameError };

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

/** Thrown (and the socket destroyed) when a frame arrives with no subscriber and the queue that
 *  holds it for the next one (see `MAX_PENDING_FRAMES` below) is already full — the same
 *  hard-error posture as `FrameTooLargeError`, never a silent drop. */
export class PendingFrameOverflowError extends Error {
  constructor(cap: number) {
    super(`socketChannel: more than ${cap} frames arrived with no subscriber`);
    this.name = 'PendingFrameOverflowError';
  }
}

/** Thrown (and the socket destroyed) when a well-framed, correctly-parsed message's own delivery
 *  throws — `JSON.parse` on a malformed body, or the subscriber itself (the RPC client's own
 *  `ContractVersionMismatchError`/`ContractShapeError`/`TransportError`, thrown synchronously from
 *  inside `handleFrame`). G30 round-1 architecture/security review, finding #8: this used to be
 *  entirely uncaught for a plain (non-blob) frame — the throw unwound out of the `for(;;)` drain
 *  loop, stranding every OTHER complete frame already sitting in `recvBuffer` from the same read
 *  until more bytes arrived, an indefinite hang on an otherwise-idle connection. Destroying here
 *  matches the blob branch's own existing posture (a header/body it cannot make sense of already
 *  destroys) rather than leaving the loop to strand the rest of the buffer. */
export class FrameDeliveryError extends Error {
  constructor(reason: string) {
    super(`socketChannel: frame delivery failed: ${reason}`);
    this.name = 'FrameDeliveryError';
  }
}

interface FrameDrainState {
  recvBuffer: Buffer;
}

// A blob frame's body (BLOB_FRAME_DISCRIMINANT-prefixed) — `parseBlobFrameBody`'s own parse
// failure destroys the socket exactly like a malformed JSON body does (deliverFrame below).
// Returns whether the frame was delivered (drainFrames' own signal to keep draining or stop).
function deliverBlobFrame(
  body: Buffer,
  deliver: (message: unknown) => void,
  destroy: (err: Error) => void,
): boolean {
  try {
    deliver(parseBlobFrameBody(body));
    return true;
  } catch (err) {
    destroy(err instanceof Error ? err : new MalformedBlobFrameError(String(err)));
    return false;
  }
}

// A plain JSON frame's body — see deliverBlobFrame's own doc comment.
function deliverFrame(
  body: Buffer,
  deliver: (message: unknown) => void,
  destroy: (err: Error) => void,
): boolean {
  try {
    deliver(JSON.parse(body.toString('utf8')));
    return true;
  } catch (err) {
    destroy(err instanceof Error ? err : new FrameDeliveryError(String(err)));
    return false;
  }
}

// Drains *every* complete frame currently sitting in `state.recvBuffer` — two frames delivered in
// one read would otherwise strand the second until more data arrives (this file's own doc
// comment). The four early `return`s below are real early returns, not `break`s: each ends this
// whole drain (the caller's `socket.on('data', …)` handler has nothing left to do either way),
// not just the current frame — past each of them there either isn't a complete frame yet (a
// partial header or a partial body) or the socket is already being destroyed, and recvBuffer must
// not be touched again after that.
function drainFrames(
  state: FrameDrainState,
  deliver: (message: unknown) => void,
  destroy: (err: Error) => void,
): void {
  for (;;) {
    if (state.recvBuffer.byteLength < FRAME_HEADER_LEN) return;
    const declaredLength = state.recvBuffer.readUInt32BE(0);
    if (declaredLength > MAX_FRAME_BYTES) {
      destroy(new FrameTooLargeError(declaredLength));
      return;
    }
    const frameEnd = FRAME_HEADER_LEN + declaredLength;
    if (state.recvBuffer.byteLength < frameEnd) return;
    const body = state.recvBuffer.subarray(FRAME_HEADER_LEN, frameEnd);
    state.recvBuffer = state.recvBuffer.subarray(frameEnd);

    const delivered =
      body.byteLength > 0 && body[0] === BLOB_FRAME_DISCRIMINANT
        ? deliverBlobFrame(body, deliver, destroy)
        : deliverFrame(body, deliver, destroy);
    if (!delivered) return;
  }
}

export function createSocketChannel(socket: Socket): SocketChannel {
  const drainState: FrameDrainState = { recvBuffer: Buffer.alloc(0) };
  let currentHandler: ((message: unknown) => void) | null = null;
  const closeHandlers = new Set<(err?: Error) => void>();

  // A frame that arrives between two subscribers is queued, never dropped: the read loop below
  // drains every complete frame present after one read, synchronously (this file's own doc
  // comment), so a handler that resubscribes across an `await` — connection.ts's handshake does —
  // would otherwise lose whatever the same read already delivered. Bounded because an unread
  // queue is a leak, not a feature: past the cap the socket is destroyed, the same hard-error
  // posture as an oversize frame.
  const MAX_PENDING_FRAMES = 64;
  const pendingFrames: unknown[] = [];

  function fireClose(err?: Error): void {
    for (const handler of [...closeHandlers]) handler(err);
  }

  function deliver(message: unknown): void {
    if (currentHandler) {
      currentHandler(message);
      return;
    }
    if (pendingFrames.length >= MAX_PENDING_FRAMES) {
      socket.destroy(new PendingFrameOverflowError(MAX_PENDING_FRAMES));
      return;
    }
    pendingFrames.push(message);
  }

  socket.on('data', (chunk: Buffer) => {
    drainState.recvBuffer =
      drainState.recvBuffer.byteLength === 0
        ? chunk
        : Buffer.concat([drainState.recvBuffer, chunk]);
    drainFrames(drainState, deliver, (err) => socket.destroy(err));
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
      // Flush whatever queued up while no one was subscribed, in arrival order, before this call
      // returns — a resubscribe must never observe a gap in the frame sequence.
      while (pendingFrames.length > 0 && currentHandler === handler) {
        const message = pendingFrames.shift();
        handler(message);
      }
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
