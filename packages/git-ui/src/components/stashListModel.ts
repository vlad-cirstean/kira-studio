/**
 * G28 D5/D13: `StashList.vue`'s pure half, mirroring `refListModel.ts`'s own "no component
 * touches this logic un-tested" convention. Everything here is a plain function over a
 * `StashEntry` (and, for `originLabel`/`applyMenuLabel`, the currently checked-out branch) — no
 * Vue, no bridge, no reactivity, so `stashListModel.test.ts` exercises it directly with plain
 * fixtures.
 */
import type { StashEntry } from '@kira/git-ipc';

/** `AutoStashMessagePrefix`'s own TS-side literal (`gitops.AutoStashMessagePrefix`, Go) — kept as
 *  a plain string constant rather than crossing the wire: the marker is a message PREFIX, not a
 *  field, and `isAutoStash`/`stashLabel` below are the only two readers. */
const AUTO_STASH_PREFIX = 'auto-stash: ';

/** git's own reflog-subject framing (probe P3/D1): `"WIP on <b>: "` (the default push message) or
 *  `"On <b>: "` (an explicit `-m`, including G28's own auto-stash message and every
 *  `globalStashSave` label). `stashLabel` strips whichever prefix matched so the row shows the
 *  user's own text, not git's own framing — today `StashList.vue` renders the raw `message` field
 *  verbatim, which is why every manual stash reads `"On main: my label"` instead of just
 *  `"my label"`. A message with NEITHER prefix (a `stash store`-restored entry, porcelain probe 9)
 *  passes through unchanged — there is no framing to strip. */
export function stashLabel(entry: StashEntry): string {
  for (const prefix of ['WIP on ', 'On ']) {
    if (!entry.message.startsWith(prefix)) continue;
    const rest = entry.message.slice(prefix.length);
    const colonSpace = rest.indexOf(': ');
    if (colonSpace < 0) continue;
    // A label that itself contains ": " must round-trip whole — colonSpace is the FIRST
    // occurrence, which is exactly the boundary git's own subject line uses (the branch name
    // itself can never contain ": ", a git refname grammar guarantee), so everything after it,
    // including any further ": " the user typed, is the label.
    return rest.slice(colonSpace + 2);
  }
  return entry.message;
}

/** D1's own deliberate marker: an auto-stashed entry's message always starts with
 *  `AutoStashMessagePrefix` AFTER git's own "On &lt;branch&gt;: " framing is stripped — checked
 *  against the STRIPPED label (`stashLabel`), not the raw message, since the marker is meant to be
 *  the user-visible text's own prefix, not a coincidental substring of the branch name. A user
 *  could type this by hand; the only consequence is a cosmetic "auto" badge, never a behavior
 *  change — nothing in this app branches on it beyond this one badge predicate. */
export function isAutoStash(entry: StashEntry): boolean {
  return stashLabel(entry).startsWith(AUTO_STASH_PREFIX);
}

/** `undefined` when the entry's own origin branch IS the current branch (or the entry has no
 *  origin branch at all — a detached-HEAD stash, `entry.branch === null`) — the row then renders
 *  no chip, exactly matching today's un-chipped appearance for the common case. Otherwise the
 *  origin branch name, which is what turns the row into a visibly CROSS-branch one (D5). A
 *  detached `currentBranch` (the checkout state carries no branch name at all) can never equal any
 *  real branch name, so every entry with a real origin renders its chip in that state — correct:
 *  there is no "same branch" to suppress it for. */
export function originLabel(
  entry: StashEntry,
  currentBranch: string | null | undefined,
): string | undefined {
  if (entry.branch === null) return undefined;
  if (entry.branch === currentBranch) return undefined;
  return entry.branch;
}

/** `"Apply"` for a same-branch (or origin-less) entry, `"Apply here (from `<origin>`)"` for a
 *  cross-branch one — the row menu's own label (D5), read directly by `buildStashMenu`/
 *  `buildGlobalStashMenu` rather than re-deriving `originLabel` a second time at the call site. */
export function applyMenuLabel(
  entry: StashEntry,
  currentBranch: string | null | undefined,
): string {
  const origin = originLabel(entry, currentBranch);
  return origin === undefined ? 'Apply' : `Apply here (from ${origin})`;
}

/** One global-bucket row's own display fields, computed once per render rather than re-derived by
 *  `GlobalStashList.vue` at three separate template expressions — `label` reuses `stashLabel`,
 *  `auto` reuses `isAutoStash`, `origin` is `entry.branch` verbatim (a global entry ALWAYS shows
 *  its origin chip, unlike a stack row — D13: the whole point of the bucket's own section is that
 *  every entry in it came from *some* branch, possibly the current one, and the chip is how the
 *  user tells them apart at a glance without opening each one). */
export interface GlobalStashRowModel {
  readonly label: string;
  readonly auto: boolean;
  readonly origin: string | undefined;
}

export function globalRowModel(entry: StashEntry): GlobalStashRowModel {
  return { label: stashLabel(entry), auto: isAutoStash(entry), origin: entry.branch ?? undefined };
}
