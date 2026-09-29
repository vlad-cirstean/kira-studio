import { LATER, type QueueView } from './useQueue';

// P136: the main timeline shows the top MY_WORK_LIMIT stacks of "my work" while collapsed. Pure
// presentation: `useQueue` still computes every band, hour and status over all items.
export const MY_WORK_LIMIT = 5;

export interface MyWorkCap {
  /** Stack roots shown while collapsed. */
  visibleRoots: ReadonlySet<string>;
  /** Member ids of those stacks. */
  visibleItems: ReadonlySet<string>;
  /** Stacks hidden while collapsed. */
  hiddenCount: number;
}

interface Ranked {
  root: string;
  merged: boolean;
  day: number;
  index: number;
}

/** Ranks non-parked, non-dependency stacks: unmerged first, earliest day first (an overdue day is
 *  negative, `LATER` sorts last), then merge order. Keeps the top five plus every dependency
 *  blocking a kept item. */
export function myWorkCap(view: Pick<QueueView, 'stacks' | 'segments' | 'items'>): MyWorkCap {
  const firstSegment = new Map<string, { day: number; index: number }>();
  view.segments.forEach((seg, index) => {
    const seen = firstSegment.get(seg.stackRoot);
    if (!seen || seg.day < seen.day)
      firstSegment.set(seg.stackRoot, { day: seg.day, index: seen?.index ?? index });
  });
  const mergedById = new Map(view.items.map((i) => [i.id, i.merged] as const));

  const ranked: Ranked[] = view.stacks
    .filter((s) => !s.parked && !s.dependency)
    .map((s) => ({
      root: s.root,
      merged: s.members.every((m) => mergedById.get(m.id) === true),
      day: firstSegment.get(s.root)?.day ?? LATER,
      index: firstSegment.get(s.root)?.index ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((a, b) => Number(a.merged) - Number(b.merged) || a.day - b.day || a.index - b.index);

  const visibleRoots = new Set(ranked.slice(0, MY_WORK_LIMIT).map((r) => r.root));
  const membersOf = new Map(view.stacks.map((s) => [s.root, s.members.map((m) => m.id)] as const));
  const visibleItems = new Set<string>();
  for (const root of visibleRoots) for (const id of membersOf.get(root) ?? []) visibleItems.add(id);

  const blockerIds = new Set<string>();
  for (const item of view.items) {
    if (visibleItems.has(item.id)) for (const b of item.blockers) blockerIds.add(b.id);
  }
  for (const s of view.stacks) {
    if (s.dependency && blockerIds.has(s.root)) {
      visibleRoots.add(s.root);
      visibleItems.add(s.root);
    }
  }
  return { visibleRoots, visibleItems, hiddenCount: view.stacks.length - visibleRoots.size };
}
