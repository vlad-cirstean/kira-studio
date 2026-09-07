/**
 * The contract between `CommitStore` (W4), the lane-layout algorithm (W6-W9), and the thread
 * the layout eventually runs on (P4's worker). Written before the algorithm because the buffer
 * layout is the part the IPC contract (P3) and the renderer (P4) have to agree with, and
 * because the decisions in it are the ones that are expensive to change later — see
 * `docs/plans/P2.md`'s "Where the worker line falls" for why the worker *file* is P4's while
 * this contract and the algorithm behind it are P2's.
 */

/** The row range `CommitStore.layoutInput()` hands to `layoutAppend()`, plus the parent CSR
 *  slice it reads. `parentOffsets`/`parentRows` are the *whole* store's columns (absolute
 *  indices), not sliced to `[from, to)` — the algorithm needs to see resolved parents outside
 *  the new range to patch edges emitted in an earlier chunk (§5.2's "route remaining parents"
 *  step can reach back across a page boundary). */
export interface LayoutInput {
  readonly from: number;
  readonly to: number;
  readonly parentOffsets: Uint32Array;
  readonly parentRows: Int32Array;
  /** From `CommitStore.appendPage()`'s `AppendResult` — slots that just became resolvable. */
  readonly resolvedParentSlots: Uint32Array;
}

/** One edge record's field offsets within a `EDGE_STRIDE`-wide slice of `LayoutChunk.edges`.
 *  Interleaved at a fixed stride in one `Uint32Array`, not six parallel arrays: one buffer,
 *  one transfer, and a per-frame scan reads six adjacent words instead of touching six pages. */
export const EDGE_STRIDE = 6;
export const EDGE_FROM_ROW = 0;
export const EDGE_TO_ROW = 1;
export const EDGE_FROM_LANE = 2;
export const EDGE_TO_LANE = 3;
export const EDGE_COLOR = 4;
export const EDGE_KIND = 5;

/** A real terminal state, not a placeholder: an edge to a parent outside the loaded range (or
 *  below a shallow-clone boundary) keeps this value, and the renderer draws such an edge
 *  running off the bottom of the loaded history. `0xffffffff` rather than `-1` keeps every
 *  edge field in the same unsigned column. */
export const UNRESOLVED_ROW = 0xffffffff;

/** 0 straight (parent continues the same lane), 1 branch-out (routed into a different lane
 *  below), 2 merge-in (a lane closing into another at this row). Classified once, where the
 *  lane transition is known (W7) — re-deriving it from lane numbers in the renderer is not
 *  free the way deciding it here is. */
export type EdgeKind = 0 | 1 | 2;
export const EDGE_KIND_STRAIGHT: EdgeKind = 0;
export const EDGE_KIND_BRANCH_OUT: EdgeKind = 1;
export const EDGE_KIND_MERGE_IN: EdgeKind = 2;

export interface LayoutChunk {
  readonly from: number;
  readonly to: number;
  /** One entry per row in `[from, to)`, indexed `row - from`. */
  readonly laneOf: Uint32Array;
  readonly colorOf: Uint32Array;
  /** `EDGE_STRIDE`-wide records, sorted by `fromRow` ascending. */
  readonly edges: Uint32Array;
  /** CSR into `edges`: `edgeIndex[row - from]` is the first edge index starting at `row`;
   *  length `(to - from) + 1`. Lets the renderer find the edges touching a visible row window
   *  in O(1) instead of scanning from row 0. */
  readonly edgeIndex: Uint32Array;
  /** `(edgeIndex, toRow)` pairs correcting an `UNRESOLVED_ROW` target left dangling by an
   *  *earlier* chunk — the mechanism that lets a Load more fix up the previous page's edges
   *  without re-laying it out. Empty when this chunk resolved nothing outside itself. */
  readonly patches: Uint32Array;
  /** High-water mark of lanes allocated by the pass — lets a consumer size the graph column
   *  without scanning. */
  readonly laneCount: number;
  /** The largest `toRow - fromRow` over every edge in this chunk. Tells the renderer exactly
   *  how far above a visible window it must look back to catch a long edge passing through,
   *  instead of scanning from row 0 or guessing. */
  readonly maxEdgeSpan: number;
  /** Every distinct `ArrayBuffer` backing this chunk's typed arrays, exactly once — what
   *  `postMessage(chunk, { transfer })` (or `structuredClone`, W10) is handed. */
  readonly transfer: readonly ArrayBuffer[];
}

/** Opaque outside `core/graph/*`: plain, structured-clone-safe data carrying the open-lane
 *  state, the pending (not-yet-loaded-parent) map, the next colour counter and the next row —
 *  everything `layoutAppend()` needs to resume a pass at a page boundary. Returned rather than
 *  kept in module state so two repositories' layouts never see each other. */
export interface LayoutFrontier {
  readonly nextRow: number;
  /** High-water mark of lanes allocated so far, across every chunk this frontier descends
   *  from — carried forward so `laneCount` in a later chunk is never smaller than an earlier
   *  one's, even if lanes have since closed. */
  readonly laneCount: number;
  /** `openLanes[lane]` = the row that lane is waiting for, or one of the two sentinels below.
   *  Index is the lane number; a closed lane's slot is reused by a later `LANE_EMPTY` claim. */
  readonly openLanes: readonly number[];
  /** Colour assigned to each currently-open lane, parallel to `openLanes`; meaningless where
   *  the lane is `LANE_EMPTY`. */
  readonly laneColors: readonly number[];
  readonly colorState: ColorState;
  /** Every edge emitted so far, across every chunk, is numbered from 0 in one global sequence
   *  — this is the next number to hand out. Global (not per-chunk) numbering is what lets a
   *  patch in a later chunk name an edge that lives in an earlier one's `edges` buffer; the
   *  reassembler (the consumer holding every chunk) maps a global index back to
   *  (chunk, local offset) via each chunk's own `[from, from + (to - from))` edge-count range. */
  readonly nextGlobalEdgeIndex: number;
  /** Store parent-slot index (the same numbering as `LayoutInput.resolvedParentSlots`) -> the
   *  lane and global edge index left waiting on that slot's resolution. A direct lookup
   *  against `resolvedParentSlots`, never a scan — this map's size is bounded by the walk's
   *  open frontier, not by row count. */
  readonly pendingBySlot: ReadonlyMap<number, PendingEdge>;
}

/** `openLanes[lane]` when the lane holds no commit and is free to be claimed. */
export const LANE_EMPTY = -1;
/** `openLanes[lane]` when the lane is waiting on a parent that is not loaded yet — a distinct
 *  sentinel from `LANE_EMPTY` because a pending lane is not eligible to be claimed by an
 *  unrelated new lane allocation the way an empty one is. */
export const LANE_PENDING = -2;

export interface PendingEdge {
  readonly lane: number;
  readonly globalEdgeIndex: number;
}

/** Colour-assignment state (W8), carried in the frontier so a lane reused after closing does
 *  not inherit its old colour and two runs over the same topology stay byte-identical. */
export interface ColorState {
  readonly nextColor: number;
  readonly paletteSize: number;
}

export const DEFAULT_PALETTE_SIZE = 8;

// ---------------------------------------------------------------------------------------
// Worker message shapes (types only) — what P4's layout.worker.ts will speak. Declared here,
// not invented separately by P3's IPC contract and P4's worker, so the two cannot drift.
// ---------------------------------------------------------------------------------------

export interface LayoutRequest {
  /** Monotonically increasing per repo; lets a superseded request's response be dropped by a
   *  caller that raced ahead (e.g. two Load more presses in quick succession). */
  readonly sequence: number;
  readonly input: LayoutInput;
  readonly frontier: LayoutFrontier | undefined;
}

export interface LayoutResponse {
  readonly sequence: number;
  readonly chunk: LayoutChunk;
  readonly frontier: LayoutFrontier;
}
