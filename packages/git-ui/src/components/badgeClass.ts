import { badgeVariants } from '@theme/components/ui/badge/variants';
import { cn } from '@theme/lib/utils';

export type RefBadgeVariant = 'default' | 'ok' | 'info' | 'warn' | 'err' | 'chip';

// Studio Badge tones; only height and font follow Settings > Git graph font size.
export function refBadgeClass(variant: RefBadgeVariant = 'default', ...extra: string[]): string {
  return cn(badgeVariants({ variant }), 'h-graph-h-xs text-graph-sm', ...extra);
}

// Keyed by string: CommitMeta and BranchPicker carry the state as a plain string.
const PR_BADGE_VARIANT: Record<string, RefBadgeVariant> = {
  open: 'ok',
  draft: 'default',
  closed: 'err',
};

/** `refBadges.ts` marks the graph PR badge with `data-testid`. */
export function prBadgeClass(state: string): string {
  const base = 'no-underline cursor-pointer';
  if (state === 'merged') return refBadgeClass('chip', base, 'bg-conn-violet/16 text-conn-violet');
  return refBadgeClass(PR_BADGE_VARIANT[state] ?? 'default', base);
}
