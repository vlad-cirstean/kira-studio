/**
 * P77 §9: `BranchPicker.vue`'s tab fold — one filter box (§5), a per-tab ordering/pin/cap pass
 * (§6), and the row-id list §7.3's roving keyboard focus walks. Kept beside `refListModel.ts`/
 * `stashListModel.ts`/`stackListModel.ts` as the same "pure fold out of the template" convention
 * those three already follow — no Vue, no bridge, so `pickerModel.test.ts` exercises it directly
 * with plain fixtures.
 *
 * `refListModel.ts` is NOT modified: `buildRefListSections` has two other consumers
 * (`review/BaseSelector.vue`, `review/ReviewView.vue`) whose own sort must not silently change to
 * recency. This module reuses that file's `filterRefs`/`sortByName`/`sortTags`/`capItems`/
 * `REF_LIST_SECTION_CAP` and owns the picker-specific ordering itself.
 *
 * P77 §18.1 commit 1: today's filtering (the one box matches branches/remote/tags only, §2 N2)
 * and today's ordering (alphabetical/`naturalCompare`/received-order — §2 N3/N4's own defects,
 * unfixed) carry over unchanged into the new tabbed structure; only WHERE each list renders moves.
 * Every list also gains a real cap here (`REF_LIST_SECTION_CAP`), including the two — worktrees,
 * stacks — that had none before (part of N1's fix, since `WorktreeList.vue`/`StackList.vue` move
 * to the same pre-capped `section`-prop contract `TagList.vue` already has). §5/§6 land the actual
 * scoped-filter and recency/pin fixes on top of this in later commits.
 */
import type { RefRow, StackBranch, StackSummary, StashEntry, WorktreeEntry } from '@kira/git-ipc';
import {
  capItems,
  filterRefs,
  REF_LIST_SECTION_CAP,
  sortByName,
  sortTags,
} from './refListModel.ts';

export type PickerTab = 'branches' | 'tags' | 'stashes' | 'worktrees' | 'stacks';

/** Every capped list in the panel — the key `capSteps` and `PickerModel` are both addressed by. */
export type PickerListKey =
  | 'branchesLocal'
  | 'branchesRemote'
  | 'tags'
  | 'stashStack'
  | 'stashGlobal'
  | 'worktrees'
  | 'stacks';

export interface PickerList<T> {
  readonly visible: readonly T[];
  readonly hiddenCount: number;
}

/** One Stacks-tab group: a `StackSummary` plus its own branches. */
export interface PickerStackGroup {
  readonly summary: StackSummary;
  readonly branches: readonly StackBranch[];
}

export interface PickerInput {
  readonly branches: readonly RefRow[];
  readonly remoteBranches: readonly RefRow[];
  readonly tags: readonly RefRow[];
  readonly stashes: readonly StashEntry[];
  readonly globalStashes: readonly StashEntry[];
  readonly worktrees: readonly WorktreeEntry[];
  readonly stacks: readonly StackSummary[];
  readonly orphans: readonly StackBranch[];
}

export interface PickerModel {
  /** Every tab's badge (§5.3 widens this to a live match count once the filter is tab-scoped). */
  readonly counts: Readonly<Record<PickerTab, number>>;
  readonly branchesLocal: PickerList<RefRow>;
  readonly branchesRemote: PickerList<RefRow>;
  readonly tags: PickerList<RefRow>;
  readonly stashStack: PickerList<StashEntry>;
  readonly stashGlobal: PickerList<StashEntry>;
  readonly worktrees: PickerList<WorktreeEntry>;
  readonly stacks: PickerList<PickerStackGroup>;
  readonly orphans: PickerList<StackBranch>;
  /** The active tab's rows in DOM order, for §7.3's roving focus — shape chosen to feed
   *  `enabledNeighbour` directly. Every other tab's own lists above are returned empty (the body
   *  renders one tab; folding the other four would be work nothing reads). */
  readonly rowIds: readonly { id: string; disabled: boolean }[];
}

function emptyList<T>(): PickerList<T> {
  return { visible: [], hiddenCount: 0 };
}

/** `WorktreeList.vue`'s own row identity text — shared here so a later filter pass (§5.1's "the
 *  text the row already renders as its identity") matches exactly what the row shows.
 *  `WorktreeList.vue` imports this rather than keeping a second copy. */
export function worktreeLabel(entry: WorktreeEntry): string {
  if (entry.branch) return entry.branch.replace(/^refs\/heads\//, '');
  if (entry.isDetached && entry.head) return `detached @ ${entry.head.slice(0, 7)}`;
  return entry.isBare ? 'bare' : 'unknown';
}

function groupStacks(stacks: readonly StackSummary[]): PickerStackGroup[] {
  return stacks.map((summary) => ({ summary, branches: summary.branches }));
}

export function buildPickerModel(
  input: PickerInput,
  filter: string,
  tab: PickerTab,
  capSteps: Readonly<Partial<Record<PickerListKey, number>>>,
): PickerModel {
  const capFor = (key: PickerListKey): number => capSteps[key] ?? REF_LIST_SECTION_CAP;

  // Today's filter scope (§2 N2): the one box matches branches/remote/tags only, everywhere,
  // regardless of which tab is active — stash/worktree/stack are never touched by it yet.
  const filteredLocal = filterRefs(input.branches, filter);
  const filteredRemote = filterRefs(input.remoteBranches, filter);
  const filteredTags = filterRefs(input.tags, filter);

  const counts: Record<PickerTab, number> = {
    branches: filteredLocal.length + filteredRemote.length,
    tags: filteredTags.length,
    stashes: input.stashes.length + input.globalStashes.length,
    worktrees: input.worktrees.length,
    stacks: input.stacks.reduce((n, s) => n + s.branches.length, 0) + input.orphans.length,
  };

  const base: Omit<PickerModel, 'rowIds'> = {
    counts,
    branchesLocal: emptyList(),
    branchesRemote: emptyList(),
    tags: emptyList(),
    stashStack: emptyList(),
    stashGlobal: emptyList(),
    worktrees: emptyList(),
    stacks: emptyList(),
    orphans: emptyList(),
  };

  if (tab === 'branches') {
    const branchesLocal = capItems(sortByName(filteredLocal), capFor('branchesLocal'));
    const branchesRemote = capItems(sortByName(filteredRemote), capFor('branchesRemote'));
    return {
      ...base,
      branchesLocal,
      branchesRemote,
      rowIds: [
        ...branchesLocal.visible.map((r) => ({ id: `branch:${r.refname}`, disabled: false })),
        ...branchesRemote.visible.map((r) => ({ id: `remote:${r.refname}`, disabled: false })),
      ],
    };
  }

  if (tab === 'tags') {
    const tags = capItems(sortTags(filteredTags), capFor('tags'));
    return {
      ...base,
      tags,
      rowIds: tags.visible.map((r) => ({ id: `tag:${r.refname}`, disabled: false })),
    };
  }

  if (tab === 'stashes') {
    const stashStack = capItems(input.stashes, capFor('stashStack'));
    const stashGlobal = capItems(input.globalStashes, capFor('stashGlobal'));
    return {
      ...base,
      stashStack,
      stashGlobal,
      rowIds: [
        ...stashStack.visible.map((e) => ({ id: `stash:${e.sha}`, disabled: false })),
        ...stashGlobal.visible.map((e) => ({ id: `global:${e.sha}`, disabled: false })),
      ],
    };
  }

  if (tab === 'worktrees') {
    const worktrees = capItems(input.worktrees, capFor('worktrees'));
    return {
      ...base,
      worktrees,
      rowIds: worktrees.visible.map((w) => ({ id: `worktree:${w.path}`, disabled: false })),
    };
  }

  // tab === 'stacks'
  const groups = groupStacks(input.stacks);
  const stacks = capItems(groups, capFor('stacks'));
  const orphans = capItems(input.orphans, capFor('stacks'));
  return {
    ...base,
    stacks,
    orphans,
    rowIds: [
      ...stacks.visible.flatMap((g) =>
        g.branches.map((b) => ({ id: `stack:${b.name}`, disabled: false })),
      ),
      ...orphans.visible.map((o) => ({ id: `orphan:${o.name}`, disabled: false })),
    ],
  };
}
