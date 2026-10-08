import { DEFAULT_PALETTE_SIZE } from '@kira/git-core';
import { badgeVariants } from '@theme/components/ui/badge/variants';
import { cn } from '@theme/lib/utils';

// P131 Part 2 §3.4: graph-scale height and the kind-colour border; font size stays in
// CommitGrid.vue's `.kv-badge` rule (check_font_scale rejects an arbitrary text size on
// unprefixed markup). Theme's own `cn` here, not git-ui's: every token below is unprefixed.
const REF_BADGE_CLASS = cn(
  badgeVariants({ variant: 'chip' }),
  'kv-badge h-(--kv-h-xs) leading-(--kv-h-xs) border-2 border-transparent font-[inherit] text-(color:--kv-badge-fg) appearance-none m-0',
);

// Border colour per badge kind. Every entry is a full literal: Tailwind emits only scanned strings.
export const BADGE_KIND_CLASS = {
  local: 'border-(color:--kv-badge-local-bg)',
  remote: 'border-(color:--kv-badge-remote-fg)',
  // `kv-badge-tag` stays as a marker: graph-columns.spec.ts selects it.
  tag: 'kv-badge-tag border-(color:--kv-badge-tag-fg)',
  stash: 'border-(color:--kv-badge-stash-border)',
  overflow: 'border-(color:--kv-panel-border)',
} as const;

export const BADGE_STACKED_CLASS = 'border-(color:--kv-badge-branch-stacked-border)';

// Eight entries, matching DEFAULT_PALETTE_SIZE and vscode-tokens.css's generated `.kv-lane-N` range.
const LANE_BORDER_CLASS = [
  'border-(color:--kv-graph-lane-0)',
  'border-(color:--kv-graph-lane-1)',
  'border-(color:--kv-graph-lane-2)',
  'border-(color:--kv-graph-lane-3)',
  'border-(color:--kv-graph-lane-4)',
  'border-(color:--kv-graph-lane-5)',
  'border-(color:--kv-graph-lane-6)',
  'border-(color:--kv-graph-lane-7)',
] as const;

export function laneBorderClass(colorIndex: number): string {
  return LANE_BORDER_CLASS[colorIndex % DEFAULT_PALETTE_SIZE] ?? '';
}

// Keyed by string: CommitMeta and BranchPicker carry the state as a plain string.
const PR_BADGE_CLASS: Record<string, string> = {
  open: 'border-(color:--kv-badge-pr-open-fg)',
  draft: 'border-(color:--kv-badge-pr-draft-fg)',
  merged: 'border-(color:--kv-badge-pr-merged-fg)',
  closed: 'border-(color:--kv-badge-pr-closed-fg)',
};

/** `kv-badge-pr` stays as a marker: tests and `CommitGrid.vue`'s click delegation read it. */
export function prBadgeClass(state: string, clickable = false): string {
  return refBadgeClass(
    'kv-badge-pr no-underline',
    PR_BADGE_CLASS[state] ?? '',
    clickable ? 'cursor-pointer' : '',
  );
}

export function refBadgeClass(...extra: string[]): string {
  return cn(REF_BADGE_CLASS, ...extra);
}
