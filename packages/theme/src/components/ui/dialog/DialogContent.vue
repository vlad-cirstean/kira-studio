<script setup lang="ts">
import { XIcon } from '@lucide/vue'
import { Button } from '@theme/components/ui/button'
import DialogOverlay from '@theme/components/ui/dialog/DialogOverlay.vue'
import { cn } from '@theme/lib/utils'
import { reactiveOmit } from '@vueuse/core'
import type { DialogContentEmits, DialogContentProps } from 'reka-ui'
import {
  DialogClose,
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

const props = withDefaults(defineProps<DialogContentProps & { class?: HTMLAttributes['class'], showCloseButton?: boolean, size?: NonNullable<DialogContentSizeVariants['size']>, fixedHeight?: boolean }>(), {
  showCloseButton: true,
  size: undefined,
  fixedHeight: false,
})
const emits = defineEmits<DialogContentEmits>()

const delegatedProps = reactiveOmit(props, 'class', 'size', 'fixedHeight', 'showCloseButton')

const forwarded = useForwardPropsEmits(delegatedProps, emits)

// P262: `size` selects the unified path (flex column, header/body/footer own their padding, close
// lives in DialogHeader). Without it the legacy grid path stays until close-out deletes it.
const contentClass = computed(() => props.size
  ? cn('bg-elevated text-fg data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 ring-fg/10 rounded-kira-pill text-kira-md ring-1 duration-100 fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 outline-none', dialogContentSizeVariants({ size: props.size, fixedHeight: props.fixedHeight }), props.class)
  : cn('bg-elevated text-fg data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 ring-fg/10 grid max-w-[calc(100%-2rem)] gap-4 rounded-kira-pill p-4 text-kira-md ring-1 duration-100 fixed top-1/2 left-1/2 z-50 w-full -translate-x-1/2 -translate-y-1/2 outline-none', props.class))
</script>

<template>
  <DialogPortal>
    <DialogOverlay />
    <DialogContent
      data-slot="dialog-content"
      v-bind="{ ...$attrs, ...forwarded }"
      :class="contentClass"
    >
      <slot />

      <DialogClose
        v-if="!size && showCloseButton"
        data-slot="dialog-close"
        as-child
      >
        <Button variant="ghost" class="absolute top-2 right-2" size="icon-sm">
          <XIcon />
          <span class="sr-only">Close</span>
        </Button>
      </DialogClose>
    </DialogContent>
  </DialogPortal>
</template>
