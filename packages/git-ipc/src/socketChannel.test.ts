import { expect, test } from 'bun:test';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { createSocketChannel, FrameTooLargeError, MAX_FRAME_BYTES } from './socketChannel.ts';

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
