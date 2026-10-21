import { assert } from '../lib/assert.ts';
import type { CommitStore } from '../store/commitStore.ts';
import type { LayoutInput } from './types.ts';

/**
 * P93 §3: the branch-grouped row plan — a pure projection from `CommitStore`'s arrival order
 * (store rows, topological: a commit's parents always have a strictly larger row index than the
 * commit itself) onto a *display* order (checked-out branch first, then every other branch's
 * group, most-recently-active first).
 *
 * **Group assignment is final on arrival.** `priority(row) = min(tipPriority(sha(row)), min over
 * children c of row: priority(c))`, computed in one forward pass over rows in arrival order
 * (`buildRowPlan` below). Under `--topo-order` every commit that can reach a row is already
 * loaded when that row arrives, so no later page can lower a row's priority — a plan rebuilt
 * after page 5 agrees with one rebuilt after page 1 about every row page 1 already held
 * (`rowPlan.spec.ts`'s "final on arrival" case).
 *
 * `buildRowPlan` reprocesses the whole `[0, store.rowCount)` range on every call rather than
 * keeping `claimed`/`pendingBySha` state across calls — a deliberate simplification against this
 * module's own production call site (`GraphViewState`'s rebuild, P93 §5.3 step 1), which always
 * passes the *whole* store on every plan-affecting change anyway (a page landing already forces a
 * full relayout downstream, §5.1). Finality still holds identically either way; a per-call
 * `claimed`/`pendingBySha` cache would only ever be exercised in a call pattern nothing in this
 * codebase uses.
 *
 * No Vue, no DOM — `App.vue`/`GraphOrderState` own the tip list and the expanded-group set;
 * this module only ever reads `CommitStore` and the `RowPlan`/`LayoutInput` shapes.
 *
 * `buildRowPlan` also performs §4's contraction: a collapsed group (`options.collapseEnabled`,
 * not group 0, not in `options.expandedKeys`, more than `MIN_COLLAPSIBLE` members) renders as its
 * tip, one placeholder entry contracting every member between, and its oldest own commit — never
 * a nested collapse, since a branch off a branch is its own group at its own priority (§3.1).
 * `projectLayoutInput` (§4.3/§6.2, below) is the display-row projection `lanes.ts` runs against;
 * it already handles a contracted placeholder's folded parent links.
 */

/** One branch/stash/tag tip the plan groups commits under, in priority order — index 0 is the
 *  checked-out branch (or whatever the caller places first; this module has no branch/stash/tag
 *  vocabulary of its own, see `state/graphOrder.ts` for how `App.vue` assembles this list). */
export interface TipRef {
  readonly sha: string;
  /** Stable group identity — a ref name or a stash key, never re-derived from `sha` (two tips
   *  can share a sha, e.g. a branch and a tag on the same commit; the first tip in the array
   *  wins that commit's own row, but each tip still needs its own key for the expanded-set and
   *  the collapsed placeholder's label). */
  readonly key: string;
  /** The collapsed placeholder's own branch name, e.g. `"feature/x"` in "47 more commits on
   *  feature/x". */
  readonly label: string;
}

export type RowPlanEntryKind = 'commit' | 'collapsed';

export interface RowPlanEntry {
  readonly kind: RowPlanEntryKind;
  /** A `'commit'` entry's own store row; a `'collapsed'` placeholder's *first* contracted store
   *  row (its group's tip is a separate, earlier `'commit'` entry — this is the first *hidden*
   *  member). Never used to read commit data for a placeholder — every formatter asks the plan
   *  first (`entryAt(...).kind`); it exists so `getItem` always has a real row to materialize. */
  readonly storeRow: number;
  /** Index into the tip list this row's group was assigned, or `tips.length` for the synthetic
   *  `other` group (a row no tip reaches). */
  readonly groupIndex: number;
  /** Count of store rows contracted into a `'collapsed'` entry; `0` for a `'commit'` entry. */
  readonly hiddenCount: number;
}

export interface RowPlan {
  readonly length: number;
  /** Stamped by the caller (`GraphOrderState`) at build time — what `CommitGrid.vue`'s own
   *  `planRevision` watcher diffs against to know a rebuild landed. */
  readonly revision: number;
  /** Store rows this plan covers — `CommitStore.rowCount` at the moment this plan was
   *  built. A caller holding a store row from outside this build (a persisted scroll
   *  position, a plan rebuild still in flight) checks it against this bound before trusting
   *  `displayRowOf`/`containingDisplayRow`, since a plan can lag a store that has since grown or
   *  reset (`GraphViewState.#applyChunk` publishes `loadedRows` before its plan rebuild lands). */
  readonly storeLength: number;
  entryAt(displayRow: number): RowPlanEntry;
  storeRowAt(displayRow: number): number;
  /** `-1` when `storeRow` is hidden inside a collapsed placeholder, OR when `storeRow` is outside
   *  `[0, storeLength)` — this plan does not cover it (P108 F1: a caller degrades to "not found"
   *  instead of the assert this used to throw for that second case). */
  displayRowOf(storeRow: number): number;
  /** The display row that shows `storeRow` — its own row if visible, otherwise the placeholder
   *  hiding it. Always resolves for a loaded row. */
  containingDisplayRow(storeRow: number): number;
  groupKeyAt(displayRow: number): string;
  /** This row's nearest upward link — the display row of the parent that lands
   *  *above* it, or `-1` when every parent lands below (every row of the checked-out group, and
   *  most rows everywhere else). Populated by `projectLayoutInput`; `-1` for every row until that
   *  runs. */
  forkParentOf(displayRow: number): number;
}

export interface RowPlanOptions {
  readonly expandedKeys: ReadonlySet<string>;
  readonly collapseEnabled: boolean;
  readonly revision: number;
}

/** §4.1: a group of `MIN_COLLAPSIBLE` (3) or fewer members always renders in full — contracting
 *  tip + placeholder + oldest into the identical 3 rows saves nothing and costs a click. */
const MIN_COLLAPSIBLE = 3;

/** Never a real ref name or stash key (both come from git, which never emits a NUL byte), so this
 *  can never collide with a caller-supplied `TipRef.key`. */
export const OTHER_GROUP_KEY = '\u0000other';

/** Only `projectLayoutInput` (same module) writes `forkParentOf` — every other
 *  reader of `RowPlan` sees it read-only. Kept as a narrow internal protocol rather than a public
 *  `RowPlan` method so `identityRowPlan`'s trivial implementation (whose links never point up)
 *  does not need one at all. */
interface InternalRowPlan {
  _setForkParent?(displayRow: number, target: number): void;
}

class RowPlanImpl implements RowPlan, InternalRowPlan {
  readonly length: number;
  readonly revision: number;
  readonly storeLength: number;
  readonly #entries: readonly RowPlanEntry[];
  readonly #storeRowToDisplayRow: Int32Array;
  readonly #storeRowToContainingDisplayRow: Int32Array;
  readonly #groupKeyByIndex: readonly string[];
  readonly #forkParent: Int32Array;

  constructor(
    entries: readonly RowPlanEntry[],
    storeRowToDisplayRow: Int32Array,
    storeRowToContainingDisplayRow: Int32Array,
    groupKeyByIndex: readonly string[],
    revision: number,
  ) {
    this.length = entries.length;
    this.revision = revision;
    this.storeLength = storeRowToDisplayRow.length;
    this.#entries = entries;
    this.#storeRowToDisplayRow = storeRowToDisplayRow;
    this.#storeRowToContainingDisplayRow = storeRowToContainingDisplayRow;
    this.#groupKeyByIndex = groupKeyByIndex;
    this.#forkParent = new Int32Array(entries.length).fill(-1);
  }

  entryAt(displayRow: number): RowPlanEntry {
    const entry = this.#entries[displayRow];
    assert(entry !== undefined, `RowPlan.entryAt(${displayRow}): out of range`);
    return entry;
  }

  storeRowAt(displayRow: number): number {
    return this.entryAt(displayRow).storeRow;
  }

  displayRowOf(storeRow: number): number {
    // P108 F1: range-tolerant, not an assert — a caller can hold a store row this plan predates
    // (a persisted scroll position at mount, a stale plan mid-rebuild), and that is "not found",
    // not a programmer error.
    if (storeRow < 0 || storeRow >= this.#storeRowToDisplayRow.length) return -1;
    return this.#storeRowToDisplayRow[storeRow];
  }

  containingDisplayRow(storeRow: number): number {
    assert(
      storeRow >= 0 && storeRow < this.#storeRowToContainingDisplayRow.length,
      `RowPlan.containingDisplayRow(${storeRow}): out of range`,
    );
    return this.#storeRowToContainingDisplayRow[storeRow];
  }

  groupKeyAt(displayRow: number): string {
    return this.#groupKeyByIndex[this.entryAt(displayRow).groupIndex];
  }

  forkParentOf(displayRow: number): number {
    assert(
      displayRow >= 0 && displayRow < this.#forkParent.length,
      `RowPlan.forkParentOf(${displayRow}): out of range`,
    );
    return this.#forkParent[displayRow];
  }

  _setForkParent(displayRow: number, target: number): void {
    this.#forkParent[displayRow] = target;
  }
}

/** The plan a caller with no tips yet gets (a repo whose `refs.list` has not resolved),
 *  and what "collapse turned off entirely" degenerates to conceptually — one entry per store row,
 *  in store order, no groups, no placeholders. `storeRowAt(d) === d` for every `d`, so every
 *  consumer written against `RowPlan` needs no separate "no plan yet" branch. */
export function identityRowPlan(rowCount: number, revision = 0): RowPlan {
  return new IdentityRowPlan(rowCount, revision);
}

class IdentityRowPlan implements RowPlan {
  readonly length: number;
  readonly revision: number;
  readonly storeLength: number;

  constructor(rowCount: number, revision: number) {
    this.length = rowCount;
    this.revision = revision;
    this.storeLength = rowCount;
  }

  entryAt(displayRow: number): RowPlanEntry {
    assert(
      displayRow >= 0 && displayRow < this.length,
      `RowPlan.entryAt(${displayRow}): out of range`,
    );
    return { kind: 'commit', storeRow: displayRow, groupIndex: 0, hiddenCount: 0 };
  }

  storeRowAt(displayRow: number): number {
    assert(
      displayRow >= 0 && displayRow < this.length,
      `RowPlan.storeRowAt(${displayRow}): out of range`,
    );
    return displayRow;
  }

  displayRowOf(storeRow: number): number {
    // P108 F1: range-tolerant, matching `RowPlanImpl` above — `identityRowPlan(0)` is what a
    // fresh mount holds before the first chunk lands, so `storeRow >= length` here is the
    // ordinary "not loaded yet", not a programmer error.
    if (storeRow < 0 || storeRow >= this.length) return -1;
    return storeRow;
  }

  containingDisplayRow(storeRow: number): number {
    assert(
      storeRow >= 0 && storeRow < this.length,
      `RowPlan.containingDisplayRow(${storeRow}): out of range`,
    );
    return storeRow;
  }

  groupKeyAt(displayRow: number): string {
    assert(
      displayRow >= 0 && displayRow < this.length,
      `RowPlan.groupKeyAt(${displayRow}): out of range`,
    );
    return 'identity';
  }

  forkParentOf(displayRow: number): number {
    assert(
      displayRow >= 0 && displayRow < this.length,
      `RowPlan.forkParentOf(${displayRow}): out of range`,
    );
    return -1;
  }
}

// Phase 1 (P94 pass 3 §4.3): first tip wins a shared sha (a branch and a tag on the same commit
// both name it; the array's own priority order decides which group claims it).
function rankTips(tips: readonly TipRef[]): Map<string, number> {
  const tipRankBySha = new Map<string, number>();
  for (let i = 0; i < tips.length; i++) {
    if (!tipRankBySha.has(tips[i].sha)) tipRankBySha.set(tips[i].sha, i);
  }
  return tipRankBySha;
}

// One forward pass over store rows computing `priority(row) = min(tipPriority(sha(row)),
// min over children c of row: priority(c))` (this module's own doc comment) and bucketing each
// row by its rank. `bucketCount` is `tips.length + 1` — one bucket per tip plus the catch-all
// "other" bucket at `otherRank`.
function assignRowRanks(
  store: CommitStore,
  tipRankBySha: ReadonlyMap<string, number>,
  otherRank: number,
  rowCount: number,
  bucketCount: number,
): number[][] {
  const claimed = new Int32Array(rowCount);
  const pendingByRow = new Int32Array(rowCount).fill(-1);
  const pendingBySha = new Map<string, number>();
  const buckets: number[][] = Array.from({ length: bucketCount }, () => []);

  for (let row = 0; row < rowCount; row++) {
    const sha = store.shaAt(row);
    const ownRank = tipRankBySha.get(sha);
    const fromChildRow = pendingByRow[row];
    const fromChildSha = pendingBySha.get(sha);
    let rank = otherRank;
    if (ownRank !== undefined && ownRank < rank) rank = ownRank;
    if (fromChildRow >= 0 && fromChildRow < rank) rank = fromChildRow;
    if (fromChildSha !== undefined && fromChildSha < rank) rank = fromChildSha;
    claimed[row] = rank;
    buckets[rank].push(row);
    pendingBySha.delete(sha);

    const parentRows = store.parentsOf(row);
    let parentShas: readonly string[] | undefined;
    for (let i = 0; i < parentRows.length; i++) {
      const parentRow = parentRows[i];
      if (parentRow === -1) {
        parentShas ??= store.commitAt(row).parents;
        const parentSha = parentShas[i];
        const existing = pendingBySha.get(parentSha);
        if (existing === undefined || rank < existing) pendingBySha.set(parentSha, rank);
        continue;
      }
      assert(parentRow > row, `rowPlan: parent row ${parentRow} <= child row ${row}`);
      const existing = pendingByRow[parentRow];
      if (existing === -1 || rank < existing) pendingByRow[parentRow] = rank;
    }
  }
  return buckets;
}

interface CollapsedBuckets {
  entries: RowPlanEntry[];
  storeRowToDisplayRow: Int32Array;
  storeRowToContainingDisplayRow: Int32Array;
}

// The contraction: group 0 (bucket index 0, the checked-out branch — or stash, if the
// caller placed it there, though `App.vue` never does) never collapses; every other bucket
// collapses when enabled, not manually expanded, and large enough that contracting saves a real
// row count. `bucket` is already tip-first/oldest-last (store order === arrival order === the
// forward walk that visits a child before its still-loading parent, assignRowRanks' own
// `assert(parentRow > row, ...)`).
function collapseBuckets(
  buckets: readonly number[][],
  groupKeyByIndex: readonly string[],
  options: RowPlanOptions,
  rowCount: number,
): CollapsedBuckets {
  const entries: RowPlanEntry[] = [];
  const storeRowToDisplayRow = new Int32Array(rowCount).fill(-1);
  const storeRowToContainingDisplayRow = new Int32Array(rowCount).fill(-1);

  for (let bucketIndex = 0; bucketIndex < buckets.length; bucketIndex++) {
    const bucket = buckets[bucketIndex] as number[];
    const key = groupKeyByIndex[bucketIndex] as string;
    const collapse =
      options.collapseEnabled &&
      bucketIndex !== 0 &&
      bucket.length > MIN_COLLAPSIBLE &&
      !options.expandedKeys.has(key);

    if (!collapse) {
      for (const row of bucket) {
        const displayRow = entries.length;
        entries.push({ kind: 'commit', storeRow: row, groupIndex: bucketIndex, hiddenCount: 0 });
        storeRowToDisplayRow[row] = displayRow;
        storeRowToContainingDisplayRow[row] = displayRow;
      }
      continue;
    }

    const tipRow = bucket[0] as number;
    const tipDisplayRow = entries.length;
    entries.push({ kind: 'commit', storeRow: tipRow, groupIndex: bucketIndex, hiddenCount: 0 });
    storeRowToDisplayRow[tipRow] = tipDisplayRow;
    storeRowToContainingDisplayRow[tipRow] = tipDisplayRow;

    // `bucket.length > MIN_COLLAPSIBLE` (>3) guarantees at least 2 hidden members here.
    const hiddenRows = bucket.slice(1, bucket.length - 1);
    const placeholderDisplayRow = entries.length;
    entries.push({
      kind: 'collapsed',
      storeRow: hiddenRows[0] as number,
      groupIndex: bucketIndex,
      hiddenCount: hiddenRows.length,
    });
    for (const row of hiddenRows) {
      // `storeRowToDisplayRow[row]` stays -1 — a hidden row has no display row of its own
      // (`RowPlan.displayRowOf`'s own doc comment); only `containingDisplayRow` resolves it.
      storeRowToContainingDisplayRow[row] = placeholderDisplayRow;
    }

    const oldestRow = bucket[bucket.length - 1] as number;
    const oldestDisplayRow = entries.length;
    entries.push({ kind: 'commit', storeRow: oldestRow, groupIndex: bucketIndex, hiddenCount: 0 });
    storeRowToDisplayRow[oldestRow] = oldestDisplayRow;
    storeRowToContainingDisplayRow[oldestRow] = oldestDisplayRow;
  }

  return { entries, storeRowToDisplayRow, storeRowToContainingDisplayRow };
}

/**
 * Builds the branch-grouped `RowPlan` for the store's current rows against `tips`
 * (already in priority order — index 0 is the group that never collapses). This first cut always
 * renders every group in full; `options.expandedKeys`/`options.collapseEnabled` are threaded
 * through the public signature now (the `RowPlan`/`RowPlanOptions` shape does not change again)
 * but contraction itself lands in a later commit.
 *
 * Three phases: rankTips (tip priority by sha), assignRowRanks (the forward
 * `priority(row)` pass, bucketed by rank), collapseBuckets (contraction into display rows).
 */
export function buildRowPlan(
  store: CommitStore,
  tips: readonly TipRef[],
  options: RowPlanOptions,
): RowPlan {
  const rowCount = store.rowCount;
  const otherRank = tips.length;

  const tipRankBySha = rankTips(tips);
  const buckets = assignRowRanks(store, tipRankBySha, otherRank, rowCount, tips.length + 1);

  const groupKeyByIndex: string[] = tips.map((t) => t.key);
  groupKeyByIndex.push(OTHER_GROUP_KEY);

  const { entries, storeRowToDisplayRow, storeRowToContainingDisplayRow } = collapseBuckets(
    buckets,
    groupKeyByIndex,
    options,
    rowCount,
  );

  return new RowPlanImpl(
    entries,
    storeRowToDisplayRow,
    storeRowToContainingDisplayRow,
    groupKeyByIndex,
    options.revision,
  );
}

/**
 * Re-expresses `base` (a `CommitStore.layoutInput()` slice, in store-row
 * coordinates) as a `LayoutInput` in `plan`'s *display*-row coordinates — the projection that
 * keeps `lanes.ts` itself branch-order-blind (it never sees an upward link at all, only ever
 * downward ones, exactly like today).
 *
 * Every real parent link classifies against the two rows' *containing* display rows (a
 * contracted row's own display row is its placeholder's):
 * - **downward** (`parentDisplayRow > displayRow`): kept, deduplicated per row — a placeholder
 *   folds several hidden commits' parents into one row, and two of them landing on the same
 *   later group must not become two lanes into it.
 * - **upward** (`parentDisplayRow < displayRow`): dropped from the CSR entirely and recorded as
 *   this row's fork stub instead (`RowPlan.forkParentOf`) — the *nearest* (largest) such target,
 *   since a stub draws one short dashed line, not a fan of them. Never mind lane assignment for
 *   an upward link at all: `lanes.ts` stays a one-directional forward pass unchanged by this
 *   module.
 * - **internal** (`parentDisplayRow === displayRow`, only possible inside a collapsed
 *   placeholder): dropped — a placeholder's own hidden commits never draw a lane to each other.
 *
 * An unresolved parent (`-1` in `base.parentRows`, no target row to classify at all) always
 * stays downward and is never deduplicated — each is a distinct future edge, not yet reachable
 * to compare against.
 *
 * Returns a *fresh* `LayoutInput` covering `[0, plan.length)` — a full relayout's input,
 * not an incremental append, so `resolvedParentSlots` is always empty here: there is no prior
 * frontier for a "just resolved" slot to patch.
 */
export function projectLayoutInput(plan: RowPlan, base: LayoutInput): LayoutInput {
  const length = plan.length;
  const unresolvedCounts = new Uint32Array(length);
  const resolvedTargets: (Set<number> | undefined)[] = new Array(length);
  const upwardBest = new Int32Array(length).fill(-1);

  for (let storeRow = base.from; storeRow < base.to; storeRow++) {
    const displayRow = plan.containingDisplayRow(storeRow);
    const start = base.parentOffsets[storeRow];
    const end = base.parentOffsets[storeRow + 1];
    for (let slot = start; slot < end; slot++) {
      const parentStoreRow = base.parentRows[slot];
      if (parentStoreRow === -1) {
        unresolvedCounts[displayRow]++;
        continue;
      }
      const parentDisplayRow = plan.containingDisplayRow(parentStoreRow);
      if (parentDisplayRow > displayRow) {
        let targets = resolvedTargets[displayRow];
        if (targets === undefined) {
          targets = new Set();
          resolvedTargets[displayRow] = targets;
        }
        targets.add(parentDisplayRow);
      } else if (parentDisplayRow < displayRow && parentDisplayRow > upwardBest[displayRow]) {
        upwardBest[displayRow] = parentDisplayRow;
      }
      // parentDisplayRow === displayRow: internal to a placeholder, dropped.
    }
  }

  const parentOffsets = new Uint32Array(length + 1);
  let total = 0;
  for (let d = 0; d < length; d++) {
    parentOffsets[d] = total;
    total += unresolvedCounts[d] + (resolvedTargets[d]?.size ?? 0);
  }
  parentOffsets[length] = total;

  const parentRows = new Int32Array(total);
  let cursor = 0;
  for (let d = 0; d < length; d++) {
    for (let i = 0; i < unresolvedCounts[d]; i++) parentRows[cursor++] = -1;
    const targets = resolvedTargets[d];
    if (targets !== undefined) {
      for (const target of targets) parentRows[cursor++] = target;
    }
  }

  const internalPlan = plan as InternalRowPlan;
  for (let d = 0; d < length; d++) {
    if (upwardBest[d] >= 0) internalPlan._setForkParent?.(d, upwardBest[d]);
  }

  return {
    from: 0,
    to: length,
    parentOffsets,
    parentRows,
    resolvedParentSlots: new Uint32Array(0),
  };
}
