<script setup lang="ts">
import { cn } from '@theme/lib/utils'
import type { HTMLAttributes } from 'vue'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <div
    data-slot="field-group"
    :class="cn(
      'flex flex-row items-start [&>[data-slot=field]]:flex-1 [&>[data-slot=field]]:min-w-0',
      props.class,
    )"
  >
    <slot />
  </div>
</template>
