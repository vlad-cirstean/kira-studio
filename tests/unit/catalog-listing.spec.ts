// P44 F46: redis/catalog.ts's listNamespaceChildren and s3/catalog.ts's listPrefixChildren own the
// `truncated` flag P43 iteration 2 added (D21) — a two-term conjunction in each file (a round cap
// was hit AND the server says there is still more) that is invisible in normal use and expensive to
// exercise for real: a live assertion needs a namespace/prefix big enough to survive
// MAX_SCAN_ROUNDS/MAX_LIST_ROUNDS rounds, which is exactly the "without seeding 200 000 keys"
// iteration 2 itself named as out of scope. tests/db/redis.spec.ts and tests/db/s3.spec.ts both
// exercise these functions against a live server, but neither drives truncation and both are
// Testcontainers-backed (never run in this sandbox). Both functions take a client object as their
// first parameter — the seam a hand-written fake drives in under a millisecond, all 200/20 rounds
// included.
import { describe, expect, test } from 'bun:test';
import type { S3Client } from '@aws-sdk/client-s3';
import type { Redis } from 'ioredis';
import type { OpCtx } from '../../src/engine/adapters/adapter';
import { listNamespaceChildren } from '../../src/engine/adapters/redis/catalog';
import { listPrefixChildren } from '../../src/engine/adapters/s3/catalog';

function makeCtx(signal?: AbortSignal): OpCtx {
  return { opId: 'op1', signal: signal ?? new AbortController().signal, setCommand: () => {} };
}

function fakeRedis(round: (call: number) => [string, string[]]): {
  conn: Redis;
  calls: unknown[][];
} {
  const calls: unknown[][] = [];
  let call = 0;
  const conn = {
    async scan(...args: unknown[]) {
      calls.push(args);
      const result = round(call);
      call++;
      return result;
    },
  } as unknown as Redis;
  return { conn, calls };
}

describe('redis/catalog.ts — listNamespaceChildren (P44 F46)', () => {
  test('1. the namespace/key split falls on the first ":" after the prefix; namespaces sort before keys, each alphabetically', async () => {
    const { conn } = fakeRedis(() => ['0', ['zebra:1', 'apple:1', 'counter', 'banana']]);
    const result = await listNamespaceChildren(conn, 'db0', [], makeCtx());
    expect(result.nodes.map((n) => [n.kind, n.name])).toEqual([
      ['namespace', 'apple'],
      ['namespace', 'zebra'],
      ['key', 'banana'],
      ['key', 'counter'],
    ]);
  });

  test('2. a nested level scans the joined prefix and dedups a repeated segment', async () => {
    const { conn, calls } = fakeRedis(() => ['0', ['a:b:x', 'a:b:y', 'a:c']]);
    const result = await listNamespaceChildren(conn, 'db0', ['a'], makeCtx());
    // MATCH argument is the joined prefix, not the bare descent segment.
    expect(calls[0]).toEqual(['0', 'MATCH', 'a:*', 'COUNT', 1000]);
    expect(result.nodes.map((n) => [n.kind, n.name])).toEqual([
      ['namespace', 'b'], // deduped: seen twice ('a:b:x', 'a:b:y'), kept once
      ['key', 'a:c'], // a key node's own name is the full key, not the local segment
    ]);
  });

  test('3. a cursor that never returns to "0" runs exactly MAX_SCAN_ROUNDS rounds and reports truncated: true', async () => {
    const { conn, calls } = fakeRedis((call) => [String(call + 1), []]);
    const result = await listNamespaceChildren(conn, 'db0', [], makeCtx());
    expect(calls).toHaveLength(200);
    expect(result.truncated).toBe(true);
  });

  test('4. a scan that completes inside the cap reports truncated as undefined, not false', async () => {
    const { conn, calls } = fakeRedis(() => ['0', ['onlykey']]);
    const result = await listNamespaceChildren(conn, 'db0', [], makeCtx());
    expect(calls).toHaveLength(1);
    expect(result.truncated).toBeUndefined();
    expect('truncated' in result).toBe(false);
  });

  test('5. an already-aborted signal throws E_CANCELLED before the first scan call', async () => {
    const controller = new AbortController();
    controller.abort();
    const { conn, calls } = fakeRedis(() => ['0', []]);
    await expect(
      listNamespaceChildren(conn, 'db0', [], makeCtx(controller.signal)),
    ).rejects.toMatchObject({ code: 'E_CANCELLED' });
    expect(calls).toHaveLength(0);
  });
});

function fakeS3(
  page: (call: number) => {
    CommonPrefixes?: { Prefix?: string }[];
    Contents?: { Key?: string }[];
    NextContinuationToken?: string;
  },
): { client: S3Client; inputs: Record<string, unknown>[] } {
  const inputs: Record<string, unknown>[] = [];
  let call = 0;
  const client = {
    async send(cmd: { input: Record<string, unknown> }) {
      inputs.push(cmd.input);
      const result = page(call);
      call++;
      return result;
    },
  } as unknown as S3Client;
  return { client, inputs };
}

describe('s3/catalog.ts — listPrefixChildren (P44 F46)', () => {
  test('6. CommonPrefixes become local segments while Contents keep the full key; Prefix/Delimiter are sent as expected', async () => {
    const { client, inputs } = fakeS3(() => ({
      CommonPrefixes: [{ Prefix: 'reports/' }, { Prefix: 'assets/' }],
      Contents: [{ Key: 'root.txt' }],
    }));
    const result = await listPrefixChildren(client, 'my-bucket', [], makeCtx());
    expect(inputs[0]).toMatchObject({ Bucket: 'my-bucket', Prefix: '', Delimiter: '/' });
    expect(result.nodes.map((n) => [n.kind, n.name])).toEqual([
      ['prefix', 'assets'],
      ['prefix', 'reports'],
      ['object', 'root.txt'],
    ]);
  });

  test('7. the exact-prefix directory marker is skipped', async () => {
    const { client } = fakeS3(() => ({
      Contents: [{ Key: 'reports/' }, { Key: 'reports/file.csv' }],
    }));
    const result = await listPrefixChildren(client, 'my-bucket', ['reports'], makeCtx());
    expect(result.nodes.map((n) => n.name)).toEqual(['reports/file.csv']);
  });

  test('8. a continuation token that never clears runs exactly MAX_LIST_ROUNDS rounds and reports truncated: true', async () => {
    const { client, inputs } = fakeS3(() => ({ NextContinuationToken: 'more' }));
    const result = await listPrefixChildren(client, 'my-bucket', [], makeCtx());
    expect(inputs).toHaveLength(20);
    expect(result.truncated).toBe(true);
  });

  test('9. a listing that completes inside the cap reports truncated as undefined, not false', async () => {
    const { client, inputs } = fakeS3(() => ({ Contents: [{ Key: 'a.txt' }] }));
    const result = await listPrefixChildren(client, 'my-bucket', [], makeCtx());
    expect(inputs).toHaveLength(1);
    expect(result.truncated).toBeUndefined();
    expect('truncated' in result).toBe(false);
  });
});
