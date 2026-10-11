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
    :class="cn('border-border-strong aria-invalid:border-error rounded-kira-sm border bg-field px-2 py-1.5 text-kira-md transition-colors flex field-sizing-content min-h-16 w-full placeholder:text-muted-foreground disabled:cursor-default disabled:opacity-50', props.class)"
  />
</template>
