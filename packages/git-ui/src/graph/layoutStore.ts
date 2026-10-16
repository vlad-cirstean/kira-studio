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
  EDGE_RUN_LANE,
  EDGE_STRIDE,
  EDGE_TO_LANE,
  EDGE_TO_ROW,
  type LayoutChunk,
  PATCH_EDGE_INDEX,
  PATCH_STRIDE,
  PATCH_TO_LANE,
  PATCH_TO_ROW,
  PATCH_UNCHANGED,
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
 *  `segmentsInRow`'s results a plain per-row shape. */
export interface EdgeSegment {
  readonly fromRow: number;
  readonly toRow: number;
  readonly fromLane: number;
  /** The lane the edge occupies on its pass-through rows (`EDGE_RUN_LANE`). */
  readonly runLane: number;
  readonly toLane: number;
  readonly color: number;
}

/** Edges whose span exceeds this many rows — or whose target has not resolved yet, treated as
 *  unboundedly long until a later chunk's patch says otherwise — are indexed separately rather
 *  than relied on to be found by a nearby row's CSR scan: a resolved long edge sits in the
 *  `#longBlocks` bucket of every `LONG_EDGE_ROWS`-row block it covers (a row query reads one
 *  bucket), an unresolved one in `#openLongEdges`. An edge merely unresolved *at append time*
 *  (every open lane at a chunk boundary) is demoted back out the moment its own patch resolves
 *  it to a genuinely short span (`#resolveLong`). */
const LONG_EDGE_ROWS = 64;

/** A reference into an owning chunk's own `edges` buffer, not a copy of the segment itself: a
 *  patch mutates that buffer in place (see `#applyPatches`), so re-reading through the
 *  reference always observes the current value with nothing here to go stale. */
interface LongEdgeRef {
  readonly chunkIndex: number;
  readonly localIndex: number;
  readonly fromRow: number;
}

/** Orders `out[from, to)` by `fromRow`, stably — insertion sort: the slice is a row's few long
 *  edges, already almost in order. */
function sortByFromRow(out: EdgeSegment[], from: number, to: number): void {
  for (let i = from + 1; i < to; i++) {
    const item = out[i] as EdgeSegment;
    let j = i - 1;
    while (j >= from && (out[j] as EdgeSegment).fromRow > item.fromRow) {
      out[j + 1] = out[j] as EdgeSegment;
      j--;
    }
    out[j + 1] = item;
  }
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
    runLane: chunk.edges[base + EDGE_RUN_LANE] as number,
    toLane: chunk.edges[base + EDGE_TO_LANE] as number,
    color: chunk.edges[base + EDGE_COLOR] as number,
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
 * cannot still be open — its own span bound rules it out), and the row's own block bucket of long
 * edges (plus the still-unresolved ones) catches everything else. Neither is a walk over history.
 */
export class LayoutStore {
  readonly #chunks: LayoutChunk[] = [];
  /** `#chunkEdgeStart[i]` is the first global edge index `#chunks[i]` owns — parallel to
   *  `#chunks`, strictly increasing, and exactly what a patch's `globalEdgeIndex` is resolved
   *  against. */
  readonly #chunkEdgeStart: number[] = [];
  #nextGlobalEdgeIndex = 0;
  /** `#longBlocks[b]` holds every resolved long edge covering any row of block `b` (rows
   *  `[b * LONG_EDGE_ROWS, (b + 1) * LONG_EDGE_ROWS)`), so a row query reads one bucket instead of
   *  every long edge above it. */
  readonly #longBlocks: Array<LongEdgeRef[] | undefined> = [];
  /** Long edges whose target is still `UNRESOLVED_ROW`: they cover every row from `fromRow` down
   *  to the end of the loaded rows, so no bucket can hold them. Moved into `#longBlocks` (or
   *  dropped, when short) by `#resolveLong`. */
  readonly #openLongEdges: LongEdgeRef[] = [];
  #longEdgeTotal = 0;
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

  /** Test-observable count of indexed long edges — exposed so `#resolveLong`'s bound ("stays
   *  close to the genuinely-long edge count, not the total number ever appended") is provable from
   *  outside the class, not just inferable from `segmentsInRow`'s output. Not read by any
   *  renderer. */
  get longEdgeCount(): number {
    return this.#longEdgeTotal;
  }

  clear(): void {
    this.#chunks.length = 0;
    this.#chunkEdgeStart.length = 0;
    this.#nextGlobalEdgeIndex = 0;
    this.#longBlocks.length = 0;
    this.#openLongEdges.length = 0;
    this.#longEdgeTotal = 0;
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
        const ref: LongEdgeRef = { chunkIndex, localIndex, fromRow: segment.fromRow };
        this.#longEdgeTotal++;
        if (segment.toRow === UNRESOLVED_ROW) this.#openLongEdges.push(ref);
        else this.#registerLong(ref, segment.toRow);
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

  // ---------------------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------------------

  /** Patches name edges an *earlier* chunk left dangling that this chunk's own page resolved —
   *  either a `toRow` an `UNRESOLVED_ROW` parent just resolved to, or (G21 D3) a `toLane`
   *  a lane just discovered to converge into another. Each `PATCH_STRIDE`-wide record carries
   *  `PATCH_UNCHANGED` in whichever of `toRow`/`toLane` it is not setting, so one loop
   *  applies both kinds of patch without needing to know which it is. Writes directly into the
   *  owning chunk's `edges` buffer — legal (it is ours, it was transferred to us, nothing else
   *  holds a reference) and exactly what keeps every later read (the CSR scan, `#longEdges`)
   *  automatically current with no separate bookkeeping. */
  #applyPatches(chunk: LayoutChunk): void {
    for (let i = 0; i < chunk.patches.length; i += PATCH_STRIDE) {
      const globalEdgeIndex = chunk.patches[i + PATCH_EDGE_INDEX] as number;
      const toRow = chunk.patches[i + PATCH_TO_ROW] as number;
      const toLane = chunk.patches[i + PATCH_TO_LANE] as number;
      const target = this.#findChunkForGlobalEdgeIndex(globalEdgeIndex);
      const owner = this.#chunks[target.chunkIndex] as LayoutChunk;
      const base = target.localIndex * EDGE_STRIDE;
      if (toRow !== PATCH_UNCHANGED) {
        owner.edges[base + EDGE_TO_ROW] = toRow;
        this.#resolveLong(target.chunkIndex, target.localIndex, toRow);
      }
      if (toLane !== PATCH_UNCHANGED) owner.edges[base + EDGE_TO_LANE] = toLane;
    }
  }

  /** G31 round-2 performance review, finding #2: `isLongAtAppendTime` unconditionally classifies
   *  any still-`UNRESOLVED_ROW` edge as long — every open lane at a chunk boundary, not just a
   *  genuine long-lived merge. Most of those resolve in the very next chunk to a genuinely SHORT
   *  span; the frozen-at-append-time membership (`isLongAtAppendTime`'s own doc comment, to avoid
   *  a double-reported segment) must not keep them indexed forever.
   *
   *  Called the moment a patch resolves an edge's `toRow` (`patchTarget`'s own doc comment: at
   *  most once per edge, `UNRESOLVED_ROW` → a real row). The edge leaves `#openLongEdges`; a span
   *  that is genuinely long moves into `#longBlocks`, a short one is un-frozen — dropped from
   *  `#longLocalIndices` towards the *same* answer `isLongAtAppendTime` would have given had it
   *  known the real span, so `#collectShortSegments`' CSR window picks it up and nothing is
   *  double-reported. */
  #resolveLong(chunkIndex: number, localIndex: number, toRow: number): void {
    const longLocalIndices = this.#longLocalIndices[chunkIndex] as Set<number>;
    if (!longLocalIndices.has(localIndex)) return; // wasn't long-at-append-time; nothing to do.
    const index = this.#openLongEdges.findIndex(
      (ref) => ref.chunkIndex === chunkIndex && ref.localIndex === localIndex,
    );
    assert(index !== -1, 'LayoutStore: unresolved long edge missing from #openLongEdges');
    const ref = this.#openLongEdges[index] as LongEdgeRef;
    this.#openLongEdges.splice(index, 1);
    if (toRow - ref.fromRow > LONG_EDGE_ROWS) {
      this.#registerLong(ref, toRow);
      return;
    }
    longLocalIndices.delete(localIndex);
    this.#longEdgeTotal--;
  }

  /** Files a resolved long edge into the bucket of every block its `[fromRow, toRow]` covers. */
  #registerLong(ref: LongEdgeRef, toRow: number): void {
    const lastBlock = Math.floor(toRow / LONG_EDGE_ROWS);
    for (let block = Math.floor(ref.fromRow / LONG_EDGE_ROWS); block <= lastBlock; block++) {
      const bucket = this.#longBlocks[block];
      if (bucket === undefined) this.#longBlocks[block] = [ref];
      else bucket.push(ref);
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

  /** The long-edge scan: the row's own `#longBlocks` bucket plus the still-unresolved edges, so
   *  cost follows the long edges that actually touch this block, not every long edge above it
   *  (G30 finding #3's allocation concern still holds: only a covering edge is read into an
   *  object). Edges come out ordered by `fromRow`, as the segment painter expects. */
  #collectLongSegments(row: number, out: EdgeSegment[], countIn: number): number {
    let count = countIn;
    const bucket = this.#longBlocks[Math.floor(row / LONG_EDGE_ROWS)];
    if (bucket !== undefined) {
      for (const ref of bucket) {
        if (ref.fromRow > row) continue;
        const chunk = this.#chunks[ref.chunkIndex] as LayoutChunk;
        const toRow = chunk.edges[ref.localIndex * EDGE_STRIDE + EDGE_TO_ROW] as number;
        if (row > toRow) continue;
        out[count] = readSegment(chunk, ref.localIndex);
        count++;
      }
    }
    for (const ref of this.#openLongEdges) {
      if (ref.fromRow > row) continue;
      out[count] = readSegment(this.#chunks[ref.chunkIndex] as LayoutChunk, ref.localIndex);
      count++;
    }
    sortByFromRow(out, countIn, count);
    return count;
  }
}
