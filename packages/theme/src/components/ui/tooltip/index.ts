import type { VariantProps } from 'class-variance-authority';
import { cva } from 'class-variance-authority';

export { default as Tooltip } from '@theme/components/ui/tooltip/Tooltip.vue';
export { default as TooltipContent } from '@theme/components/ui/tooltip/TooltipContent.vue';
export { default as TooltipDisabledTrigger } from '@theme/components/ui/tooltip/TooltipDisabledTrigger.vue';
export { default as TooltipProvider } from '@theme/components/ui/tooltip/TooltipProvider.vue';
export { default as TooltipTrigger } from '@theme/components/ui/tooltip/TooltipTrigger.vue';

// `default`: inverted ground for plain text. `surface`: popover ground for rich content that uses
// the ADE tones, which are dark-only and unreadable on the inverted ground.
export const tooltipContentVariants = cva(
  'data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 pointer-events-none z-(--kira-z-tooltip) text-kira-md break-words origin-(--reka-tooltip-content-transform-origin)',
  {
    variants: {
      variant: {
        default:
          'inline-flex items-center gap-1.5 rounded-kira-sm px-3 py-1.5 has-data-[slot=kbd]:pr-1.5 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-1 **:data-[slot=kbd]:rounded-kira-xs **:data-[slot=kbd]:border-transparent **:data-[slot=kbd]:bg-bg/15 **:data-[slot=kbd]:text-bg **:data-[chip=branch]:bg-bg/15 **:data-[chip=branch]:text-bg bg-fg text-bg w-fit max-w-xs whitespace-pre-line',
        surface:
          'flex w-80 max-w-(--reka-tooltip-content-available-width) flex-col items-stretch gap-1.5 rounded-kira bg-elevated p-2 text-fg ring-1 ring-fg/10',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export type TooltipContentVariants = VariantProps<typeof tooltipContentVariants>;
