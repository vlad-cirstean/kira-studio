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
  <!-- P110 I2-21 (§3.10): base is today's already-merged 17-site override. `leading-none` is gone
       -- twMerge already dropped it once a later font-size (`text-kira-lg`) landed on top of the
       old `text-base leading-none font-medium` base, verified with the real cn() before this
       change (empirically: cn('text-base leading-none font-medium cn-font-heading', 'text-kira-lg
       font-normal') => 'cn-font-heading text-kira-lg font-normal', no leading-none survives). -->
</template>
