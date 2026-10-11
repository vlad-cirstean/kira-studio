<script setup lang="ts">
import { cn } from '@theme/lib/utils';
import type { HTMLAttributes } from 'vue';
import type { CardVariants } from '.';
import { cardVariants } from '.';

const props = defineProps<{ class?: HTMLAttributes['class']; variant?: CardVariants['variant'] }>();
</script>

<template>
  <div data-slot="card" :data-variant="variant ?? 'inset'" :class="cn(cardVariants({ variant }), props.class)">
    <slot />
  </div>
</template>
