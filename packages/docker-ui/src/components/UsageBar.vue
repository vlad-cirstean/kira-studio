<script setup lang="ts">
import { computed } from 'vue';
import { usageToneClass } from '../lib/format';

const props = defineProps<{ percent: number }>();

const clamped = computed(() => Math.min(100, Math.max(0, props.percent)));
</script>

<template>
  <div class="h-1 w-full overflow-hidden rounded-full bg-field" aria-hidden="true" data-testid="docker-usage-bar">
    <div class="h-full rounded-full transition-[width] duration-300" :class="usageToneClass(clamped)" :style="{ width: `${clamped}%` }" />
  </div>
</template>
