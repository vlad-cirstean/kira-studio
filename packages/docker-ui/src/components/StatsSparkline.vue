<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{ values: readonly number[]; max?: number; width?: number; height?: number; heightClass?: string }>(),
  { max: 0, width: 240, height: 48, heightClass: 'h-12' },
);

const coords = computed(() => {
  const n = props.values.length;
  if (n < 2) return [];
  const top = props.max > 0 ? props.max : Math.max(1, ...props.values);
  const step = props.width / (n - 1);
  return props.values.map((v, i): [number, number] => [i * step, props.height - (Math.min(v, top) / top) * props.height]);
});

const line = computed(() => coords.value.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '));
const area = computed(() => (line.value ? `0,${props.height} ${line.value} ${props.width},${props.height}` : ''));
</script>

<template>
  <svg
    :viewBox="`0 0 ${width} ${height}`"
    preserveAspectRatio="none"
    class="w-full rounded-kira-sm bg-field"
    :class="heightClass"
    aria-hidden="true"
  >
    <polygon v-if="area" :points="area" class="fill-info/15" />
    <polyline v-if="line" :points="line" fill="none" class="stroke-info" stroke-width="1.5" vector-effect="non-scaling-stroke" />
  </svg>
</template>
