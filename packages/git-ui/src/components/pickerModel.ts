/**
 * P77 §9: `BranchPicker.vue`'s tab fold — one filter box (§5), a per-tab ordering/pin/cap pass
 * (§6), and the row-id list §7.3's roving keyboard focus walks. Kept beside `refListModel.ts`/
 * `stashListModel.ts`/`stackListModel.ts` as the same "pure fold out of the template" convention
 * those three already follow — no Vue, no bridge, so `pickerModel.test.ts` exercises it directly
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
import type { RefRow, StackBranch, StackSummary, StashEntry, WorktreeEntry } from '@kira/git-ipc';
import { capItems, filterRefs, REF_LIST_SECTION_CAP, sortTags } from './refListModel.ts';
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
  return b.committerDate - a.committerDate || a.shortName.localeCompare(b.shortName);
}

/** §6.1/§6.2: HEAD first, then a branch checked out in another worktree, then everything else by
 *  recency — closing N3/N4. `pinned` is handed to `capWithPins` so the cap floor never drops a
 *  pinned row. */
function orderLocalBranches(rows: readonly RefRow[]): { rows: RefRow[]; pinned: number } {
  const isPinned = (r: RefRow) => r.isHead || r.checkedOutIn !== undefined;
  const pinned = rows
    .filter(isPinned)
    .sort((a, b) => Number(b.isHead) - Number(a.isHead) || a.shortName.localeCompare(b.shortName));
  const rest = rows.filter((r) => !isPinned(r)).sort(byRecencyThenName);
  return { rows: [...pinned, ...rest], pinned: pinned.length };
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
  return [...entries].sort((a, b) => b.timestamp - a.timestamp);
}

/** §6.1: current, then main, then the rest by path — today's order is whatever `worktree.list`
 *  returned. */
function orderWorktrees(entries: readonly WorktreeEntry[]): WorktreeEntry[] {
  const byPath = (a: WorktreeEntry, b: WorktreeEntry) => a.path.localeCompare(b.path);
  const current = entries.filter((e) => e.isCurrent).sort(byPath);
  const main = entries.filter((e) => !e.isCurrent && e.isMain).sort(byPath);
  const rest = entries.filter((e) => !e.isCurrent && !e.isMain).sort(byPath);
  return [...current, ...main, ...rest];
}

/** `capItems` with a floor: a pinned row is never capped out, and never duplicated — the rows are
 *  already ordered pinned-first, so one slice does both (§6.2). */
function capWithPins<T>(rows: readonly T[], pinned: number, cap: number): PickerList<T> {
  const limit = Math.max(cap, pinned);
  if (rows.length <= limit) return { visible: rows, hiddenCount: 0 };
  return { visible: rows.slice(0, limit), hiddenCount: rows.length - limit };
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

/** The cheap half: only orders/caps the active tab's already-filtered rows — depends on
 *  `(filtered, tab, capSteps)`, so a tab switch or a "show more" click never touches the other
 *  four tabs' lists. */
export function orderAndCapTab(
  filtered: FilteredPicker,
  tab: PickerTab,
  capSteps: Readonly<Partial<Record<PickerListKey, number>>>,
): PickerModel {
  const capFor = (key: PickerListKey): number => capSteps[key] ?? REF_LIST_SECTION_CAP;

  const base: Omit<PickerModel, 'rowIds'> = {
    counts: filtered.counts,
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
    const { rows: orderedLocal, pinned } = orderLocalBranches(filtered.local);
    const branchesLocal = capWithPins(orderedLocal, pinned, capFor('branchesLocal'));
    const branchesRemote = capItems(orderRemoteBranches(filtered.remote), capFor('branchesRemote'));
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
    const tags = capItems(sortTags(filtered.tags), capFor('tags'));
    return {
      ...base,
      tags,
      rowIds: tags.visible.map((r) => ({ id: `tag:${r.refname}`, disabled: false })),
    };
  }

  if (tab === 'stashes') {
    const stashStack = capItems(orderStashStack(filtered.stashStack), capFor('stashStack'));
    const stashGlobal = capItems(orderGlobalStash(filtered.stashGlobal), capFor('stashGlobal'));
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
    const worktrees = capItems(orderWorktrees(filtered.worktrees), capFor('worktrees'));
    return {
      ...base,
      worktrees,
      rowIds: worktrees.visible.map((w) => ({ id: `worktree:${w.path}`, disabled: false })),
    };
  }

  // tab === 'stacks'
  const stacks = capItems(filtered.stackGroups, capFor('stacks'));
  const orphans = capItems(filtered.orphans, capFor('stacks'));
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

/** Composes the two halves above — the one entry point `pickerModel.test.ts` exercises with plain
 *  fixtures. `BranchPicker.vue` calls `filterPickerInput`/`orderAndCapTab` directly instead, as two
 *  separate computeds, so a tab switch or "show more" click recomputes only the cheap half. */
export function buildPickerModel(
  input: PickerInput,
  filter: string,
  tab: PickerTab,
  capSteps: Readonly<Partial<Record<PickerListKey, number>>>,
): PickerModel {
  return orderAndCapTab(filterPickerInput(input, filter), tab, capSteps);
}
