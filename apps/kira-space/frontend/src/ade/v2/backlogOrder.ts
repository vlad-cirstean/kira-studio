import type { BacklogResult } from './wire';

/** The backlog with `id` moved to `toIndex`, as the backend's Move leaves it. Unknown ids leave it as is. */
export function withMovedItem(
  result: BacklogResult,
  args: { id: string; toIndex: number },
): BacklogResult {
  const items = [...result.items];
  const from = items.findIndex((i) => i.id === args.id);
  if (from < 0) return result;
  const [moved] = items.splice(from, 1);
  if (moved) items.splice(args.toIndex, 0, moved);
  return { items };
}
