/**
 * P77 §9: `BranchPicker.vue`'s tab fold — one filter box (§5), a per-tab ordering/pin/cap pass
 * (§6), and the row-id list §7.3's roving keyboard focus walks. Kept beside `refListModel.ts`/
 * `stashListModel.ts`/`stackListModel.ts` as the same "pure fold out of the template" convention
 * those three already follow — no Vue, no bridge, so `pickerModel.spec.ts` exercises it directly
 * with plain fixtures.
 *
 * `refListModel.ts` is NOT modified: `buildRefListSections` has two other consumers
 * (`review/BaseSelector.vue`, `review/ReviewView.vue`) whose own sort must not silently change to
 * recency. This module reuses that file's `filterRefs`/`sortTags`/`capItems`/`REF_LIST_SECTION_CAP`
 * and owns the picker-specific ordering itself.
 *
 * P77 §18.1 commit 1: every list gained a real cap here (`REF_LIST_SECTION_CAP`), including the
 * two — worktrees, stacks — that had none before (part of N1's fix, since `WorktreeList.vue`/
 * `StackList.vue` move to the same pre-capped `section`-prop contract `TagList.vue` already has).
 *
 * P77 §18.1 commit 2 (§5): the one filter box now scopes to the active tab — stash/worktree/stack
 * are matched against the same text their own row already renders as its identity (§5.1's table),
 * closing N2 for the four lists the box never reached. Every tab's `counts` badge is a live match
 * count once the query is non-empty (§5.3), computed with that tab's own field scope regardless of
 * which tab is active — so typing on one tab still hints a match sitting on another.
 *
 * P77 §18.1 commit 3 (§6): local branches rank HEAD, then worktree-checked-out rows, then
 * `committerDate` descending (ties by name) — closing N3/N4. Remote branches and the global stash
 * bucket rank by recency alone (no pin step: neither can ever BE the current branch). Tags, the
 * stash stack and Stacks keep their existing order (§6.1's own reasons: a version sequence, a
 * stack-position addressing scheme, and a forest whose order IS its structure, respectively).
 * `capWithPins`/`capStackGroups` never cap a pinned row out and never split a stack group mid-order
 * (§6.2's "pin before cap"); `capSteps` (threaded from `BranchPicker.vue`, §6.3) lets a caller raise
 * one list's own cap for the current panel-open without touching any other list's.
 */
import { orderWorktrees, worktreeLabel } from '@kira/git-core';
import type { RefRow, StackBranch, StackSummary, StashEntry, WorktreeEntry } from '@kira/git-ipc';
import { compareNatural, matchesQuery } from '@workbench/behaviour/match';
import { filterRefs, sortTags } from './refListModel.ts';
import { stashLabel } from './stashListModel.ts';

export type PickerTab = 'branches' | 'tags' | 'stashes' | 'worktrees' | 'stacks';

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

/** `WorktreeList.vue`'s own row identity text — `@kira/git-core`'s `worktreeLabel` (T1-24; also
 *  Space's `repo/state/worktrees.ts`), re-exported here so `WorktreeList.vue` need not import
 *  from two packages. */
export { worktreeLabel };

function groupStacks(stacks: readonly StackSummary[]): PickerStackGroup[] {
  return stacks.map((summary) => ({ summary, branches: summary.branches }));
}

/** §5.1/§5.2: case-insensitive substring, not fuzzy — the same rule `filterRefs`/`filterFiles`
 *  already apply to this module family. `needle` is pre-trimmed/lowered by the caller once per
 *  call rather than per row. */
function matchesText(haystack: string, needle: string): boolean {
  return matchesQuery(haystack, needle);
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
    const baseMatches = matchesText(group.summary.base, needle);
    const branches = group.branches.filter((b) => baseMatches || matchesText(b.name, needle));
    if (branches.length > 0) filtered.push({ summary: group.summary, branches });
  }
  return filtered;
}

function filterOrphans(orphans: readonly StackBranch[], needle: string): StackBranch[] {
  if (needle === '') return [...orphans];
  return orphans.filter((o) => matchesText(o.name, needle));
}

/** §6.1's shared comparator for every ref list ranked by recency: `committerDate` descending,
 *  ties by name — used for local branches' own unpinned tail and for remote branches outright
 *  (a remote-tracking ref can never be HEAD or `checkedOutIn`, so it never has a pin step). */
function byRecencyThenName(a: RefRow, b: RefRow): number {
  return b.committerDate - a.committerDate || compareNatural(a.shortName, b.shortName);
}

/** §6.1/§6.2: HEAD first, then a branch checked out in another worktree, then everything else by
 *  recency — closing N3/N4. Pinned rows lead, so a cap over the ordered list never drops one. */
function orderLocalBranches(rows: readonly RefRow[]): RefRow[] {
  const isPinned = (r: RefRow) => r.isHead || r.checkedOutIn !== undefined;
  const pinned = rows
    .filter(isPinned)
    .sort(
      (a, b) => Number(b.isHead) - Number(a.isHead) || compareNatural(a.shortName, b.shortName),
    );
  const rest = rows.filter((r) => !isPinned(r)).sort(byRecencyThenName);
  return [...pinned, ...rest];
}

function orderRemoteBranches(rows: readonly RefRow[]): RefRow[] {
  return [...rows].sort(byRecencyThenName);
}

/** §6.1: the stack's own index — `stash@{0}` is already newest, and the index is the addressing
 *  scheme Pop/Drop use — kept explicit rather than assumed, since a filtered/reordered array must
 *  not silently drift from it. */
function orderStashStack(entries: readonly StashEntry[]): StashEntry[] {
  return [...entries].sort((a, b) => a.index - b.index);
}

/** §6.1: the global bucket has no stack position at all, so recency is what is left. */
function orderGlobalStash(entries: readonly StashEntry[]): StashEntry[] {
  return [...entries].sort((a, b) => b.timestamp - a.timestamp || compareNatural(a.sha, b.sha));
}

/** The expensive half of the fold (§5.1's filter, plus §5.3's cross-tab counts) — depends only on
 *  `(input, filter)`, never on `activeTab`/`capSteps`. P79: split out of `buildPickerModel` so
 *  clicking a different tab or "show more" (which only ever changes ordering/capping below) does
 *  not re-lowercase/re-filter every one of the eight lists on a repo with thousands of rows. */
export interface FilteredPicker {
  readonly counts: Readonly<Record<PickerTab, number>>;
  readonly local: readonly RefRow[];
  readonly remote: readonly RefRow[];
  readonly tags: readonly RefRow[];
  readonly stashStack: readonly StashEntry[];
  readonly stashGlobal: readonly StashEntry[];
  readonly worktrees: readonly WorktreeEntry[];
  readonly stackGroups: readonly PickerStackGroup[];
  readonly orphans: readonly StackBranch[];
}

export function filterPickerInput(input: PickerInput, filter: string): FilteredPicker {
  const needle = filter.trim().toLowerCase();

  // §5.1: the one box now scopes to each tab's own field — every tab's filtered set is computed
  // here (not only the active tab's) since §5.3's cross-tab counts need every tab's match count on
  // every call.
  const local = filterRefs(input.branches, filter);
  const remote = filterRefs(input.remoteBranches, filter);
  const tags = filterRefs(input.tags, filter);
  const stashStack = filterStashes(input.stashes, needle);
  const stashGlobal = filterStashes(input.globalStashes, needle);
  const worktrees = filterWorktrees(input.worktrees, needle);
  const stackGroups = filterStackGroups(groupStacks(input.stacks), needle);
  const orphans = filterOrphans(input.orphans, needle);

  const counts: Record<PickerTab, number> = {
    branches: local.length + remote.length,
    tags: tags.length,
    stashes: stashStack.length + stashGlobal.length,
    worktrees: worktrees.length,
    // P79: entries (a stack group counts as one, same as an orphan), not branches summed across
    // groups — `capItems`/`StackList.vue`'s own "Show N more" both already count entries, so the
    // badge now agrees with what's capped and what's reported hidden instead of mixing units.
    stacks: stackGroups.length + orphans.length,
  };

  return { counts, local, remote, tags, stashStack, stashGlobal, worktrees, stackGroups, orphans };
}

/** One tab's ordered, uncapped lists (every other tab's lists are empty — the body renders one
 *  tab). `BranchPicker.vue` caps each list with `useCappedList`. */
export interface OrderedPicker {
  readonly branchesLocal: readonly RefRow[];
  readonly branchesRemote: readonly RefRow[];
  readonly tags: readonly RefRow[];
  readonly stashStack: readonly StashEntry[];
  readonly stashGlobal: readonly StashEntry[];
  readonly worktrees: readonly WorktreeEntry[];
  readonly stacks: readonly PickerStackGroup[];
  readonly orphans: readonly StackBranch[];
}

/** The cheap half: only orders the active tab's already-filtered rows — depends on
 *  `(filtered, tab)`, so a tab switch never touches the other four tabs' lists. */
export function orderTab(filtered: FilteredPicker, tab: PickerTab): OrderedPicker {
  const base: OrderedPicker = {
    branchesLocal: [],
    branchesRemote: [],
    tags: [],
    stashStack: [],
    stashGlobal: [],
    worktrees: [],
    stacks: [],
    orphans: [],
  };
  switch (tab) {
    case 'branches':
      return {
        ...base,
        branchesLocal: orderLocalBranches(filtered.local),
        branchesRemote: orderRemoteBranches(filtered.remote),
      };
    case 'tags':
      return { ...base, tags: sortTags(filtered.tags) };
    case 'stashes':
      return {
        ...base,
        stashStack: orderStashStack(filtered.stashStack),
        stashGlobal: orderGlobalStash(filtered.stashGlobal),
      };
    case 'worktrees':
      return { ...base, worktrees: orderWorktrees(filtered.worktrees) };
    case 'stacks':
      return { ...base, stacks: filtered.stackGroups, orphans: filtered.orphans };
  }
}

/** The visible rows in DOM order, for §7.3's roving focus — shape chosen to feed
 *  `enabledNeighbour` directly. Takes the capped lists, since only rendered rows can take focus. */
export function pickerRowIds(
  tab: PickerTab,
  visible: OrderedPicker,
): { id: string; disabled: boolean }[] {
  const row = (id: string) => ({ id, disabled: false });
  switch (tab) {
    case 'branches':
      return [
        ...visible.branchesLocal.map((r) => row(`branch:${r.refname}`)),
        ...visible.branchesRemote.map((r) => row(`remote:${r.refname}`)),
      ];
    case 'tags':
      return visible.tags.map((r) => row(`tag:${r.refname}`));
    case 'stashes':
      return [
        ...visible.stashStack.map((e) => row(`stash:${e.sha}`)),
        ...visible.stashGlobal.map((e) => row(`global:${e.sha}`)),
      ];
    case 'worktrees':
      return visible.worktrees.map((w) => row(`worktree:${w.path}`));
    case 'stacks':
      return [
        ...visible.stacks.flatMap((g) => g.branches.map((b) => row(`stack:${b.name}`))),
        ...visible.orphans.map((o) => row(`orphan:${o.name}`)),
      ];
  }
}
