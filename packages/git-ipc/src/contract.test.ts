import { describe, expect, test } from 'bun:test';
import { decode, dedupeTransferList, encode } from '@kira/ipc-core';
import type {
  EventPayload,
  PackedCommitChunk,
  ParamsOf,
  ResultOf,
  StreamChunkOf,
} from './contract';
import { CONTRACT_VERSION } from './validate';

/**
 * Round-trips contract entries through the codec, over a real `MessageChannel` so the
 * ArrayBuffer case exercises actual structured-clone transfer semantics rather than an
 * in-process stand-in.
 */
async function roundTrip<T>(message: T, transfer: readonly ArrayBuffer[]): Promise<T> {
  const { port1, port2 } = new MessageChannel();
  const received = new Promise<T>((resolve) => {
    port2.onmessage = (event) => resolve(decode(event.data as T));
  });
  port1.postMessage(message, transfer as ArrayBuffer[]);
  const result = await received;
  port1.close();
  port2.close();
  return result;
}

function emptyPackedChunk(): PackedCommitChunk {
  return {
    from: 0,
    to: 0,
    shaWidthBytes: 20,
    shas: new ArrayBuffer(0),
    parentOffsets: new ArrayBuffer(4),
    parentShas: new ArrayBuffer(0),
    identityIds: new ArrayBuffer(0),
    times: new ArrayBuffer(0),
    subjectBytes: new ArrayBuffer(0),
    subjectOffsets: new ArrayBuffer(4),
    dictionaryBase: 0,
    dictionary: [],
    decorations: [],
  };
}

describe('git contract', () => {
  test('round-trips app.init request/result', async () => {
    const params: ParamsOf<'app.init'> = {};
    const result: ResultOf<'app.init'> = {
      host: 'harness',
      contractVersion: CONTRACT_VERSION,
      settings: {
        'git.path': '',
        'git.graph.pageSize': 5000,
        'git.graph.scope': 'all',
        'git.log.level': 'info',
      },
      git: { kind: 'ok', path: '/usr/bin/git', version: '2.43.0' },
    };
    const encodedParams = encode(params);
    const encodedResult = encode(result);
    expect(await roundTrip(encodedParams.payload, encodedParams.transfer)).toEqual(params);
    expect(await roundTrip(encodedResult.payload, encodedResult.transfer)).toEqual(result);
  });

  test('round-trips repo.open request/result', async () => {
    const params: ParamsOf<'repo.open'> = { path: '/repos/example' };
    const result: ResultOf<'repo.open'> = {
      kind: 'ok',
      repo: {
        repoId: 'r1',
        root: '/repos/example',
        gitDir: '/repos/example/.git',
        commonDir: '/repos/example/.git',
        isBare: false,
        isLinkedWorktree: false,
        head: { kind: 'branch', name: 'main' },
      },
    };
    const { payload, transfer } = encode(params);
    expect(transfer).toHaveLength(0);
    expect(await roundTrip(payload, transfer)).toEqual(params);
    const encodedResult = encode(result);
    expect(await roundTrip(encodedResult.payload, encodedResult.transfer)).toEqual(result);
  });

  test('round-trips repo.changed event', async () => {
    const payload: EventPayload<'repo.changed'> = { repoId: 'r1', kind: 'refsChanged' };
    const encoded = encode(payload);
    expect(await roundTrip(encoded.payload, encoded.transfer)).toEqual(payload);
  });

  test('round-trips graph.stream chunk, preserving the whole contract shape', async () => {
    const packed = emptyPackedChunk();
    const shas = new ArrayBuffer(20 * 3);
    new Uint8Array(shas).fill(0xab);
    const chunk: StreamChunkOf<'graph.stream'> = {
      repoId: 'r1',
      seq: 0,
      from: 0,
      to: 3,
      source: 'git',
      remaining: 0,
      exhausted: true,
      commits: { ...packed, shas, to: 3 },
    };

    const { payload, transfer } = encode(chunk);
    expect(dedupeTransferList(transfer)).toBe(transfer);
    const result = await roundTrip(payload, transfer);

    expect(result.repoId).toBe('r1');
    expect(result.seq).toBe(0);
    expect(result.from).toBe(0);
    expect(result.to).toBe(3);
    expect(result.source).toBe('git');
    expect(result.remaining).toBe(0);
    expect(result.exhausted).toBe(true);
    expect(result.commits.to).toBe(3);
    expect(result.commits.shas.byteLength).toBe(60);
    expect(new Uint8Array(result.commits.shas).every((b) => b === 0xab)).toBe(true);
  });
});
