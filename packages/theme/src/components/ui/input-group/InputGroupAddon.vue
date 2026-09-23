<script setup lang="ts">
import { cn } from '@theme/lib/utils'
import { useEventListener } from '@vueuse/core'
import { type HTMLAttributes, useTemplateRef } from 'vue'
import type { InputGroupVariants } from '.'
import { inputGroupAddonVariants } from '.'

const props = withDefaults(defineProps<{
  align?: InputGroupVariants['align']
  class?: HTMLAttributes['class']
}>(), {
  align: 'inline-start',
})

function handleInputGroupAddonClick(e: MouseEvent) {
  const currentTarget = e.currentTarget as HTMLElement | null
  const target = e.target as HTMLElement | null
  if (target?.closest('button')) {
    return
  }
  if (currentTarget?.parentElement) {
    currentTarget.parentElement?.querySelector('input')?.focus()
  }
}

// P105 §16: a pointer-only shortcut into the sibling <input>, which is already its own tab stop —
// off-template so it carries no interactive role/keyboard contract of its own (real fix, not a
// suppression: a keyboard user already reaches the input directly via Tab).
const addonEl = useTemplateRef<HTMLElement>('addonEl')
useEventListener(addonEl, 'click', handleInputGroupAddonClick)
</script>

<template>
  <fieldset
    ref="addonEl"
    data-slot="input-group-addon"
    :data-align="props.align"
    :class="cn('m-0 min-w-0 border-0 p-0', inputGroupAddonVariants({ align: props.align }), props.class)"
  >
    <slot />
  </fieldset>
</template>
