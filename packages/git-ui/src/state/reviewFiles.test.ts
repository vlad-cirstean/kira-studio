import { describe, expect, test } from 'bun:test';
import type {
  EventKey,
  EventPayload,
  FileChange,
  ParamsOf,
  RequestKey,
  ResultOf,
  StreamChunkOf,
  StreamKey,
  StreamParamsOf,
  Transport,
} from '@kira/git-ipc';
import { BridgeClient } from '../bridge/client.ts';
import { ReviewFilesState } from './reviewFiles.ts';

/** Same fake `Transport` shape `pr.test.ts`/`repoSettings.test.ts` already established. */
class FakeTransport implements Transport {
  onRequest: (method: RequestKey, params: unknown) => unknown = () => {
    throw new Error('unscripted request');
  };
  readonly calls: Array<{ method: RequestKey; params: unknown }> = [];
  #handlers = new Map<EventKey, Set<(payload: unknown) => void>>();

  request<K extends RequestKey>(method: K, params: ParamsOf<K>): Promise<ResultOf<K>> {
    this.calls.push({ method, params });
    return Promise.resolve(this.onRequest(method, params) as ResultOf<K>);
  }

  on<K extends EventKey>(method: K, handler: (payload: EventPayload<K>) => void): () => void {
    let set = this.#handlers.get(method);
    if (!set) {
      set = new Set();
      this.#handlers.set(method, set);
    }
    const wrapped = handler as (payload: unknown) => void;
    set.add(wrapped);
    return () => set?.delete(wrapped);
  }

  emit<K extends EventKey>(method: K, payload: EventPayload<K>): void {
    for (const handler of this.#handlers.get(method) ?? []) {
      handler(payload);
    }
  }

  stream<K extends StreamKey>(
    _method: K,
    _params: StreamParamsOf<K>,
    _onChunk: (chunk: StreamChunkOf<K>) => void,
  ): Promise<void> {
    return Promise.reject(new Error('not used by these tests'));
  }

  dispose(): void {}
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function fileChange(path: string): FileChange {
  return {
    kind: 'modified',
    path,
    originalPath: undefined,
    similarity: undefined,
    additions: 1,
    deletions: 0,
    isBinary: false,
  };
}

const REPO = '/repos/a';
const BRANCH = 'feature';
const BASE = 'main';

// G30 round-1 functional-correctness review, finding #3: `#openInEditor` used to read the SHARED
// `reviewedAtSha` ref — written only by `#loadDiff`'s own response, fired concurrently and not
// awaited by `selectFile` — instead of the just-clicked file's own `entry.review.reviewedAtSha`
// (already in hand from the file list). Selecting a.ts then b.ts in `sinceReview` mode opened
// a.ts's diff against whatever `reviewedAtSha` held BEFORE a.ts's own #loadDiff response landed
// (the merge base, or a previous file's sha), and opened b.ts's diff against a.ts's sha.
describe('ReviewFilesState — sinceReview mode opens each file against its own reviewedAtSha', () => {
  test('selecting two files in turn opens each against its own reviewedAtSha, never a stale one', async () => {
    const transport = new FakeTransport();
    const bridge = new BridgeClient(transport);
    const state = new ReviewFilesState(bridge);

    const openRangeDiffCalls: Array<{ path: string; leftRev: string; leftLabel: string }> = [];
    transport.onRequest = (method, params) => {
      if (method === 'review.files') {
        return {
          branchTip: 'tip-sha',
          mergeBase: 'merge-base-sha',
          files: [
            {
              change: fileChange('a.ts'),
              review: {
                kind: 'full',
                changedSinceReview: false,
                reviewedAt: 1000,
                reviewedAtSha: 'a-reviewed-sha',
              },
            },
            {
              change: fileChange('b.ts'),
              review: {
                kind: 'full',
                changedSinceReview: false,
                reviewedAt: 2000,
                reviewedAtSha: 'b-reviewed-sha',
              },
            },
          ],
        };
      }
      if (method === 'review.fileDiff') {
        const { path } = params as { path: string };
        return {
          path,
          deltaSource: 'exact',
          body: { kind: 'text', hunks: [] },
          reviewedRanges: [],
          lineCount: 10,
          reviewedAtSha: path === 'a.ts' ? 'a-reviewed-sha' : 'b-reviewed-sha',
        };
      }
      if (method === 'editor.openRangeDiff') {
        const p = params as { path: string; leftRev: string; leftLabel: string };
        openRangeDiffCalls.push({ path: p.path, leftRev: p.leftRev, leftLabel: p.leftLabel });
        return undefined;
      }
      throw new Error(`unscripted request: ${method}`);
    };

    state.setTarget({ repoId: REPO, branch: BRANCH, base: BASE });
    await tick();
    expect(state.diffMode.value).toBe('sinceReview');

    state.selectFile('a.ts');
    await tick();

    state.selectFile('b.ts');
    await tick();

    expect(openRangeDiffCalls).toEqual([
      { path: 'a.ts', leftRev: 'a-reviewed-sha', leftLabel: 'your last review' },
      { path: 'b.ts', leftRev: 'b-reviewed-sha', leftLabel: 'your last review' },
    ]);
  });
});

// G30 round-1 functional-correctness review, finding #6: mark()'s own `finally` only clears
// `pending` when `this.#target` still identically equals the target that was current when the
// request started. A setTarget call landing while a mark() is in flight (a base-resolution
// change, the stale-review banner, Refresh review) swaps that identity, so the guard never
// matches and `pending` — a pane-wide flag, not a per-target one — stays latched true forever:
// every review checkbox goes dead until the webview reloads.
describe('ReviewFilesState — pending never latches across a setTarget while a mark() is in flight', () => {
  test('setTarget clears pending even when a prior mark() never resolves', async () => {
    const transport = new FakeTransport();
    const bridge = new BridgeClient(transport);
    const state = new ReviewFilesState(bridge);

    let resolveMark: ((v: unknown) => void) | undefined;
    transport.onRequest = (method) => {
      if (method === 'review.files') {
        return { branchTip: 'tip', mergeBase: 'base', files: [] };
      }
      if (method === 'review.mark') {
        return new Promise((resolve) => {
          resolveMark = resolve;
        });
      }
      throw new Error(`unscripted request: ${method}`);
    };

    state.setTarget({ repoId: REPO, branch: BRANCH, base: BASE });
    await tick();

    void state.mark('a.ts', true);
    await tick();
    expect(state.pending.value).toBe(true);

    // A base-resolution change (or Refresh review, or the stale-review banner) lands a fresh
    // target while the mark() above is still hanging — resolveMark is deliberately never called.
    state.setTarget({ repoId: REPO, branch: BRANCH, base: 'a-different-base' });
    await tick();

    expect(state.pending.value).toBe(false);

    // And the panel must actually be usable again, not just report pending=false: a fresh mark()
    // call must reach the transport rather than bouncing off a guard that still thinks one is
    // already in flight.
    const markCallsBefore = transport.calls.filter((c) => c.method === 'review.mark').length;
    void state.mark('b.ts', true);
    await tick();
    expect(transport.calls.filter((c) => c.method === 'review.mark').length).toBe(
      markCallsBefore + 1,
    );

    resolveMark?.({
      review: { kind: 'full', changedSinceReview: false, reviewedAt: 0, reviewedAtSha: 's' },
    });
  });
});

// G30 round-1 functional-correctness review, finding #7: mark()'s own request had no catch at
// all — a rejection propagated straight out of mark() as a rejected promise, and every real
// caller (ReviewFilesPane.vue's onToggleReviewed, ReviewView.vue's toggleFileReviewed palette
// action) calls it as `void mark(...)`, discarding that promise. The failure became an unhandled
// rejection with nothing user-visible: the checkbox just silently reverted on the next render.
describe('ReviewFilesState — a failed mark() surfaces on markError instead of vanishing', () => {
  test('a rejected review.mark sets markError and clears pending, without throwing out of mark()', async () => {
    const transport = new FakeTransport();
    const bridge = new BridgeClient(transport);
    const state = new ReviewFilesState(bridge);

    transport.onRequest = (method) => {
      if (method === 'review.files') {
        return { branchTip: 'tip', mergeBase: 'base', files: [] };
      }
      if (method === 'review.mark') {
        throw new Error('disk full');
      }
      throw new Error(`unscripted request: ${method}`);
    };

    state.setTarget({ repoId: REPO, branch: BRANCH, base: BASE });
    await tick();
    expect(state.markError.value).toBeUndefined();

    // mark() is awaited directly here (not `void`-discarded, as every real caller does) — proves
    // the promise itself never rejects, only markError is set. A real caller relying on `void`
    // would otherwise have seen this as an unhandled rejection.
    await state.mark('a.ts', true);

    expect(state.markError.value).toBe('disk full');
    expect(state.pending.value).toBe(false);
  });

  test('a subsequent successful mark() clears a previous markError', async () => {
    const transport = new FakeTransport();
    const bridge = new BridgeClient(transport);
    const state = new ReviewFilesState(bridge);

    let failNext = true;
    transport.onRequest = (method) => {
      if (method === 'review.files') {
        return { branchTip: 'tip', mergeBase: 'base', files: [] };
      }
      if (method === 'review.mark') {
        if (failNext) throw new Error('disk full');
        return {
          review: { kind: 'full', changedSinceReview: false, reviewedAt: 0, reviewedAtSha: 's' },
        };
      }
      throw new Error(`unscripted request: ${method}`);
    };

    state.setTarget({ repoId: REPO, branch: BRANCH, base: BASE });
    await tick();

    await state.mark('a.ts', true);
    expect(state.markError.value).toBe('disk full');

    failNext = false;
    await state.mark('a.ts', true);
    expect(state.markError.value).toBeUndefined();
  });

  test('setTarget clears a stale markError from the previous target', async () => {
    const transport = new FakeTransport();
    const bridge = new BridgeClient(transport);
    const state = new ReviewFilesState(bridge);

    transport.onRequest = (method) => {
      if (method === 'review.files') {
        return { branchTip: 'tip', mergeBase: 'base', files: [] };
      }
      if (method === 'review.mark') {
        throw new Error('disk full');
      }
      throw new Error(`unscripted request: ${method}`);
    };

    state.setTarget({ repoId: REPO, branch: BRANCH, base: BASE });
    await tick();
    await state.mark('a.ts', true);
    expect(state.markError.value).toBe('disk full');

    state.setTarget({ repoId: REPO, branch: BRANCH, base: 'a-different-base' });
    await tick();
    expect(state.markError.value).toBeUndefined();
  });
});
