import type { VariantProps } from 'class-variance-authority';
import { cva } from 'class-variance-authority';

export { default as Empty } from './Empty.vue';
export { default as EmptyContent } from './EmptyContent.vue';
export { default as EmptyDescription } from './EmptyDescription.vue';
export { default as EmptyHeader } from './EmptyHeader.vue';
export { default as EmptyMedia } from './EmptyMedia.vue';
export { default as EmptyTitle } from './EmptyTitle.vue';

// P110 I2-10/11: the registry default carries its own `mb-2` -- dropped here. `Empty`'s own
// `gap-2` already spaces every direct child (icon/title/description) uniformly; keeping `mb-2`
// too would double that gap between the icon and whatever follows it, which the pre-phase
// `.empty-state` (gap-only, no icon-specific margin) never had.
export const emptyMediaVariants = cva(
  'flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'text-subtle',
        icon: 'bg-muted text-foreground flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg:not([class*=size-])]:size-4',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export type EmptyMediaVariants = VariantProps<typeof emptyMediaVariants>;
