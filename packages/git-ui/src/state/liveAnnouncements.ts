/**
 * `docs/plans/P4.md` W14's "one polite live region" — pure text composition for the two events it
 * announces (Load-more's own doc comment in `LoadMoreButton.vue` names both: "the Load-more result
 * ... and Refresh completion"). Kept separate from `App.vue`, which only owns *when* to set the
 * region's text (watching `GraphViewState.loading`'s transitions back to `"idle"`), so the exact
 * wording is unit-testable on its own, the same split `rowAccessibility.ts` makes for a row's
 * accessible name.
 */
const COUNT_FORMATTER = new Intl.NumberFormat();

/** `LoadMoreButton.vue`'s own `fmt` helper, duplicated rather than imported: that one is a private
 *  detail of a `.vue` SFC's `<script setup>` block, not an exported function, and both call sites
 *  want the same "grouped thousands" formatting the plan's own example ("5,000 more loaded,
 *  122,400 remaining") shows. */
export function formatCount(count: number): string {
  return COUNT_FORMATTER.format(count);
}

/** The plan's own worked example, generalized: "N more loaded, M remaining" — or, once the
 *  history is fully loaded, "N more loaded, history fully loaded" rather than "0 remaining",
 *  which reads as if nothing happened. */
export function composeLoadMoreAnnouncement(
  added: number,
  remaining: number,
  exhausted: boolean,
): string {
  const addedText = `${formatCount(added)} more loaded`;
  return exhausted
    ? `${addedText}, history fully loaded`
    : `${addedText}, ${formatCount(remaining)} remaining`;
}

/** §6.2's refresh action, completed: a keyboard user who cannot see the toolbar spinner stop has
 *  no other way to learn a refresh finished (or how many commits it re-walked). */
export function composeRefreshAnnouncement(totalLoaded: number): string {
  const noun = totalLoaded === 1 ? 'commit' : 'commits';
  return `Refreshed — ${formatCount(totalLoaded)} ${noun} loaded`;
}
