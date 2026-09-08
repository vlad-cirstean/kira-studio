import { expect, test } from 'bun:test';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { decodeStreamPayload } from './codec.ts';
import type { DecorationRef, StreamChunkOf } from './contract.ts';
import {
  createSocketChannel,
  FrameTooLargeError,
  MAX_FRAME_BYTES,
  MalformedBlobFrameError,
} from './socketChannel.ts';
import { unwrapVersioned } from './validate.ts';

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

// G12 D5/D17 — the frame this file's F1 finding is about: connection.ts's handshake unsubscribes
// itself as its own first statement inside the handler, and only resubscribes later (after an
// `await`). If a second frame is already sitting in the same read when that happens, it must not
// be lost.
test('a frame delivered while unsubscribed is queued for the next subscriber, in order', async () => {
  await withConnectedPair(async (client, server) => {
    const serverChannel = createSocketChannel(server);
    const received: unknown[] = [];

    let unsubscribe: () => void = () => undefined;
    unsubscribe = serverChannel.onMessage((msg) => {
      unsubscribe(); // the exact self-unsubscribing shape connection.ts's handshake used.
      received.push(msg);
    });

    const frames = [{ n: 1 }, { n: 2 }].map((m) => {
      const body = Buffer.from(JSON.stringify(m), 'utf8');
      const frame = Buffer.allocUnsafe(4 + body.byteLength);
      frame.writeUInt32BE(body.byteLength, 0);
      body.copy(frame, 4);
      return frame;
    });
    client.write(Buffer.concat(frames));

    // Let the synchronous drain loop run to completion, with no subscriber installed, before a
    // second one arrives — the exact gap the bug lived in.
    await new Promise((r) => setTimeout(r, 20));
    expect(received).toEqual([{ n: 1 }]);

    const second = await new Promise<unknown>((resolve) => serverChannel.onMessage(resolve));
    received.push(second);

    expect(received).toEqual([{ n: 1 }, { n: 2 }]);
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

// D16 — the cross-language fixture: internal/gitsock's own TestFixtures_CaptureGraphChunkFrame
// (KIRA_GIT_FIXTURES=write) drives a real graph.stream over a real socket against a real fixture
// repository and writes the first chunk frame's exact body bytes (graphChunkFrame.bin) plus the
// decoded values a reader should recover (graphChunkFrame.json). This is the only test that can
// catch the Go encoder and this file's/graphChunkCodec.ts's decode path disagreeing — a field
// written to the wrong slot, a big-endian column, a mis-sized header prefix.
interface GraphChunkFixture {
  readonly envelope: {
    readonly repoId: string;
    readonly seq: number;
    readonly from: number;
    readonly to: number;
    readonly source: 'git' | 'cache';
    readonly remaining: number;
    readonly exhausted: boolean;
  };
  readonly commits: {
    readonly from: number;
    readonly to: number;
    readonly shaWidthBytes: number;
    readonly shas: readonly string[];
    readonly parentOffsets: readonly number[];
    readonly parentShas: readonly string[];
    readonly identityIds: readonly number[];
    readonly times: readonly number[];
    readonly subjects: readonly string[];
    readonly subjectOffsets: readonly number[];
    readonly dictionaryBase: number;
    readonly dictionary: readonly string[];
    readonly decorations: ReadonlyArray<{
      readonly row: number;
      readonly refs: ReadonlyArray<{
        readonly kind: string;
        readonly name?: string;
        readonly isHead?: boolean;
      }>;
    }>;
  };
}

function expectedDecorationRef(r: {
  kind: string;
  name?: string;
  isHead?: boolean;
}): DecorationRef {
  switch (r.kind) {
    case 'branch':
      if (r.name === undefined) throw new Error('branch decoration fixture is missing a name');
      return { kind: 'branch', name: r.name, isHead: r.isHead ?? false };
    case 'remoteBranch':
      if (r.name === undefined) {
        throw new Error('remoteBranch decoration fixture is missing a name');
      }
      return { kind: 'remoteBranch', name: r.name };
    case 'tag':
      if (r.name === undefined) throw new Error('tag decoration fixture is missing a name');
      return { kind: 'tag', name: r.name };
    case 'head':
      return { kind: 'head' };
    case 'stash':
      if (r.name === undefined) throw new Error('stash decoration fixture is missing an index');
      return { kind: 'stash', index: Number(r.name) };
    default:
      throw new Error(`socketChannel.test.ts: unrecognised decoration kind ${r.kind}`);
  }
}

test('D16: decodes the captured Go-encoded graph.stream chunk frame field for field', async () => {
  const fixtureDir = path.join(import.meta.dir, '..', 'testdata');
  const raw = new Uint8Array(
    await Bun.file(path.join(fixtureDir, 'graphChunkFrame.bin')).arrayBuffer(),
  );
  const expected = JSON.parse(
    await Bun.file(path.join(fixtureDir, 'graphChunkFrame.json')).text(),
  ) as GraphChunkFixture;

  await withConnectedPair(async (client, server) => {
    const serverChannel = createSocketChannel(server);
    const received = new Promise<unknown>((resolve) => serverChannel.onMessage(resolve));

    // The captured .bin is the frame *body* (internal/gitsock's own readFrame already stripped
    // the outer length prefix) — re-add it here, exactly as it crossed the real socket.
    const body = Buffer.from(raw);
    const frame = Buffer.allocUnsafe(4 + body.byteLength);
    frame.writeUInt32BE(body.byteLength, 0);
    body.copy(frame, 4);
    client.write(frame);

    const envelope = await received;
    const frameBody = unwrapVersioned(envelope as { version: number; body: unknown }) as {
      readonly t: string;
      readonly id: number;
      readonly seq: number;
      readonly chunk: unknown;
    };
    expect(frameBody.t).toBe('chunk');

    const chunk = decodeStreamPayload(
      'graph.stream',
      frameBody.chunk,
    ) as StreamChunkOf<'graph.stream'>;

    expect(chunk.repoId).toBe(expected.envelope.repoId);
    expect(chunk.seq).toBe(expected.envelope.seq);
    expect(chunk.from).toBe(expected.envelope.from);
    expect(chunk.to).toBe(expected.envelope.to);
    expect(chunk.source).toBe(expected.envelope.source);
    expect(chunk.remaining).toBe(expected.envelope.remaining);
    expect(chunk.exhausted).toBe(expected.envelope.exhausted);

    const commits = chunk.commits;
    expect(commits.from).toBe(expected.commits.from);
    expect(commits.to).toBe(expected.commits.to);
    expect(commits.shaWidthBytes).toBe(expected.commits.shaWidthBytes);

    const shaWidth = commits.shaWidthBytes;
    const shasBytes = new Uint8Array(commits.shas);
    const gotShas: string[] = [];
    for (let i = 0; i < shasBytes.length; i += shaWidth) {
      gotShas.push(Buffer.from(shasBytes.slice(i, i + shaWidth)).toString('hex'));
    }
    expect(gotShas).toEqual([...expected.commits.shas]);

    expect(Array.from(new Uint32Array(commits.parentOffsets))).toEqual([
      ...expected.commits.parentOffsets,
    ]);
    const parentShasBytes = new Uint8Array(commits.parentShas);
    const gotParentShas: string[] = [];
    for (let i = 0; i < parentShasBytes.length; i += shaWidth) {
      gotParentShas.push(Buffer.from(parentShasBytes.slice(i, i + shaWidth)).toString('hex'));
    }
    expect(gotParentShas).toEqual([...expected.commits.parentShas]);

    expect(Array.from(new Uint32Array(commits.identityIds))).toEqual([
      ...expected.commits.identityIds,
    ]);
    expect(Array.from(new Uint32Array(commits.times))).toEqual([...expected.commits.times]);
    expect(Array.from(new Uint32Array(commits.subjectOffsets))).toEqual([
      ...expected.commits.subjectOffsets,
    ]);

    const subjectBytes = new Uint8Array(commits.subjectBytes);
    const subjectOffsets = Array.from(new Uint32Array(commits.subjectOffsets));
    const gotSubjects: string[] = [];
    for (let i = 0; i < subjectOffsets.length - 1; i++) {
      gotSubjects.push(
        Buffer.from(subjectBytes.slice(subjectOffsets[i], subjectOffsets[i + 1])).toString('utf8'),
      );
    }
    expect(gotSubjects).toEqual([...expected.commits.subjects]);

    expect(commits.dictionaryBase).toBe(expected.commits.dictionaryBase);
    expect([...commits.dictionary]).toEqual([...expected.commits.dictionary]);

    const gotDecorations = commits.decorations.map(([row, refs]) => ({ row, refs: [...refs] }));
    const wantDecorations = expected.commits.decorations.map((d) => ({
      row: d.row,
      refs: d.refs.map(expectedDecorationRef),
    }));
    expect(gotDecorations).toEqual(wantDecorations);
  });
});
