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
  'text-muted-foreground h-auto gap-2 py-1.5 text-sm font-medium group-data-[disabled=true]/input-group:opacity-50 [&>kbd]:rounded-[calc(var(--radius)-5px)] [&>svg:not([class*=size-])]:size-4 flex cursor-text items-center justify-center select-none',
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

export const inputGroupButtonVariants = cva('gap-2 text-sm flex items-center shadow-none', {
  variants: {
    size: {
      xs: 'h-6 gap-1 rounded-[calc(var(--radius)-3px)] px-1.5 [&>svg:not([class*=size-])]:size-3.5',
      sm: '',
      'icon-xs': 'size-6 rounded-[calc(var(--radius)-3px)] p-0 has-[>svg]:p-0',
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
