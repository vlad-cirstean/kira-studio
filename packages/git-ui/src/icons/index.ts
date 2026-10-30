/** Mapping of actions to codicon names (§3.4). Grows as components gain actions. */
export const ACTION_ICONS = {
  refresh: 'refresh',
  search: 'search',
  copy: 'copy',
  chevronRight: 'chevron-right',
  back: 'chevron-left',
  renameArrow: 'arrow-small-right',
  // G12 D16: the review sidebar's icon-only toggles.
  commits: 'git-commit',
  files: 'files',
  listTree: 'list-tree',
  listFlat: 'list-flat',
  diffSingle: 'diff',
  diffMultiple: 'diff-multiple',
  // G13 D16: the Comments pane's own toggle icon and its two header actions.
  comments: 'comment-discussion',
  remove: 'trash',
  clearAll: 'clear-all',
  // G19 D5: the review compare header's base/branch swap button.
  swap: 'arrow-swap',
} as const;

export type IconAction = keyof typeof ACTION_ICONS;

/** Mapping of `refBadges.ts`'s badge kinds to codicon names (P4 W7, §6.2's table) — kept
 *  separate from `ACTION_ICONS` because these decorate a `DecorationRef` kind, not an action. */
export const BADGE_ICONS = {
  localBranch: 'git-branch',
  remoteBranch: 'cloud',
  tag: 'tag',
  stash: 'archive',
} as const;

/** Icons for `NoRepositoryPanel.vue`, `RefsPopover.vue` and the P4 W10 "no graph" panels — kept
 *  separate from `ACTION_ICONS` for the same reason `BADGE_ICONS` is: these decorate a surface,
 *  not an action a click performs. */
export const STATE_ICONS = {
  repo: 'repo',
  chevronDown: 'chevron-down',
  openFolder: 'folder-opened',
  warning: 'warning',
  commit: 'git-commit',
} as const;

/** P77 §4's tab strip — kept separate from `ACTION_ICONS` for the same reason `BADGE_ICONS`/
 *  `STATE_ICONS` are: these decorate a `RefsPopover.vue` tab, not an action a click performs. */
export const PICKER_TAB_ICONS = {
  branches: 'git-branch',
  tags: 'tag',
  stashes: 'archive',
  worktrees: 'multiple-windows',
  stacks: 'list-tree',
} as const;
