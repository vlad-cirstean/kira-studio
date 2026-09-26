import type { VariantProps } from 'class-variance-authority';
import { cva } from 'class-variance-authority';

export { default as Badge } from './Badge.vue';

// P110 B22: one shape (h-control-sm, rounded-kira-sm, gap-1) replaces primitives.css's
// `.p-badge`/`.p-chip` (+ its `.warn/.err/.ok/.info` tone modifiers)/`.p-count` trio -- colour
// only varies per variant now. `chip` is the untoned `.p-chip` case (method/status hosts that
// carry their own colour via a sibling class, or a chip with no status yet).
// `count` keeps `.p-count`'s own pill shape (disclosed: text swaps #f0f0f0 -> text-fg, P110 §1.4).
export const badgeVariants = cva(
  'inline-flex h-control-sm shrink-0 items-center gap-1 whitespace-nowrap font-data text-kira-sm [&>svg]:pointer-events-none [&>svg]:size-3',
  {
    variants: {
      variant: {
        default: 'rounded-kira-sm px-1 bg-field text-muted-foreground',
        chip: 'rounded-kira-sm px-1',
        warn: 'rounded-kira-sm px-1 bg-warn/16 text-warn',
        err: 'rounded-kira-sm px-1 bg-error/16 text-error',
        ok: 'rounded-kira-sm px-1 bg-ok/14 text-ok',
        info: 'rounded-kira-sm px-1 bg-info/16 text-info',
        count: 'min-w-control-sm justify-center rounded-kira-pill px-1.5 bg-badge text-fg',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export type BadgeVariants = VariantProps<typeof badgeVariants>;
