<script setup lang="ts">
import DialogOverlay from '@theme/components/ui/dialog/DialogOverlay.vue'
import { cn } from '@theme/lib/utils'
import { reactiveOmit } from '@vueuse/core'
import type { DialogContentEmits, DialogContentProps } from 'reka-ui'
import {
  DialogContent,
  DialogPortal,
  useForwardPropsEmits,
} from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { computed } from 'vue'
import type { DialogContentSizeVariants } from '.'
import { dialogContentSizeVariants } from '.'

defineOptions({
  inheritAttrs: false,
})

// P262: `size` is required. Header, body and footer own their padding; the close button lives in
// DialogHeader (`closable`).
const props = withDefaults(defineProps<DialogContentProps & { class?: HTMLAttributes['class'], size: NonNullable<DialogContentSizeVariants['size']>, fixedHeight?: boolean, destructive?: boolean }>(), {
  fixedHeight: false,
  destructive: false,
})
const emits = defineEmits<DialogContentEmits>()

const delegatedProps = reactiveOmit(props, 'class', 'size', 'fixedHeight', 'destructive')

const forwarded = useForwardPropsEmits(delegatedProps, emits)

// Initial focus: a destructive dialog opens on its dismiss control (`data-dialog-dismiss`) so Enter
// cancels instead of confirming; any other dialog may name a control with `data-dialog-initial`.
function onOpenAutoFocus(event: Event): void {
  const root = event.currentTarget as HTMLElement | null
  const target = root?.querySelector<HTMLElement>(props.destructive ? '[data-dialog-dismiss]' : '[data-dialog-initial]')
  if (!target) return
  event.preventDefault()
  target.focus()
}

const contentClass = computed(() => cn('bg-elevated text-fg data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 ring-fg/10 rounded-kira-pill text-kira-md ring-1 duration-100 fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 outline-none', dialogContentSizeVariants({ size: props.size, fixedHeight: props.fixedHeight }), props.class))
</script>

<template>
  <DialogPortal>
    <DialogOverlay />
    <DialogContent
      data-slot="dialog-content"
      v-bind="{ ...$attrs, ...forwarded }"
      :class="contentClass"
      @open-auto-focus="onOpenAutoFocus"
    >
      <slot />
    </DialogContent>
  </DialogPortal>
</template>
