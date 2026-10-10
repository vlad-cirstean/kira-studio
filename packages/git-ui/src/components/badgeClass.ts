import { DEFAULT_PALETTE_SIZE } from '@kira/git-core';
import { badgeVariants } from '@theme/components/ui/badge/variants';
import { cn } from '@theme/lib/utils';

// P131 Part 2 §3.4: graph-scale height, kind-colour border and (P229) 15% tint fill; font size
// stays in CommitGrid.vue's `.kv-badge` rule (check_font_scale rejects an arbitrary text size on
// unprefixed markup). Theme's own `cn` here, not git-ui's: every token below is unprefixed.
const REF_BADGE_CLASS = cn(
  badgeVariants({ variant: 'chip' }),
  'kv-badge h-(--kv-h-xs) leading-(--kv-h-xs) border border-transparent font-normal text-(color:--kv-badge-fg) appearance-none m-0',
);

// Border colour per badge kind. Every entry is a full literal: Tailwind emits only scanned strings.
export const BADGE_KIND_CLASS = {
  local: 'border-(color:--kv-badge-local-bg) bg-(color:--kv-badge-local-bg)/15',
  remote: 'border-(color:--kv-badge-remote-fg) bg-(color:--kv-badge-remote-fg)/15',
  // `kv-badge-tag` stays as a marker: graph-columns.spec.ts selects it.
  tag: 'kv-badge-tag border-(color:--kv-badge-tag-fg) bg-(color:--kv-badge-tag-fg)/15',
  stash: 'border-(color:--kv-badge-stash-border) bg-(color:--kv-badge-stash-border)/15',
  overflow: 'border-(color:--kv-panel-border)',
} as const;

export const BADGE_STACKED_CLASS =
  'border-(color:--kv-badge-branch-stacked-border) bg-(color:--kv-badge-branch-stacked-border)/15';

// Eight entries, matching DEFAULT_PALETTE_SIZE and vscode-tokens.css's generated `.kv-lane-N` range.
const LANE_BORDER_CLASS = [
  'border-(color:--kv-graph-lane-0) bg-(color:--kv-graph-lane-0)/15',
  'border-(color:--kv-graph-lane-1) bg-(color:--kv-graph-lane-1)/15',
  'border-(color:--kv-graph-lane-2) bg-(color:--kv-graph-lane-2)/15',
  'border-(color:--kv-graph-lane-3) bg-(color:--kv-graph-lane-3)/15',
  'border-(color:--kv-graph-lane-4) bg-(color:--kv-graph-lane-4)/15',
  'border-(color:--kv-graph-lane-5) bg-(color:--kv-graph-lane-5)/15',
  'border-(color:--kv-graph-lane-6) bg-(color:--kv-graph-lane-6)/15',
  'border-(color:--kv-graph-lane-7) bg-(color:--kv-graph-lane-7)/15',
] as const;

export function laneBorderClass(colorIndex: number): string {
  return LANE_BORDER_CLASS[colorIndex % DEFAULT_PALETTE_SIZE] ?? '';
}

// Keyed by string: CommitMeta and BranchPicker carry the state as a plain string.
const PR_BADGE_CLASS: Record<string, string> = {
  open: 'border-(color:--kv-badge-pr-open-fg) bg-(color:--kv-badge-pr-open-fg)/15',
  draft: 'border-(color:--kv-badge-pr-draft-fg) bg-(color:--kv-badge-pr-draft-fg)/15',
  merged: 'border-(color:--kv-badge-pr-merged-fg) bg-(color:--kv-badge-pr-merged-fg)/15',
  closed: 'border-(color:--kv-badge-pr-closed-fg) bg-(color:--kv-badge-pr-closed-fg)/15',
};

/** `kv-badge-pr` stays as a marker: tests and `CommitGrid.vue`'s click delegation read it. */
export function prBadgeClass(state: string): string {
  return refBadgeClass('kv-badge-pr no-underline', PR_BADGE_CLASS[state] ?? '', 'cursor-pointer');
}

export function refBadgeClass(...extra: string[]): string {
  return cn(REF_BADGE_CLASS, ...extra);
}
