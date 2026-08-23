import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { NodePath } from '@shared/domain/tree';
import type { AdapterDeps, OpCtx } from '../../src/engine/adapters/adapter';
import { AdapterError, type AdapterErrorCode } from '../../src/engine/adapters/errors';
import { createAdapter } from '../../src/engine/adapters/registry';
import { s3Caps } from '../../src/engine/adapters/s3/caps';
import { cellText, type KeyValuePage } from '../../src/shared/protocol/page';
import {
  EMPTY_BUCKET,
  MAIN_BUCKET,
  NESTED_OBJECT_BODY,
  NESTED_OBJECT_KEY,
  ROOT_OBJECT_BODY,
  ROOT_OBJECT_KEY,
  SIBLING_PREFIX_OBJECT_KEY,
} from './fixtures/0007_s3_seed';
import { DOCKER_UNAVAILABLE_MESSAGE, isDockerAvailable } from './support/docker';
import { readKeyValue } from './support/page';
import { type S3Fixture, startS3 } from './support/s3';

const CONTAINER_START_TIMEOUT_MS = 180_000;

const deps: AdapterDeps = {
  log(level, message) {
    if (level === 'error') console.error(`[s3 adapter] ${message}`);
  },
};

function makeCtx(): OpCtx {
  return {
    opId: crypto.randomUUID(),
    signal: new AbortController().signal,
    setCommand() {},
  };
}

function path(segments: NodePath['segments']): NodePath {
  return { connectionId: 'test-s3', segments };
}

function bucketPath(name: string): NodePath {
  return path([{ kind: 'bucket', name }]);
}

function objectPath(bucket: string, key: string): NodePath {
  const parts = key.split('/');
  const object = parts.pop() as string;
  return path([
    { kind: 'bucket', name: bucket },
    ...parts.map((name) => ({ kind: 'prefix' as const, name })),
    { kind: 'object', name: object },
  ]);
}

const decoder = new TextDecoder();

function fieldsOf(page: KeyValuePage): Record<string, string> {
  const out: Record<string, string> = {};
  for (let row = 0; row < page.rowCount; row++) {
    out[cellText(page.fields, row, decoder)] = cellText(page.values, row, decoder);
  }
  return out;
}

/** preview() is synchronous — `.rejects` doesn't apply. */
function expectSyncThrow(fn: () => unknown, code: AdapterErrorCode): void {
  try {
    fn();
    throw new Error('expected the call to throw');
  } catch (err) {
    expect(err).toBeInstanceOf(AdapterError);
    expect((err as AdapterError).code).toBe(code);
  }
}

let fixture: S3Fixture;

beforeAll(async () => {
  if (!(await isDockerAvailable())) throw new Error(DOCKER_UNAVAILABLE_MESSAGE);
  fixture = await startS3();
}, CONTAINER_START_TIMEOUT_MS);

afterAll(async () => {
  await fixture?.stop();
});

describe('s3 adapter (§9.1, P17)', () => {
  test('1. connect / disconnect', async () => {
    const adapter = await createAdapter('s3', deps);
    const info = await adapter.connect(fixture.config, makeCtx());
    expect(info.serverVersion).toBe('Amazon S3');
    await adapter.disconnect();

    await expect(adapter.children(path([]), makeCtx())).rejects.toMatchObject({
      code: 'E_CONNECT',
    });
  });

  test('2. an unparseable URI is rejected at connect time', async () => {
    const adapter = await createAdapter('s3', deps);
    const badConfig = { ...fixture.config, uri: 'not a valid uri at all' };
    await expect(adapter.connect(badConfig, makeCtx())).rejects.toMatchObject({
      code: 'E_QUERY',
    });
  });

  test('3. cap honesty', () => {
    expect(s3Caps.tabular).toBe(false);
    expect(s3Caps.keyValue).toBe(true);
    expect(s3Caps.defaultPageKind).toBe('keyvalue');
    expect(s3Caps.definition).toBe(false);
    expect(s3Caps.sql).toBe(false);
    expect(s3Caps.exactCount).toBe(false);
    expect(s3Caps.pagination).toBe('token');
    expect(s3Caps.canInsert).toBe(false);
    expect(s3Caps.canUpdate).toBe(false);
    expect(s3Caps.canDelete).toBe(false);
    expect(s3Caps.writable).toBe(false);
    expect(s3Caps.cancel).toBe(true);
  });

  test('4. tree enumeration: root is a flat bucket list', async () => {
    const adapter = await createAdapter('s3', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const root = await adapter.children(path([]), makeCtx());
      expect(root.map((n) => n.name)).toEqual([EMPTY_BUCKET, MAIN_BUCKET].sort());
      expect(root.every((n) => n.kind === 'bucket' && n.hasChildren === true)).toBe(true);
    } finally {
      await adapter.disconnect();
    }
  });

  test('5. tree enumeration: a bucket root lists objects and prefixes, delimiter-grouped', async () => {
    const adapter = await createAdapter('s3', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const children = await adapter.children(bucketPath(MAIN_BUCKET), makeCtx());
      // 'reports/' is one CommonPrefix (both reports/2024/summary.json and reports/notes.txt
      // fall under it) — NOT two separate top-level entries; readme.txt is the one root object.
      expect(children.map((n) => ({ kind: n.kind, name: n.name }))).toEqual([
        { kind: 'prefix', name: 'reports' },
        { kind: 'object', name: ROOT_OBJECT_KEY },
      ]);
      expect(children[0].hasChildren).toBe(true);
      expect(children[1].hasChildren).toBe(false);
    } finally {
      await adapter.disconnect();
    }
  });

  test('6. tree enumeration: descending into a prefix mixes a sub-prefix and a sibling object', async () => {
    const adapter = await createAdapter('s3', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const children = await adapter.children(
        path([
          { kind: 'bucket', name: MAIN_BUCKET },
          { kind: 'prefix', name: 'reports' },
        ]),
        makeCtx(),
      );
      expect(children.map((n) => ({ kind: n.kind, name: n.name }))).toEqual([
        { kind: 'prefix', name: '2024' },
        { kind: 'object', name: 'notes.txt' },
      ]);
    } finally {
      await adapter.disconnect();
    }
  });

  test('7. children of a leaf (object) and of an empty bucket', async () => {
    const adapter = await createAdapter('s3', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const leafChildren = await adapter.children(
        objectPath(MAIN_BUCKET, ROOT_OBJECT_KEY),
        makeCtx(),
      );
      expect(leafChildren).toEqual([]);

      const emptyBucketChildren = await adapter.children(bucketPath(EMPTY_BUCKET), makeCtx());
      expect(emptyBucketChildren).toEqual([]);
    } finally {
      await adapter.disconnect();
    }
  });

  test('8. describe/definition are unsupported', async () => {
    const adapter = await createAdapter('s3', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const target = objectPath(MAIN_BUCKET, ROOT_OBJECT_KEY);
      await expect(adapter.describe(target, makeCtx())).rejects.toMatchObject({
        code: 'E_UNSUPPORTED',
      });
      await expect(adapter.definition(target, makeCtx())).rejects.toMatchObject({
        code: 'E_UNSUPPORTED',
      });
    } finally {
      await adapter.disconnect();
    }
  });

  test('9. read: a root-level object comes back as a keyvalue page with metadata + body', async () => {
    const adapter = await createAdapter('s3', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const page = await readKeyValue(
        adapter,
        {
          path: objectPath(MAIN_BUCKET, ROOT_OBJECT_KEY),
          projection: null,
          filter: null,
          sort: null,
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      expect(page.redisType).toBe('object');
      expect(page.position.hasMore).toBe(false);
      const fields = fieldsOf(page);
      expect(fields.ContentType).toBe('text/plain');
      expect(fields['Metadata.seeded']).toBe('true');
      expect(fields.Body).toBe(ROOT_OBJECT_BODY);
      expect(fields.ContentLength).toContain(String(ROOT_OBJECT_BODY.length));
    } finally {
      await adapter.disconnect();
    }
  });

  test('10. read: a nested object under two prefix levels resolves to the right key', async () => {
    const adapter = await createAdapter('s3', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const page = await readKeyValue(
        adapter,
        {
          path: objectPath(MAIN_BUCKET, NESTED_OBJECT_KEY),
          projection: null,
          filter: null,
          sort: null,
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      const fields = fieldsOf(page);
      expect(fields.ContentType).toBe('application/json');
      expect(fields.Body).toBe(NESTED_OBJECT_BODY);
    } finally {
      await adapter.disconnect();
    }
  });

  test('11. read: a sibling object one level up from the nested one is distinct', async () => {
    const adapter = await createAdapter('s3', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const page = await readKeyValue(
        adapter,
        {
          path: objectPath(MAIN_BUCKET, SIBLING_PREFIX_OBJECT_KEY),
          projection: null,
          filter: null,
          sort: null,
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      expect(fieldsOf(page).Body).not.toBe(NESTED_OBJECT_BODY);
    } finally {
      await adapter.disconnect();
    }
  });

  test('12. read: a nonexistent object is E_NOT_FOUND', async () => {
    const adapter = await createAdapter('s3', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      await expect(
        readKeyValue(
          adapter,
          {
            path: objectPath(MAIN_BUCKET, 'this-key-was-never-put.txt'),
            projection: null,
            filter: null,
            sort: null,
            pageSize: 10,
            cursor: { mode: 'offset', offset: 0 },
          },
          makeCtx(),
        ),
      ).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
    } finally {
      await adapter.disconnect();
    }
  });

  test('13. count: exact field-row count (not approximate — no ListObjects estimate involved)', async () => {
    const adapter = await createAdapter('s3', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const result = await adapter.count(
        { path: objectPath(MAIN_BUCKET, ROOT_OBJECT_KEY), filter: null },
        makeCtx(),
      );
      expect(result.exact).toBe(true);
      expect(result.value).toBeGreaterThan(0);
    } finally {
      await adapter.disconnect();
    }
  });

  test('14. preview/mutate/execute stay unsupported (read-only in this phase)', async () => {
    const adapter = await createAdapter('s3', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const target = objectPath(MAIN_BUCKET, ROOT_OBJECT_KEY);
      expectSyncThrow(() => adapter.preview({ path: target, ops: [] }), 'E_UNSUPPORTED');
      await expect(adapter.mutate({ path: target, ops: [] }, makeCtx())).rejects.toMatchObject({
        code: 'E_UNSUPPORTED',
      });
      await expect(
        adapter.execute({ path: target, statements: ['x'] }, makeCtx()),
      ).rejects.toMatchObject({ code: 'E_UNSUPPORTED' });
    } finally {
      await adapter.disconnect();
    }
  });

  test('15. cancel is a permanent no-op', async () => {
    const adapter = await createAdapter('s3', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      expect(await adapter.cancel(crypto.randomUUID())).toBe(false);
    } finally {
      await adapter.disconnect();
    }
  });

  test('16. read: an already-cancelled signal rejects before running anything', async () => {
    const adapter = await createAdapter('s3', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const controller = new AbortController();
      controller.abort();
      const ctx: OpCtx = { opId: crypto.randomUUID(), signal: controller.signal, setCommand() {} };
      await expect(
        readKeyValue(
          adapter,
          {
            path: objectPath(MAIN_BUCKET, ROOT_OBJECT_KEY),
            projection: null,
            filter: null,
            sort: null,
            pageSize: 10,
            cursor: { mode: 'offset', offset: 0 },
          },
          ctx,
        ),
      ).rejects.toMatchObject({ code: 'E_CANCELLED' });
    } finally {
      await adapter.disconnect();
    }
  });
});
