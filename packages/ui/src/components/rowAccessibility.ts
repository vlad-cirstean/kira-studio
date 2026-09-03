/**
 * `docs/plans/P4.md` W14: pure text-composition for a row's accessible name — kept DOM-free and
 * out of `CommitGrid.vue` so the exact wording is unit-testable directly, the same split
 * `refBadges.ts` already makes between `badgeSpecFor`/`planBadges` (pure) and its own DOM
 * builders. `CommitGrid.vue`'s `onRendered` handler calls `composeRowLabel` once per rendered row
 * and sets the result as that row element's `aria-label` — see its own doc comment for why the
 * name must live on the row rather than be assembled by a screen reader from the cell soup.
 */
import type { CommitRecord, DecorationRef } from "@kira-version/core";
import { badgeSpecFor } from "./refBadges.ts";

/** One decoration, in words — reuses `badgeSpecFor`'s own `text` (the same string a sighted user
 *  reads off the badge) so the visible and announced names of a ref can never disagree. Prefixed
 *  by its kind: a bare name ("main") read out of context is ambiguous between a branch and a tag
 *  in a way the badge's own shape/icon already disambiguates visually. */
export function describeDecoration(ref: DecorationRef): string {
  const name = badgeSpecFor(ref).text;
  switch (ref.kind) {
    case "branch":
      return ref.isHead ? `current branch ${name}` : `branch ${name}`;
    case "remoteBranch":
      return `remote branch ${name}`;
    case "tag":
      return `tag ${name}`;
    case "stash":
      return "stash";
    case "head":
      return "HEAD";
  }
}

/**
 * A row's whole accessible name — "subject, author, relative date, refs" (the plan's own list).
 * `dateText` is passed in rather than recomputed here so the announced date always matches
 * whichever of relative/absolute the date column is currently showing (`dateFormatter`'s own
 * `ctx`, `CommitGrid.vue`'s `dateFormatRef`) — this function has no clock or format preference of
 * its own, matching `dateFormatter`'s own split between "what to show" and "how to compute it".
 * A row with no decorations omits that segment entirely rather than reading "no refs" aloud for
 * the overwhelming majority of ordinary commits.
 */
export function composeRowLabel(commit: CommitRecord, dateText: string): string {
  const parts = [commit.subject, commit.author.name, dateText];
  if (commit.decoration.length > 0)
    parts.push(commit.decoration.map(describeDecoration).join(", "));
  return parts.join(", ");
}
