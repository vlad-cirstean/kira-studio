// P1 D5: the mode seam. A tab's mode is a total function of its kind (TAB_KIND_MODE, tabs.ts) —
// there is no mode column, no migration, and switching mode writes nothing.
export type AppMode = 'studio' | 'http' | 'git';
