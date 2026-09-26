<script setup lang="ts">
import { cn } from '@theme/lib/utils'
import { reactiveOmit } from '@vueuse/core'
import type { TabsTriggerProps } from 'reka-ui'
import { TabsTrigger, useForwardProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'

const props = defineProps<TabsTriggerProps & { class?: HTMLAttributes['class'] }>()

const delegatedProps = reactiveOmit(props, 'class')

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <TabsTrigger
    data-slot="tabs-trigger"
    :class="cn('inline-flex items-center justify-center whitespace-nowrap disabled:pointer-events-none disabled:opacity-50', props.class)"
    v-bind="forwardedProps"
  >
    <slot />
  </TabsTrigger>
</template>
