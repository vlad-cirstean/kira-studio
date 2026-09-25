<script setup lang="ts">
import { CheckIcon } from '@lucide/vue'
import { cn } from '@theme/lib/utils'
import { reactiveOmit } from '@vueuse/core'
import type { CheckboxRootEmits, CheckboxRootProps } from 'reka-ui'
import { CheckboxIndicator, CheckboxRoot, useForwardPropsEmits } from 'reka-ui'
import type { HTMLAttributes } from 'vue'

const props = defineProps<CheckboxRootProps & { class?: HTMLAttributes['class'] }>()
const emits = defineEmits<CheckboxRootEmits>()

const delegatedProps = reactiveOmit(props, 'class')

const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <CheckboxRoot
    v-slot="slotProps"
    data-slot="checkbox"
    v-bind="forwarded"
    :class="cn('border-border-strong dark:bg-border-strong/30 data-checked:bg-primary data-checked:text-primary-foreground dark:data-checked:bg-primary data-checked:border-primary aria-invalid:aria-checked:border-primary aria-invalid:border-error dark:aria-invalid:border-error/50 focus-visible:border-focus focus-visible:ring-focus/50 aria-invalid:ring-error/20 dark:aria-invalid:ring-error/40 flex size-4 items-center justify-center rounded-[4px] border transition-colors group-has-disabled/field:opacity-50 focus-visible:ring-3 aria-invalid:ring-3 peer relative shrink-0 outline-none after:absolute after:-inset-x-3 after:-inset-y-2 disabled:cursor-not-allowed disabled:opacity-50', props.class)"
  >
    <CheckboxIndicator
      data-slot="checkbox-indicator"
      class="[&>svg]:size-3.5 grid place-content-center text-current transition-none"
    >
      <slot v-bind="slotProps">
        <CheckIcon />
      </slot>
    </CheckboxIndicator>
  </CheckboxRoot>
</template>
