/**
 * Edge emission, packing, and the patch mechanism that lets a later chunk fix up a dangling
 * edge left by an earlier one — driven by `lanes.ts`'s forward pass (W6), but a separate
 * concern: the sort invariant, the CSR index and the global-numbering-across-chunks scheme
 * belong here, not in lane bookkeeping.
 */
import { assert } from "../util/assert.ts";
import {
  EDGE_COLOR,
  EDGE_FROM_LANE,
  EDGE_FROM_ROW,
  EDGE_KIND,
  EDGE_STRIDE,
  EDGE_TO_LANE,
  EDGE_TO_ROW,
  type EdgeKind,
  UNRESOLVED_ROW,
} from "./types.ts";

function growUint32(
  current: Uint32Array<ArrayBuffer>,
  minLength: number,
): Uint32Array<ArrayBuffer> {
  let capacity = current.length === 0 ? 256 : current.length;
  while (capacity < minLength) capacity *= 2;
  const grown = new Uint32Array(capacity);
  grown.set(current);
  return grown;
}

export interface BuiltEdges {
  /** `EDGE_STRIDE`-wide records, sorted by `fromRow`, trimmed to exactly the appended count. */
  readonly edges: Uint32Array;
  /** CSR into `edges`: length `rowCount + 1`, indexed by `row - from`. */
  readonly edgeIndex: Uint32Array;
  /** `(globalEdgeIndex, toRow)` pairs patching an edge that belongs to an earlier chunk. */
  readonly patches: Uint32Array;
  readonly maxEdgeSpan: number;
}

/**
 * One chunk's worth of edges. `startGlobalIndex` is where this chunk's edges continue the
 * cross-chunk numbering a `patchTarget` call needs — see `LayoutFrontier.nextGlobalEdgeIndex`'s
 * doc comment for why that numbering has to be global rather than per-chunk.
 */
export class EdgeBuffer {
  #edges = new Uint32Array(0) as Uint32Array<ArrayBuffer>;
  #count = 0;
  #patches: number[] = []; // flat pairs: [globalEdgeIndex, toRow, globalEdgeIndex, toRow, ...]
  #maxEdgeSpan = 0;
  #lastFromRow = -1;
  readonly #startGlobalIndex: number;

  constructor(startGlobalIndex: number) {
    this.#startGlobalIndex = startGlobalIndex;
  }

  /** Appends one edge; `fromRow` must be >= every previously appended edge's `fromRow` in this
   *  chunk (the sort invariant `edgeIndex` depends on) — asserted, never assumed, since a
   *  future change emitting one out of order would otherwise corrupt every window query. */
  append(
    fromRow: number,
    toRow: number,
    fromLane: number,
    toLane: number,
    color: number,
    kind: EdgeKind,
  ): number {
    assert(
      fromRow >= this.#lastFromRow,
      `EdgeBuffer.append: fromRow ${fromRow} precedes the last-appended ${this.#lastFromRow} — ` +
        `edges must be emitted in non-decreasing fromRow order`,
    );
    this.#lastFromRow = fromRow;

    const localIndex = this.#count;
    const requiredLength = (localIndex + 1) * EDGE_STRIDE;
    if (requiredLength > this.#edges.length) this.#edges = growUint32(this.#edges, requiredLength);
    const base = localIndex * EDGE_STRIDE;
    this.#edges[base + EDGE_FROM_ROW] = fromRow;
    this.#edges[base + EDGE_TO_ROW] = toRow;
    this.#edges[base + EDGE_FROM_LANE] = fromLane;
    this.#edges[base + EDGE_TO_LANE] = toLane;
    this.#edges[base + EDGE_COLOR] = color;
    this.#edges[base + EDGE_KIND] = kind;
    this.#count++;

    if (toRow !== UNRESOLVED_ROW) {
      const span = toRow - fromRow;
      if (span > this.#maxEdgeSpan) this.#maxEdgeSpan = span;
    }
    return this.#startGlobalIndex + localIndex;
  }

  /** Sets a previously-`UNRESOLVED_ROW` target now that the parent has resolved. If
   *  `globalEdgeIndex` belongs to this buffer, the target is patched in place; otherwise it
   *  belongs to an earlier chunk and a `(globalEdgeIndex, toRow)` pair is recorded instead —
   *  the mechanism a Load more uses to fix up a previous page's edges without re-laying it out. */
  patchTarget(globalEdgeIndex: number, toRow: number): void {
    if (globalEdgeIndex >= this.#startGlobalIndex) {
      const localIndex = globalEdgeIndex - this.#startGlobalIndex;
      assert(
        localIndex < this.#count,
        `EdgeBuffer.patchTarget(${globalEdgeIndex}): not yet appended in this chunk`,
      );
      const base = localIndex * EDGE_STRIDE;
      const fromRow = this.#edges[base + EDGE_FROM_ROW] as number;
      this.#edges[base + EDGE_TO_ROW] = toRow;
      const span = toRow - fromRow;
      if (span > this.#maxEdgeSpan) this.#maxEdgeSpan = span;
      return;
    }
    this.#patches.push(globalEdgeIndex, toRow);
  }

  get count(): number {
    return this.#count;
  }

  get nextGlobalIndex(): number {
    return this.#startGlobalIndex + this.#count;
  }

  get maxEdgeSpan(): number {
    return this.#maxEdgeSpan;
  }

  /** Builds the CSR index and trims every buffer to its exact appended length. `from`/`to` are
   *  the chunk's row range — `edgeIndex` is sized `(to - from) + 1` regardless of whether every
   *  row has an outgoing edge. */
  build(from: number, to: number): BuiltEdges {
    const rowCount = to - from;
    const edgeIndex = new Uint32Array(rowCount + 1);
    // A single sweep suffices because of the sort invariant: edges are grouped by fromRow in
    // non-decreasing order, so edgeIndex[r+1] is simply "how many edges have fromRow <= r".
    let edgeCursor = 0;
    for (let row = from; row < to; row++) {
      while (
        edgeCursor < this.#count &&
        (this.#edges[edgeCursor * EDGE_STRIDE + EDGE_FROM_ROW] as number) === row
      ) {
        edgeCursor++;
      }
      edgeIndex[row - from + 1] = edgeCursor;
    }
    return {
      edges: this.#edges.subarray(0, this.#count * EDGE_STRIDE),
      edgeIndex,
      patches: Uint32Array.from(this.#patches),
      maxEdgeSpan: this.#maxEdgeSpan,
    };
  }
}
