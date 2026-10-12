<script setup lang="ts">
import { cn } from '@theme/lib/utils';
import type { HTMLAttributes } from 'vue';

const props = withDefaults(defineProps<{ class?: HTMLAttributes['class']; as?: string }>(), {
  as: 'div',
});
</script>

<template>
  <component
    :is="as"
    data-slot="card-title"
    :class="cn('min-w-0 truncate font-medium group-data-[variant=section]/card:text-kira-sm group-data-[variant=section]/card:font-normal group-data-[variant=section]/card:uppercase group-data-[variant=section]/card:tracking-wider group-data-[variant=section]/card:text-subtle', props.class)"
  >
    <slot />
  </component>
</template>
