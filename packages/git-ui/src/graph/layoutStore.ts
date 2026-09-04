/**
 * P2's own `graph/types.ts` names the missing piece: "the reassembler (the consumer holding
 * every chunk) maps a global index back to (chunk, local offset)". This is that consumer
 * (docs/plans/P4.md W3) — the main-thread, UI-only, pure accumulator that owns every
 * `LayoutChunk` a repo's session has produced (one per appended page, per P2 W9) and answers
 * the two queries the renderer needs: a row's lane/colour, and every edge segment crossing a
 * given row's band. No Vue, no DOM, no SlickGrid — unit-testable in `bun test` without a
 * browser, and the type of thing worth keeping that way.
 */
import {
  AssertionError,
  assert,
  EDGE_COLOR,
  EDGE_FROM_LANE,
  EDGE_FROM_ROW,
  EDGE_KIND,
  EDGE_STRIDE,
  EDGE_TO_LANE,
  EDGE_TO_ROW,
  type EdgeKind,
  type LayoutChunk,
  UNRESOLVED_ROW,
} from '@kira/git-core';

export interface RowVisual {
  readonly lane: number;
  readonly color: number;
}

/** One edge's crossing of a row's band, in the same absolute-row coordinates the edge is stored
 *  in — `fromRow`/`toRow` name the edge's own full extent (`toRow` may be `UNRESOLVED_ROW`, a
 *  parent not loaded yet), not a value relative to the queried row. A consumer building a row's
 *  SVG (W8) derives "does this row start/end/merely cross the edge" itself by comparing its own
 *  row number against these two fields — trivial once both are in hand, and what keeps
 *  `segmentsInRow`'s and `segmentsInWindow`'s results provably the same shape (their `Done
 *  when` requires concatenating the former over a range to equal the latter). */
export interface EdgeSegment {
  readonly fromRow: number;
  readonly toRow: number;
  readonly fromLane: number;
  readonly toLane: number;
  readonly color: number;
  readonly kind: EdgeKind;
}

/** Edges whose span exceeds this many rows — or whose target has not resolved yet, treated as
 *  unboundedly long until a later chunk's patch says otherwise — are indexed separately in
 *  `#longEdges` rather than relied on to be found by a nearby row's CSR scan. Real repositories
 *  have hundreds of these (long-lived branch merges), not thousands. */
const LONG_EDGE_ROWS = 64;

/** A reference into an owning chunk's own `edges` buffer, not a copy of the segment itself: a
 *  patch mutates that buffer in place (see `#applyPatches`), so re-reading through the
 *  reference always observes the current value with nothing here to go stale. */
interface LongEdgeRef {
  readonly chunkIndex: number;
  readonly localIndex: number;
  readonly fromRow: number;
}

function edgeCount(chunk: LayoutChunk): number {
  return chunk.edges.length / EDGE_STRIDE;
}

function readSegment(chunk: LayoutChunk, localIndex: number): EdgeSegment {
  const base = localIndex * EDGE_STRIDE;
  return {
    fromRow: chunk.edges[base + EDGE_FROM_ROW] as number,
    toRow: chunk.edges[base + EDGE_TO_ROW] as number,
    fromLane: chunk.edges[base + EDGE_FROM_LANE] as number,
    toLane: chunk.edges[base + EDGE_TO_LANE] as number,
    color: chunk.edges[base + EDGE_COLOR] as number,
    kind: chunk.edges[base + EDGE_KIND] as EdgeKind,
  };
}

/** Whether `segment` paints inside `row`'s band at all — the vertical run of its lane crossing
 *  the row, or the arc at either endpoint. Inclusive of both `fromRow` and `toRow`: the edge's
 *  owning commit (`fromRow`) is where the diagonal into its lane starts, and the parent's row
 *  (`toRow`) is where it arrives, both real paint, not just the rows strictly between. */
function coversRow(segment: EdgeSegment, row: number): boolean {
  if (row < segment.fromRow) return false;
  return segment.toRow === UNRESOLVED_ROW || row <= segment.toRow;
}

/** Decides `#longEdges` membership at the moment a chunk is first appended — an edge still
 *  `UNRESOLVED_ROW` at that point is unconditionally long, exactly because its eventual span is
 *  not known yet. This is *not* safe to recompute later: a patch can resolve such an edge to a
 *  `toRow` whose span turns out to be short (a merge with a nearby parent, discovered only once
 *  that page loads), and re-deriving membership from the live, now-patched buffer would then
 *  disagree with the frozen decision `#append` already made — the exact bug that produced a
 *  double-reported segment (once via the CSR window, once via `#longEdges`) before this
 *  function's result was captured once, in `#longIndices`, rather than re-asked on every read. */
function isLongAtAppendTime(segment: EdgeSegment): boolean {
  return segment.toRow === UNRESOLVED_ROW || segment.toRow - segment.fromRow > LONG_EDGE_ROWS;
}

interface ChunkSlice {
  readonly chunk: LayoutChunk;
  readonly chunkIndex: number;
  readonly localFrom: number;
  readonly localToExclusive: number;
}

/**
 * Accumulates every `LayoutChunk` a repo's session has produced into the two queries the graph
 * column needs, without ever flattening chunks into one array (§5.5 — the whole reason chunks
 * are transferred rather than copied). `laneOf`/`colorOf` are a binary search over chunk starts
 * plus one typed-array read. `segmentsInRow` partitions an edge into exactly one of two disjoint
 * scans: a bounded CSR window over the `LONG_EDGE_ROWS` rows just above the query row catches
 * every *short* edge that could possibly cover it (a short edge starting further back than that
 * cannot still be open — its own span bound rules it out), and a binary-search-bounded scan of
 * `#longEdges` catches everything else. Neither is a walk over history.
 */
export class LayoutStore {
  readonly #chunks: LayoutChunk[] = [];
  /** `#chunkEdgeStart[i]` is the first global edge index `#chunks[i]` owns — parallel to
   *  `#chunks`, strictly increasing, and exactly what a patch's `globalEdgeIndex` is resolved
   *  against. */
  readonly #chunkEdgeStart: number[] = [];
  #nextGlobalEdgeIndex = 0;
  /** Sorted by `fromRow` ascending — true by construction, never re-sorted: chunks are appended
   *  in row order, and a chunk's own edges are already sorted by `fromRow` (`edges.ts`'s own
   *  invariant), so appending one chunk's long edges after every earlier chunk's keeps the
   *  whole array sorted. */
  readonly #longEdges: LongEdgeRef[] = [];
  /** `#longLocalIndices[chunkIndex]` is the set of that chunk's own local edge indices decided
   *  long *at append time* (see `isLongAtAppendTime`'s doc comment for why this must be frozen,
   *  not recomputed) — what the CSR window scan excludes, so an edge is reported by exactly one
   *  of the two scans for its whole life, never both and never neither. Parallel to `#chunks`. */
  readonly #longLocalIndices: Array<Set<number>> = [];
  #rowCount = 0;
  #laneCount = 0;

  get rowCount(): number {
    return this.#rowCount;
  }

  get laneCount(): number {
    return this.#laneCount;
  }

  clear(): void {
    this.#chunks.length = 0;
    this.#chunkEdgeStart.length = 0;
    this.#nextGlobalEdgeIndex = 0;
    this.#longEdges.length = 0;
    this.#longLocalIndices.length = 0;
    this.#rowCount = 0;
    this.#laneCount = 0;
  }

  append(chunk: LayoutChunk): void {
    assert(
      chunk.from === this.#rowCount,
      `LayoutStore.append: chunk [${chunk.from}, ${chunk.to}) does not continue the store's ` +
        `${this.#rowCount} loaded rows — chunks must be appended contiguously and in order`,
    );

    // Patches name edges in *earlier* chunks (edges.ts's own `patchTarget`: a same-chunk target
    // is patched in place before packing and never appears in `patches`), so this always runs
    // before the new chunk is registered below — the search space is exactly the chunks that
    // can legally be named.
    this.#applyPatches(chunk);

    const chunkIndex = this.#chunks.length;
    this.#chunks.push(chunk);
    this.#chunkEdgeStart.push(this.#nextGlobalEdgeIndex);
    const count = edgeCount(chunk);
    this.#nextGlobalEdgeIndex += count;

    const longLocalIndices = new Set<number>();
    this.#longLocalIndices.push(longLocalIndices);
    for (let localIndex = 0; localIndex < count; localIndex++) {
      const segment = readSegment(chunk, localIndex);
      if (isLongAtAppendTime(segment)) {
        longLocalIndices.add(localIndex);
        this.#longEdges.push({ chunkIndex, localIndex, fromRow: segment.fromRow });
      }
    }

    this.#rowCount = chunk.to;
    this.#laneCount = Math.max(this.#laneCount, chunk.laneCount);
  }

  laneOf(row: number): number {
    const { chunk, localRow } = this.#locateRow(row);
    return chunk.laneOf[localRow] as number;
  }

  colorOf(row: number): number {
    const { chunk, localRow } = this.#locateRow(row);
    return chunk.colorOf[localRow] as number;
  }

  /** Every segment that paints inside this one row's band. Allocation-free in the sense that
   *  matters here: it never grows `out` itself (writes by index and returns the count, so a
   *  caller reusing the same array across many rows never reallocates its backing storage). */
  segmentsInRow(row: number, out: EdgeSegment[]): number {
    assert(
      row >= 0 && row < this.#rowCount,
      `LayoutStore.segmentsInRow(${row}): out of range [0, ${this.#rowCount})`,
    );
    let count = this.#collectShortSegments(row, out, 0);
    count = this.#collectLongSegments(row, out, count);
    return count;
  }

  /** The batch form over `[firstRow, lastRow]` inclusive — not on the render path (the grid
   *  calls `segmentsInRow` once per row it draws); this exists as `segmentsInRow`'s own test
   *  oracle and as the query a future prefetch would use. Defined as literal per-row
   *  concatenation so the two can never drift in what they consider "covers this row". */
  segmentsInWindow(firstRow: number, lastRow: number, out: EdgeSegment[]): number {
    assert(
      firstRow >= 0 && lastRow < this.#rowCount && firstRow <= lastRow,
      `LayoutStore.segmentsInWindow(${firstRow}, ${lastRow}): out of range [0, ${this.#rowCount})`,
    );
    let count = 0;
    for (let row = firstRow; row <= lastRow; row++) {
      count = this.#collectShortSegments(row, out, count);
      count = this.#collectLongSegments(row, out, count);
    }
    return count;
  }

  // ---------------------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------------------

  /** Patches name edges an *earlier* chunk left `UNRESOLVED_ROW` that this chunk's own page
   *  resolved. Writes `EDGE_TO_ROW` directly into the owning chunk's `edges` buffer — legal
   *  (it is ours, it was transferred to us, nothing else holds a reference) and exactly what
   *  keeps every later read (the CSR scan, `#longEdges`) automatically current with no separate
   *  bookkeeping. */
  #applyPatches(chunk: LayoutChunk): void {
    for (let i = 0; i < chunk.patches.length; i += 2) {
      const globalEdgeIndex = chunk.patches[i] as number;
      const toRow = chunk.patches[i + 1] as number;
      const target = this.#findChunkForGlobalEdgeIndex(globalEdgeIndex);
      const owner = this.#chunks[target.chunkIndex] as LayoutChunk;
      owner.edges[target.localIndex * EDGE_STRIDE + EDGE_TO_ROW] = toRow;
    }
  }

  /** Binary search over `#chunkEdgeStart`: the chunk whose own range contains `globalEdgeIndex`. */
  #findChunkForGlobalEdgeIndex(globalEdgeIndex: number): {
    chunkIndex: number;
    localIndex: number;
  } {
    let low = 0;
    let high = this.#chunkEdgeStart.length - 1;
    let found = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const start = this.#chunkEdgeStart[mid] as number;
      if (start <= globalEdgeIndex) {
        found = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    if (found === -1) {
      throw new AssertionError(
        `LayoutStore: patch names global edge ${globalEdgeIndex}, which no appended chunk owns`,
      );
    }
    return {
      chunkIndex: found,
      localIndex: globalEdgeIndex - (this.#chunkEdgeStart[found] as number),
    };
  }

  /** Binary search over `#chunks` by row range. */
  #locateRow(row: number): { chunk: LayoutChunk; localRow: number } {
    assert(
      row >= 0 && row < this.#rowCount,
      `LayoutStore: row ${row} out of range [0, ${this.#rowCount})`,
    );
    const chunk = this.#chunks[this.#chunkIndexAt(row)] as LayoutChunk;
    return { chunk, localRow: row - chunk.from };
  }

  /** Every chunk slice overlapping `[fromRow, toRowInclusive]`, clipped to each chunk's own
   *  range — a lookback window can span a chunk boundary, so this may yield more than one. */
  *#chunkSlices(fromRow: number, toRowInclusive: number): Generator<ChunkSlice> {
    if (this.#chunks.length === 0) return;
    let chunkIndex = this.#chunkIndexAt(Math.max(0, fromRow));
    while (chunkIndex < this.#chunks.length) {
      const chunk = this.#chunks[chunkIndex] as LayoutChunk;
      if (chunk.from > toRowInclusive) break;
      const localFrom = Math.max(fromRow, chunk.from) - chunk.from;
      const localToExclusive = Math.min(toRowInclusive, chunk.to - 1) - chunk.from + 1;
      yield { chunk, chunkIndex, localFrom, localToExclusive };
      chunkIndex++;
    }
  }

  #chunkIndexAt(row: number): number {
    let low = 0;
    let high = this.#chunks.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const chunk = this.#chunks[mid] as LayoutChunk;
      if (row < chunk.from) high = mid - 1;
      else if (row >= chunk.to) low = mid + 1;
      else return mid;
    }
    throw new AssertionError(`LayoutStore: row ${row} not covered by any appended chunk`);
  }

  /** The CSR window scan: every *short* edge (§module doc comment) starting in
   *  `[row - LONG_EDGE_ROWS, row]` that covers `row`. A short edge starting further back than
   *  that cannot still be open (its own span bound rules it out), so this window is exact, not
   *  a heuristic. */
  #collectShortSegments(row: number, out: EdgeSegment[], countIn: number): number {
    let count = countIn;
    const windowStart = Math.max(0, row - LONG_EDGE_ROWS);
    for (const { chunk, chunkIndex, localFrom, localToExclusive } of this.#chunkSlices(
      windowStart,
      row,
    )) {
      const longLocalIndices = this.#longLocalIndices[chunkIndex] as Set<number>;
      const edgeStart = chunk.edgeIndex[localFrom] as number;
      const edgeEnd = chunk.edgeIndex[localToExclusive] as number;
      for (let localIndex = edgeStart; localIndex < edgeEnd; localIndex++) {
        if (longLocalIndices.has(localIndex)) continue; // handled exclusively by #collectLongSegments
        const segment = readSegment(chunk, localIndex);
        if (coversRow(segment, row)) {
          out[count] = segment;
          count++;
        }
      }
    }
    return count;
  }

  /** The `#longEdges` scan: binary search to the last entry with `fromRow <= row`, then a
   *  linear filter on `toRow` — the "long edges are hundreds, not thousands" bound from the
   *  module doc comment is what keeps this cheap. */
  #collectLongSegments(row: number, out: EdgeSegment[], countIn: number): number {
    let count = countIn;
    const upperBound = this.#longEdgeUpperBound(row);
    for (let i = 0; i < upperBound; i++) {
      const ref = this.#longEdges[i] as LongEdgeRef;
      const chunk = this.#chunks[ref.chunkIndex] as LayoutChunk;
      const segment = readSegment(chunk, ref.localIndex);
      if (coversRow(segment, row)) {
        out[count] = segment;
        count++;
      }
    }
    return count;
  }

  /** The index just past the last `#longEdges` entry with `fromRow <= row`. */
  #longEdgeUpperBound(row: number): number {
    let low = 0;
    let high = this.#longEdges.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      const fromRow = (this.#longEdges[mid] as LongEdgeRef).fromRow;
      if (fromRow <= row) low = mid + 1;
      else high = mid;
    }
    return low;
  }
}
