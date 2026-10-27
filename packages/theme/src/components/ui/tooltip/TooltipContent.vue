<script setup lang="ts">
import { cn } from '@theme/lib/utils';
import { reactiveOmit } from '@vueuse/core';
import type { TooltipContentEmits, TooltipContentProps } from 'reka-ui';
import { TooltipArrow, TooltipContent, TooltipPortal, useForwardPropsEmits } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { type TooltipContentVariants, tooltipContentVariants } from '.';

defineOptions({
  inheritAttrs: false,
});

const props = withDefaults(
  defineProps<
    TooltipContentProps & {
      class?: HTMLAttributes['class'];
      variant?: TooltipContentVariants['variant'];
    }
  >(),
  {
    variant: 'default',
    sideOffset: 0,
    collisionPadding: 4,
  },
);

const emits = defineEmits<TooltipContentEmits>();

const delegatedProps = reactiveOmit(props, 'class', 'variant');
const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <TooltipPortal>
    <TooltipContent
      data-slot="tooltip-content"
      :data-variant="variant"
      v-bind="{ ...forwarded, ...$attrs }"
      :class="cn(tooltipContentVariants({ variant }), props.class)"
    >
      <slot />

      <TooltipArrow
        v-if="variant === 'default'"
        class="size-2.5 rotate-45 rounded-kira-xs bg-fg fill-fg z-(--kira-z-tooltip) -translate-y-1/2"
      />
    </TooltipContent>
  </TooltipPortal>
</template>
