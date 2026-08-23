import { describe, expect, test } from "bun:test";
import { CommitStore } from "../../../packages/core/src/index.ts";
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
import { BridgeClient } from "../../../packages/ui/src/bridge/client.ts";
import { GraphViewState } from "../../../packages/ui/src/state/graphView.ts";
import { topology } from "../../fixtures/topology.ts";

/**
 * W9's own "Done when": unit tests over `state/graphView.ts` with a fake transport assert that
 * chunks append in order, and that an out-of-order chunk throws rather than corrupting the
 * store. `CommitStore.appendPacked` (packages/core) is what actually enforces ordering — this
 * file exercises that guarantee through `GraphViewState`, not a second copy of the check.
 */

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

/** Feeds a fixed, caller-supplied sequence of `graph.stream` chunks to whatever the test wires
 *  it to — deliberately dumb, so a test can hand it chunks in a deliberately wrong order. */
class ScriptedTransport implements Transport {
  packedChunks: readonly StreamChunkOf<"graph.stream">[] = [];

  request<K extends RequestKey>(_method: K, _params: ParamsOf<K>): Promise<ResultOf<K>> {
    throw new Error("ScriptedTransport: request() not used by these tests");
  }

  on<K extends EventKey>(_method: K, _handler: (payload: EventPayload<K>) => void): () => void {
    return () => {};
  }

  async stream<K extends StreamKey>(
    method: K,
    _params: StreamParamsOf<K>,
    onChunk: (chunk: StreamChunkOf<K>) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    if (method !== "graph.stream") throw new Error(`unhandled stream '${method}'`);
    for (const chunk of this.packedChunks) {
      if (signal?.aborted) return;
      onChunk(chunk as StreamChunkOf<K>);
    }
  }

  dispose(): void {}
}

function toStreamChunks(
  repoId: string,
  packedChunks: readonly PackedCommitChunk[],
  source: "git" | "cache",
): StreamChunkOf<"graph.stream">[] {
  return packedChunks.map((commits, i) => ({
    repoId,
    seq: i,
    from: commits.from,
    to: commits.to,
    source,
    remaining: 0,
    exhausted: i === packedChunks.length - 1,
    commits,
  }));
}

describe("GraphViewState", () => {
  test("chunks append in order and update the reactive scalars", async () => {
    const transport = new ScriptedTransport();
    const packed = chunkChain(9, 4); // 4 + 4 + 1
    transport.packedChunks = toStreamChunks("r1", packed, "git");

    const graphView = new GraphViewState(new BridgeClient(transport));
    await graphView.openStream("r1");

    expect(graphView.store.rowCount).toBe(9);
    expect(graphView.loadedRows.value).toBe(9);
    expect(graphView.exhausted.value).toBe(true);
    expect(graphView.lastChunkSource.value).toBe("git");
    // Row order is preserved end to end: `topology()` emits newest-first, so row 0 is the
    // chain's tip ("c8") and row 8 its root ("c0").
    expect(graphView.store.subjectAt(0)).toBe("c8");
    expect(graphView.store.subjectAt(8)).toBe("c0");
  });

  test("an out-of-order chunk throws rather than corrupting the store", async () => {
    const transport = new ScriptedTransport();
    const packed = chunkChain(6, 2); // three chunks: [0,2) [2,4) [4,6)
    const [firstChunk, secondChunk, thirdChunk] = toStreamChunks("r1", packed, "git");
    if (!firstChunk || !secondChunk || !thirdChunk) {
      throw new Error("chunkChain(6, 2) must produce exactly 3 chunks");
    }
    // Swap the last two chunks: the store will have 2 rows when it receives a chunk claiming
    // to start at row 4, which `CommitStore.appendPacked`'s own ordering assert must reject.
    transport.packedChunks = [firstChunk, thirdChunk, secondChunk];

    const graphView = new GraphViewState(new BridgeClient(transport));
    await expect(graphView.openStream("r1")).rejects.toThrow(/chunks must be applied in order/);

    // Only the first (correctly-ordered) chunk was ever applied — the store was not corrupted
    // by the rejected out-of-order one.
    expect(graphView.store.rowCount).toBe(2);
    expect(graphView.loadedRows.value).toBe(2);
  });

  test("openStream defaults resumeThroughRow to the store's own current row count", async () => {
    const transport = new ScriptedTransport();
    const seenParams: StreamParamsOf<"graph.stream">[] = [];
    const originalStream = transport.stream.bind(transport);
    transport.stream = (async (method, params, onChunk, signal) => {
      seenParams.push(params as StreamParamsOf<"graph.stream">);
      return originalStream(method, params, onChunk, signal);
    }) as Transport["stream"];

    const graphView = new GraphViewState(new BridgeClient(transport));

    transport.packedChunks = toStreamChunks("r1", linearChain(3), "git");
    await graphView.openStream("r1");
    expect(seenParams[0]).toEqual({ repoId: "r1", resumeThroughRow: 0 });

    transport.packedChunks = toStreamChunks("r1", chunkChain(6, 3).slice(1), "cache");
    await graphView.openStream("r1");
    expect(seenParams[1]).toEqual({ repoId: "r1", resumeThroughRow: 3 });
  });

  test("reset clears every loaded row and reactive scalar", async () => {
    const transport = new ScriptedTransport();
    transport.packedChunks = toStreamChunks("r1", linearChain(4), "git");
    const graphView = new GraphViewState(new BridgeClient(transport));
    await graphView.openStream("r1");
    expect(graphView.loadedRows.value).toBe(4);

    graphView.reset();

    expect(graphView.store.rowCount).toBe(0);
    expect(graphView.loadedRows.value).toBe(0);
    expect(graphView.remaining.value).toBe(0);
    expect(graphView.exhausted.value).toBe(false);
    expect(graphView.lastChunkSource.value).toBeUndefined();
  });
});
