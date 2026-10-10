<script setup lang="ts">
import { cn } from '@theme/lib/utils'
import type { HTMLAttributes } from 'vue'
import { dialogBodyClass } from '.'

const props = defineProps<{
  flush?: boolean
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <div
    data-slot="dialog-body"
    :class="cn(dialogBodyClass, props.flush && 'gap-0 p-0', props.class)"
  >
    <slot />
  </div>
</template>
