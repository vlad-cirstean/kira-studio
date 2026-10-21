/**
 * The pure half of `BranchPicker.vue`/`TagList.vue` — the filter (one box,
 * matching across all three sections), the per-section sort, the "N more" cap, and the small
 * per-row facts (`formatTrack`, the remote-checkout label) neither component should recompute on
 * its own. Follows `fileTreeModel.ts`/`columns.ts`'s precedent of splitting the pure fold from the
 * DOM-touching renderer.
 */
import type { RefRow, RefTrack } from '@kira/git-ipc';
import { t } from '@theme/i18n';
import { compareNatural, matchesQuery } from '@workbench/behaviour/match';

/** §7.8's own rule reused verbatim (`fileTreeModel.ts`'s `filterFiles`): case-insensitive
 *  substring over the display name, not fuzzy, not regex. An empty (or all-whitespace) filter
 *  matches everything. */
export function filterRefs(rows: readonly RefRow[], filter: string): RefRow[] {
  return rows.filter((row) => matchesQuery(row.shortName, filter));
}

function sortByName(rows: readonly RefRow[]): RefRow[] {
  return [...rows].sort((a, b) => compareNatural(a.shortName, b.shortName));
}

/** §7.9: tags sort `v10` after `v9` (`compareNatural` is numeric). */
export function sortTags(rows: readonly RefRow[]): RefRow[] {
  return sortByName(rows);
}

/** The picker's own "N more" cap, kept well under the file tree's 500-row page — a repo with more local
 *  branches or tags than this is filtering, not scrolling, through the picker (§6.3's narrow-panel
 *  budget applies here even harder than to the file tree). */
export const REF_LIST_SECTION_CAP = 50;

export interface RefListSection {
  readonly visible: readonly RefRow[];
  readonly hiddenCount: number;
}

/** The generic half of `capSection` below — split out so `StashList.vue` gets the same
 *  "N more" cap over `StashEntry[]` (an already-ordered stack, never filtered or re-sorted) without
 *  a second list implementation. `capSection` itself is kept as the thin `RefRow`-typed wrapper
 *  every existing caller (`BranchPicker.vue`,
 *  `TagList.vue`) already uses, unchanged. */
export function capItems<T>(
  items: readonly T[],
  cap: number = REF_LIST_SECTION_CAP,
): { readonly visible: readonly T[]; readonly hiddenCount: number } {
  if (items.length <= cap) return { visible: items, hiddenCount: 0 };
  return { visible: items.slice(0, cap), hiddenCount: items.length - cap };
}

function capSection(rows: readonly RefRow[], cap: number = REF_LIST_SECTION_CAP): RefListSection {
  return capItems(rows, cap);
}

export interface RefListSections {
  readonly branches: RefListSection;
  readonly remoteBranches: RefListSection;
  readonly tags: RefListSection;
}

export interface RefListInput {
  readonly branches: readonly RefRow[];
  readonly remoteBranches: readonly RefRow[];
  readonly tags: readonly RefRow[];
}

/** The whole fold: filter (one box, all three sections), sort (name for branches/remotes,
 *  version-aware for tags), cap. `BranchPicker.vue`/`TagList.vue` render this and nothing else. */
export function buildRefListSections(refs: RefListInput, filter: string): RefListSections {
  return {
    branches: capSection(sortByName(filterRefs(refs.branches, filter))),
    remoteBranches: capSection(sortByName(filterRefs(refs.remoteBranches, filter))),
    tags: capSection(sortTags(filterRefs(refs.tags, filter))),
  };
}

/** A branch row's ahead/behind badge text, or `undefined` when there is nothing worth a badge
 *  (no upstream, or an up-to-date one — §6.2 shows the count only when it is non-zero). `"gone"`
 *  (the upstream branch was deleted) is its own, un-counted case. */
export function formatTrack(track: RefTrack | 'gone' | undefined): string | undefined {
  if (track === undefined) return undefined;
  if (track === 'gone') return 'gone';
  const parts: string[] = [];
  if (track.ahead > 0) parts.push(`↑${track.ahead}`);
  if (track.behind > 0) parts.push(`↓${track.behind}`);
  return parts.length > 0 ? parts.join(' ') : undefined;
}

/** `origin/feature` → `feature` — the local name a remote branch's tracking branch would take,
 *  used both to decide `remoteCheckoutLabel`'s wording and as the `branch` argument the checkout
 *  op itself resolves server-side (`RepoService.runOp`'s own `localNameForRemoteBranch`, which
 *  this mirrors so the label the user reads matches the branch git creates). */
export function localNameForRemoteBranch(remoteShortName: string): string {
  const slash = remoteShortName.indexOf('/');
  return slash === -1 ? remoteShortName : remoteShortName.slice(slash + 1);
}

/** Probe P7's DWIM, stated rather than left silent (W13's own text): checking out a remote branch
 *  either switches to the local branch of the same name (already exists) or creates one tracking
 *  it (does not) — the label says which, before the click, not after. */
export function remoteCheckoutLabel(remoteRow: RefRow, branches: readonly RefRow[]): string {
  const localName = localNameForRemoteBranch(remoteRow.shortName);
  const hasLocal = branches.some((row) => row.shortName === localName);
  return hasLocal
    ? t('git.picker.switchTo.label', { name: localName })
    : t('git.picker.createTracking.label', { name: remoteRow.shortName });
}

/** The `op.run`/`preflight.checkout` `target` string a remote branch row's row-level checkout
 *  should send — `RepoService`'s own `resolveCheckoutTarget` looks the target up in
 *  `branches` *before* `remoteBranches` ("a same-named local branch wins"), so
 *  sending the remote ref's own name when a local counterpart already exists would silently miss
 *  it and fall through to the tracking-creation path instead. Naming the local branch directly
 *  when it exists is what makes `remoteCheckoutLabel`'s "Switch to …" wording true, not merely a
 *  hopeful guess. */
export function remoteCheckoutTarget(remoteRow: RefRow, branches: readonly RefRow[]): string {
  const localName = localNameForRemoteBranch(remoteRow.shortName);
  const hasLocal = branches.some((row) => row.shortName === localName);
  return hasLocal ? localName : remoteRow.shortName;
}
