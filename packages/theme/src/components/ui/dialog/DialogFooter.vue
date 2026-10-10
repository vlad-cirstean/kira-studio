<script setup lang="ts">
import { Button } from '@theme/components/ui/button'
import { cn } from '@theme/lib/utils'
import { DialogClose } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { dialogFooterClass } from '.'

const props = withDefaults(defineProps<{
  class?: HTMLAttributes['class']
  showCloseButton?: boolean
}>(), {
  showCloseButton: false,
})
</script>

<template>
  <div
    data-slot="dialog-footer"
    :class="cn(dialogFooterClass, props.class)"
  >
    <div v-if="$slots.start" class="mr-auto flex min-w-0 items-center gap-1.5">
      <slot name="start" />
    </div>
    <slot />
    <DialogClose v-if="showCloseButton" as-child>
      <Button variant="dialog" size="kira-lg">
        Close
      </Button>
    </DialogClose>
  </div>
</template>
