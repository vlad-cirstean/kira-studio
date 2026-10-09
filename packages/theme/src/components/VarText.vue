<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import type { TextPart } from '@theme/varText';

defineProps<{ parts: readonly TextPart[] }>();
</script>

<template>
  <template v-for="(p, i) in parts" :key="i">
    <template v-if="typeof p === 'string'">{{ p }}</template>
    <span
      v-else
      class="inline-flex items-center gap-0.5 rounded-kira-xs border border-dashed border-info/60 bg-info/10 px-1 font-data text-info"
      data-testid="var-chip"
      :data-var="p.name"
      :aria-label="`${p.name}: ${p.value}`"
    >
      <CodiconIcon name="symbol-variable" :size="11" />{{ p.value }}
    </span>
  </template>
</template>
