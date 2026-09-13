/**
 * The Kira-Studio-native channel (C10 §3.4) — a `MessageChannelLike` over a Wails stream, the
 * in-process peer of `socketChannel.ts`'s socket channel. `internal/bridge/gitstream.go` hands
 * `*application.StreamConn` straight to `rpcstream.NewSession` with no length prefix at all (a
 * Wails stream is message-framed already — the prefix `gitsock/frame.go` adds exists only because
 * a `net.Conn` is a byte stream with no message boundaries of its own), so this file has none of
 * `socketChannel.ts`'s `recvBuffer`/drain-loop/`MAX_PENDING_FRAMES` machinery: every inbound
 * message here is already one whole frame body.
 *
 * `bufferEncoding: 'native'` — a Wails stream carries real `ArrayBuffer`s, like the socket and
 * unlike a VS Code `WebviewView` (`socketChannel.ts`'s own doc comment).
 *
 * The frame *body* shape is the one `blobFrame.ts` (C10 S1) already owns: a `0x00` first byte is a
 * blob frame (`0x00 | uint32BE headerLen | headerJSON | blob…`), anything else is a plain JSON
 * frame. One implementation of that layout shared with `socketChannel.ts`, not a second copy.
 *
 * `post` never encodes a blob — the client here never sends one, only
 * `internal/bridge/rpcstream` does (same as `socketChannel.ts`).
 */
import {
  BLOB_FRAME_DISCRIMINANT,
  MalformedBlobFrameError,
  parseBlobFrameBody,
} from './blobFrame.ts';
import type { MessageChannelLike } from './rpc.ts';

// Re-exported so a caller can `instanceof`-check a close reason without importing blobFrame.ts
// directly — the same shape socketChannel.ts's own re-export follows.
export { MalformedBlobFrameError };

/**
 * The useful subset of `WebSocket`/Wails' own `WailsSocket` this file needs. Declared locally
 * rather than referencing the DOM lib's `WebSocket`/`MessageEvent`/`CloseEvent` types: this
 * package's `tsconfig.json` has no `"dom"` lib (it also runs under Bun/Node), so those names do
 * not exist here. The event-parameter types below are deliberately `any` — the real object a
 * caller passes (`@wailsio/runtime`'s `WailsSocket | WebSocket`) is declared against the DOM lib's
 * `Event`/`MessageEvent`/`CloseEvent`, and a structural interface narrower than those types would
 * fail TypeScript's contravariant parameter check for a plain property-typed callback (unlike a
 * method, which checks bivariantly) purely on library-type-name grounds, not on any real mismatch
 * at runtime — every `data`/`code`/`reason` reference below is defensive-cast at the point of use.
 */
export interface StreamSocketLike {
  binaryType: string;
  onopen: (() => void) | null;
  // biome-ignore lint/suspicious/noExplicitAny: cross-project structural type — see interface doc above.
  onmessage: ((ev: any) => void) | null;
  // biome-ignore lint/suspicious/noExplicitAny: cross-project structural type — see interface doc above.
  onclose: ((ev: any) => void) | null;
  // biome-ignore lint/suspicious/noExplicitAny: cross-project structural type — see interface doc above.
  onerror: ((ev: any) => void) | null;
  send(data: string | ArrayBufferLike | ArrayBufferView): void;
  close(): void;
}

export interface StreamChannel extends MessageChannelLike {
  onClose(handler: (err?: Error) => void): () => void;
}

/** Thrown when an inbound frame's body cannot be decoded as JSON and is not a valid blob frame
 *  either — the stream channel's counterpart of `socketChannel.ts`'s `FrameDeliveryError`. */
export class StreamFrameDeliveryError extends Error {
  constructor(reason: string) {
    super(`streamChannel: frame delivery failed: ${reason}`);
    this.name = 'StreamFrameDeliveryError';
  }
}

function decodeFrame(data: ArrayBuffer): unknown {
  const bytes = new Uint8Array(data);
  if (bytes.byteLength > 0 && bytes[0] === BLOB_FRAME_DISCRIMINANT) {
    return parseBlobFrameBody(bytes);
  }
  return JSON.parse(new TextDecoder('utf-8').decode(bytes));
}

export function createStreamChannel(socket: StreamSocketLike): StreamChannel {
  socket.binaryType = 'arraybuffer';

  let currentHandler: ((message: unknown) => void) | null = null;
  const closeHandlers = new Set<(err?: Error) => void>();

  function fireClose(err?: Error): void {
    for (const handler of [...closeHandlers]) handler(err);
  }

  socket.onmessage = (ev: { data: ArrayBuffer }) => {
    let message: unknown;
    try {
      message = decodeFrame(ev.data);
    } catch (err) {
      socket.close();
      fireClose(err instanceof Error ? err : new StreamFrameDeliveryError(String(err)));
      return;
    }
    if (currentHandler) currentHandler(message);
    // No pending-frame queue (unlike socketChannel.ts): the transport's own createRpcClient
    // subscribes with onMessage before the socket can have delivered anything, and this channel
    // has exactly one subscriber for its whole life — there is no resubscribe-across-an-await gap
    // to lose a frame in.
  };
  socket.onclose = () => fireClose();
  socket.onerror = () => {
    // An `error` event on a Wails/DOM socket is always followed by `close` — teardown lives in
    // onclose alone, the same posture `port.ts`'s own `socket.onerror` already takes.
  };

  return {
    bufferEncoding: 'native',

    post(message): void {
      socket.send(JSON.stringify(message));
    },

    onMessage(handler): () => void {
      currentHandler = handler;
      return () => {
        if (currentHandler === handler) currentHandler = null;
      };
    },

    close(): void {
      socket.close();
    },

    onClose(handler): () => void {
      closeHandlers.add(handler);
      return () => closeHandlers.delete(handler);
    },
  };
}
