<script setup lang="ts">
import type { toggleVariants } from '@theme/components/ui/toggle'
import { cn } from '@theme/lib/utils'
import { reactiveOmit } from '@vueuse/core'
import type { VariantProps } from 'class-variance-authority'
import type { ToggleGroupRootEmits, ToggleGroupRootProps } from 'reka-ui'
import { ToggleGroupRoot, useForwardPropsEmits } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { provide } from 'vue'

type ToggleGroupVariants = VariantProps<typeof toggleVariants>

const props = defineProps<ToggleGroupRootProps & {
  class?: HTMLAttributes['class']
  variant?: ToggleGroupVariants['variant']
  size?: ToggleGroupVariants['size']
  spacing?: number
}>()

const emits = defineEmits<ToggleGroupRootEmits>()

// Outline groups stay connected (K1 KuiSegmented precedent); default-variant
// groups become separate chips 2px apart (TabStrip's own gap-0.5).
const resolvedSpacing = props.spacing ?? (props.variant === 'outline' ? 0 : 0.5)

provide('toggleGroup', {
  variant: props.variant,
  size: props.size,
  spacing: resolvedSpacing,
})

const delegatedProps = reactiveOmit(props, 'class', 'size', 'variant', 'spacing')
const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <ToggleGroupRoot
    v-slot="slotProps"
    data-slot="toggle-group"
    :data-size="size"
    :data-variant="variant"
    :data-spacing="resolvedSpacing"
    :style="{
      '--gap': resolvedSpacing,
    }"
    v-bind="forwarded"
    :class="cn('rounded-kira-sm group/toggle-group flex w-fit flex-row items-center gap-[--spacing(var(--gap))] data-[orientation=vertical]:flex-col data-[orientation=vertical]:items-stretch', props.class)"
  >
    <slot v-bind="slotProps" />
  </ToggleGroupRoot>
</template>
