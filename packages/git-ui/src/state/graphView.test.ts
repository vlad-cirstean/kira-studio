import { describe, expect, test } from 'bun:test';
import type { LayoutChunk } from '@kira/git-core';
import { buildPackedChunk } from '@kira/git-core/testing/packedChunk';
import type {
  EventKey,
  EventPayload,
  ParamsOf,
  RequestKey,
  ResultOf,
  StreamChunkOf,
  StreamKey,
  StreamParamsOf,
  Transport,
} from '@kira/git-ipc';
import { TransportError } from '@kira/git-ipc';
import { sleep } from '@workbench/testing/unit/async';
import { BridgeClient } from '../bridge/client.ts';
import type { LayoutClient } from '../graph/layoutClient.ts';
import { GraphViewState } from './graphView.ts';

const REPO_A = '/repos/a';
const REPO_B = '/repos/b';

type GraphStreamChunk = StreamChunkOf<'graph.stream'>;

function chunkFor(
  repoId: string,
  sha: string,
  options: { readonly exhausted?: boolean } = {},
): GraphStreamChunk {
  const exhausted = options.exhausted ?? true;
  return {
    repoId,
    seq: 0,
    from: 0,
    to: 1,
    source: 'git',
    remaining: exhausted ? 0 : 1,
    exhausted,
    commits: buildPackedChunk([{ sha, subject: `${repoId} commit` }]),
  };
}

function fakeLayoutChunk(from: number, to: number): LayoutChunk {
  return {
    from,
    to,
    laneOf: new Uint32Array(Math.max(0, to - from)),
    colorOf: new Uint32Array(Math.max(0, to - from)),
    edges: new Uint32Array(0),
    edgeIndex: new Uint32Array(Math.max(0, to - from) + 1),
    patches: new Uint32Array(0),
    laneCount: 0,
    maxEdgeSpan: 0,
    transfer: [],
  };
}

/** F1's own regression fixture: a `LayoutClient` that never touches a real worker (bun test has
 *  no `import.meta.url`-relative module worker to load), settling every `submit()` immediately
 *  with an empty layout for whatever range it was asked to lay out. */
function fakeLayoutClient(): LayoutClient {
  return {
    submit: (input) => Promise.resolve(fakeLayoutChunk(input.from, input.to)),
    reset: () => {},
    dispose: () => {},
  };
}

interface StreamOpen {
  readonly repoId: string;
  readonly resumeThroughRow: number | undefined;
  push(chunk: GraphStreamChunk): void;
  end(): void;
}

/**
 * F1's own scriptable `Transport`: `graph.stream` opens stay pending — recorded onto
 * `streamOpens` — until the test pushes a chunk and/or ends the stream, or the caller's own
 * `AbortSignal` fires (mirroring `createRpcClient`'s stream(): abort *resolves*, never rejects).
 * `graph.loadMore` calls hand back a controller the test resolves on its own schedule, so a
 * repo switch can land while one is genuinely still in flight — the exact race F1 fixes.
 * `graph.status` always answers "exhausted", which is all `#runLoad`'s post-resync call reads.
 */
class RaceTransport implements Transport {
  readonly streamOpens: StreamOpen[] = [];
  readonly loadMoreRequests: Array<{ resolve: () => void }> = [];
  #handlers = new Map<EventKey, Set<(payload: unknown) => void>>();

  request<K extends RequestKey>(
    method: K,
    _params: ParamsOf<K>,
    signal?: AbortSignal,
  ): Promise<ResultOf<K>> {
    if (method === 'graph.loadMore') {
      return new Promise<ResultOf<K>>((resolve, reject) => {
        if (signal?.aborted) {
          reject(new TransportError('cancelled', `request '${method}' was already cancelled`));
          return;
        }
        signal?.addEventListener(
          'abort',
          () => reject(new TransportError('cancelled', `request '${method}' was cancelled`)),
          { once: true },
        );
        this.loadMoreRequests.push({
          resolve: () => resolve({ started: true } as ResultOf<K>),
        });
      });
    }
    if (method === 'graph.status') {
      return Promise.resolve({ loaded: 1, remaining: 0, exhausted: true } as ResultOf<K>);
    }
    return Promise.reject(new Error(`RaceTransport: unscripted request '${method}'`));
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

  stream<K extends StreamKey>(
    method: K,
    params: StreamParamsOf<K>,
    onChunk: (chunk: StreamChunkOf<K>) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    if (method !== 'graph.stream') {
      return Promise.reject(new Error(`RaceTransport: unscripted stream '${method}'`));
    }
    const streamParams = params as StreamParamsOf<'graph.stream'>;
    return new Promise<void>((resolve) => {
      this.streamOpens.push({
        repoId: streamParams.repoId,
        resumeThroughRow: streamParams.resumeThroughRow,
        push: (chunk) => void (onChunk as (chunk: GraphStreamChunk) => void)(chunk),
        end: resolve,
      });
      signal?.addEventListener('abort', () => resolve(), { once: true });
    });
  }

  dispose(): void {}
}

describe('GraphViewState — F1 repo switch mid-load', () => {
  test('a repo switch during loadMore never reopens the OLD repo stream, and leaves the new repo usable', async () => {
    const transport = new RaceTransport();
    const bridge = new BridgeClient(transport);
    const graphView = new GraphViewState(bridge, fakeLayoutClient());

    // Open + settle repo A's initial stream, same as `handleRepoOpened`'s first ever call.
    const openA = graphView.openStream(REPO_A);
    await sleep();
    expect(transport.streamOpens).toHaveLength(1);
    transport.streamOpens[0]?.push(chunkFor(REPO_A, '1'.repeat(40)));
    transport.streamOpens[0]?.end();
    await openA;
    expect(graphView.loading.value).toBe('idle');

    // Start a `loadMore()` for repo A and let its `graph.loadMore` request reach the transport,
    // but never let it settle yet — this is the in-flight load the switch must land on top of.
    const loadMorePromise = graphView.loadMore();
    await sleep();
    expect(transport.loadMoreRequests).toHaveLength(1);
    expect(graphView.loading.value).toBe('loadingMore');

    // Switch repos mid-load — `App.vue`'s `handleRepoOpened` shape exactly: reset(), then
    // openStream(newRepoId), with no await of the still-in-flight loadMore in between.
    graphView.reset();
    const openB = graphView.openStream(REPO_B);
    await sleep();
    expect(graphView.loading.value).toBe('streaming'); // openStream(B) owns `loading` now
    expect(transport.streamOpens).toHaveLength(2);
    expect(transport.streamOpens[1]?.repoId).toBe(REPO_B);

    // NOW let repo A's stale loadMore reply land.
    transport.loadMoreRequests[0]?.resolve();
    await loadMorePromise;

    // F1: the stale reply's resync must not have reopened repo A's stream, and must not have
    // clobbered `loading` out from under repo B's own still-open stream.
    expect(transport.streamOpens).toHaveLength(2);
    expect(graphView.loading.value).toBe('streaming');

    // Repo B's stream lands and ends normally.
    transport.streamOpens[1]?.push(chunkFor(REPO_B, '2'.repeat(40)));
    transport.streamOpens[1]?.end();
    await openB;

    expect(graphView.loading.value).toBe('idle');
    expect(graphView.store.rowOfSha('2'.repeat(40))).toBe(0);
    // Repo A's row never lands in repo B's store.
    expect(graphView.store.rowOfSha('1'.repeat(40))).toBe(-1);

    graphView.dispose();
  });

  test('loadAll() releases its own #loadController identity on a mid-loop repo switch, without clobbering a later one', async () => {
    const transport = new RaceTransport();
    const bridge = new BridgeClient(transport);
    const graphView = new GraphViewState(bridge, fakeLayoutClient());

    const openA = graphView.openStream(REPO_A);
    await sleep();
    transport.streamOpens[0]?.push(chunkFor(REPO_A, '1'.repeat(40), { exhausted: false }));
    transport.streamOpens[0]?.end();
    await openA;

    const loadAllPromise = graphView.loadAll();
    await sleep();
    expect(transport.loadMoreRequests).toHaveLength(1);

    graphView.reset();
    const openB = graphView.openStream(REPO_B);
    await sleep();

    // Repo B starts its own load before repo A's stale loadAll() iteration ever settles.
    transport.streamOpens[1]?.push(chunkFor(REPO_B, '2'.repeat(40)));
    transport.streamOpens[1]?.end();
    await openB;
    const loadMoreB = graphView.loadMore();
    await sleep();
    expect(transport.loadMoreRequests).toHaveLength(2);

    // Now repo A's original loadMore (inside loadAll()'s loop) finally resolves. Its own abort
    // (from reset()) already rejects it as cancelled inside #runLoad, so loadAll()'s loop exits
    // on the aborted signal; its `finally` must not clear the `#loadController` repo B's own
    // loadMore() just installed.
    await loadAllPromise;

    // Resolve repo B's own loadMore and let its resync run.
    transport.loadMoreRequests[1]?.resolve();
    await sleep();
    expect(transport.streamOpens).toHaveLength(3); // B's post-load resync reopened B's stream
    expect(transport.streamOpens[2]?.repoId).toBe(REPO_B);
    transport.streamOpens[2]?.push(chunkFor(REPO_B, '3'.repeat(40)));
    transport.streamOpens[2]?.end();
    await loadMoreB;

    expect(graphView.loading.value).toBe('idle');
    // Only ever repo B's own streams reopened — repo A's stale loadAll() never did.
    expect(
      transport.streamOpens.every(
        (open) => open.repoId === REPO_B || open === transport.streamOpens[0],
      ),
    ).toBe(true);

    graphView.dispose();
  });
});
