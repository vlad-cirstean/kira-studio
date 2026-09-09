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
