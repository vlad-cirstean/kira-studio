// P1 D5: the mode seam. A tab's mode is a total function of its kind (TAB_KIND_MODE, tabs.ts) —
// there is no mode column, no migration, and switching mode writes nothing.
//
// P12 D2: 'http' → 'api' — nothing persists this value (F3), so the rename costs one sed and no
// migration.
//
// P67b §4.1: 'git' joined here as the third top-level module, beside 'studio' and 'api'.
//
// P91 §2: 'terminal' — a fourth peer module, plugged into the same registry git itself took in
// P67b (§4's own conclusion).
//
// P100 Part 2: 'git' (and every repo workspace it hosted, WorkspaceKey's own `repo:${string}`)
// moved to apps/kira-space wholesale — this app has no git module of its own any more, so
// WorkspaceKey (packages/shared/domain/workspace.ts) collapsed back into this type outright
// (deleted, not just trimmed): with no repo-prefixed workspace ever occurring here again, "which
// workspace" and "which mode" are the same one-dimensional question they were before C5 ever
// introduced the distinction.
export type AppMode = 'studio' | 'api' | 'terminal';
