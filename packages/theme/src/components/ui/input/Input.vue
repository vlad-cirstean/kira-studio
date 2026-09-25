<script setup lang="ts">
import { cn } from '@theme/lib/utils'
import { useVModel } from '@vueuse/core'
import type { HTMLAttributes } from 'vue'

const props = defineProps<{
  defaultValue?: string | number
  modelValue?: string | number
  class?: HTMLAttributes['class']
}>()

const emits = defineEmits<(e: 'update:modelValue', payload: string | number) => void>()

const modelValue = useVModel(props, 'modelValue', emits, {
  passive: true,
  defaultValue: props.defaultValue,
})
</script>

<template>
  <input
    v-model="modelValue"
    data-slot="input"
    :class="cn(
      'dark:bg-border-strong/30 border-border-strong focus-visible:border-focus focus-visible:ring-focus/50 aria-invalid:ring-error/20 dark:aria-invalid:ring-error/40 aria-invalid:border-error dark:aria-invalid:border-error/50 disabled:bg-border-strong/50 dark:disabled:bg-border-strong/80 h-8 rounded-lg border bg-transparent px-2.5 py-1 text-base transition-colors file:h-6 file:text-sm file:font-medium focus-visible:ring-3 aria-invalid:ring-3 md:text-sm w-full min-w-0 outline-none file:inline-flex file:border-0 file:bg-transparent file:text-fg placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
      props.class,
    )"
  >
</template>
