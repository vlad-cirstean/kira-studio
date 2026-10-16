<script setup lang="ts">
import { computed } from 'vue';

// 12 chips and steppers, 13 default, 16 mode tabs and the title bar, 24 empty-state media.
export type CodiconSize = 12 | 13 | 16 | 24;

const props = defineProps<{
  name: string;
  size: CodiconSize;
}>();

const style = computed(() => ({ fontSize: `${props.size}px` }));
</script>

<template>
  <i :class="`codicon codicon-${name}`" :style="style" aria-hidden="true" />
</template>
