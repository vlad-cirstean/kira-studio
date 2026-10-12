const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** The fields the order reads; a `WorktreeEntry` satisfies it structurally. */
export interface OrderableWorktree {
  readonly path: string;
  readonly isCurrent: boolean;
  readonly isMain: boolean;
}

/** Current worktree first, then the main one, then the rest; each group by natural path order. */
export function orderWorktrees<T extends OrderableWorktree>(entries: readonly T[]): T[] {
  const byPath = (a: T, b: T): number => collator.compare(a.path, b.path);
  const current = entries.filter((e) => e.isCurrent).sort(byPath);
  const main = entries.filter((e) => !e.isCurrent && e.isMain).sort(byPath);
  const rest = entries.filter((e) => !e.isCurrent && !e.isMain).sort(byPath);
  return [...current, ...main, ...rest];
}
