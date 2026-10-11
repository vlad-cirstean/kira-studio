<script setup lang="ts">
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { useResizeObserver } from '@vueuse/core';
import { ref, useTemplateRef } from 'vue';

// A single-line truncating span. The full text shows in a tooltip only while it is actually cut
// off. Virtual rows keep `AttributeTooltip` instead (DOM-cheap per row).
defineProps<{ text: string }>();

const el = useTemplateRef<HTMLElement>('el');
const overflowing = ref(false);
useResizeObserver(el, () => {
  const node = el.value;
  overflowing.value = node !== null && node.scrollWidth > node.clientWidth;
});
</script>

<template>
  <Tooltip :disabled="!overflowing">
    <TooltipTrigger as-child>
      <span ref="el" class="block min-w-0 truncate"><slot>{{ text }}</slot></span>
    </TooltipTrigger>
    <TooltipContent>{{ text }}</TooltipContent>
  </Tooltip>
</template>
