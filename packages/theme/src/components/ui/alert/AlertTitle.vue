<script setup lang="ts">
import { cn } from '@theme/lib/utils';
import type { HTMLAttributes } from 'vue';

const props = defineProps<{
  class?: HTMLAttributes['class'];
}>();
</script>

<template>
  <div
    data-slot="alert-title"
    :class="cn('font-medium [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-fg', props.class)"
  >
    <slot />
  </div>
</template>
