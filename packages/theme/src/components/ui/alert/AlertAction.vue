<script setup lang="ts">
import { cn } from '@theme/lib/utils'
import type { HTMLAttributes } from 'vue'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <div
    data-slot="alert-action"
    :class="cn('absolute top-2 right-2', props.class)"
  >
    <slot />
  </div>
</template>
