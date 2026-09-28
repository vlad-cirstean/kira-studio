import { badgeVariants } from '@theme/components/ui/badge/variants';
import { cn } from '@theme/lib/utils';

// P131 Part 2 §3.4: graph-scale height and the kind-colour border; font size stays in
// CommitGrid.vue's `.kv-badge` rule (check_font_scale rejects an arbitrary text size on
// unprefixed markup). Theme's own `cn` here, not git-ui's: every token below is unprefixed.
export const REF_BADGE_CLASS = cn(
  badgeVariants({ variant: 'chip' }),
  'kv-badge h-(--kv-h-xs) leading-(--kv-h-xs) border-2 border-transparent font-[inherit] text-(color:--kv-badge-fg) appearance-none m-0',
);

export function refBadgeClass(...extra: string[]): string {
  return cn(REF_BADGE_CLASS, ...extra);
}
