<script setup lang="ts">
import { cn } from '@theme/lib/utils';
import type { VariantProps } from 'class-variance-authority';
import { cva } from 'class-variance-authority';
import type { HTMLAttributes } from 'vue';

// P110 I2-23 (§3.10): the h-bar shrink-0 flex items-center gap-1.5 px-2 (+ border) recipe, carried
// once instead of 36 times across 13 views + ErrorPopover.vue. `class` still reaches the root (via
// cn()), so a per-site extra like bg-elevated keeps working the same way it did as a raw string.
const viewToolbarVariants = cva('h-bar shrink-0 flex items-center gap-1.5 px-2', {
  variants: {
    border: {
      bottom: 'border-b border-border',
      top: 'border-t border-border',
      none: '',
    },
  },
  defaultVariants: {
    border: 'bottom',
  },
});

type ViewToolbarVariants = VariantProps<typeof viewToolbarVariants>;

const props = defineProps<{
  border?: ViewToolbarVariants['border'];
  class?: HTMLAttributes['class'];
}>();
</script>

<template>
  <div :class="cn(viewToolbarVariants({ border: props.border }), props.class)">
    <slot />
  </div>
</template>
