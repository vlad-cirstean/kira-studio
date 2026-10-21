// The mode seam. A tab's mode is a total function of its kind (TAB_KIND_MODE, tabs.ts) —
// there is no mode column, no migration, and switching mode writes nothing.
//
// Nothing persists this value, so a rename costs one sed and no migration.
//
// 'git' (and every repo workspace it hosted, WorkspaceKey's own `repo:${string}`) moved to
// apps/kira-space wholesale — this app has no git module of its own any more, so WorkspaceKey
// (packages/shared/domain/workspace.ts) collapsed back into this type outright (deleted, not just
// trimmed): with no repo-prefixed workspace ever occurring here again, "which workspace" and
// "which mode" are the same one-dimensional question.
export type AppMode = 'studio' | 'api' | 'automations' | 'docker';
