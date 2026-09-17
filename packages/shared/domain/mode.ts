// P1 D5: the mode seam. A tab's mode is a total function of its kind (TAB_KIND_MODE, tabs.ts) —
// there is no mode column, no migration, and switching mode writes nothing.
//
// P12 D2: 'http' → 'api' — nothing persists this value (F3), so the rename costs one sed and no
// migration.
//
// P67b §4.1: 'git' — the third top-level module, beside 'studio' and 'api'. Every repo workspace
// (workspace.ts's `repo:${string}`) lives inside it; moduleOfWorkspace names the mapping.
//
// P91 §2: 'terminal' — a fourth peer module, plugged into the same registry git itself took in
// P67b. No workspace beyond the bare 'terminal' key exists inside it (§4's own conclusion).
export type AppMode = 'studio' | 'api' | 'git' | 'terminal';
