/**
 * §5.2's forward pass: "a single forward pass over the topologically ordered commit list
 * maintaining an array of open lanes; for each commit, claim the leftmost lane whose expected
 * child is this commit, route remaining parents into free or newly-allocated lanes, and emit
 * edge segments." `--topo-order` (§4.4) is what makes this valid: a commit's parents always
 * have a strictly larger row index than the commit itself (children before parents), so the
 * pass never needs to look behind itself.
 *
 * Convergence — multiple lanes turning out to share a target — is decided **only** by steps
 * 1-2 below, at the shared target row's own processing, never speculatively when a parent link
 * is first created. An earlier version of this pass also eagerly merged a new parent link into
 * an already-open lane the moment it discovered (from already-resolved data) that both pointed
 * at the same future row. That is unsound under paging: whether a parent is "already resolved"
 * at edge-creation time depends on how much of the store has been loaded, which differs between
 * a one-pass layout (everything resolved up front, so the merge happens immediately) and a
 * paged one (a parent resolves only once its own page loads, so the merge — if attempted at
 * all — happens much later). The two runs would then free lanes for reuse at different points
 * and disagree on `laneOf`/`colorOf`, breaking the page-by-page-equals-one-pass invariant.
 * Steps 1-2 depend only on row order, which is identical either way, so that is where every
 * convergence — a real merge commit's parents, or several unrelated lanes that simply happen
 * to share a distant single-parent ancestor — is resolved. One consequence: `EdgeKind`'s
 * `merge-in` value is not currently emitted by this pass (every edge is `straight`, continuing
 * the claiming commit's own lane, or `branch-out`, a freshly allocated one) — recorded as a
 * deliberate simplification for a future refinement, not a silently dropped case; see this
 * phase's Findings.
 */
import { assert } from "../util/assert.ts";
import { advanceColorState, allocateColor, initialColorState } from "./colors.ts";
import { EdgeBuffer } from "./edges.ts";
import {
  EDGE_KIND_BRANCH_OUT,
  EDGE_KIND_STRAIGHT,
  LANE_EMPTY,
  LANE_PENDING,
  type LayoutFrontier,
  type LayoutInput,
  type PendingEdge,
  UNRESOLVED_ROW,
} from "./types.ts";

export interface LaneAssignment {
  readonly laneOf: Uint32Array;
  readonly colorOf: Uint32Array;
  readonly edgeBuffer: EdgeBuffer;
  readonly laneCount: number;
  readonly frontier: LayoutFrontier;
}

function freshFrontier(): LayoutFrontier {
  return {
    nextRow: 0,
    laneCount: 0,
    openLanes: [],
    laneColors: [],
    colorState: initialColorState(),
    nextGlobalEdgeIndex: 0,
    pendingBySlot: new Map(),
  };
}

/** Mutable working copy of a `LayoutFrontier` — the frontier type itself is immutable/plain
 *  for structured-clone safety (W10); this pass mutates local arrays/maps and only freezes
 *  them back into a new `LayoutFrontier` once it returns. */
interface MutableState {
  openLanes: number[];
  laneColors: number[];
  colorState: { nextColor: number; paletteSize: number };
  laneCount: number;
  pendingBySlot: Map<number, PendingEdge>;
}

function toMutable(frontier: LayoutFrontier | undefined): MutableState {
  const source = frontier ?? freshFrontier();
  return {
    openLanes: [...source.openLanes],
    laneColors: [...source.laneColors],
    colorState: { ...source.colorState },
    laneCount: source.laneCount,
    pendingBySlot: new Map(source.pendingBySlot),
  };
}

function neighbourColorsOf(state: MutableState, lane: number): number[] {
  const colors: number[] = [];
  if (lane > 0 && state.openLanes[lane - 1] !== LANE_EMPTY) {
    colors.push(state.laneColors[lane - 1] as number);
  }
  if (lane + 1 < state.laneCount && state.openLanes[lane + 1] !== LANE_EMPTY) {
    colors.push(state.laneColors[lane + 1] as number);
  }
  return colors;
}

/** Finds the leftmost lane in `[0, laneCount)` whose `openLanes` value equals `row`, skipping
 *  `skip` if given. -1 if none. */
function findExpectingLane(state: MutableState, row: number, skip: number | undefined): number {
  for (let lane = 0; lane < state.laneCount; lane++) {
    if (lane === skip) continue;
    if (state.openLanes[lane] === row) return lane;
  }
  return -1;
}

/** Allocates a lane for a new claim: the leftmost `LANE_EMPTY` slot, or a fresh one at the
 *  right edge if none is free — "route remaining parents into free or newly-allocated lanes". */
function allocateLane(state: MutableState): number {
  for (let lane = 0; lane < state.laneCount; lane++) {
    if (state.openLanes[lane] === LANE_EMPTY) return lane;
  }
  const lane = state.laneCount;
  state.laneCount++;
  state.openLanes.push(LANE_EMPTY);
  state.laneColors.push(0);
  return lane;
}

function assignColor(state: MutableState, lane: number): number {
  const color = allocateColor(state.colorState, neighbourColorsOf(state, lane));
  state.colorState = advanceColorState(state.colorState, color);
  state.laneColors[lane] = color;
  return color;
}

/**
 * The forward pass over `input.from .. input.to`. Returns per-row lane/colour assignments, the
 * edges emitted (via the returned `EdgeBuffer`, not yet packed — `layout.ts`/W9 owns that), and
 * the frontier to resume from on the next call.
 */
export function assignLanes(
  input: LayoutInput,
  frontier: LayoutFrontier | undefined,
): LaneAssignment {
  const state = toMutable(frontier);
  const rowCount = input.to - input.from;
  const laneOf = new Uint32Array(rowCount);
  const colorOf = new Uint32Array(rowCount);
  const edgeBuffer = new EdgeBuffer(frontier?.nextGlobalEdgeIndex ?? 0);

  // Step 0: react to parents resolved since the last call — patch the dangling edge and let
  // the lane that was waiting on it start expecting the now-known row, exactly as if it had
  // been resolved from the start.
  for (const slot of input.resolvedParentSlots) {
    const pending = state.pendingBySlot.get(slot);
    if (!pending) continue; // resolved by a lineage this frontier doesn't descend from
    const resolvedRow = input.parentRows[slot] as number;
    assert(resolvedRow >= 0, `assignLanes: resolvedParentSlots names slot ${slot} still -1`);
    edgeBuffer.patchTarget(pending.globalEdgeIndex, resolvedRow);
    state.openLanes[pending.lane] = resolvedRow;
    state.pendingBySlot.delete(slot);
  }

  for (let row = input.from; row < input.to; row++) {
    const localRow = row - input.from;

    // Step 1: claim the leftmost lane already expecting this row, or allocate one.
    let claimedLane = findExpectingLane(state, row, undefined);
    if (claimedLane === -1) {
      claimedLane = allocateLane(state);
      assignColor(state, claimedLane);
    }
    laneOf[localRow] = claimedLane;
    colorOf[localRow] = state.laneColors[claimedLane] as number;

    // Step 2: every OTHER lane also expecting this row is a sibling child converging here —
    // its edge was already emitted (kind decided at that edge's own creation time, see the
    // module doc comment); all that remains is to free the lane for reuse.
    for (let lane = 0; lane < state.laneCount; lane++) {
      if (lane !== claimedLane && state.openLanes[lane] === row) state.openLanes[lane] = LANE_EMPTY;
    }

    const parentStart = input.parentOffsets[row] as number;
    const parentEnd = input.parentOffsets[row + 1] as number;
    const parentCount = parentEnd - parentStart;

    if (parentCount === 0) {
      state.openLanes[claimedLane] = LANE_EMPTY;
      continue;
    }

    // Step 3a: parent 0 always continues the claimed lane. (An earlier version of this pass
    // also checked "is a lane to the left already expecting this same row" and merged into it
    // immediately when so — eagerly collapsing lanes as soon as a shared future ancestor was
    // *known*. That check is unsound under paging: whether it fires depends on whether the
    // parent happened to be resolved yet, which differs between a one-pass layout (everything
    // resolved up front) and a paged one (a parent resolves only once its own page loads) —
    // the same row could end up claimed by a different lane, or a lane freed for reuse at a
    // different point, purely as an artifact of page boundaries. Convergence is instead left
    // entirely to steps 1-2 above, which fire at the shared target row's own processing and so
    // depend only on row order — identical between paged and one-pass by construction. See
    // the page-boundary invariant tests this fixes.)
    const parent0Row = input.parentRows[parentStart] as number;
    if (parent0Row === -1) {
      state.openLanes[claimedLane] = LANE_PENDING;
      const edgeIndex = edgeBuffer.append(
        row,
        UNRESOLVED_ROW,
        claimedLane,
        claimedLane,
        state.laneColors[claimedLane] as number,
        EDGE_KIND_STRAIGHT,
      );
      state.pendingBySlot.set(parentStart, { lane: claimedLane, globalEdgeIndex: edgeIndex });
    } else {
      state.openLanes[claimedLane] = parent0Row;
      edgeBuffer.append(
        row,
        parent0Row,
        claimedLane,
        claimedLane,
        state.laneColors[claimedLane] as number,
        EDGE_KIND_STRAIGHT,
      );
    }

    // Step 3b: remaining parents (an octopus merge is this loop running further) always
    // allocate a fresh lane — free-or-new at the right edge — for the same paging-consistency
    // reason as 3a: they converge with an existing lane only once steps 1-2 discover it at the
    // shared target row, never speculatively here.
    for (let i = 1; i < parentCount; i++) {
      const slot = parentStart + i;
      const parentRow = input.parentRows[slot] as number;
      const newLane = allocateLane(state);
      const color = assignColor(state, newLane);
      if (parentRow === -1) {
        state.openLanes[newLane] = LANE_PENDING;
        const edgeIndex = edgeBuffer.append(
          row,
          UNRESOLVED_ROW,
          claimedLane,
          newLane,
          color,
          EDGE_KIND_BRANCH_OUT,
        );
        state.pendingBySlot.set(slot, { lane: newLane, globalEdgeIndex: edgeIndex });
      } else {
        state.openLanes[newLane] = parentRow;
        edgeBuffer.append(row, parentRow, claimedLane, newLane, color, EDGE_KIND_BRANCH_OUT);
      }
    }
  }

  const newFrontier: LayoutFrontier = {
    nextRow: input.to,
    laneCount: state.laneCount,
    openLanes: state.openLanes,
    laneColors: state.laneColors,
    colorState: state.colorState,
    nextGlobalEdgeIndex: edgeBuffer.nextGlobalIndex,
    pendingBySlot: state.pendingBySlot,
  };

  return { laneOf, colorOf, edgeBuffer, laneCount: state.laneCount, frontier: newFrontier };
}
