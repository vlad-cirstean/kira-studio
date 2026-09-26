import type { ButtonVariants } from '@theme/components/ui/button';
import type { VariantProps } from 'class-variance-authority';
import { cva } from 'class-variance-authority';
import type { HTMLAttributes } from 'vue';

export { default as InputGroup } from '@theme/components/ui/input-group/InputGroup.vue';
export { default as InputGroupAddon } from '@theme/components/ui/input-group/InputGroupAddon.vue';
export { default as InputGroupButton } from '@theme/components/ui/input-group/InputGroupButton.vue';
export { default as InputGroupInput } from '@theme/components/ui/input-group/InputGroupInput.vue';
export { default as InputGroupText } from '@theme/components/ui/input-group/InputGroupText.vue';
export { default as InputGroupTextarea } from '@theme/components/ui/input-group/InputGroupTextarea.vue';

export const inputGroupAddonVariants = cva(
  'text-muted-foreground h-auto gap-2 py-1.5 text-sm font-medium group-data-[disabled=true]/input-group:opacity-50 [&>kbd]:rounded-[calc(var(--kira-radius)-5px)] [&>svg:not([class*=size-])]:size-4 flex cursor-text items-center justify-center select-none',
  {
    variants: {
      align: {
        'inline-start': 'pl-2 has-[>button]:ml-[-0.3rem] has-[>kbd]:ml-[-0.15rem] order-first',
        'inline-end': 'pr-2 has-[>button]:mr-[-0.3rem] has-[>kbd]:mr-[-0.15rem] order-last',
        'block-start':
          'px-2.5 pt-2 group-has-[>input]/input-group:pt-2 [.border-b]:pb-2 order-first w-full justify-start',
        'block-end':
          'px-2.5 pb-2 group-has-[>input]/input-group:pb-2 [.border-t]:pt-2 order-last w-full justify-start',
      },
    },
    defaultVariants: {
      align: 'inline-start',
    },
  },
);

export type InputGroupVariants = VariantProps<typeof inputGroupAddonVariants>;

// P110 B25: the box (root <fieldset>) itself. `default` is shadcn-vue's own registry string,
// verbatim -- untouched, so every existing InputGroup consumer (the P104-era number-stepper
// migration) renders byte-identical. `kira` is primitives.css's retired `.p-input` box translated
// to Tailwind: height/gap/padding/radius/border/background/text tokens per the P110 plan's own
// mapping table, `focus-within:` for the old `:focus-within` ring, `aria-invalid:` (a generic
// Tailwind functional variant, not a fixed list -- compiles to `&[aria-invalid="true"]` for any
// name) replacing the old `.is-invalid` class toggle. `min-w-0`: fieldset's own UA min-content
// sizing quirk, same reason the `default` variant already carries it. `.is-grow`'s own height/
// line-height/padding-block math stays live, unlayered CSS in primitives.css (B31 residue) --
// unlayered beats this layered utility, so `h-control` here is a no-op once `.is-grow` also
// applies, by design.
export const inputGroupVariants = cva('', {
  variants: {
    variant: {
      default:
        'm-0 min-w-0 border-border-strong dark:bg-border-strong/30 has-[[data-slot=input-group-control]:focus-visible]:border-focus has-[[data-slot=input-group-control]:focus-visible]:ring-focus/50 has-[[data-slot][aria-invalid=true]]:ring-error/20 has-[[data-slot][aria-invalid=true]]:border-error dark:has-[[data-slot][aria-invalid=true]]:ring-error/40 has-disabled:bg-border-strong/50 dark:has-disabled:bg-border-strong/80 h-8 rounded-kira border transition-colors in-data-[slot=combobox-content]:focus-within:border-inherit in-data-[slot=combobox-content]:focus-within:ring-0 has-disabled:opacity-50 has-[[data-slot=input-group-control]:focus-visible]:ring-3 has-[[data-slot][aria-invalid=true]]:ring-3 has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col has-[>[data-align=block-end]]:[&>input]:pt-3 has-[>[data-align=block-start]]:[&>input]:pb-3 has-[>[data-align=inline-end]]:[&>input]:pr-1.5 has-[>[data-align=inline-start]]:[&>input]:pl-1.5 group/input-group relative flex w-full items-center p-0 outline-none has-[>textarea]:h-auto',
      kira: 'm-0 min-w-0 inline-flex items-center gap-1 h-control rounded-kira-sm border border-border-strong bg-field px-2 py-0 text-fg font-data text-kira-sm focus-within:border-focus focus-within:focus-ring aria-invalid:border-error',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

export type InputGroupBoxVariants = VariantProps<typeof inputGroupVariants>;

export const inputGroupButtonVariants = cva('gap-2 text-sm flex items-center shadow-none', {
  variants: {
    size: {
      xs: 'h-6 gap-1 rounded-[calc(var(--kira-radius)-3px)] px-1.5 [&>svg:not([class*=size-])]:size-3.5',
      sm: '',
      'icon-xs': 'size-6 rounded-[calc(var(--kira-radius)-3px)] p-0 has-[>svg]:p-0',
      'icon-sm': 'size-8 p-0 has-[>svg]:p-0',
    },
  },
  defaultVariants: {
    size: 'xs',
  },
});

export type InputGroupButtonVariants = VariantProps<typeof inputGroupButtonVariants>;

export interface InputGroupButtonProps {
  variant?: ButtonVariants['variant'];
  size?: InputGroupButtonVariants['size'];
  class?: HTMLAttributes['class'];
}
