<script setup lang="ts">
import { cn } from '@theme/lib/utils'
import { useVModel } from '@vueuse/core'
import type { HTMLAttributes } from 'vue'

const props = defineProps<{
  class?: HTMLAttributes['class']
  defaultValue?: string | number
  modelValue?: string | number
}>()

const emits = defineEmits<(e: 'update:modelValue', payload: string | number) => void>()

const modelValue = useVModel(props, 'modelValue', emits, {
  passive: true,
  defaultValue: props.defaultValue,
})
</script>

<template>
  <textarea
    v-model="modelValue"
    data-slot="textarea"
    :class="cn('border-border-strong dark:bg-border-strong/30 focus-visible:border-focus aria-invalid:ring-error/20 dark:aria-invalid:ring-error/40 aria-invalid:border-error dark:aria-invalid:border-error/50 disabled:bg-border-strong/50 dark:disabled:bg-border-strong/80 rounded-kira border bg-transparent px-2.5 py-2 text-base transition-colors aria-invalid:ring-3 md:text-sm flex field-sizing-content min-h-16 w-full placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50', props.class)"
  />
</template>
