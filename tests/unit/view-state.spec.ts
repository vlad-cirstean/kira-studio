// P44 F47: P43 iteration 3 fixed two ordering bugs in the renderer's view-state modules —
// views/browse/state.ts's load() supersession guard (D39/F35) and views/keyvalue/state.ts's
// cursor-strategy reload fallback (D40/F37) — and both are pinned today only by Docker-gated
// Playwright steps that cannot deterministically force the race they exist to guard against. The
// browse guard's own coverage (tests/e2e/s3.spec.ts's "descend then press Up immediately" step)
// only exercises the guard if the slow load happens to still be in flight when
// Up lands — on a fast container or a small level, the step passes whether or not the guard
// exists. Both modules are plain TypeScript over bridge/data/bridge/control, both window.kira
// wrappers a stub can satisfy — this file resolves the *older* of two in-flight loads *after* the
// newer one, the exact interleaving no Playwright test can force, by holding both on manually
// resolved promises.
import './support/window';

import { describe, expect, test } from 'bun:test';
import type { PageCursor } from '@shared/protocol/data-ops';
import type { KeyValuePage, TextColumnChunk } from '@shared/protocol/page';

const { control } = await import('../../src/renderer/bridge/control');
const { data } = await import('../../src/renderer/bridge/data');
const { openBrowseTab, openKeyValueTab, openDataTab, findKeyValueTab, findDataTab } = await import(
  '../../src/renderer/state/tabs'
);
const { load: loadBrowse, runtime: browseRuntime } = await import(
  '../../src/renderer/views/browse/state'
);
const {
  load: loadKeyValue,
  goNext: keyValueGoNext,
  runtime: keyValueRuntime,
} = await import('../../src/renderer/views/keyvalue/state');
const { setPage } = await import('../../src/renderer/views/keyvalue/page');
const {
  goNext: gridGoNext,
  goPrev: gridGoPrev,
  runtime: gridRuntime,
} = await import('../../src/renderer/views/grid/state');

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function emptyChunk(): TextColumnChunk {
  return {
    data: new Uint8Array(0),
    offsets: new Uint32Array([0]),
    nulls: new Uint8Array(0),
    truncated: new Uint32Array(0),
  };
}

describe('views/browse/state.ts — load() supersession guard (P44 F47, P43 D39)', () => {
  test('1. resolving the older treeChildren call after the newer one still leaves the newer nodes in place', async () => {
    const { id } = openBrowseTab('conn1', 'bucket:one', { newTab: true });
    const calls: Array<ReturnType<typeof deferred<{ nodes: unknown[]; truncated: boolean }>>> = [];
    // biome-ignore lint/suspicious/noExplicitAny: a minimal fake, not the real TreeChildrenResult
    (control as any).treeChildren = () => {
      const d = deferred<{ nodes: unknown[]; truncated: boolean }>();
      calls.push(d);
      return d.promise;
    };

    const older = loadBrowse(id); // loadSeq 1
    const newer = loadBrowse(id); // loadSeq 2
    expect(calls).toHaveLength(2);

    // The newer call lands first; the older one resolves after it.
    calls[1]?.resolve({ nodes: [{ name: 'newer' }], truncated: false });
    await newer;
    calls[0]?.resolve({ nodes: [{ name: 'older' }], truncated: false });
    await older;

    expect(browseRuntime[id]?.nodes.map((n) => n.name)).toEqual(['newer']);
  });

  test('2. a superseded failure does not redden a level that loaded fine', async () => {
    const { id } = openBrowseTab('conn2', 'bucket:two', { newTab: true });
    const calls: Array<ReturnType<typeof deferred<{ nodes: unknown[]; truncated: boolean }>>> = [];
    // biome-ignore lint/suspicious/noExplicitAny: a minimal fake, not the real TreeChildrenResult
    (control as any).treeChildren = () => {
      const d = deferred<{ nodes: unknown[]; truncated: boolean }>();
      calls.push(d);
      return d.promise;
    };

    const older = loadBrowse(id); // loadSeq 1 — will fail
    const newer = loadBrowse(id); // loadSeq 2 — will succeed
    calls[1]?.resolve({ nodes: [{ name: 'good' }], truncated: false });
    await newer;
    expect(browseRuntime[id]?.status).toBe('idle');

    calls[0]?.reject(new Error('stale failure'));
    await older;

    expect(browseRuntime[id]?.status).toBe('idle');
    expect(browseRuntime[id]?.nodes.map((n) => n.name)).toEqual(['good']);
    expect(browseRuntime[id]?.error).toBeNull();
  });

  test('3. rt.truncated is reset to false the moment a new load starts, before the await settles', async () => {
    const { id } = openBrowseTab('conn3', 'bucket:three', { newTab: true });
    const first = deferred<{ nodes: unknown[]; truncated: boolean }>();
    // biome-ignore lint/suspicious/noExplicitAny: a minimal fake, not the real TreeChildrenResult
    (control as any).treeChildren = () => first.promise;

    const pending = loadBrowse(id);
    if (browseRuntime[id]) browseRuntime[id].truncated = true; // simulate a prior truncated level
    const second = loadBrowse(id); // a new load starts — must reset truncated synchronously

    expect(browseRuntime[id]?.truncated).toBe(false);

    first.resolve({ nodes: [], truncated: false });
    await Promise.all([pending, second]);
  });
});

describe('views/keyvalue/state.ts — cursor-strategy reload fallback (P44 F47, P43 D40)', () => {
  function makeKeyValuePage(strategy: 'offset' | 'cursor'): KeyValuePage {
    return {
      kind: 'keyvalue',
      position: {
        offset: strategy === 'offset' ? 200 : null,
        pageSize: 100,
        hasMore: true,
        nextToken: strategy === 'cursor' ? 'tok' : null,
        prevToken: null,
        strategy,
      },
      redisType: strategy === 'offset' ? 'list' : 'hash',
      ttlMs: null,
      memoryBytes: null,
      fields: emptyChunk(),
      values: emptyChunk(),
      rowCount: 0,
      byteSize: 0,
      fetchedAt: Date.now(),
    };
  }

  test('4. a cursor-strategy page reloads with offset: 0 and returns pageIndex to 0', async () => {
    const { id } = openKeyValueTab('conn4', 'db0/key:big-hash', { newTab: true });
    setPage(id, makeKeyValuePage('cursor'));
    let capturedCursor: PageCursor | undefined;
    // biome-ignore lint/suspicious/noExplicitAny: a minimal fake, not the real ReadResponse
    (data as any).read = (req: { cursor: PageCursor }) => {
      capturedCursor = req.cursor;
      return Promise.resolve({ page: makeKeyValuePage('cursor'), source: 'server' });
    };

    await loadKeyValue(id);

    expect(capturedCursor).toEqual({ mode: 'offset', offset: 0 });
    expect(findKeyValueTab(id)?.state.pageIndex).toBe(0);
  });

  test('5. an offset-strategy page on the same code path still reloads with pageIndex * pageSize, unchanged', async () => {
    const { id } = openKeyValueTab('conn5', 'db0/key:big-list', { newTab: true });
    setPage(id, makeKeyValuePage('offset'));
    let capturedCursor: PageCursor | undefined;
    // biome-ignore lint/suspicious/noExplicitAny: a minimal fake, not the real ReadResponse
    (data as any).read = (req: { cursor: PageCursor }) => {
      capturedCursor = req.cursor;
      return Promise.resolve({ page: makeKeyValuePage('offset'), source: 'server' });
    };
    const tab = findKeyValueTab(id);
    if (!tab) throw new Error('expected the tab to exist');
    tab.state.pageIndex = 2;

    await loadKeyValue(id);

    expect(capturedCursor).toEqual({ mode: 'offset', offset: 2 * tab.state.pageSize });
    expect(findKeyValueTab(id)?.state.pageIndex).toBe(2);
  });
});

// P2 R2 (task #93): goNext/goPrev/etc. patch pageIndex to the new page *before* the load that
// fetches it settles — a failed or cancelled load never calls setPage, so the grid keeps
// rendering the old page's rows while the pager, left un-reverted, claimed a page that was never
// actually fetched.
describe('views/grid/state.ts — pageIndex reverts on a failed or cancelled load (P2 R2, task #93)', () => {
  test('6. goNext reverts pageIndex to the previous page when the load fails', async () => {
    const { id } = openDataTab('conn6', 'public.orders', { newTab: true });
    // biome-ignore lint/suspicious/noExplicitAny: a minimal fake, not the real ReadResponse
    (data as any).read = () =>
      Promise.reject(Object.assign(new Error('boom'), { code: 'E_QUERY' }));

    await gridGoNext(id);

    expect(findDataTab(id)?.state.pageIndex).toBe(0);
    expect(gridRuntime[id]?.status).toBe('error');
  });

  test('7. goNext reverts pageIndex to the previous page when the load is cancelled', async () => {
    const { id } = openDataTab('conn7', 'public.orders', { newTab: true });
    // biome-ignore lint/suspicious/noExplicitAny: a minimal fake, not the real ReadResponse
    (data as any).read = () =>
      Promise.reject(Object.assign(new Error('cancelled'), { code: 'E_CANCELLED' }));

    await gridGoNext(id);

    expect(findDataTab(id)?.state.pageIndex).toBe(0);
    expect(gridRuntime[id]?.status).toBe('cancelled');
  });

  test('8. goPrev reverts pageIndex to the previous page when the load fails', async () => {
    const { id } = openDataTab('conn8', 'public.orders', { newTab: true });
    const tab = findDataTab(id);
    if (!tab) throw new Error('expected the tab to exist');
    tab.state.pageIndex = 3;
    // biome-ignore lint/suspicious/noExplicitAny: a minimal fake, not the real ReadResponse
    (data as any).read = () =>
      Promise.reject(Object.assign(new Error('boom'), { code: 'E_QUERY' }));

    await gridGoPrev(id);

    expect(findDataTab(id)?.state.pageIndex).toBe(3);
  });

  test("9. a superseded (stale) load's failure does not revert a pageIndex a newer load already advanced", async () => {
    const { id } = openDataTab('conn9', 'public.orders', { newTab: true });
    const first = deferred<{ page: unknown; source: string }>();
    const second = deferred<{ page: unknown; source: string }>();
    const reads: Array<typeof first> = [first, second];
    let call = 0;
    // biome-ignore lint/suspicious/noExplicitAny: a minimal fake, not the real ReadResponse
    (data as any).read = () => reads[call++]?.promise;

    const older = gridGoNext(id); // page 0 -> 1, opId A
    expect(findDataTab(id)?.state.pageIndex).toBe(1);
    const newer = gridGoNext(id); // page 1 -> 2, opId B (supersedes A)
    expect(findDataTab(id)?.state.pageIndex).toBe(2);

    // A's request fails after B has already taken over — its failure must not stomp on B's
    // optimistic pageIndex, and reverting to "1" (the index *before A's own* advance) would be
    // exactly that stomp.
    first.reject(Object.assign(new Error('stale failure'), { code: 'E_QUERY' }));
    await older;
    expect(findDataTab(id)?.state.pageIndex).toBe(2);

    // B itself now fails — being the current op, it must revert to its own previous index (1).
    second.reject(Object.assign(new Error('boom'), { code: 'E_QUERY' }));
    await newer;
    expect(findDataTab(id)?.state.pageIndex).toBe(1);
  });
});

describe('views/keyvalue/state.ts — pageIndex reverts on a failed load (P2 R2, task #93)', () => {
  test('10. goNext reverts pageIndex to the previous page when the load fails', async () => {
    const { id } = openKeyValueTab('conn10', 'db0/key:big-list', { newTab: true });
    // biome-ignore lint/suspicious/noExplicitAny: a minimal fake, not the real ReadResponse
    (data as any).read = () =>
      Promise.reject(Object.assign(new Error('boom'), { code: 'E_QUERY' }));

    await keyValueGoNext(id);

    expect(findKeyValueTab(id)?.state.pageIndex).toBe(0);
    expect(keyValueRuntime[id]?.status).toBe('error');
  });
});
