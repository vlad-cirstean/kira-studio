<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue'
import { Button } from '@theme/components/ui/button'
import DialogClose from '@theme/components/ui/dialog/DialogClose.vue'
import { cn } from '@theme/lib/utils'
import type { HTMLAttributes } from 'vue'
import { dialogHeaderClass } from '.'

const props = withDefaults(defineProps<{
  class?: HTMLAttributes['class']
  icon?: string
  closable?: boolean
  closeTestid?: string
}>(), {
  closable: false,
})
</script>

<template>
  <div
    data-slot="dialog-header"
    :class="cn(dialogHeaderClass, props.class)"
  >
    <span
      v-if="icon"
      class="size-4 flex items-center justify-center shrink-0 text-muted-foreground"
    >
      <CodiconIcon :name="icon" :size="13" />
    </span>
    <slot />
    <DialogClose v-if="closable" as-child>
      <Button
        variant="ghost"
        size="icon-sm"
        class="ml-auto"
        aria-label="Close"
        :data-testid="closeTestid"
      >
        <CodiconIcon name="close" :size="13" />
      </Button>
    </DialogClose>
  </div>
</template>
