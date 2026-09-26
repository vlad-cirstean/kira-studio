<script setup lang="ts">
import { cn } from '@theme/lib/utils'
import type { HTMLAttributes } from 'vue'

defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <p
    data-slot="empty-description"
    :class="cn(
      'text-kira-sm text-subtle leading-normal',
      $attrs.class ?? '',
    )"
  >
    <slot />
  </p>
</template>
