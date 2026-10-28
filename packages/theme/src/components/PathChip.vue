<script setup lang="ts">
import TruncatedText from '@theme/components/TruncatedText.vue';
import ValueChip from '@theme/components/ValueChip.vue';
import type { HTMLAttributes } from 'vue';

withDefaults(
  defineProps<{
    path: string;
    variant?: 'default' | 'info' | 'warn';
    class?: HTMLAttributes['class'];
  }>(),
  { variant: 'default' },
);
</script>

<template>
  <ValueChip
    :value="path"
    icon="folder"
    chip="path"
    :variant="variant"
    :class="$props.class"
    data-testid="path-chip"
  >
    <TruncatedText v-if="path" :text="path" split="path" />
  </ValueChip>
</template>
