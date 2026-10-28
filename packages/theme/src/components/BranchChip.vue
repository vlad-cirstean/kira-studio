<script setup lang="ts">
import ValueChip from '@theme/components/ValueChip.vue';
import type { HTMLAttributes } from 'vue';

withDefaults(
  defineProps<{
    name: string;
    variant?: 'default' | 'info' | 'warn';
    class?: HTMLAttributes['class'];
  }>(),
  { variant: 'default' },
);
</script>

<template>
  <ValueChip
    :value="name"
    icon="git-branch"
    chip="branch"
    :variant="variant"
    :class="$props.class"
    data-testid="branch-chip"
  />
</template>
