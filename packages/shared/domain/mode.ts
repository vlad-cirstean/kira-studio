// P1 D5: the mode seam. A tab's mode is a total function of its kind (TAB_KIND_MODE, tabs.ts) —
// there is no mode column, no migration, and switching mode writes nothing.
//
// P12 D2: 'http' → 'api' — nothing persists this value (F3), so the rename costs one sed and no
// migration.
export type AppMode = 'studio' | 'api';
