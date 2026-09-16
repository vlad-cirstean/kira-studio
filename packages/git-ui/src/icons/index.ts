/** Mapping of actions to codicon class names (§3.4). Grows as components gain actions. */
export const ACTION_ICONS = {
  refresh: 'codicon-refresh',
  search: 'codicon-search',
  copy: 'codicon-copy',
  chevronRight: 'codicon-chevron-right',
  back: 'codicon-chevron-left',
  renameArrow: 'codicon-arrow-small-right',
  // G12 D16: the review sidebar's icon-only toggles.
  commits: 'codicon-git-commit',
  files: 'codicon-files',
  listTree: 'codicon-list-tree',
  listFlat: 'codicon-list-flat',
  diffSingle: 'codicon-diff',
  diffMultiple: 'codicon-diff-multiple',
  // G13 D16: the Comments pane's own toggle icon and its two header actions.
  comments: 'codicon-comment-discussion',
  remove: 'codicon-trash',
  clearAll: 'codicon-clear-all',
  // G19 D5: the review compare header's base/branch swap button.
  swap: 'codicon-arrow-swap',
} as const;

export type IconAction = keyof typeof ACTION_ICONS;

/** Mapping of `refBadges.ts`'s badge kinds to codicon class names (P4 W7, §6.2's table) — kept
 *  separate from `ACTION_ICONS` because these decorate a `DecorationRef` kind, not an action. */
export const BADGE_ICONS = {
  localBranch: 'codicon-git-branch',
  remoteBranch: 'codicon-cloud',
  tag: 'codicon-tag',
  stash: 'codicon-archive',
} as const;

/** Icons for `NoRepositoryPanel.vue`, `BranchPicker.vue` and the P4 W10 "no graph" panels — kept
 *  separate from `ACTION_ICONS` for the same reason `BADGE_ICONS` is: these decorate a surface,
 *  not an action a click performs. */
export const STATE_ICONS = {
  repo: 'codicon-repo',
  chevronDown: 'codicon-chevron-down',
  openFolder: 'codicon-folder-opened',
  warning: 'codicon-warning',
  commit: 'codicon-git-commit',
} as const;

/** P77 §4's tab strip — kept separate from `ACTION_ICONS` for the same reason `BADGE_ICONS`/
 *  `STATE_ICONS` are: these decorate a `BranchPicker.vue` tab, not an action a click performs. */
export const PICKER_TAB_ICONS = {
  branches: 'codicon-git-branch',
  tags: 'codicon-tag',
  stashes: 'codicon-archive',
  worktrees: 'codicon-multiple-windows',
  stacks: 'codicon-list-tree',
} as const;
