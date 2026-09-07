import { expect, test } from 'bun:test';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createSocketChannel,
  FrameTooLargeError,
  MAX_FRAME_BYTES,
  MalformedBlobFrameError,
} from './socketChannel.ts';

// D1's framing boundary arithmetic, from the TypeScript side — the counterpart of
// internal/gitsock/frame_test.go. The two implementations must agree byte for byte, and this is
// the only thing that checks that.
async function withConnectedPair(
  fn: (client: net.Socket, server: net.Socket) => Promise<void>,
): Promise<void> {
  const sockPath = path.join(
    os.tmpdir(),
    `kira-socketchannel-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`,
  );
  const listener = net.createServer();
  await new Promise<void>((resolve) => listener.listen(sockPath, resolve));

  try {
    const serverSocketPromise = new Promise<net.Socket>((resolve) =>
      listener.once('connection', resolve),
    );
    const client = net.connect(sockPath);
    await new Promise<void>((resolve, reject) => {
      client.once('connect', () => resolve());
      client.once('error', reject);
    });
    const server = await serverSocketPromise;
    try {
      await fn(client, server);
    } finally {
      client.destroy();
      server.destroy();
    }
  } finally {
    listener.close();
  }
}

test('round-trips an empty object', async () => {
  await withConnectedPair(async (client, server) => {
    const clientChannel = createSocketChannel(client);
    const serverChannel = createSocketChannel(server);
    const received = new Promise<unknown>((resolve) => serverChannel.onMessage(resolve));
    clientChannel.post({});
    expect(await received).toEqual({});
  });
});

test('round-trips a 1 MiB payload split by the OS across many reads', async () => {
  await withConnectedPair(async (client, server) => {
    const clientChannel = createSocketChannel(client);
    const serverChannel = createSocketChannel(server);
    const big = 'x'.repeat(1024 * 1024);
    const received = new Promise<unknown>((resolve) => serverChannel.onMessage(resolve));
    clientChannel.post({ big });
    const msg = (await received) as { big: string };
    expect(msg.big.length).toBe(big.length);
    expect(msg.big).toBe(big);
  });
});

test('drains three frames written in one underlying write', async () => {
  await withConnectedPair(async (client, server) => {
    const serverChannel = createSocketChannel(server);
    const messages: unknown[] = [];
    const allReceived = new Promise<void>((resolve) => {
      serverChannel.onMessage((msg) => {
        messages.push(msg);
        if (messages.length === 3) resolve();
      });
    });

    // Bypass createSocketChannel's own post() (one write per frame) to genuinely construct three
    // frames concatenated into a single client.write call.
    const frames = [{ n: 1 }, { n: 2 }, { n: 3 }].map((m) => {
      const body = Buffer.from(JSON.stringify(m), 'utf8');
      const frame = Buffer.allocUnsafe(4 + body.byteLength);
      frame.writeUInt32BE(body.byteLength, 0);
      body.copy(frame, 4);
      return frame;
    });
    client.write(Buffer.concat(frames));

    await allReceived;
    expect(messages).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });
});

// buildBlobFrame constructs D4's own wire body — 0x00 | uint32BE headerLen | headerJSON | blob —
// wrapped in gitsock's outer 4-byte length prefix, exactly as internal/bridge/rpcstream's
// encodeBody produces it.
function buildBlobFrame(header: unknown, blob: Buffer): Buffer {
  const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
  const body = Buffer.concat([
    Buffer.from([0x00]),
    (() => {
      const b = Buffer.alloc(4);
      b.writeUInt32BE(headerBytes.byteLength, 0);
      return b;
    })(),
    headerBytes,
    blob,
  ]);
  const frame = Buffer.allocUnsafe(4 + body.byteLength);
  frame.writeUInt32BE(body.byteLength, 0);
  body.copy(frame, 4);
  return frame;
}

test('reassembles a blob frame, substituting the $blob marker with the raw bytes', async () => {
  await withConnectedPair(async (client, server) => {
    const serverChannel = createSocketChannel(server);
    const received = new Promise<unknown>((resolve) => serverChannel.onMessage(resolve));
    const blob = Buffer.from('the-blob-bytes', 'utf8');
    client.write(buildBlobFrame({ t: 'chunk', id: 1, chunk: { $blob: true } }, blob));

    const msg = (await received) as { chunk: ArrayBuffer };
    expect(Buffer.from(msg.chunk)).toEqual(blob);
  });
});

test('reassembles a blob frame split across three socket reads', async () => {
  await withConnectedPair(async (client, server) => {
    const serverChannel = createSocketChannel(server);
    const received = new Promise<unknown>((resolve) => serverChannel.onMessage(resolve));
    const blob = Buffer.from('x'.repeat(5000), 'utf8');
    const full = buildBlobFrame({ chunk: { $blob: true }, seq: 7 }, blob);

    const third = Math.floor(full.byteLength / 3);
    client.write(full.subarray(0, third));
    await new Promise((r) => setTimeout(r, 5));
    client.write(full.subarray(third, third * 2));
    await new Promise((r) => setTimeout(r, 5));
    client.write(full.subarray(third * 2));

    const msg = (await received) as { chunk: ArrayBuffer; seq: number };
    expect(msg.seq).toBe(7);
    expect(Buffer.from(msg.chunk)).toEqual(blob);
  });
});

test('a JSON frame immediately following a blob frame in one read is not lost', async () => {
  await withConnectedPair(async (client, server) => {
    const serverChannel = createSocketChannel(server);
    const messages: unknown[] = [];
    const allReceived = new Promise<void>((resolve) => {
      serverChannel.onMessage((msg) => {
        messages.push(msg);
        if (messages.length === 2) resolve();
      });
    });

    const blob = Buffer.from('abc', 'utf8');
    const blobFrame = buildBlobFrame({ chunk: { $blob: true } }, blob);
    const jsonBody = Buffer.from(JSON.stringify({ hello: 'world' }), 'utf8');
    const jsonFrame = Buffer.allocUnsafe(4 + jsonBody.byteLength);
    jsonFrame.writeUInt32BE(jsonBody.byteLength, 0);
    jsonBody.copy(jsonFrame, 4);

    client.write(Buffer.concat([blobFrame, jsonFrame]));
    await allReceived;

    expect(Buffer.from((messages[0] as { chunk: ArrayBuffer }).chunk)).toEqual(blob);
    expect(messages[1]).toEqual({ hello: 'world' });
  });
});

test('destroys the socket on a blob frame whose header length exceeds the frame', async () => {
  await withConnectedPair(async (client, server) => {
    const serverChannel = createSocketChannel(server);
    serverChannel.onMessage(() => undefined);
    const closed = new Promise<Error | undefined>((resolve) => serverChannel.onClose(resolve));

    // discriminant + a header length far larger than any body actually present.
    const body = Buffer.concat([Buffer.from([0x00]), Buffer.from([0xff, 0xff, 0xff, 0xff])]);
    const frame = Buffer.allocUnsafe(4 + body.byteLength);
    frame.writeUInt32BE(body.byteLength, 0);
    body.copy(frame, 4);
    client.write(frame);

    const err = await closed;
    expect(err).toBeInstanceOf(MalformedBlobFrameError);
  });
});

test('destroys the socket on a blob frame whose header carries no $blob marker', async () => {
  await withConnectedPair(async (client, server) => {
    const serverChannel = createSocketChannel(server);
    serverChannel.onMessage(() => undefined);
    const closed = new Promise<Error | undefined>((resolve) => serverChannel.onClose(resolve));

    client.write(buildBlobFrame({ hello: 'world' }, Buffer.from('x')));

    const err = await closed;
    expect(err).toBeInstanceOf(MalformedBlobFrameError);
  });
});

test('destroys the socket on a frame whose declared length exceeds the cap', async () => {
  await withConnectedPair(async (client, server) => {
    const serverChannel = createSocketChannel(server);
    // Only the close/error side matters here — a would-be message never legitimately arrives
    // once the cap is exceeded, so onMessage's handler has nothing to do.
    serverChannel.onMessage(() => undefined);
    const closed = new Promise<Error | undefined>((resolve) => serverChannel.onClose(resolve));

    const header = Buffer.alloc(4);
    header.writeUInt32BE(MAX_FRAME_BYTES + 1, 0);
    client.write(header);

    const err = await closed;
    expect(err).toBeInstanceOf(FrameTooLargeError);
  });
});
