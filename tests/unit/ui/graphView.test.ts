import { describe, expect, test } from "bun:test";
import type { LayoutChunk, LayoutFrontier, LayoutInput } from "../../../packages/core/src/index.ts";
import { CommitStore, layoutAppend } from "../../../packages/core/src/index.ts";
import type {
  EventKey,
  EventPayload,
  PackedCommitChunk,
  ParamsOf,
  RequestKey,
  ResultOf,
  StreamChunkOf,
  StreamKey,
  StreamParamsOf,
  Transport,
} from "../../../packages/ipc/src/index.ts";
import { TransportError } from "../../../packages/ipc/src/index.ts";
import { BridgeClient } from "../../../packages/ui/src/bridge/client.ts";
import type { LayoutClient } from "../../../packages/ui/src/graph/layoutClient.ts";
import { GraphViewState } from "../../../packages/ui/src/state/graphView.ts";
import { SelectionState } from "../../../packages/ui/src/state/selection.ts";
import { topology } from "../../fixtures/topology.ts";

/**
 * P4 W5's own "Done when": chunks append in order; a `from: 0` chunk after rows exist resets
 * and bumps `generation`; a corrupted chunk produces a re-open rather than a rejection;
 * `loadMore` appends without disturbing `selection.row`; `refresh` clears and re-populates with
 * selection re-resolved by sha; a v1 persisted state is discarded and a v2 one round-trips
 * every field (that last one is `viewState.test.ts`'s).
 */

/** A real `LayoutClient`, minus the worker: threads a `LayoutFrontier` through `layoutAppend`
 *  (P2) directly, synchronously under the hood but still promise-returning, so `GraphViewState`
 *  cannot tell it apart from the real one — `layoutClient.test.ts` already covers
 *  `layoutClient.ts`'s own request/response bookkeeping against a stubbed *worker*; this is one
 *  level up, standing in for the whole client so these tests never touch a real `Worker`
 *  (unavailable under Bun) while still exercising real layout output. */
function fakeLayoutClient(): LayoutClient {
  let frontier: LayoutFrontier | undefined;
  return {
    submit(input: LayoutInput): Promise<LayoutChunk> {
      const result = layoutAppend(input, frontier);
      frontier = result.frontier;
      return Promise.resolve(result.chunk);
    },
    reset(): void {
      frontier = undefined;
    },
    dispose(): void {},
  };
}

function linearChain(count: number): PackedCommitChunk[] {
  const spec = Array.from({ length: count }, (_, i) => (i === 0 ? "c0" : `c${i}:c${i - 1}`));
  const source = new CommitStore();
  source.appendPage(topology(spec));
  return [source.packSlice(0, source.rowCount, 0)];
}

function chunkChain(count: number, pageSize: number): PackedCommitChunk[] {
  const spec = Array.from({ length: count }, (_, i) => (i === 0 ? "c0" : `c${i}:c${i - 1}`));
  const source = new CommitStore();
  source.appendPage(topology(spec));

  const packed: PackedCommitChunk[] = [];
  let dictionaryBase = 0;
  for (let from = 0; from < source.rowCount; from += pageSize) {
    const to = Math.min(from + pageSize, source.rowCount);
    const chunk = source.packSlice(from, to, dictionaryBase);
    dictionaryBase += chunk.dictionary.length;
    packed.push(chunk);
  }
  return packed;
}

function toStreamChunks(
  repoId: string,
  packedChunks: readonly PackedCommitChunk[],
  source: "git" | "cache",
  remaining = 0,
): StreamChunkOf<"graph.stream">[] {
  return packedChunks.map((commits, i) => ({
    repoId,
    seq: i,
    from: commits.from,
    to: commits.to,
    source,
    remaining,
    exhausted: i === packedChunks.length - 1,
    commits,
  }));
}

/**
 * A `Transport` fully under a test's control. `streamScripts` is consumed one array per
 * `stream("graph.stream", ...)` call — FIFO, not a single fixed sequence — specifically so a
 * test can script "the first stream delivers a corrupted sequence, the automatic recovery
 * re-open delivers a clean one" without the recovery replaying the same corruption forever.
 * `loadMoreQueue`/`refreshQueue` do the same for the two one-shot requests `GraphViewState`
 * makes; a queued entry can be a plain result or `"hang"`, which resolves (or, if the caller's
 * signal fires first, rejects with a cancellation `TransportError`) only once the test calls
 * `settleHangingLoadMore()` — the seam `cancelLoad()`'s own test needs.
 */
class ScriptedTransport implements Transport {
  streamScripts: StreamChunkOf<"graph.stream">[][] = [];
  readonly streamCalls: StreamParamsOf<"graph.stream">[] = [];
  readonly loadMoreCalls: ParamsOf<"graph.loadMore">[] = [];
  readonly refreshCalls: ParamsOf<"graph.refresh">[] = [];
  /** When true, the next `graph.loadMore` request neither resolves nor rejects until either
   *  its signal aborts or the test calls `settleHangingLoadMore()`. */
  hangNextLoadMore = false;
  #hangingLoadMore: (() => void) | undefined;

  request<K extends RequestKey>(
    method: K,
    params: ParamsOf<K>,
    signal?: AbortSignal,
  ): Promise<ResultOf<K>> {
    if (method === "graph.loadMore") {
      this.loadMoreCalls.push(params as ParamsOf<"graph.loadMore">);
      const result = { started: true } as ResultOf<K>;
      if (!this.hangNextLoadMore) return Promise.resolve(result);
      this.hangNextLoadMore = false;
      return new Promise<ResultOf<K>>((resolve, reject) => {
        this.#hangingLoadMore = () => resolve(result);
        signal?.addEventListener(
          "abort",
          () => {
            this.#hangingLoadMore = undefined;
            reject(new TransportError("cancelled", `request '${method}' was cancelled`));
          },
          { once: true },
        );
      });
    }
    if (method === "graph.refresh") {
      this.refreshCalls.push(params as ParamsOf<"graph.refresh">);
      return Promise.resolve({ restarted: true } as ResultOf<K>);
    }
    throw new Error(`ScriptedTransport: request('${method}') not scripted by this test`);
  }

  /** Resolves a `graph.loadMore` request left hanging by `hangNextLoadMore` — models the host
   *  finishing the page read before a test-driven cancel would have reached it. */
  settleHangingLoadMore(): void {
    this.#hangingLoadMore?.();
  }

  on<K extends EventKey>(_method: K, _handler: (payload: EventPayload<K>) => void): () => void {
    return () => {};
  }

  async stream<K extends StreamKey>(
    method: K,
    params: StreamParamsOf<K>,
    onChunk: (chunk: StreamChunkOf<K>) => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<void> {
    if (method !== "graph.stream") throw new Error(`unhandled stream '${method}'`);
    this.streamCalls.push(params as StreamParamsOf<"graph.stream">);
    const script = this.streamScripts.shift();
    if (!script) throw new Error("ScriptedTransport: stream() called with no script queued");
    for (const chunk of script) {
      if (signal?.aborted) return;
      await onChunk(chunk as StreamChunkOf<K>);
    }
  }

  dispose(): void {}
}

function makeGraphView(transport: ScriptedTransport): GraphViewState {
  return new GraphViewState(new BridgeClient(transport), fakeLayoutClient());
}

describe("GraphViewState", () => {
  test("chunks append in order and update the reactive scalars, including layout", async () => {
    const transport = new ScriptedTransport();
    const packed = chunkChain(9, 4); // 4 + 4 + 1
    transport.streamScripts = [toStreamChunks("r1", packed, "git")];

    const graphView = makeGraphView(transport);
    await graphView.openStream("r1");

    expect(graphView.store.rowCount).toBe(9);
    expect(graphView.loadedRows.value).toBe(9);
    expect(graphView.exhausted.value).toBe(true);
    expect(graphView.lastChunkSource.value).toBe("git");
    expect(graphView.loading.value).toBe("idle");
    // Row order is preserved end to end: `topology()` emits newest-first, so row 0 is the
    // chain's tip ("c8") and row 8 its root ("c0").
    expect(graphView.store.subjectAt(0)).toBe("c8");
    expect(graphView.store.subjectAt(8)).toBe("c0");
    // Layout is driven from the append (W5's own design): every loaded row already has a lane
    // by the time openStream() resolves, not just the commit data.
    expect(graphView.layout.rowCount).toBe(9);
    expect(graphView.laneCount.value).toBeGreaterThan(0);
  });

  test("onChunkLayout fires once per chunk with that chunk's own row range", async () => {
    const transport = new ScriptedTransport();
    const packed = chunkChain(6, 2);
    transport.streamScripts = [toStreamChunks("r1", packed, "git")];

    const graphView = makeGraphView(transport);
    const ranges: Array<{ from: number; to: number }> = [];
    const unsubscribe = graphView.onChunkLayout((range) => ranges.push(range));

    await graphView.openStream("r1");

    expect(ranges).toEqual([
      { from: 0, to: 2 },
      { from: 2, to: 4 },
      { from: 4, to: 6 },
    ]);

    unsubscribe();
  });

  test("an out-of-order chunk re-opens from row 0 instead of rejecting", async () => {
    const transport = new ScriptedTransport();
    const packed = chunkChain(6, 2); // three chunks: [0,2) [2,4) [4,6)
    const [firstChunk, secondChunk, thirdChunk] = toStreamChunks("r1", packed, "git");
    if (!firstChunk || !secondChunk || !thirdChunk) {
      throw new Error("chunkChain(6, 2) must produce exactly 3 chunks");
    }
    // First stream: chunk 3 arrives before chunk 2, which `CommitStore.appendPacked`'s own
    // ordering assert rejects. The recovery re-open (row 0) gets a clean, well-formed script —
    // modelling a transient wire issue, not a deterministic one the recovery would just repeat.
    transport.streamScripts = [
      [firstChunk, thirdChunk, secondChunk],
      toStreamChunks("r1", packed, "git"),
    ];

    const graphView = makeGraphView(transport);
    await graphView.openStream("r1"); // must NOT reject

    expect(transport.streamCalls).toHaveLength(2);
    expect(transport.streamCalls[1]).toEqual({ repoId: "r1", resumeThroughRow: 0 });
    expect(graphView.store.rowCount).toBe(6);
    expect(graphView.loadedRows.value).toBe(6);
    expect(graphView.exhausted.value).toBe(true);
  });

  test("a from: 0 chunk after rows exist resets the store, layout and generation", async () => {
    const transport = new ScriptedTransport();
    transport.streamScripts = [toStreamChunks("r1", linearChain(4), "git")];
    const graphView = makeGraphView(transport);
    await graphView.openStream("r1");
    expect(graphView.loadedRows.value).toBe(4);
    expect(graphView.generation.value).toBe(0);

    // A second, independent walk of the same repo (e.g. after a watcher-driven re-walk) starts
    // again at row 0 — restart-at-zero, not append.
    transport.streamScripts = [toStreamChunks("r1", linearChain(3), "git")];
    await graphView.openStream("r1", 0);

    expect(graphView.generation.value).toBe(1);
    expect(graphView.store.rowCount).toBe(3);
    expect(graphView.loadedRows.value).toBe(3);
    expect(graphView.layout.rowCount).toBe(3);
  });

  test("openStream defaults resumeThroughRow to the store's own current row count", async () => {
    const transport = new ScriptedTransport();
    transport.streamScripts = [
      toStreamChunks("r1", linearChain(3), "git"),
      toStreamChunks("r1", chunkChain(6, 3).slice(1), "cache"),
    ];

    const graphView = makeGraphView(transport);
    await graphView.openStream("r1");
    expect(transport.streamCalls[0]).toEqual({ repoId: "r1", resumeThroughRow: 0 });

    await graphView.openStream("r1");
    expect(transport.streamCalls[1]).toEqual({ repoId: "r1", resumeThroughRow: 3 });
  });

  test("reset clears every loaded row, layout and reactive scalar, and bumps generation", async () => {
    const transport = new ScriptedTransport();
    transport.streamScripts = [toStreamChunks("r1", linearChain(4), "git")];
    const graphView = makeGraphView(transport);
    await graphView.openStream("r1");
    expect(graphView.loadedRows.value).toBe(4);

    graphView.reset();

    expect(graphView.store.rowCount).toBe(0);
    expect(graphView.layout.rowCount).toBe(0);
    expect(graphView.loadedRows.value).toBe(0);
    expect(graphView.remaining.value).toBe(0);
    expect(graphView.exhausted.value).toBe(false);
    expect(graphView.lastChunkSource.value).toBeUndefined();
    expect(graphView.laneCount.value).toBe(0);
    expect(graphView.generation.value).toBe(1);
  });

  test("loadMore reads a page then re-opens the stream from cache, without disturbing selection.row", async () => {
    const transport = new ScriptedTransport();
    transport.streamScripts = [toStreamChunks("r1", linearChain(4), "git", 10)];
    const graphView = makeGraphView(transport);
    await graphView.openStream("r1");

    const selection = new SelectionState(graphView.store);
    selection.select(1); // row 1 == "c2" (topology(...) emits newest-first)
    expect(selection.sha.value).toBe(graphView.store.shaAt(1));

    transport.streamScripts = [toStreamChunks("r1", chunkChain(7, 4).slice(1), "cache", 3)];
    await graphView.loadMore(1);

    expect(transport.loadMoreCalls).toEqual([{ repoId: "r1", pages: 1 }]);
    // The re-open asked for exactly the rows not yet loaded, answered entirely from cache.
    expect(transport.streamCalls[1]).toEqual({ repoId: "r1", resumeThroughRow: 4 });
    expect(graphView.loadedRows.value).toBe(7);
    expect(graphView.remaining.value).toBe(3);
    expect(graphView.loading.value).toBe("idle");
    // Selection is untouched by the append — same row, same sha, still resolvable.
    expect(selection.row.value).toBe(1);
    expect(selection.sha.value).toBe(graphView.store.shaAt(1));
  });

  test("loadMore is a no-op while already loading", async () => {
    const transport = new ScriptedTransport();
    transport.streamScripts = [toStreamChunks("r1", linearChain(2), "git", 1)];
    const graphView = makeGraphView(transport);
    await graphView.openStream("r1");

    transport.hangNextLoadMore = true;
    const first = graphView.loadMore(1);
    expect(graphView.loading.value).toBe("loadingMore");

    const second = graphView.loadMore(1); // must return immediately, not queue a second page
    expect(transport.loadMoreCalls).toHaveLength(1);

    // Nothing new to fold in: the hang settles with no real page ever read, so the resync
    // `openStream()` that always follows in `#runLoad`'s `finally` gets an empty script.
    transport.streamScripts = [[]];
    transport.settleHangingLoadMore();
    await Promise.all([first, second]);
    expect(transport.loadMoreCalls).toHaveLength(1);
  });

  test("cancelLoad aborts an in-flight loadMore; the resync afterwards keeps whatever was already read", async () => {
    const transport = new ScriptedTransport();
    transport.streamScripts = [toStreamChunks("r1", linearChain(2), "git", 5)];
    const graphView = makeGraphView(transport);
    await graphView.openStream("r1");

    transport.hangNextLoadMore = true;
    // The resync `openStream` that always runs in `#runLoad`'s `finally`, even on cancel, needs
    // a script — this one reports one more row was actually read before the cancel landed.
    transport.streamScripts = [toStreamChunks("r1", chunkChain(3, 2).slice(1), "cache", 4)];

    const loadMore = graphView.loadMore(1);
    expect(graphView.loading.value).toBe("loadingMore");
    graphView.cancelLoad();
    await loadMore;

    expect(graphView.loading.value).toBe("idle");
    expect(graphView.loadedRows.value).toBe(3);
    expect(graphView.remaining.value).toBe(4);
  });

  test("refresh clears and re-populates, and selection re-resolves by sha", async () => {
    const transport = new ScriptedTransport();
    transport.streamScripts = [toStreamChunks("r1", linearChain(4), "git")];
    const graphView = makeGraphView(transport);
    await graphView.openStream("r1");

    const selection = new SelectionState(graphView.store);
    // "c1" is row 2 in the initial walk (topology emits newest-first: c3, c2, c1, c0).
    selection.select(2);
    const selectedSha = selection.sha.value;
    if (!selectedSha) throw new Error("selection.select(2) must resolve a sha");

    // The re-walk this models reorders history ("c1" now leads) — the point is that refresh
    // renumbers rows and selection must be re-resolved by sha, not assumed to still be row 2.
    const rewalkedSpec = ["c0", "c3:c0", "c2:c3", "c1:c2"];
    const rewalked = new CommitStore();
    rewalked.appendPage(topology(rewalkedSpec));
    transport.streamScripts = [
      [
        {
          repoId: "r1",
          seq: 0,
          from: 0,
          to: rewalked.rowCount,
          source: "git",
          remaining: 0,
          exhausted: true,
          commits: rewalked.packSlice(0, rewalked.rowCount, 0),
        },
      ],
    ];

    const generationBefore = graphView.generation.value;
    await graphView.refresh();

    expect(transport.refreshCalls).toEqual([{ repoId: "r1" }]);
    expect(graphView.generation.value).toBe(generationBefore + 1);
    expect(graphView.loadedRows.value).toBe(4);
    expect(graphView.loading.value).toBe("idle");

    // App.vue's own future job (W11): re-resolve selection once the store holds rows again.
    // Exercised directly here since `GraphViewState` and `SelectionState` stay decoupled.
    expect(selection.selectBySha(selectedSha)).toBe(true);
    expect(selection.sha.value).toBe(selectedSha);
    expect(graphView.store.shaAt(selection.row.value)).toBe(selectedSha);
  });

  test("refresh is a no-op while already loading", async () => {
    const transport = new ScriptedTransport();
    transport.streamScripts = [toStreamChunks("r1", linearChain(2), "git", 1)];
    const graphView = makeGraphView(transport);
    await graphView.openStream("r1");

    transport.hangNextLoadMore = true;
    const first = graphView.loadMore(1);
    expect(graphView.loading.value).toBe("loadingMore");

    await graphView.refresh(); // must return immediately without calling graph.refresh
    expect(transport.refreshCalls).toHaveLength(0);

    // Nothing new to fold in — see the identical note in the loadMore no-op test above.
    transport.streamScripts = [[]];
    transport.settleHangingLoadMore();
    await first;
  });
});
