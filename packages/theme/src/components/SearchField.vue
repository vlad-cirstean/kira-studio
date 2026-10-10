<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@theme/components/ui/input-group'
import { onMounted, useTemplateRef } from 'vue'

// P262 §2.5: the one search/filter text box. Attrs (data-testid, @keydown, @keydown.enter, ...) land
// on the <input>. Esc clears a non-empty value and stops there; an empty field lets Esc bubble so
// the surrounding surface (dialog, popover, find bar) still closes.
defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  modelValue: string
  placeholder?: string
  ariaLabel?: string
  size?: 'kira' | 'kira-lg'
  autofocus?: boolean
}>(), {
  placeholder: 'Search',
  ariaLabel: undefined,
  size: 'kira',
  autofocus: false,
})

const emit = defineEmits<(e: 'update:modelValue', value: string) => void>()

const input = useTemplateRef<{ $el: HTMLInputElement }>('input')

function focus(): void {
  input.value?.$el.focus()
}

function onEscape(e: KeyboardEvent): void {
  if (e.isComposing || props.modelValue === '') return
  e.stopPropagation()
  emit('update:modelValue', '')
}

function clear(): void {
  emit('update:modelValue', '')
  focus()
}

onMounted(() => {
  if (props.autofocus) focus()
})

defineExpose({ focus })
</script>

<template>
  <InputGroup :variant="size" data-slot="search-field">
    <InputGroupAddon align="inline-start">
      <CodiconIcon name="search" :size="13" />
    </InputGroupAddon>
    <InputGroupInput
      ref="input"
      v-bind="$attrs"
      :model-value="modelValue"
      :placeholder="placeholder"
      :aria-label="ariaLabel ?? placeholder"
      :size="size"
      @update:model-value="emit('update:modelValue', String($event))"
      @keydown.escape="onEscape"
    />
    <InputGroupAddon v-if="modelValue !== ''" align="inline-end">
      <InputGroupButton size="icon-xs" class="size-4" aria-label="Clear search" @click="clear">
        <CodiconIcon name="close" :size="12" />
      </InputGroupButton>
    </InputGroupAddon>
  </InputGroup>
</template>
