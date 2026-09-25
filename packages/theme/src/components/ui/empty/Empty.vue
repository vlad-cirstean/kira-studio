<script setup lang="ts">
import { cn } from '@theme/lib/utils'
import type { HTMLAttributes } from 'vue'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <div
    data-slot="empty"
    :class="cn(
      'flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-center',
      props.class,
    )"
  >
    <slot />
  </div>
</template>
