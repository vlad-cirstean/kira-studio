<script setup lang="ts">
import { Input } from '@theme/components/ui/input'
import { cn } from '@theme/lib/utils'
import type { HTMLAttributes } from 'vue'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <Input
    data-slot="input-group-control"
    :class="cn(
      'rounded-none border-0 bg-transparent shadow-none outline-none disabled:bg-transparent aria-invalid:ring-0 dark:bg-transparent dark:disabled:bg-transparent flex-1',
      props.class,
    )"
  />
</template>
