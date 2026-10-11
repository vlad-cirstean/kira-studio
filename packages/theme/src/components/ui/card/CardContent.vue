<script setup lang="ts">
import { cn } from '@theme/lib/utils';
import type { HTMLAttributes } from 'vue';

const props = defineProps<{ class?: HTMLAttributes['class']; flush?: boolean }>();
</script>

<template>
  <div
    data-slot="card-content"
    :class="cn('min-w-0 group-data-[variant=section]/card:p-3', flush && 'group-data-[variant=section]/card:p-0', props.class)"
  >
    <slot />
  </div>
</template>
