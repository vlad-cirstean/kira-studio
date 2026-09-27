<script setup lang="ts">
import { cn } from '@theme/lib/utils'
import { reactiveOmit } from '@vueuse/core'
import type { SwitchRootEmits, SwitchRootProps } from 'reka-ui'
import { SwitchRoot, SwitchThumb, useForwardPropsEmits } from 'reka-ui'
import type { HTMLAttributes } from 'vue'

// P129 Part 4 §0.18/§2.7: the force-push toggle's own control (mockup line 519-523's own
// `pushTrack`/`pushKnob`, ported onto a real shadcn-vue primitive). `checkbox`/`radio-group`'s own
// reka-nova rewrite is the precedent this follows (`@theme/lib/utils`, `focus-visible:border-focus`,
// no ring, theme tokens) — but targets `data-[state=checked]:`, not their own `data-checked:`
// shorthand: reka-ui's `SwitchRoot`/`SwitchThumb` (checked against the installed package's own
// `SwitchRoot.cjs`) emit `data-state="checked"|"unchecked"`, never a bare `data-checked` attribute,
// so `data-checked:` never matches anything on either sibling component either — not reproduced here.
const props = defineProps<SwitchRootProps & { class?: HTMLAttributes['class'] }>()
const emits = defineEmits<SwitchRootEmits>()

const delegatedProps = reactiveOmit(props, 'class')
const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <SwitchRoot
    data-slot="switch"
    v-bind="forwarded"
    :class="
      cn(
        'peer inline-flex h-[1.15rem] w-8 shrink-0 cursor-pointer items-center rounded-full border border-border-strong bg-transparent transition-colors focus-visible:border-focus disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary',
        props.class,
      )
    "
  >
    <SwitchThumb
      data-slot="switch-thumb"
      class="pointer-events-none block size-3.5 rounded-full bg-fg shadow-sm transition-transform data-[state=unchecked]:translate-x-0.5 data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-primary-foreground"
    />
  </SwitchRoot>
</template>
