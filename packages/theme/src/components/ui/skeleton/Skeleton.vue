<script setup lang="ts">
import { cn } from '@theme/lib/utils';
import type { HTMLAttributes } from 'vue';

const props = defineProps<{ class?: HTMLAttributes['class'] }>();
</script>

<template>
  <div data-slot="skeleton" :class="cn('animate-pulse rounded-kira-sm bg-field', props.class)" />
</template>
