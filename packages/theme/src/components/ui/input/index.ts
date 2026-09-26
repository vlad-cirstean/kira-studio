import type { VariantProps } from 'class-variance-authority';
import { cva } from 'class-variance-authority';

export { default as Input } from '@theme/components/ui/input/Input.vue';

// P117 A2: a size axis, NativeSelect's and Button's own cva shape. `default` is Input.vue's
// pre-existing stock string verbatim, so every caller passing no size renders byte-identical --
// same rule P110 B25 used adding InputGroup's own kira variant. `kira`/`kira-lg` are the app's
// control-scale tokens, for a caller that renders inside 22px/28px chrome instead of shadcn's
// stock 32px.
export const inputVariants = cva(
  'dark:bg-border-strong/30 border-border-strong focus-visible:border-focus aria-invalid:ring-error/20 dark:aria-invalid:ring-error/40 aria-invalid:border-error dark:aria-invalid:border-error/50 disabled:bg-border-strong/50 dark:disabled:bg-border-strong/80 rounded-kira border bg-transparent transition-colors text-kira-md file:h-6 file:text-kira-md file:font-medium aria-invalid:ring-3 w-full min-w-0 file:inline-flex file:border-0 file:bg-transparent file:text-fg placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      size: {
        default: 'h-8 px-2.5 py-1',
        kira: 'h-control px-2 py-0',
        'kira-lg': 'h-control-lg px-2 py-0',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  },
);

export type InputVariants = VariantProps<typeof inputVariants>;
