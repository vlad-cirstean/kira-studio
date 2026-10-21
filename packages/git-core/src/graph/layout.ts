/**
 * The public entry point: `lanes.ts`'s forward pass plus `edges.ts`'s packing, combined into a
 * `LayoutChunk` and a transfer list. Incremental by construction — each call lays out exactly
 * `input.to - input.from` new rows and returns buffers covering only them, never re-laying out
 * what came before. Worker transfers must be transfers, and a transfer detaches its source;
 * re-laying out from row 0 every page would mean re-copying the whole parent structure
 * into the worker each time, the exact cross-thread duplication that transfers exist to prevent.
 *
 * The correctness obligation this creates: laying a topology out page by page must produce
 * byte-identical buffers to laying it out in one pass, once patches are applied. See
 * the pipeline/layout test suites for that invariant.
 */
import { assignLanes } from './lanes.ts';
import type { LayoutChunk, LayoutFrontier, LayoutInput } from './types.ts';

export interface LayoutAppendResult {
  readonly chunk: LayoutChunk;
  readonly frontier: LayoutFrontier;
}

export function layoutAppend(input: LayoutInput, frontier?: LayoutFrontier): LayoutAppendResult {
  const {
    laneOf,
    colorOf,
    edgeBuffer,
    laneCount,
    frontier: newFrontier,
  } = assignLanes(input, frontier);
  const built = edgeBuffer.build(input.from, input.to);
  const transfer = [
    ...new Set<ArrayBuffer>([
      laneOf.buffer as ArrayBuffer,
      colorOf.buffer as ArrayBuffer,
      built.edges.buffer as ArrayBuffer,
      built.edgeIndex.buffer as ArrayBuffer,
      built.patches.buffer as ArrayBuffer,
    ]),
  ];

  const chunk: LayoutChunk = {
    from: input.from,
    to: input.to,
    laneOf,
    colorOf,
    edges: built.edges,
    edgeIndex: built.edgeIndex,
    patches: built.patches,
    laneCount,
    maxEdgeSpan: built.maxEdgeSpan,
    transfer,
  };

  return { chunk, frontier: newFrontier };
}

/** Every distinct `ArrayBuffer` backing `chunk`'s typed arrays, exactly once — what
 *  `postMessage(chunk, { transfer })` (or `structuredClone`) is handed. A buffer listed
 *  twice throws at `postMessage`; a buffer omitted is silently cloned, which is the failure
 *  mode that would show up as a memory regression with no obvious cause. Every array
 *  here is always allocated locally as a plain (never shared) `ArrayBuffer` — never wrapping a
 *  `SharedArrayBuffer`, which TypeScript's typed-array generics otherwise leave possible — so
 *  the cast is a narrow, load-bearing fact about how these buffers are constructed, not a way
 *  around the type checker. */
export function layoutTransferList(chunk: LayoutChunk): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>([
    chunk.laneOf.buffer as ArrayBuffer,
    chunk.colorOf.buffer as ArrayBuffer,
    chunk.edges.buffer as ArrayBuffer,
    chunk.edgeIndex.buffer as ArrayBuffer,
    chunk.patches.buffer as ArrayBuffer,
  ]);
  return [...buffers];
}
