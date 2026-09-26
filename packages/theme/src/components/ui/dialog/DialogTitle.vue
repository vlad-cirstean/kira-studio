<script setup lang="ts">
import { cn } from '@theme/lib/utils'
import { reactiveOmit } from '@vueuse/core'
import type { DialogTitleProps } from 'reka-ui'
import { DialogTitle, useForwardProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'

const props = defineProps<DialogTitleProps & { class?: HTMLAttributes['class'] }>()

const delegatedProps = reactiveOmit(props, 'class')

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <DialogTitle
    data-slot="dialog-title"
    v-bind="forwardedProps"
    :class="cn('cn-font-heading text-kira-lg font-normal', props.class)"
  >
    <slot />
  </DialogTitle>
  <!-- text-kira-lg replaces shadcn's leading-none base; twMerge drops leading-none once a later
       font-size lands. -->
</template>
