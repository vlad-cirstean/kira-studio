import type { VariantProps } from 'class-variance-authority';
import { cva } from 'class-variance-authority';

export { default as Input } from '@theme/components/ui/input/Input.vue';

// P117 A2: a size axis. `kira-lg` (26px, default) is the dialog/form density, `kira` (22px) the
// toolbar density.
export const inputVariants = cva(
  'border-border-strong focus-visible:border-focus aria-invalid:ring-error/20 dark:aria-invalid:ring-error/40 aria-invalid:border-error dark:aria-invalid:border-error/50 disabled:bg-border-strong/50 dark:disabled:bg-border-strong/80 rounded-kira-sm border bg-field transition-colors text-kira-md file:h-6 file:text-kira-md file:font-medium aria-invalid:ring-3 w-full min-w-0 file:inline-flex file:border-0 file:bg-transparent file:text-fg placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      size: {
        kira: 'h-control px-2 py-0',
        'kira-lg': 'h-control-lg px-2 py-0',
      },
    },
    defaultVariants: {
      size: 'kira-lg',
    },
  },
);

export type InputVariants = VariantProps<typeof inputVariants>;
