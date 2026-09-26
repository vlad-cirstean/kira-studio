<script setup lang="ts">
import { cn } from '@theme/lib/utils'
import { useVModel } from '@vueuse/core'
import type { HTMLAttributes } from 'vue'
import type { InputVariants } from '.'
import { inputVariants } from '.'

const props = defineProps<{
  defaultValue?: string | number
  modelValue?: string | number
  class?: HTMLAttributes['class']
  size?: InputVariants['size']
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
    :class="cn(inputVariants({ size: props.size }), props.class)"
  >
</template>
