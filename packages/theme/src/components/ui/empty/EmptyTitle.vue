<script setup lang="ts">
import { cn } from '@theme/lib/utils'
import type { HTMLAttributes } from 'vue'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <div
    data-slot="empty-title"
    :class="cn('text-kira-md text-muted-foreground font-normal', props.class)"
  >
    <slot />
  </div>
</template>
