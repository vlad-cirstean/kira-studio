<script setup lang="ts">
import { cn } from '@theme/lib/utils';
import { useVModel } from '@vueuse/core';
import type { HTMLAttributes } from 'vue';
import type { TextareaVariants } from '.';
import { textareaVariants } from '.';

const props = defineProps<{
  class?: HTMLAttributes['class'];
  defaultValue?: string | number;
  modelValue?: string | number;
  size?: TextareaVariants['size'];
  appearance?: TextareaVariants['appearance'];
}>();

const emits = defineEmits<(e: 'update:modelValue', payload: string | number) => void>();

const modelValue = useVModel(props, 'modelValue', emits, {
  passive: true,
  defaultValue: props.defaultValue,
});
</script>

<template>
  <textarea
    v-model="modelValue"
    data-slot="textarea"
    :class="cn(textareaVariants({ size: props.size, appearance: props.appearance }), props.class)"
  />
</template>
