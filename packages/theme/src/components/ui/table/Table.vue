<script setup lang="ts">
import { cn } from '@theme/lib/utils';
import type { HTMLAttributes } from 'vue';

// `columns` adds cell dividers (data tables); list tables show rows only.
const props = defineProps<{ class?: HTMLAttributes['class']; columns?: boolean }>();
</script>

<template>
  <table
    data-slot="table"
    :data-columns="columns ? '' : undefined"
    :class="cn('group/table w-full border-collapse text-kira-md', props.class)"
  >
    <slot />
  </table>
</template>
