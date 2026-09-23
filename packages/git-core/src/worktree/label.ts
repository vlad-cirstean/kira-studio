/**
 * A structural, not imported, copy of `@kira/git-ipc`'s own `WorktreeEntry` shape (B3 — core and
 * ipc both depend on nothing, so neither imports the other) narrowed to the fields this label
 * needs. Every real `WorktreeEntry` already satisfies this shape, so both call sites pass their
 * own `WorktreeEntry` straight through with no cast.
 */
export interface WorktreeLabelInput {
  readonly branch: string | null;
  readonly isDetached: boolean;
  readonly head: string | null;
  readonly isBare: boolean;
}

/** The row identity text `WorktreeList.vue`'s own picker row and Space's worktree switcher both
 *  render — shared so a filter pass matches exactly what the row shows. */
export function worktreeLabel(entry: WorktreeLabelInput): string {
  if (entry.branch) return entry.branch.replace(/^refs\/heads\//, '');
  if (entry.isDetached && entry.head) return `detached @ ${entry.head.slice(0, 7)}`;
  return entry.isBare ? 'bare' : 'unknown';
}
