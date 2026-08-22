/**
 * The phasing row says lane layout runs "in a worker" (docs/plans/P2.md); P2 does not build
 * the worker itself (see the plan's "Where the worker line falls"), so it owes a mechanical
 * proof the algorithm *can* be moved to one — stronger than "it looks pure".
 */
import { describe, expect, test } from "bun:test";
import { Worker } from "node:worker_threads";
import { layoutAppend, layoutTransferList } from "../../../packages/core/src/graph/layout.ts";
import type { LayoutChunk } from "../../../packages/core/src/graph/types.ts";
import { CommitStore } from "../../../packages/core/src/store/commitStore.ts";
import { fan, octopusOf, topology } from "../../fixtures/topology.ts";

function chunkFor(records: ReturnType<typeof topology>): LayoutChunk {
  const store = new CommitStore();
  store.appendPage(records);
  return layoutAppend(store.layoutInput(0, store.rowCount), undefined).chunk;
}

const SHAPES = [topology(["A", "B:A", "C:B"]), fan(5, 3), octopusOf(3), octopusOf(12)];

describe("worker-readiness — structuredClone transfer (required)", () => {
  for (const [i, records] of SHAPES.entries()) {
    test(`shape ${i}: round-trips and detaches every source buffer`, () => {
      const chunk = chunkFor(records);
      const transfer = layoutTransferList(chunk);
      // A one-pass layout's `patches` buffer is always empty (there is no earlier chunk to
      // patch) — only the row/lane-bearing buffers are guaranteed non-empty here.
      expect(chunk.laneOf.buffer.byteLength).toBeGreaterThan(0);
      expect(chunk.edgeIndex.buffer.byteLength).toBeGreaterThan(0);

      // Snapshot before transfer: the source views become unreadable once detached.
      const originalFrom = chunk.from;
      const originalTo = chunk.to;
      const originalLaneOf = Array.from(chunk.laneOf);
      const originalLaneCount = chunk.laneCount;
      const originalMaxEdgeSpan = chunk.maxEdgeSpan;

      const cloned = structuredClone(chunk, { transfer });

      // The operation postMessage performs: every source buffer is now detached.
      for (const buffer of transfer) expect(buffer.byteLength).toBe(0);

      expect(cloned.from).toBe(originalFrom);
      expect(cloned.to).toBe(originalTo);
      expect([...cloned.laneOf]).toEqual(originalLaneOf);
      expect(cloned.laneCount).toBe(originalLaneCount);
      expect(cloned.maxEdgeSpan).toBe(originalMaxEdgeSpan);
    });
  }
});

describe("worker-readiness — a real worker thread (best-effort)", () => {
  test("a chunk round-trips through node:worker_threads with its buffers transferred", async () => {
    const chunk = chunkFor(octopusOf(4));
    const transfer = layoutTransferList(chunk);
    const originalLaneOf = Array.from(chunk.laneOf);
    const originalEdges = Array.from(chunk.edges);

    const workerSource = `
      const { parentPort } = require("node:worker_threads");
      parentPort.on("message", ({ chunk, transferList }) => {
        parentPort.postMessage({ echoed: chunk }, transferList);
      });
    `;
    const worker = new Worker(workerSource, { eval: true });
    try {
      const received = await new Promise<LayoutChunk>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("worker round trip timed out")), 5000);
        worker.once("message", (msg: { echoed: LayoutChunk }) => {
          clearTimeout(timer);
          resolve(msg.echoed);
        });
        worker.once("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
        worker.postMessage({ chunk, transferList: transfer }, transfer);
      });

      expect(Array.from(received.laneOf)).toEqual(originalLaneOf);
      expect(Array.from(received.edges)).toEqual(originalEdges);
      for (const buffer of transfer) expect(buffer.byteLength).toBe(0);
    } finally {
      await worker.terminate();
    }
  });
});
