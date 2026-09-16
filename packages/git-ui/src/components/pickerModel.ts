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
 * P77 §18.1 commit 1: every list gained a real cap here (`REF_LIST_SECTION_CAP`), including the
 * two — worktrees, stacks — that had none before (part of N1's fix, since `WorktreeList.vue`/
 * `StackList.vue` move to the same pre-capped `section`-prop contract `TagList.vue` already has).
 *
 * P77 §18.1 commit 2 (§5): the one filter box now scopes to the active tab — stash/worktree/stack
 * are matched against the same text their own row already renders as its identity (§5.1's table),
 * closing N2 for the four lists the box never reached. Every tab's `counts` badge is a live match
 * count once the query is non-empty (§5.3), computed with that tab's own field scope regardless of
 * which tab is active — so typing on one tab still hints a match sitting on another. §6 lands the
 * recency/pin ordering fix on top of this in a later commit.
 */
import type { RefRow, StackBranch, StackSummary, StashEntry, WorktreeEntry } from '@kira/git-ipc';
import {
  capItems,
  filterRefs,
  REF_LIST_SECTION_CAP,
  sortByName,
  sortTags,
} from './refListModel.ts';
import { stashLabel } from './stashListModel.ts';

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

/** §5.1/§5.2: case-insensitive substring, not fuzzy — the same rule `filterRefs`/`filterFiles`
 *  already apply to this module family. `needle` is pre-trimmed/lowered by the caller once per
 *  call rather than per row. */
function matchesText(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle);
}

function filterStashes(entries: readonly StashEntry[], needle: string): StashEntry[] {
  if (needle === '') return [...entries];
  return entries.filter(
    (e) =>
      matchesText(stashLabel(e), needle) || (e.branch !== null && matchesText(e.branch, needle)),
  );
}

function filterWorktrees(entries: readonly WorktreeEntry[], needle: string): WorktreeEntry[] {
  if (needle === '') return [...entries];
  return entries.filter(
    (w) => matchesText(worktreeLabel(w), needle) || matchesText(w.path, needle),
  );
}

/** Stacks tab (§5.1): a branch matches by its own name or its stack's `base`; a group with no
 *  matching branch is dropped entirely rather than shown empty-bodied. */
function filterStackGroups(
  groups: readonly PickerStackGroup[],
  needle: string,
): PickerStackGroup[] {
  if (needle === '') return [...groups];
  const filtered: PickerStackGroup[] = [];
  for (const group of groups) {
    const branches = group.branches.filter(
      (b) => matchesText(b.name, needle) || matchesText(group.summary.base, needle),
    );
    if (branches.length > 0) filtered.push({ summary: group.summary, branches });
  }
  return filtered;
}

function filterOrphans(orphans: readonly StackBranch[], needle: string): StackBranch[] {
  if (needle === '') return [...orphans];
  return orphans.filter((o) => matchesText(o.name, needle));
}

export function buildPickerModel(
  input: PickerInput,
  filter: string,
  tab: PickerTab,
  capSteps: Readonly<Partial<Record<PickerListKey, number>>>,
): PickerModel {
  const capFor = (key: PickerListKey): number => capSteps[key] ?? REF_LIST_SECTION_CAP;
  const needle = filter.trim().toLowerCase();

  // §5.1: the one box now scopes to each tab's own field — every tab's filtered set is computed
  // here (not only the active tab's) since §5.3's cross-tab counts need every tab's match count on
  // every call.
  const filteredLocal = filterRefs(input.branches, filter);
  const filteredRemote = filterRefs(input.remoteBranches, filter);
  const filteredTags = filterRefs(input.tags, filter);
  const filteredStashStack = filterStashes(input.stashes, needle);
  const filteredStashGlobal = filterStashes(input.globalStashes, needle);
  const filteredWorktrees = filterWorktrees(input.worktrees, needle);
  const filteredStackGroups = filterStackGroups(groupStacks(input.stacks), needle);
  const filteredOrphans = filterOrphans(input.orphans, needle);

  const counts: Record<PickerTab, number> = {
    branches: filteredLocal.length + filteredRemote.length,
    tags: filteredTags.length,
    stashes: filteredStashStack.length + filteredStashGlobal.length,
    worktrees: filteredWorktrees.length,
    stacks: filteredStackGroups.reduce((n, g) => n + g.branches.length, 0) + filteredOrphans.length,
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
    const stashStack = capItems(filteredStashStack, capFor('stashStack'));
    const stashGlobal = capItems(filteredStashGlobal, capFor('stashGlobal'));
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
    const worktrees = capItems(filteredWorktrees, capFor('worktrees'));
    return {
      ...base,
      worktrees,
      rowIds: worktrees.visible.map((w) => ({ id: `worktree:${w.path}`, disabled: false })),
    };
  }

  // tab === 'stacks'
  const stacks = capItems(filteredStackGroups, capFor('stacks'));
  const orphans = capItems(filteredOrphans, capFor('stacks'));
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
