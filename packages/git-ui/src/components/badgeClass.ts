import { DEFAULT_PALETTE_SIZE } from '@kira/git-core';
import { badgeVariants } from '@theme/components/ui/badge/variants';
import { cn } from '@theme/lib/utils';

// Graph-scale height and font, kind-colour border and 15% tint fill.
const REF_BADGE_CLASS = cn(
  badgeVariants({ variant: 'chip' }),
  'kv-badge h-graph-h-xs leading-(--kira-graph-h-xs) text-graph-sm border border-transparent font-normal text-fg appearance-none',
);

// Border colour per badge kind. Every entry is a full literal: Tailwind emits only scanned strings.
export const BADGE_KIND_CLASS = {
  local: 'border-ok bg-ok/15',
  remote: 'border-info bg-info/15',
  // `kv-badge-tag` stays as a marker: graph-columns.spec.ts selects it.
  tag: 'kv-badge-tag border-ok bg-ok/15',
  stash: 'border-muted-foreground bg-muted-foreground/15',
  overflow: 'border-border',
} as const;

export const BADGE_STACKED_CLASS = 'border-info bg-info/15';

// Eight entries, matching DEFAULT_PALETTE_SIZE and git.css's `--color-graph-lane-N` range.
const LANE_BORDER_CLASS = [
  'border-graph-lane-0 bg-graph-lane-0/15',
  'border-graph-lane-1 bg-graph-lane-1/15',
  'border-graph-lane-2 bg-graph-lane-2/15',
  'border-graph-lane-3 bg-graph-lane-3/15',
  'border-graph-lane-4 bg-graph-lane-4/15',
  'border-graph-lane-5 bg-graph-lane-5/15',
  'border-graph-lane-6 bg-graph-lane-6/15',
  'border-graph-lane-7 bg-graph-lane-7/15',
] as const;

export function laneBorderClass(colorIndex: number): string {
  return LANE_BORDER_CLASS[colorIndex % DEFAULT_PALETTE_SIZE] ?? '';
}

// Keyed by string: CommitMeta and BranchPicker carry the state as a plain string.
const PR_BADGE_CLASS: Record<string, string> = {
  open: 'border-ok bg-ok/15',
  draft: 'border-muted-foreground bg-muted-foreground/15',
  merged: 'border-git-merged bg-git-merged/15',
  closed: 'border-error bg-error/15',
};

/** `kv-badge-pr` stays as a marker: tests and `CommitGrid.vue`'s click delegation read it. */
export function prBadgeClass(state: string): string {
  return refBadgeClass('kv-badge-pr no-underline', PR_BADGE_CLASS[state] ?? '', 'cursor-pointer');
}

export function refBadgeClass(...extra: string[]): string {
  return cn(REF_BADGE_CLASS, ...extra);
}
