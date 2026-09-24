<script setup lang="ts">
import { cn } from '@theme/lib/utils'
import type { HTMLAttributes } from 'vue'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <legend
    data-slot="field-legend"
    :class="cn('uppercase text-kira-sm text-subtle tracking-wider pt-1', props.class)"
  >
    <slot />
  </legend>
</template>
