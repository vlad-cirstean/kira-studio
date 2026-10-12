<script setup lang="ts">
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { useResizeObserver } from '@vueuse/core';
import { computed, ref, useTemplateRef } from 'vue';

// A single-line truncating span. The full text shows in a tooltip only while it is actually cut
// off. `split="path"` keeps the file name visible and truncates the directory instead. Virtual
// rows keep `AttributeTooltip` instead (DOM-cheap per row).
const props = defineProps<{ text: string; split?: 'path' }>();

const el = useTemplateRef<HTMLElement>('el');
const overflowing = ref(false);
useResizeObserver(el, () => {
  const node = el.value;
  overflowing.value = node !== null && node.scrollWidth > node.clientWidth;
});

const parts = computed(() => {
  const at = props.text.lastIndexOf('/');
  return at < 0
    ? { dir: '', name: props.text }
    : { dir: props.text.slice(0, at + 1), name: props.text.slice(at + 1) };
});
</script>

<template>
  <Tooltip :disabled="!overflowing">
    <TooltipTrigger as-child>
      <span v-if="split === 'path'" class="flex min-w-0">
        <span ref="el" class="min-w-0 truncate">{{ parts.dir }}</span>
        <span class="shrink-0">{{ parts.name }}</span>
      </span>
      <span v-else ref="el" class="block min-w-0 truncate"><slot>{{ text }}</slot></span>
    </TooltipTrigger>
    <TooltipContent>{{ text }}</TooltipContent>
  </Tooltip>
</template>
