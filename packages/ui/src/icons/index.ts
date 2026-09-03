/** Mapping of actions to codicon class names (§3.4). Grows as components gain actions. */
export const ACTION_ICONS = {
  refresh: "codicon-refresh",
  search: "codicon-search",
} as const;

export type IconAction = keyof typeof ACTION_ICONS;

/** Mapping of `refBadges.ts`'s badge kinds to codicon class names (P4 W7, §6.2's table) — kept
 *  separate from `ACTION_ICONS` because these decorate a `DecorationRef` kind, not an action. */
export const BADGE_ICONS = {
  localBranch: "codicon-git-branch",
  remoteBranch: "codicon-cloud",
  tag: "codicon-tag",
  stash: "codicon-archive",
} as const;
