<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{ values: readonly number[]; max?: number; width?: number; height?: number }>(), {
  max: 0,
  width: 240,
  height: 48,
});

const points = computed(() => {
  const n = props.values.length;
  if (n < 2) return '';
  const top = props.max > 0 ? props.max : Math.max(1, ...props.values);
  const step = props.width / (n - 1);
  return props.values
    .map((v, i) => `${(i * step).toFixed(1)},${(props.height - (Math.min(v, top) / top) * props.height).toFixed(1)}`)
    .join(' ');
});
</script>

<template>
  <svg
    :viewBox="`0 0 ${width} ${height}`"
    preserveAspectRatio="none"
    class="h-12 w-full rounded-kira-sm bg-field"
    aria-hidden="true"
  >
    <polyline v-if="points" :points="points" fill="none" class="stroke-info" stroke-width="1.5" vector-effect="non-scaling-stroke" />
  </svg>
</template>
