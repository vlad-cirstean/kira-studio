<script setup lang="ts">
import { computed } from 'vue';
import { Translation } from 'vue-i18n';
import { messageDefaults } from './index';
import { formatCount } from './number';
import type { MessageKey, MessageParams } from './types';

const props = withDefaults(defineProps<{ k: MessageKey; params?: MessageParams; tag?: string }>(), {
  params: undefined,
  tag: 'span',
});

const slots = defineSlots<Record<string, (props: Record<string, unknown>) => unknown>>();

const count = computed(() =>
  typeof props.params?.count === 'number' ? props.params.count : undefined,
);

// Translation interpolates through slots only; plain params render as text slots.
const textParams = computed(() =>
  Object.entries({ ...messageDefaults(), ...props.params })
    .filter(([name]) => !(name in slots))
    .map(
      ([name, value]) =>
        [name, typeof value === 'number' ? formatCount(value) : String(value)] as const,
    ),
);
const slotNames = computed(() => Object.keys(slots));
</script>

<template>
  <Translation :keypath="k" :tag="tag" :plural="count">
    <template v-for="[ name, text ] in textParams" :key="name" #[name]>{{ text }}</template>
    <template v-for="name in slotNames" :key="name" #[name]="slotProps">
      <slot :name="name" v-bind="slotProps" />
    </template>
  </Translation>
</template>
