<script setup lang="ts">
import { cn } from '@theme/lib/utils'
import type { HTMLAttributes } from 'vue'
import type { InputGroupBoxVariants } from '.'
import { inputGroupVariants } from '.'

// P110 B25: `variant` added (default: 'default', shadcn-vue's own registry root, untouched) --
// `kira` is the retired `.p-input` box's own successor, see index.ts's own inputGroupVariants doc
// comment for the token mapping.
const props = withDefaults(
  defineProps<{
    class?: HTMLAttributes['class']
    variant?: InputGroupBoxVariants['variant']
  }>(),
  { variant: 'default' },
)
</script>

<template>
  <fieldset
    data-slot="input-group"
    :class="cn(inputGroupVariants({ variant: props.variant }), props.class)"
  >
    <slot />
  </fieldset>
</template>
