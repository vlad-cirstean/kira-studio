import { expect, test } from 'bun:test';
import {
  createStreamChannel,
  MalformedBlobFrameError,
  type StreamSocketLike,
} from './streamChannel.ts';

// A minimal WebSocket-like double: this file's own contract is "MessageChannelLike over a
// WebSocket-like object" (§3.4), not any particular runtime's WebSocket — a plain in-memory stand-
// in is enough to drive onmessage/onclose the same way a real WailsSocket would.
class MockSocket implements StreamSocketLike {
  binaryType = 'arraybuffer';
  onopen: (() => void) | null = null;
  // biome-ignore lint/suspicious/noExplicitAny: matches StreamSocketLike's own cross-project escape hatch.
  onmessage: ((ev: any) => void) | null = null;
  // biome-ignore lint/suspicious/noExplicitAny: matches StreamSocketLike's own cross-project escape hatch.
  onclose: ((ev: any) => void) | null = null;
  // biome-ignore lint/suspicious/noExplicitAny: matches StreamSocketLike's own cross-project escape hatch.
  onerror: ((ev: any) => void) | null = null;
  readonly sent: unknown[] = [];
  closed = false;

  send(data: string | ArrayBufferLike | ArrayBufferView): void {
    this.sent.push(data);
  }

  // Deliberately does not fire onclose itself — a real socket's close() dispatches its close
  // event asynchronously, never synchronously from inside the caller that requested it, and a
  // test relying on the opposite would mask the malformed-frame path's own explicit fireClose.
  close(): void {
    this.closed = true;
  }

  /** Test-only: deliver one message as this socket's peer would. */
  deliver(data: ArrayBuffer): void {
    this.onmessage?.({ data });
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function jsonFrame(value: unknown): ArrayBuffer {
  return toArrayBuffer(new TextEncoder().encode(JSON.stringify(value)));
}

// buildBlobFrame constructs the same wire body streamChannel.ts and socketChannel.ts both parse —
// 0x00 | uint32BE headerLen | headerJSON | blob — with no outer length prefix, since a Wails
// stream is message-framed already (§3.4).
function buildBlobFrame(header: unknown, blob: Uint8Array): ArrayBuffer {
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const body = new Uint8Array(1 + 4 + headerBytes.byteLength + blob.byteLength);
  body[0] = 0x00;
  new DataView(body.buffer).setUint32(1, headerBytes.byteLength, false);
  body.set(headerBytes, 5);
  body.set(blob, 5 + headerBytes.byteLength);
  return toArrayBuffer(body);
}

test('decodes a plain JSON frame', () => {
  const socket = new MockSocket();
  const channel = createStreamChannel(socket);
  const received: unknown[] = [];
  channel.onMessage((msg) => received.push(msg));

  socket.deliver(jsonFrame({ hello: 'world' }));

  expect(received).toEqual([{ hello: 'world' }]);
});

test('substitutes a $blob marker nested inside a payload', () => {
  const socket = new MockSocket();
  const channel = createStreamChannel(socket);
  const received: unknown[] = [];
  channel.onMessage((msg) => received.push(msg));

  const blob = new TextEncoder().encode('the-blob-bytes');
  socket.deliver(
    buildBlobFrame({ t: 'chunk', envelope: { seq: 1 }, payload: { chunk: { $blob: true } } }, blob),
  );

  const msg = received[0] as { payload: { chunk: ArrayBuffer } };
  expect(new Uint8Array(msg.payload.chunk)).toEqual(blob);
});

test('closes and reports MalformedBlobFrameError when the header length exceeds the frame', () => {
  const socket = new MockSocket();
  const channel = createStreamChannel(socket);
  channel.onMessage(() => undefined);
  let closeErr: Error | undefined;
  channel.onClose((err) => {
    closeErr = err;
  });

  // discriminant + a header length far larger than any body actually present, no header/blob bytes.
  const body = new Uint8Array([0x00, 0xff, 0xff, 0xff, 0xff]);
  socket.deliver(toArrayBuffer(body));

  expect(closeErr).toBeInstanceOf(MalformedBlobFrameError);
  expect(socket.closed).toBe(true);
});

test('closes and reports MalformedBlobFrameError when the header carries no $blob marker', () => {
  const socket = new MockSocket();
  const channel = createStreamChannel(socket);
  channel.onMessage(() => undefined);
  let closeErr: Error | undefined;
  channel.onClose((err) => {
    closeErr = err;
  });

  socket.deliver(buildBlobFrame({ hello: 'world' }, new TextEncoder().encode('x')));

  expect(closeErr).toBeInstanceOf(MalformedBlobFrameError);
  expect(socket.closed).toBe(true);
});

test('closes and reports MalformedBlobFrameError when the header carries two $blob markers', () => {
  const socket = new MockSocket();
  const channel = createStreamChannel(socket);
  channel.onMessage(() => undefined);
  let closeErr: Error | undefined;
  channel.onClose((err) => {
    closeErr = err;
  });

  socket.deliver(
    buildBlobFrame({ a: { $blob: true }, b: { $blob: true } }, new TextEncoder().encode('x')),
  );

  expect(closeErr).toBeInstanceOf(MalformedBlobFrameError);
  expect(socket.closed).toBe(true);
});

test('post JSON-stringifies and sends, never encoding a blob', () => {
  const socket = new MockSocket();
  const channel = createStreamChannel(socket);

  channel.post({ id: 1, method: 'graph.status' });

  expect(socket.sent).toEqual([JSON.stringify({ id: 1, method: 'graph.status' })]);
});

test('sets binaryType to arraybuffer so inbound frames are never delivered as a Blob', () => {
  const socket = new MockSocket();
  socket.binaryType = 'blob';
  createStreamChannel(socket);
  expect(socket.binaryType).toBe('arraybuffer');
});
