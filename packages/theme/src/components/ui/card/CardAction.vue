<script setup lang="ts">
import { cn } from '@theme/lib/utils';
import type { HTMLAttributes } from 'vue';

const props = defineProps<{ class?: HTMLAttributes['class'] }>();
</script>

<template>
  <div data-slot="card-action" :class="cn('ml-auto flex items-center gap-1', props.class)">
    <slot />
  </div>
</template>
