import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NodePath } from '@shared/domain/tree';
import type { AdapterDeps, OpCtx } from '../../src/engine/adapters/adapter';
import { AdapterError, type AdapterErrorCode } from '../../src/engine/adapters/errors';
import { createAdapter } from '../../src/engine/adapters/registry';
import { s3Caps } from '../../src/engine/adapters/s3/caps';
import type { MutationPlan } from '../../src/shared/domain/mutations';
import { cellText, type KeyValuePage } from '../../src/shared/protocol/page';
import {
  DELETE_TARGET_KEY,
  EDITABLE_OBJECT_BODY,
  EDITABLE_OBJECT_KEY,
  EMPTY_BUCKET,
  MAIN_BUCKET,
  MUTABLE_BUCKET,
  NESTED_OBJECT_BODY,
  NESTED_OBJECT_KEY,
  OVERSIZED_OBJECT_BYTES,
  OVERSIZED_OBJECT_KEY,
  READONLY_TARGET_BODY,
  READONLY_TARGET_KEY,
  ROOT_OBJECT_BODY,
  ROOT_OBJECT_KEY,
  SIBLING_PREFIX_OBJECT_KEY,
  SMALL_FOR_COUNT_KEY,
  UPLOAD_TARGET_KEY,
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
  // resolveObjectTarget() only ever reads the first (bucket) and last (object) segment — an
  // 'object' leaf's own name is already the complete literal key (P17's D3, mirrors redis's
  // resolveKeyTarget), so no intermediate 'prefix' segments are needed to read/count it.
  return path([
    { kind: 'bucket', name: bucket },
    { kind: 'object', name: key },
  ]);
}

const readReq = (target: NodePath) =>
  ({
    path: target,
    projection: null,
    filter: null,
    sort: null,
    pageSize: 10,
    cursor: { mode: 'offset' as const, offset: 0 },
  }) as const;

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

async function expectRejectsWithCode(
  p: Promise<unknown>,
  code: AdapterErrorCode,
  messageContains?: string,
): Promise<void> {
  try {
    await p;
    throw new Error('expected the call to reject');
  } catch (err) {
    expect(err).toBeInstanceOf(AdapterError);
    expect((err as AdapterError).code).toBe(code);
    if (messageContains) expect((err as AdapterError).message).toContain(messageContains);
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

describe('s3 adapter (§9.1, P17/P33)', () => {
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

  // P33: S3 stops being read-only-only — canInsert/canUpdate/canDelete/writable/fileTransfer all
  // flip to true. definition/sql stay false (unchanged scope).
  test('3. cap honesty', () => {
    expect(s3Caps.tabular).toBe(false);
    expect(s3Caps.keyValue).toBe(true);
    expect(s3Caps.defaultPageKind).toBe('keyvalue');
    expect(s3Caps.definition).toBe(false);
    expect(s3Caps.sql).toBe(false);
    expect(s3Caps.exactCount).toBe(true);
    expect(s3Caps.pagination).toBe('token');
    expect(s3Caps.canInsert).toBe(true);
    expect(s3Caps.canUpdate).toBe(true);
    expect(s3Caps.canDelete).toBe(true);
    expect(s3Caps.writable).toBe(true);
    expect(s3Caps.cancel).toBe(true);
    expect(s3Caps.fileTransfer).toBe(true);
  });

  test('4. tree enumeration: root is a flat bucket list', async () => {
    const adapter = await createAdapter('s3', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const root = await adapter.children(path([]), makeCtx());
      expect(root.map((n) => n.name)).toEqual([EMPTY_BUCKET, MAIN_BUCKET, MUTABLE_BUCKET].sort());
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
      // 'reports/' and 'sizes/' are CommonPrefixes; readme.txt is the one root-level object.
      // P33 D14: the size-ladder objects live under sizes/ precisely so this root listing (the
      // only thing this scenario asserts) never has to change when they're added.
      expect(children.map((n) => ({ kind: n.kind, name: n.name }))).toEqual([
        { kind: 'prefix', name: 'reports' },
        { kind: 'prefix', name: 'sizes' },
        { kind: 'object', name: ROOT_OBJECT_KEY },
      ]);
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
      // D3: a leaf 'object' node's name is the full bucket-relative key, not just the local
      // segment — otherwise two objects at different prefixes (e.g. reports/notes.txt and some
      // other notes.txt) would be indistinguishable in the tab title/view header. A 'prefix'
      // node's name stays local: index.ts's children() accumulates prefix segments one at a
      // time as it recurses, and a full-path prefix name would double up on that.
      expect(children.map((n) => ({ kind: n.kind, name: n.name }))).toEqual([
        { kind: 'prefix', name: '2024' },
        { kind: 'object', name: 'reports/notes.txt' },
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
        readReq(objectPath(MAIN_BUCKET, ROOT_OBJECT_KEY)),
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
        readReq(objectPath(MAIN_BUCKET, NESTED_OBJECT_KEY)),
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
        readReq(objectPath(MAIN_BUCKET, SIBLING_PREFIX_OBJECT_KEY)),
        makeCtx(),
      );
      expect(fieldsOf(page).Body).not.toBe(NESTED_OBJECT_BODY);
    } finally {
      await adapter.disconnect();
    }
  });

  test('12. read: a nonexistent object is E_QUERY, not E_NOT_FOUND', async () => {
    const adapter = await createAdapter('s3', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      await expect(
        readKeyValue(
          adapter,
          readReq(objectPath(MAIN_BUCKET, 'this-key-was-never-put.txt')),
          makeCtx(),
        ),
      ).rejects.toMatchObject({ code: 'E_QUERY' });
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

  // P33: preview()/mutate() are covered on their own (scenarios 17-24, 20-24 in particular for
  // mutate) now that S3 is writable — this scenario keeps only what's still permanently
  // unsupported.
  test('14. execute stays unsupported (no query console)', async () => {
    const adapter = await createAdapter('s3', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const target = objectPath(MAIN_BUCKET, ROOT_OBJECT_KEY);
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
        readKeyValue(adapter, readReq(objectPath(MAIN_BUCKET, ROOT_OBJECT_KEY)), ctx),
      ).rejects.toMatchObject({ code: 'E_CANCELLED' });
    } finally {
      await adapter.disconnect();
    }
  });

  test('17. preview() renders exact commands for update/insert/delete without executing', async () => {
    const adapter = await createAdapter('s3', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const newValue = '{"status":"final"}';
      const newValueBytes = new TextEncoder().encode(newValue).length;
      const plan: MutationPlan = {
        path: bucketPath(MUTABLE_BUCKET),
        ops: [
          { kind: 'update', key: { _key: EDITABLE_OBJECT_KEY }, changes: { $value: newValue } },
          { kind: 'insert', values: { _key: UPLOAD_TARGET_KEY, $file: '/tmp/whatever.txt' } },
          { kind: 'delete', key: { _key: DELETE_TARGET_KEY } },
        ],
      };
      const statements = adapter.preview(plan);
      expect(statements).toEqual([
        `PutObject s3://${MUTABLE_BUCKET}/${EDITABLE_OBJECT_KEY} (${newValueBytes} B)`,
        `PutObject s3://${MUTABLE_BUCKET}/${UPLOAD_TARGET_KEY} <- /tmp/whatever.txt`,
        `DeleteObject s3://${MUTABLE_BUCKET}/${DELETE_TARGET_KEY}`,
      ]);

      // A path that isn't bucket-rooted is a synchronous, no-network failure (Adapter rule 3) —
      // resolveBucketSegment throws before any op is ever inspected.
      expectSyncThrow(() => adapter.preview({ path: path([]), ops: [] }), 'E_NOT_FOUND');

      // preview() never executes — a re-read shows the object exactly as seeded.
      const page = await readKeyValue(
        adapter,
        readReq(objectPath(MUTABLE_BUCKET, EDITABLE_OBJECT_KEY)),
        makeCtx(),
      );
      expect(fieldsOf(page).Body).toBe(EDITABLE_OBJECT_BODY);
    } finally {
      await adapter.disconnect();
    }
  });

  test('18. read: an object over the preview limit has no Body row and reports its size', async () => {
    const adapter = await createAdapter('s3', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const page = await readKeyValue(
        adapter,
        readReq(objectPath(MAIN_BUCKET, OVERSIZED_OBJECT_KEY)),
        makeCtx(),
      );
      const fields = fieldsOf(page);
      expect(fields.Body).toBeUndefined();
      expect(page.memoryBytes).toBe(OVERSIZED_OBJECT_BYTES);
      expect(fields.ContentType).toBe('text/plain');
      expect(fields.ContentLength).toContain(String(OVERSIZED_OBJECT_BYTES));
    } finally {
      await adapter.disconnect();
    }
  });

  test('19. count: the Body row is excluded for an over-limit object', async () => {
    const adapter = await createAdapter('s3', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const small = await adapter.count(
        { path: objectPath(MAIN_BUCKET, SMALL_FOR_COUNT_KEY), filter: null },
        makeCtx(),
      );
      const oversized = await adapter.count(
        { path: objectPath(MAIN_BUCKET, OVERSIZED_OBJECT_KEY), filter: null },
        makeCtx(),
      );
      expect(oversized.value).toBe(small.value - 1);
    } finally {
      await adapter.disconnect();
    }
  });

  test('20. mutate update replaces the body and preserves ContentType and user Metadata', async () => {
    const adapter = await createAdapter('s3', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const newBody = JSON.stringify({ status: 'final' });
      const result = await adapter.mutate(
        {
          path: bucketPath(MUTABLE_BUCKET),
          ops: [
            { kind: 'update', key: { _key: EDITABLE_OBJECT_KEY }, changes: { $value: newBody } },
          ],
        },
        makeCtx(),
      );
      expect(result.affectedRows).toBe(1);

      const page = await readKeyValue(
        adapter,
        readReq(objectPath(MUTABLE_BUCKET, EDITABLE_OBJECT_KEY)),
        makeCtx(),
      );
      const fields = fieldsOf(page);
      expect(fields.Body).toBe(newBody);
      expect(fields.ContentType).toBe('application/json');
      expect(fields['Metadata.seeded']).toBe('true');
    } finally {
      await adapter.disconnect();
    }
  });

  test('21. mutate update on a read-only connection is refused and writes nothing', async () => {
    const roAdapter = await createAdapter('s3', deps);
    await roAdapter.connect({ ...fixture.config, readOnly: true }, makeCtx());
    try {
      await expectRejectsWithCode(
        roAdapter.mutate(
          {
            path: bucketPath(MUTABLE_BUCKET),
            ops: [
              {
                kind: 'update',
                key: { _key: READONLY_TARGET_KEY },
                changes: { $value: 'attempted overwrite' },
              },
            ],
          },
          makeCtx(),
        ),
        'E_UNSUPPORTED',
      );
    } finally {
      await roAdapter.disconnect();
    }

    const adapter = await createAdapter('s3', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const page = await readKeyValue(
        adapter,
        readReq(objectPath(MUTABLE_BUCKET, READONLY_TARGET_KEY)),
        makeCtx(),
      );
      expect(fieldsOf(page).Body).toBe(READONLY_TARGET_BODY);
    } finally {
      await adapter.disconnect();
    }
  });

  test('22. mutate delete removes the object; deleting a missing key is E_QUERY', async () => {
    const adapter = await createAdapter('s3', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const result = await adapter.mutate(
        {
          path: bucketPath(MUTABLE_BUCKET),
          ops: [{ kind: 'delete', key: { _key: DELETE_TARGET_KEY } }],
        },
        makeCtx(),
      );
      expect(result.affectedRows).toBe(1);

      await expectRejectsWithCode(
        readKeyValue(adapter, readReq(objectPath(MUTABLE_BUCKET, DELETE_TARGET_KEY)), makeCtx()),
        'E_QUERY',
      );

      // A second delete of the same key is a query-time condition, not silent success (D13).
      await expectRejectsWithCode(
        adapter.mutate(
          {
            path: bucketPath(MUTABLE_BUCKET),
            ops: [{ kind: 'delete', key: { _key: DELETE_TARGET_KEY } }],
          },
          makeCtx(),
        ),
        'E_QUERY',
      );
    } finally {
      await adapter.disconnect();
    }
  });

  test('23. mutate insert uploads a local file with its length and content type', async () => {
    const adapter = await createAdapter('s3', deps);
    await adapter.connect(fixture.config, makeCtx());
    const tmpDir = await mkdtemp(join(tmpdir(), 'kira-s3-upload-'));
    const tmpFile = join(tmpDir, 'upload.txt');
    const content = 'uploaded from a local temp file';
    await writeFile(tmpFile, content, 'utf8');
    try {
      const result = await adapter.mutate(
        {
          path: bucketPath(MUTABLE_BUCKET),
          ops: [
            {
              kind: 'insert',
              values: { _key: UPLOAD_TARGET_KEY, $file: tmpFile, $contentType: 'text/plain' },
            },
          ],
        },
        makeCtx(),
      );
      expect(result.affectedRows).toBe(1);

      const page = await readKeyValue(
        adapter,
        readReq(objectPath(MUTABLE_BUCKET, UPLOAD_TARGET_KEY)),
        makeCtx(),
      );
      const fields = fieldsOf(page);
      expect(fields.Body).toBe(content);
      expect(fields.ContentType).toBe('text/plain');
    } finally {
      await adapter.disconnect();
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test('24. mutate insert refuses an existing key and a missing source file', async () => {
    const adapter = await createAdapter('s3', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      // READONLY_TARGET_KEY is never mutated by scenario 21 (its whole point) — a stable
      // known-existing key to collide against.
      await expectRejectsWithCode(
        adapter.mutate(
          {
            path: bucketPath(MUTABLE_BUCKET),
            ops: [
              {
                kind: 'insert',
                values: { _key: READONLY_TARGET_KEY, $file: '/does/not/matter/for/this/case.txt' },
              },
            ],
          },
          makeCtx(),
        ),
        'E_QUERY',
        READONLY_TARGET_KEY,
      );

      const neverCreatedKey = 'never-created-because-source-missing.txt';
      await expectRejectsWithCode(
        adapter.mutate(
          {
            path: bucketPath(MUTABLE_BUCKET),
            ops: [
              {
                kind: 'insert',
                values: { _key: neverCreatedKey, $file: '/does/not/exist/at/all.txt' },
              },
            ],
          },
          makeCtx(),
        ),
        'E_QUERY',
      );
      await expectRejectsWithCode(
        readKeyValue(adapter, readReq(objectPath(MUTABLE_BUCKET, neverCreatedKey)), makeCtx()),
        'E_QUERY',
      );
    } finally {
      await adapter.disconnect();
    }
  });

  test('25. downloadObject writes the exact bytes and returns the count', async () => {
    const adapter = await createAdapter('s3', deps);
    await adapter.connect(fixture.config, makeCtx());
    const tmpDir = await mkdtemp(join(tmpdir(), 'kira-s3-download-'));
    const destPath = join(tmpDir, 'downloaded.json');
    try {
      const result = await adapter.downloadObject(
        { path: objectPath(MAIN_BUCKET, NESTED_OBJECT_KEY), destPath },
        makeCtx(),
      );
      expect(result.bytes).toBe(Buffer.byteLength(NESTED_OBJECT_BODY, 'utf8'));
      const written = await readFile(destPath, 'utf8');
      expect(written).toBe(NESTED_OBJECT_BODY);
      // No .kira-partial-* sibling left behind.
      expect(await readdir(tmpDir)).toEqual(['downloaded.json']);
    } finally {
      await adapter.disconnect();
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test('26. downloadObject with an already-aborted signal leaves no file behind', async () => {
    const adapter = await createAdapter('s3', deps);
    await adapter.connect(fixture.config, makeCtx());
    const tmpDir = await mkdtemp(join(tmpdir(), 'kira-s3-cancel-'));
    const destPath = join(tmpDir, 'never-written.txt');
    try {
      const controller = new AbortController();
      controller.abort();
      const ctx: OpCtx = { opId: crypto.randomUUID(), signal: controller.signal, setCommand() {} };
      await expectRejectsWithCode(
        adapter.downloadObject({ path: objectPath(MAIN_BUCKET, ROOT_OBJECT_KEY), destPath }, ctx),
        'E_CANCELLED',
      );
      expect(existsSync(destPath)).toBe(false);
      expect(await readdir(tmpDir)).toEqual([]);
    } finally {
      await adapter.disconnect();
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test('27. downloadObject on a nonexistent object is E_QUERY and creates no file', async () => {
    const adapter = await createAdapter('s3', deps);
    await adapter.connect(fixture.config, makeCtx());
    const tmpDir = await mkdtemp(join(tmpdir(), 'kira-s3-missing-'));
    const destPath = join(tmpDir, 'never-written.txt');
    try {
      await expectRejectsWithCode(
        adapter.downloadObject(
          { path: objectPath(MAIN_BUCKET, 'this-key-was-never-put.txt'), destPath },
          makeCtx(),
        ),
        'E_QUERY',
      );
      expect(await readdir(tmpDir)).toEqual([]);
    } finally {
      await adapter.disconnect();
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
