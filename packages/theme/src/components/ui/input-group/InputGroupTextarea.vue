<script setup lang="ts">
import { Textarea } from '@theme/components/ui/textarea'
import { cn } from '@theme/lib/utils'
import type { HTMLAttributes } from 'vue'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <Textarea
    data-slot="input-group-control"
    :class="cn(
      'rounded-none border-0 bg-transparent py-2 shadow-none outline-none disabled:bg-transparent aria-invalid:ring-0 dark:bg-transparent dark:disabled:bg-transparent flex-1 resize-none',
      props.class,
    )"
  />
</template>
