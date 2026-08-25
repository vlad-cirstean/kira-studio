import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { MutationPlan } from '@shared/domain/mutations';
import type { NodePath } from '@shared/domain/tree';
import { cellText, type DocumentPage } from '@shared/protocol/page';
import { Decimal128, EJSON } from 'bson';
import { type Document, MongoClient } from 'mongodb';
import type { AdapterDeps, OpCtx } from '../../src/engine/adapters/adapter';
import { mongoCaps } from '../../src/engine/adapters/mongo/caps';
import { createAdapter } from '../../src/engine/adapters/registry';
import { WIDGET_COUNT } from './fixtures/0003_mongo_seed';
import { DOCKER_UNAVAILABLE_MESSAGE, isDockerAvailable } from './support/docker';
import {
  MONGO_ANALYTICS_DATABASE,
  MONGO_DATABASE,
  type MongoFixture,
  startMongo,
} from './support/mongo';
import { readDocument } from './support/page';

const CONTAINER_START_TIMEOUT_MS = 180_000;

const deps: AdapterDeps = {
  log(level, message) {
    if (level === 'error') console.error(`[mongo adapter] ${message}`);
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
  return { connectionId: 'test-mongo', segments };
}

const decoder = new TextDecoder();

function docIdAt(page: DocumentPage, row: number): string {
  return cellText(page.ids, row, decoder);
}

function docBodyAt(page: DocumentPage, row: number): Record<string, unknown> {
  return EJSON.parse(cellText(page.bodies, row, decoder));
}

async function waitUntil(
  check: () => Promise<boolean>,
  { timeoutMs = 5000, intervalMs = 50 } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error('waitUntil: condition never became true');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

let fixture: MongoFixture;

beforeAll(async () => {
  if (!(await isDockerAvailable())) throw new Error(DOCKER_UNAVAILABLE_MESSAGE);
  fixture = await startMongo();
}, CONTAINER_START_TIMEOUT_MS);

afterAll(async () => {
  await fixture?.stop();
});

describe('mongo adapter (§9.1, P8)', () => {
  test('1. connect / disconnect', async () => {
    const adapter = await createAdapter('mongodb', deps);
    const info = await adapter.connect(fixture.config, makeCtx());
    expect(info.serverVersion).toMatch(/^MongoDB \d/);
    await adapter.disconnect();

    await expect(adapter.children(path([]), makeCtx())).rejects.toMatchObject({
      code: 'E_CONNECT',
    });
  });

  test('2. auth failure', async () => {
    const adapter = await createAdapter('mongodb', deps);
    const badConfig = { ...fixture.config, password: 'definitely-wrong' };
    await expect(adapter.connect(badConfig, makeCtx())).rejects.toMatchObject({
      code: 'E_AUTH',
    });
  });

  test('3. tree enumeration', async () => {
    const adapter = await createAdapter('mongodb', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const roots = await adapter.children(path([]), makeCtx());
      expect(roots.map((n) => n.name).sort()).toEqual(
        [MONGO_ANALYTICS_DATABASE, MONGO_DATABASE].sort(),
      );

      const collections = await adapter.children(
        path([{ kind: 'database', name: MONGO_DATABASE }]),
        makeCtx(),
      );
      expect(collections.map((n) => n.name).sort()).toEqual([
        'big_widgets',
        'empty_collection',
        'oversized_widgets',
        'validated_widgets',
        'widgets',
      ]);
      expect(collections.every((n) => n.kind === 'collection')).toBe(true);
      // P19 D5's own SQL-relation precedent: a collection is a leaf, same as a table — its
      // indexes moved into the definition view (describe(), covered by test 6 below).
      expect(collections.every((n) => n.hasChildren === false)).toBe(true);
    } finally {
      await adapter.disconnect();
    }
  });

  test('4. cap honesty', () => {
    expect(mongoCaps.tabular).toBe(false);
    expect(mongoCaps.documents).toBe(true);
    expect(mongoCaps.defaultPageKind).toBe('document');
    expect(mongoCaps.definition).toBe(true);
    expect(mongoCaps.exactCount).toBe(false);
    expect(mongoCaps.pagination).toBe('cursor');
    expect(mongoCaps.cancel).toBe(true);
    expect(mongoCaps.writable).toBe(true);
    expect(mongoCaps.fileTransfer).toBe(false);
  });

  test('5. children of a leaf', async () => {
    const adapter = await createAdapter('mongodb', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      // Rule 5 (Adapter doc comment): children() returns [] for a leaf, never throws — a
      // collection is one now (P19 D5's own SQL-relation precedent), so this asks its own path.
      const children = await adapter.children(
        path([
          { kind: 'database', name: MONGO_DATABASE },
          { kind: 'collection', name: 'widgets' },
        ]),
        makeCtx(),
      );
      expect(children).toEqual([]);
    } finally {
      await adapter.disconnect();
    }
  });

  test('6. describe', async () => {
    const adapter = await createAdapter('mongodb', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const meta = await adapter.describe(
        path([
          { kind: 'database', name: MONGO_DATABASE },
          { kind: 'collection', name: 'widgets' },
        ]),
        makeCtx(),
      );
      expect(meta.kind).toBe('collection');
      expect(meta.columns).toEqual([]);
      expect(meta.primaryKey).toBeNull();
      expect(meta.foreignKeys).toEqual([]);
      const idIndex = meta.indexes.find((i) => i.name === '_id_');
      expect(idIndex).toMatchObject({ primary: true });
      const nameIndex = meta.indexes.find((i) => i.name === 'name_1');
      expect(nameIndex).toMatchObject({ unique: true, primary: false, columns: ['name'] });
    } finally {
      await adapter.disconnect();
    }
  });

  test('7. definition', async () => {
    const adapter = await createAdapter('mongodb', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      // Plain collection: no creation options, no validator (P19 D12).
      const widgets = await adapter.definition(
        path([
          { kind: 'database', name: MONGO_DATABASE },
          { kind: 'collection', name: 'widgets' },
        ]),
        makeCtx(),
      );
      expect(widgets.kind).toBe('collection');
      expect(widgets.language).toBe('json');
      expect(widgets.origin).toBe('server');
      expect(widgets.statements).toEqual(['{}']);
      expect(widgets.notes.length).toBeGreaterThan(0);
      expect(widgets.constraints).toEqual([]);
      expect(widgets.documentSchema).toEqual({
        validator: null,
        isJsonSchema: false,
        validationLevel: null,
        validationAction: null,
      });

      // Validated collection: a real $jsonSchema, relaxed EJSON (not {"$numberInt":"0"}).
      const validated = await adapter.definition(
        path([
          { kind: 'database', name: MONGO_DATABASE },
          { kind: 'collection', name: 'validated_widgets' },
        ]),
        makeCtx(),
      );
      expect(validated.notes).toEqual([]);
      expect(validated.statements[0]).toContain('validator');
      expect(validated.documentSchema?.isJsonSchema).toBe(true);
      expect(validated.documentSchema?.validationLevel).toBe('moderate');
      expect(validated.documentSchema?.validationAction).toBe('warn');
      const schema = JSON.parse(validated.documentSchema?.validator ?? 'null');
      expect(schema.required).toEqual(['name', 'price']);
      expect(schema.properties.price.minimum).toBe(0);

      await expect(
        adapter.definition(path([{ kind: 'database', name: MONGO_DATABASE }]), makeCtx()),
      ).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
    } finally {
      await adapter.disconnect();
    }
  });

  test('8. read: first page, _id keyset', async () => {
    const adapter = await createAdapter('mongodb', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const page = await readDocument(
        adapter,
        {
          path: path([
            { kind: 'database', name: MONGO_DATABASE },
            { kind: 'collection', name: 'widgets' },
          ]),
          projection: null,
          filter: null,
          sort: null,
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      expect(page.rowCount).toBe(10);
      expect(page.position.strategy).toBe('keyset');
      expect(page.position.hasMore).toBe(true);
      expect(docBodyAt(page, 0).name).toBe('widget-0');
    } finally {
      await adapter.disconnect();
    }
  });

  test('9. read: keyset forward and backward', async () => {
    const adapter = await createAdapter('mongodb', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const target = path([
        { kind: 'database', name: MONGO_DATABASE },
        { kind: 'collection', name: 'widgets' },
      ]);
      const baseReq = { path: target, projection: null, filter: null, sort: null, pageSize: 5 };

      const forwardIds: string[] = [];
      let cursor: { mode: 'offset'; offset: number } | { mode: 'after'; token: string } = {
        mode: 'offset',
        offset: 0,
      };
      let lastPage: DocumentPage | undefined;
      // 4 pages of 5 (20 of the 25 widgets) — stopping short of the end, like mariadb.spec.ts's
      // equivalent, keeps every forward page's nextToken non-null through the loop.
      for (let i = 0; i < 4; i++) {
        const page = await readDocument(adapter, { ...baseReq, cursor }, makeCtx());
        lastPage = page;
        for (let r = 0; r < page.rowCount; r++) forwardIds.push(docIdAt(page, r));
        const nextToken = page.position.nextToken;
        if (!nextToken) throw new Error('expected a nextToken on every forward page');
        cursor = { mode: 'after', token: nextToken };
      }
      if (!lastPage) throw new Error('expected at least one page');
      expect(forwardIds).toHaveLength(20);
      expect(new Set(forwardIds).size).toBe(20);

      const initialPrevToken = lastPage.position.prevToken;
      if (!initialPrevToken) throw new Error('expected a prevToken on the last forward page');

      const backwardIds: string[] = [];
      for (let r = 0; r < lastPage.rowCount; r++) backwardIds.push(docIdAt(lastPage, r));
      let backCursor: { mode: 'before'; token: string } = {
        mode: 'before',
        token: initialPrevToken,
      };
      for (let i = 0; i < 5; i++) {
        const page = await readDocument(adapter, { ...baseReq, cursor: backCursor }, makeCtx());
        const ids: string[] = [];
        for (let r = 0; r < page.rowCount; r++) ids.push(docIdAt(page, r));
        backwardIds.unshift(...ids);
        if (!page.position.prevToken) break;
        backCursor = { mode: 'before', token: page.position.prevToken };
      }

      expect(backwardIds).toEqual(forwardIds);

      // A token from a different filter is rejected (fingerprint mismatch, same as the SQL adapters).
      const staleToken = lastPage.position.nextToken;
      if (!staleToken) throw new Error('expected a nextToken on the last forward page');
      await expect(
        readDocument(
          adapter,
          { ...baseReq, filter: '{ active: true }', cursor: { mode: 'after', token: staleToken } },
          makeCtx(),
        ),
      ).rejects.toMatchObject({ code: 'E_QUERY' });
    } finally {
      await adapter.disconnect();
    }
  });

  test('10. read: skip/limit fallback for a non-_id sort', async () => {
    const adapter = await createAdapter('mongodb', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const target = path([
        { kind: 'database', name: MONGO_DATABASE },
        { kind: 'collection', name: 'widgets' },
      ]);
      const page1 = await readDocument(
        adapter,
        {
          path: target,
          projection: null,
          filter: null,
          sort: { kind: 'structured', terms: [{ column: 'name', direction: 'desc' }] },
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      expect(page1.position.strategy).toBe('offset');
      expect(page1.rowCount).toBe(10);
      expect(page1.position.hasMore).toBe(true);
      expect(docBodyAt(page1, 0).name).toBe('widget-9'); // lexicographic desc: widget-9 sorts first

      const page3 = await readDocument(
        adapter,
        {
          path: target,
          projection: null,
          filter: null,
          sort: { kind: 'structured', terms: [{ column: 'name', direction: 'desc' }] },
          pageSize: 10,
          cursor: { mode: 'offset', offset: 20 },
        },
        makeCtx(),
      );
      expect(page3.rowCount).toBe(WIDGET_COUNT - 20);
      expect(page3.position.hasMore).toBe(false);
    } finally {
      await adapter.disconnect();
    }
  });

  // Regression test for the paging bug this fixed (renderer's DocumentTabState.pageIndex /
  // goNext/goPrev, not this adapter): a single-field sort can look "applied" even when only the
  // first key of a multi-term sort actually reached findOptions.sort — `active` alone only
  // groups true/false, it can't prove `price` was honoured as the tiebreaker inside each group.
  // Sorting by both together and checking the exact row order across the group boundary is what
  // actually exercises `sortTerms.map(...)` building every term, not just `sortTerms[0]`.
  test('10b. read: multi-field sort actually reorders results', async () => {
    const adapter = await createAdapter('mongodb', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const target = path([
        { kind: 'database', name: MONGO_DATABASE },
        { kind: 'collection', name: 'widgets' },
      ]);
      const page = await readDocument(
        adapter,
        {
          path: target,
          projection: null,
          filter: null,
          sort: {
            kind: 'structured',
            terms: [
              { column: 'active', direction: 'desc' },
              { column: 'price', direction: 'asc' },
            ],
          },
          pageSize: WIDGET_COUNT,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      expect(page.position.strategy).toBe('offset');
      expect(page.rowCount).toBe(WIDGET_COUNT);
      // active: true (i even, 13 docs) sorts before active: false (i odd, 12 docs); within each
      // group, price (== (i+1)*1.5, monotonic in i) sorts ascending.
      expect(docBodyAt(page, 0).name).toBe('widget-0'); // lowest price, active: true
      expect(docBodyAt(page, 12).name).toBe('widget-24'); // highest price, active: true
      expect(docBodyAt(page, 13).name).toBe('widget-1'); // lowest price, active: false
      expect(docBodyAt(page, WIDGET_COUNT - 1).name).toBe('widget-23'); // highest price, active: false
    } finally {
      await adapter.disconnect();
    }
  });

  test('11. read: filter', async () => {
    const adapter = await createAdapter('mongodb', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const page = await readDocument(
        adapter,
        {
          path: path([
            { kind: 'database', name: MONGO_DATABASE },
            { kind: 'collection', name: 'widgets' },
          ]),
          projection: null,
          filter: '{ active: true }',
          sort: null,
          pageSize: 100,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      expect(page.rowCount).toBe(13); // i even, 0..24
      for (let r = 0; r < page.rowCount; r++) expect(docBodyAt(page, r).active).toBe(true);
    } finally {
      await adapter.disconnect();
    }
  });

  test('12. count: estimate vs exact', async () => {
    const adapter = await createAdapter('mongodb', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const target = path([
        { kind: 'database', name: MONGO_DATABASE },
        { kind: 'collection', name: 'widgets' },
      ]);
      const estimate = await adapter.count({ path: target, filter: null }, makeCtx());
      expect(estimate).toEqual({ value: WIDGET_COUNT, exact: false });

      const exact = await adapter.count({ path: target, filter: '{ active: true }' }, makeCtx());
      expect(exact).toEqual({ value: 13, exact: true });
    } finally {
      await adapter.disconnect();
    }
  });

  test('13. preview: exact text, never executes', async () => {
    const adapter = await createAdapter('mongodb', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const target = path([
        { kind: 'database', name: MONGO_DATABASE },
        { kind: 'collection', name: 'widgets' },
      ]);
      const plan: MutationPlan = {
        path: target,
        ops: [{ kind: 'delete', key: { _id: EJSON.stringify(0) } }],
      };
      const statements = adapter.preview(plan);
      expect(statements).toEqual(['db.widgets.deleteOne({_id: ...})']);

      const page = await readDocument(
        adapter,
        {
          path: target,
          projection: null,
          filter: null,
          sort: null,
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      expect(page.rowCount).toBe(10); // preview never executed
    } finally {
      await adapter.disconnect();
    }
  });

  test('14. mutate: whole-document replace via $document', async () => {
    const adapter = await createAdapter('mongodb', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const target = path([
        { kind: 'database', name: MONGO_DATABASE },
        { kind: 'collection', name: 'mutate_probe' },
      ]);
      const side = new MongoClient(fixture.rootUri);
      await side.connect();
      try {
        await side
          .db(MONGO_DATABASE)
          .collection('mutate_probe')
          .insertOne({ _id: 1, name: 'before' } as Document);
      } finally {
        await side.close();
      }

      let loggedCommand = '';
      const ctx: OpCtx = {
        opId: crypto.randomUUID(),
        signal: new AbortController().signal,
        setCommand(text) {
          loggedCommand = text;
        },
      };
      const plan: MutationPlan = {
        path: target,
        ops: [
          {
            kind: 'update',
            key: { _id: EJSON.stringify(1) },
            changes: { $document: EJSON.stringify({ name: 'after', extra: true }) },
          },
        ],
      };
      const result = await adapter.mutate(plan, ctx);
      expect(result.affectedRows).toBe(1);
      expect(loggedCommand).toContain('db.mutate_probe.replaceOne');

      const page = await readDocument(
        adapter,
        {
          path: target,
          projection: null,
          filter: null,
          sort: null,
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      expect(page.rowCount).toBe(1);
      expect(docBodyAt(page, 0)).toEqual({ _id: 1, name: 'after', extra: true });
    } finally {
      await adapter.disconnect();
    }
  });

  test('15. mutate: delete', async () => {
    const adapter = await createAdapter('mongodb', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const target = path([
        { kind: 'database', name: MONGO_DATABASE },
        { kind: 'collection', name: 'delete_probe' },
      ]);
      const side = new MongoClient(fixture.rootUri);
      await side.connect();
      try {
        await side
          .db(MONGO_DATABASE)
          .collection('delete_probe')
          .insertOne({ _id: 1, name: 'gone soon' } as Document);
      } finally {
        await side.close();
      }

      const plan: MutationPlan = {
        path: target,
        ops: [{ kind: 'delete', key: { _id: EJSON.stringify(1) } }],
      };
      const result = await adapter.mutate(plan, makeCtx());
      expect(result.affectedRows).toBe(1);

      const page = await readDocument(
        adapter,
        {
          path: target,
          projection: null,
          filter: null,
          sort: null,
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      expect(page.rowCount).toBe(0);
    } finally {
      await adapter.disconnect();
    }
  });

  test('16. mutate: insert is unsupported', async () => {
    const adapter = await createAdapter('mongodb', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const plan: MutationPlan = {
        path: path([
          { kind: 'database', name: MONGO_DATABASE },
          { kind: 'collection', name: 'widgets' },
        ]),
        ops: [{ kind: 'insert', values: { name: EJSON.stringify('nope') } }],
      };
      await expect(adapter.mutate(plan, makeCtx())).rejects.toMatchObject({
        code: 'E_UNSUPPORTED',
      });
    } finally {
      await adapter.disconnect();
    }
  });

  test('17. mutate: read-only connection is E_UNSUPPORTED', async () => {
    const adapter = await createAdapter('mongodb', deps);
    await adapter.connect({ ...fixture.config, readOnly: true }, makeCtx());
    try {
      const plan: MutationPlan = {
        path: path([
          { kind: 'database', name: MONGO_DATABASE },
          { kind: 'collection', name: 'widgets' },
        ]),
        ops: [{ kind: 'delete', key: { _id: EJSON.stringify(0) } }],
      };
      await expect(adapter.mutate(plan, makeCtx())).rejects.toMatchObject({
        code: 'E_UNSUPPORTED',
      });
    } finally {
      await adapter.disconnect();
    }
  });

  test('18. mutate: no matching document is E_QUERY', async () => {
    const adapter = await createAdapter('mongodb', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const plan: MutationPlan = {
        path: path([
          { kind: 'database', name: MONGO_DATABASE },
          { kind: 'collection', name: 'widgets' },
        ]),
        ops: [{ kind: 'delete', key: { _id: EJSON.stringify('000000000000000000009999') } }],
      };
      await expect(adapter.mutate(plan, makeCtx())).rejects.toMatchObject({ code: 'E_QUERY' });
    } finally {
      await adapter.disconnect();
    }
  });

  test('19. execute: console statements, including a status page', async () => {
    const adapter = await createAdapter('mongodb', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      let loggedCommand = '';
      const ctx: OpCtx = {
        opId: crypto.randomUUID(),
        signal: new AbortController().signal,
        setCommand(text) {
          loggedCommand = text;
        },
      };
      const statements = [
        'db.widgets.find({ active: true })',
        'db.widgets.countDocuments({ active: true })',
      ];
      const pages = await adapter.execute(
        { path: path([{ kind: 'database', name: MONGO_DATABASE }]), statements },
        ctx,
      );
      expect(loggedCommand).toBe(statements.join(';\n'));
      expect(pages).toHaveLength(2);
      const [findPage, countPage] = pages;
      if (findPage.kind !== 'document' || countPage.kind !== 'document') {
        throw new Error('expected document console pages');
      }
      expect(findPage.rowCount).toBe(13);
      expect(countPage.rowCount).toBe(1);
      expect(docBodyAt(countPage, 0)).toEqual({ count: 13 });
    } finally {
      await adapter.disconnect();
    }
  });

  test('20. execute: unsupported method is E_UNSUPPORTED', async () => {
    const adapter = await createAdapter('mongodb', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      await expect(
        adapter.execute(
          {
            path: path([{ kind: 'database', name: MONGO_DATABASE }]),
            statements: ['db.widgets.drop()'],
          },
          makeCtx(),
        ),
      ).rejects.toMatchObject({ code: 'E_UNSUPPORTED' });
    } finally {
      await adapter.disconnect();
    }
  });

  test('21. execute: an already-cancelled signal rejects before running anything', async () => {
    const adapter = await createAdapter('mongodb', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const controller = new AbortController();
      controller.abort();
      const ctx: OpCtx = { opId: crypto.randomUUID(), signal: controller.signal, setCommand() {} };
      await expect(
        adapter.execute(
          {
            path: path([{ kind: 'database', name: MONGO_DATABASE }]),
            statements: ['db.widgets.find({})'],
          },
          ctx,
        ),
      ).rejects.toMatchObject({ code: 'E_CANCELLED' });
    } finally {
      await adapter.disconnect();
    }
  });

  test('22. cancel, asserted server-side via killOp', async () => {
    const adapter = await createAdapter('mongodb', deps);
    await adapter.connect(fixture.config, makeCtx());
    const side = new MongoClient(fixture.rootUri);
    await side.connect();
    try {
      // A single document whose match evaluates a deliberately slow server-side $function —
      // long enough to observe in currentOp and kill mid-flight, short enough not to stall CI.
      await side
        .db(MONGO_DATABASE)
        .collection('slow_probe')
        .insertOne({ _id: 1 } as Document);

      const opId = crypto.randomUUID();
      const ctx: OpCtx = { opId, signal: new AbortController().signal, setCommand() {} };
      const slowFilter =
        '{ $expr: { $function: { body: "function() { var s = new Date().getTime(); while (new Date().getTime() - s < 8000) {} return true; }", args: [], lang: "js" } } }';
      const readPromise = adapter.read(
        {
          path: path([
            { kind: 'database', name: MONGO_DATABASE },
            { kind: 'collection', name: 'slow_probe' },
          ]),
          projection: null,
          filter: slowFilter,
          sort: null,
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        ctx,
      );
      readPromise.catch(() => {});

      await waitUntil(async () => {
        const current = await side.db().admin().command({ currentOp: 1, 'command.comment': opId });
        return ((current.inprog as unknown[] | undefined) ?? []).length > 0;
      });

      const cancelled = await adapter.cancel(opId);
      expect(cancelled).toBe(true);

      // The server killed the op mid-flight rather than the local AbortSignal firing (ctx.signal
      // is never aborted here) — the driver surfaces this as a MongoServerError, not AbortError.
      await expect(readPromise).rejects.toMatchObject({ code: 'E_QUERY' });

      await waitUntil(async () => {
        const current = await side.db().admin().command({ currentOp: 1, 'command.comment': opId });
        return ((current.inprog as unknown[] | undefined) ?? []).length === 0;
      });
    } finally {
      await side.close();
      await adapter.disconnect();
    }
  });

  test('23. read: filter accepts a shell constructor and an extended-JSON wrapper for the same value (D15)', async () => {
    const adapter = await createAdapter('mongodb', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const target = path([
        { kind: 'database', name: MONGO_DATABASE },
        { kind: 'collection', name: 'widgets' },
      ]);
      const byConstructor = await readDocument(
        adapter,
        {
          path: target,
          projection: null,
          filter: `{ _id: ObjectId('000000000000000000000005') }`,
          sort: null,
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      expect(byConstructor.rowCount).toBe(1);
      expect(docBodyAt(byConstructor, 0).name).toBe('widget-5');

      // The exact text *Copy _id* now puts on the clipboard (P27 D12) — canonical extended JSON,
      // not the shell spelling — must resolve to the same document (F14).
      const byWrapper = await readDocument(
        adapter,
        {
          path: target,
          projection: null,
          filter: `{ _id: {"$oid": "000000000000000000000005"} }`,
          sort: null,
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      expect(byWrapper.rowCount).toBe(1);
      expect(docBodyAt(byWrapper, 0).name).toBe('widget-5');
    } finally {
      await adapter.disconnect();
    }
  });

  test('24. mutate: a body mixing shell constructors and extended-JSON wrappers writes real BSON types (D16)', async () => {
    const adapter = await createAdapter('mongodb', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const target = path([
        { kind: 'database', name: MONGO_DATABASE },
        { kind: 'collection', name: 'literal_probe' },
      ]);
      const body =
        `{ _id: ObjectId('000000000000000000000a01'), ` +
        `count: NumberInt(7), ` +
        `price: {"$numberDecimal": "9.99"}, ` +
        `when: ISODate('2024-01-01T00:00:00.000Z') }`;
      const plan: MutationPlan = {
        path: target,
        ops: [{ kind: 'insert', values: { $document: body } }],
      };
      const result = await adapter.mutate(plan, makeCtx());
      expect(result.affectedRows).toBe(1);

      const page = await readDocument(
        adapter,
        {
          path: target,
          projection: null,
          filter: null,
          sort: null,
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      expect(page.rowCount).toBe(1);
      const doc = docBodyAt(page, 0);
      // Read back through EJSON.parse (canonical, mirroring what the renderer sees). NumberInt's
      // constructor (literal.ts) hands the driver a plain JS number — the driver's own wire
      // serialization decides its stored width, so only the value is asserted here; price and
      // when came from typed BSON constructors (Decimal128/Date) and are asserted by type too,
      // since those never touch a plain-number code path.
      expect(Number(doc.count)).toBe(7);
      expect(doc.price).toBeInstanceOf(Decimal128);
      expect((doc.price as Decimal128).toString()).toBe('9.99');
      expect(doc.when).toBeInstanceOf(Date);
      expect((doc.when as Date).toISOString()).toBe('2024-01-01T00:00:00.000Z');
    } finally {
      await adapter.disconnect();
    }
  });
});
