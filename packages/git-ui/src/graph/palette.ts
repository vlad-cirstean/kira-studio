/**
 * `docs/plans/P4.md` W8: this file exports only *which class* a lane gets, never a colour value.
 * The lane colours are `--color-graph-lane-N` in `theme/git.css`; SVG reads them through the
 * `stroke-`/`fill-` utilities below, so a theme change reaches the graph with no JavaScript.
 */
import { DEFAULT_PALETTE_SIZE } from '@kira/git-core';

// Every entry is a full literal: Tailwind emits only scanned strings. `kv-lane-N` is a DOM marker.
const LANE_CLASS = [
  'kv-lane-0 stroke-graph-lane-0 fill-graph-lane-0',
  'kv-lane-1 stroke-graph-lane-1 fill-graph-lane-1',
  'kv-lane-2 stroke-graph-lane-2 fill-graph-lane-2',
  'kv-lane-3 stroke-graph-lane-3 fill-graph-lane-3',
  'kv-lane-4 stroke-graph-lane-4 fill-graph-lane-4',
  'kv-lane-5 stroke-graph-lane-5 fill-graph-lane-5',
  'kv-lane-6 stroke-graph-lane-6 fill-graph-lane-6',
  'kv-lane-7 stroke-graph-lane-7 fill-graph-lane-7',
] as const;

/** Wraps modulo the palette size: a colour index past the palette reuses an earlier lane. */
export function laneClass(colorIndex: number, paletteSize: number = DEFAULT_PALETTE_SIZE): string {
  return LANE_CLASS[colorIndex % paletteSize] ?? '';
}

/** The four shapes `rowSvg.ts` draws (§7.6/W8's table, plus P93 §6.1): ordinary, merge (more than
 *  one parent), stash (a `stash` decoration on the row), collapsed (a P93 branch-group
 *  placeholder — `graphColumn.ts`'s `readSlice` sets this directly from `RowPlanEntry.kind`,
 *  never from `nodeKindFor` below, since a placeholder has no single commit's parent count or
 *  decorations to read). */
export type NodeKind = 'commit' | 'merge' | 'stash' | 'collapsed';

/**
 * Stash takes precedence over merge when a row is both — which a real stash commit always is (it
 * has two parents by construction: the index tree and the working tree), so without this
 * precedence every stash row would render as an ordinary merge, the one place it would disagree
 * with the badge (`refBadges.ts`, W7) and the row's own italic subject (`columns.ts`) about
 * whether this is a stash. `decorationAt` stays the single source either way — this function only
 * orders the two checks that already read it and `parentsOf`.
 */
export function nodeKindFor(parentCount: number, isStash: boolean): NodeKind {
  if (isStash) return 'stash';
  return parentCount > 1 ? 'merge' : 'commit';
}
