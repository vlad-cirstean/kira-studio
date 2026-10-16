<script setup lang="ts">
import { cn } from '@theme/lib/utils';
import { reactiveOmit, useVModel } from '@vueuse/core';
import type { AcceptableValue } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import type { NativeSelectVariants } from '.';
import { nativeSelectVariants } from '.';

defineOptions({
  inheritAttrs: false,
});

const props = defineProps<{
  modelValue?: AcceptableValue | AcceptableValue[];
  class?: HTMLAttributes['class'];
  variant?: NativeSelectVariants['variant'];
  size?: NativeSelectVariants['size'];
}>();

const emit = defineEmits<{
  'update:modelValue': [AcceptableValue];
}>();

const modelValue = useVModel(props, 'modelValue', emit, {
  passive: true,
  defaultValue: '',
});

const delegatedProps = reactiveOmit(props, 'class', 'variant', 'size');
</script>

<template>
  <select
    v-bind="{ ...$attrs, ...delegatedProps }"
    v-model="modelValue"
    data-slot="native-select"
    :class="cn(nativeSelectVariants({ variant, size }), props.class)"
  >
    <slot />
  </select>
</template>
